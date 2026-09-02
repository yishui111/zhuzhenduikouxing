// 无记号兜底建库：录像没喊记号时，按能量分位把帧分成 E0~E3 四档，每档抽代表帧建库
// 用法：node tools/build-lib-energysplit.mjs <input相对路径> [库名]
import { chromium } from 'playwright-core';
import { basename } from 'node:path';
import { resolveBrowserExe } from './edge.mjs';

const EXE = resolveBrowserExe();
if (!EXE) {
  console.log('SKIP: 未找到本机 Edge/Chrome，跳过（可用环境变量 EDGE_PATH 指定浏览器）。');
  process.exit(0);
}
const BASE = 'http://127.0.0.1:' + (process.env.PORT || 48620);
const REL = process.argv[2];
const LIB = process.argv[3] || 'lib_real';
if (!REL) {
  console.log('用法: node tools/build-lib-energysplit.mjs <input相对路径> [库名]');
  console.log('  例: node tools/build-lib-energysplit.mjs input/我的录像.mp4 lib_me');
  process.exit(1);
}
const FILE = basename(REL);
const FRAMES_PER_SLOT = 10;  // 帧加密：每档 10 帧，共 40 帧，覆盖"嘴巴张开幅度"的细腻梯度

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
await page.goto(`${BASE}/web/index.html`, { waitUntil: 'domcontentloaded' });

// 浏览器内：采集能量 → 分 4 档 → 每档抽代表帧 → 返回 base64
const result = await page.evaluate(async ({ file, framesPerSlot }) => {
  const video = document.createElement('video');
  video.muted = true;
  const blob = await (await fetch('/api/input/' + file)).blob();
  video.src = URL.createObjectURL(blob);
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('元数据超时')), 15000);
    video.onloadedmetadata = () => { clearTimeout(t); res(); };
    video.onerror = () => rej(new Error('视频加载失败'));
  });
  const duration = video.duration;

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
      const r = Math.sqrt(sum / buf.length);
      const d = r <= 1e-9 ? -120 : 20 * Math.log10(r);
      const t = video.currentTime;
      if (t !== lastT) { lastT = t; db.push(d); times.push(t); }
      requestAnimationFrame(tick);
    };
    tick();
  });
  try { src.disconnect(); actx.close(); } catch { /* noop */ }
  if (db.length < 20) return { err: '能量采集帧过少' };

  const sorted = [...db].sort((a, b) => a - b);
  const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const bounds = [p(0.25), p(0.5), p(0.75)];
  const slotOf = (d) => (d < bounds[0] ? 0 : d < bounds[1] ? 1 : d < bounds[2] ? 2 : 3);

  const picks = [];
  for (let slot = 0; slot < 4; slot++) {
    const idx = [];
    for (let i = 0; i < db.length; i++) if (slotOf(db[i]) === slot) idx.push(i);
    if (!idx.length) continue;
    // 按时间排序后均匀取帧（保证时间分散，避免几帧挤在同一时刻）
    idx.sort((a, b) => times[a] - times[b]);
    for (let k = 0; k < framesPerSlot; k++) {
      const pos = Math.floor(((k + 0.5) / framesPerSlot) * idx.length);
      picks.push({ slot, t: times[idx[pos]] });
    }
  }

  const out = [];
  for (const pk of picks) {
    await new Promise((res) => { const h = () => { video.removeEventListener('seeked', h); res(); }; video.addEventListener('seeked', h); video.currentTime = Math.min(pk.t, duration - 0.05); });
    // cover 模式抽帧：等比放大铺满画布、居中裁剪，无黑边、不变形
    const c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    const ctx = c.getContext('2d');
    const vw = video.videoWidth || 720;
    const vh = video.videoHeight || 1280;
    const sc = Math.max(512 / vw, 512 / vh);
    const dw = vw * sc;
    const dh = vh * sc;
    ctx.drawImage(video, (512 - dw) / 2, (512 - dh) / 2, dw, dh);
    out.push({ slot: pk.slot, t: pk.t, data: c.toDataURL('image/jpeg', 0.85).split(',')[1] });
  }

  // 背景帧：视频中间一帧 cover 铺满，作为切换时的背景（避免显示黑色）
  await new Promise((res) => { const h = () => { video.removeEventListener('seeked', h); res(); }; video.addEventListener('seeked', h); video.currentTime = duration / 2; });
  {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    const ctx = c.getContext('2d');
    const vw = video.videoWidth || 720;
    const vh = video.videoHeight || 1280;
    const sc = Math.max(512 / vw, 512 / vh);
    ctx.drawImage(video, (512 - vw * sc) / 2, (512 - vh * sc) / 2, vw * sc, vh * sc);
    out.background = c.toDataURL('image/jpeg', 0.8).split(',')[1];
  }
  return { duration, out, bg: out.background, bounds: bounds.map((b) => b.toFixed(1)) };
}, { file: FILE, framesPerSlot: FRAMES_PER_SLOT });

await browser.close();
if (result.err) { console.log('❌', result.err); process.exit(1); }
const counts = [0, 1, 2, 3].map((s) => result.out.filter((x) => x.slot === s).length);
console.log(`视频 ${result.duration.toFixed(1)}s | 分档边界 ${result.bounds.join('/')}dB | 帧数 ${result.out.length}（E0~E3: ${counts.join('/')}）`);

// 上传帧 + 背景 + manifest
async function postFile(name, rel, b64) {
  const r = await fetch(`${BASE}/api/lib/${name}/${rel}`, { method: 'POST', body: Buffer.from(b64, 'base64') });
  if (!r.ok) throw new Error(`上传失败 ${rel}: ${r.status}`);
}
const frames = [];
for (let i = 0; i < result.out.length; i++) {
  const f = result.out[i];
  const id = `E${f.slot}_x0_${i}`;
  const rel = `frames/${id}.jpg`;
  await postFile(LIB, rel, f.data);
  frames.push({ id, file: rel, slot: f.slot, expr: 0 });
  console.log(`帧 ${id} ← ${f.t.toFixed(2)}s`);
}
// 背景图（切换时显示，避免黑背景）
const bgRel = 'frames/background.jpg';
if (result.bg) {
  await postFile(LIB, bgRel, result.bg);
  console.log(`背景帧 ${bgRel}`);
} else {
  console.log('⚠️ 无背景帧');
}
const manifest = {
  meta: {
    name: LIB,
    person: '（真人 · 无记号能量分档版）',
    created: new Date().toISOString().slice(0, 10),
    note: `由能量分档自动生成（未喊记号兜底）：${result.duration.toFixed(1)}s 录像按能量 25/50/75 分位分档抽帧。建议按《录制指南》补录带记号的完整版以覆盖闭嘴/大张/表情。`,
    frameMs: 33,
  },
  background: bgRel,
  frames,
  clips: [],
};
await postFile(LIB, 'manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)).toString('base64'));

const libs = await (await fetch(`${BASE}/api/libs`)).json();
console.log('素材库列表:', libs.libs.join(', '));
const ok = libs.libs.includes(LIB) && frames.length >= 4 && errors.length === 0;
await browser.close().catch(() => {});
if (ok) {
  console.log(`✅ 真人素材库 ${LIB} 已生成：${frames.length} 帧（E0~E3 各 ${counts.join('/')}），服务器可读`);
  console.log('主页面(index.html) 素材库下拉选 ' + LIB + ' → 播放音频/开麦克风 → 实时演示');
  process.exit(0);
}
console.log('❌ 建库失败');
if (errors.length) console.log(errors.join('\n'));
process.exit(1);
