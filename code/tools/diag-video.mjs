// 诊断真人视频的能量分布：判断有没有声音、有没有明显峰值（记号）
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { basename } from 'node:path';
import { resolveBrowserExe } from './edge.mjs';

const EXE = resolveBrowserExe();
if (!EXE) {
  console.log('SKIP: 未找到本机 Edge/Chrome，跳过（可用环境变量 EDGE_PATH 指定浏览器）。');
  process.exit(0);
}
const BASE = 'http://127.0.0.1:' + (process.env.PORT || 48620);
const VIDEO = process.argv[2];
if (!VIDEO) {
  console.log('用法: node tools/diag-video.mjs <input相对路径>');
  console.log('  例: node tools/diag-video.mjs input/我的录像.mp4');
  process.exit(1);
}
const REL = basename(VIDEO); // 只取文件名，经 /api/input/ 读取

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage();
await page.goto(`${BASE}/web/index.html`, { waitUntil: 'domcontentloaded' });

const result = await page.evaluate(async (rel) => {
  const video = document.createElement('video');
  const blob = await (await fetch('/api/input/' + rel)).blob();
  video.src = URL.createObjectURL(blob);
  video.muted = true;
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('元数据加载超时')), 15000);
    video.onloadedmetadata = () => { clearTimeout(t); res(); };
    video.onerror = () => { clearTimeout(t); rej(new Error('视频加载失败')); };
  });
  const stream = video.captureStream();
  const audioTracks = stream.getAudioTracks();
  if (!audioTracks.length) return { err: '视频无音轨' };
  const actx = new AudioContext();
  const src = actx.createMediaStreamSource(new MediaStream(audioTracks));
  const analyser = actx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0;
  src.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const db = [];
  const times = [];
  video.playbackRate = 2;
  await video.play();
  let lastT = -1;
  await new Promise((resolve) => {
    const tick = () => {
      if (video.ended || video.paused) { resolve(); return; }
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const d = rms <= 1e-9 ? -120 : 20 * Math.log10(rms);
      const t = video.currentTime;
      if (t !== lastT) { lastT = t; db.push(d); times.push(t); }
      requestAnimationFrame(tick);
    };
    tick();
  });
  try { src.disconnect(); actx.close(); } catch { /* noop */ }
  return { duration: times.length ? times[times.length - 1] : 0, frames: db.length, db, times };
}, REL);

await browser.close();

if (result.err) { console.log('❌', result.err); process.exit(1); }
const { duration, frames, db, times } = result;
console.log(`时长 ${duration.toFixed(1)}s，采集 ${frames} 帧`);
const maxDb = Math.max(...db);
const minDb = Math.min(...db);
const avgDb = db.reduce((a, b) => a + b, 0) / db.length;
console.log(`能量范围: ${minDb.toFixed(1)} ~ ${maxDb.toFixed(1)} dB，均值 ${avgDb.toFixed(1)} dB`);

// 每 2 秒一段的平均
console.log('--- 每 2 秒平均能量 ---');
for (let t = 0; t < duration; t += 2) {
  const seg = db.filter((_, i) => times[i] >= t && times[i] < t + 2);
  if (seg.length) {
    const m = seg.reduce((a, b) => a + b, 0) / seg.length;
    console.log(`  ${t.toFixed(0)}~${(t + 2).toFixed(0)}s: ${m.toFixed(1)} dB`);
  }
}

// 找前 10 个峰值（简单局部最大：比前后 5 帧高，且间隔 >0.5s）
const peaks = [];
for (let i = 5; i < db.length - 5; i++) {
  let isPeak = true;
  for (let k = -5; k <= 5; k++) { if (db[i + k] > db[i]) { isPeak = false; break; } }
  if (isPeak && db[i] > avgDb + 5) {
    if (!peaks.length || times[i] - peaks[peaks.length - 1].t > 0.5) peaks.push({ t: times[i], db: db[i] });
  }
}
console.log('--- 明显峰值（可能=记号） ---');
if (!peaks.length) console.log('  无');
peaks.slice(0, 15).forEach((p) => console.log(`  ${p.t.toFixed(2)}s  ${p.db.toFixed(1)}dB`));
