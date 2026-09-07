// 生成合成"说话"测试视频（零系统依赖）：用本机 Edge 在浏览器里录制
//   画面：动画卡通脸（嘴随正弦张合）4.8s
//   音轨：test_mouth.wav（低/中/高音量段 + 静音，供建库工具能量抽帧）
// 输出：input/test/test_video.webm
// 用法：node tools/make-test-video.mjs（需开发服务器在 48620 运行，提供 /api/input）
import { chromium } from 'playwright-core';
import { writeFileSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveBrowserExe } from './edge.mjs';

const EXE = resolveBrowserExe();
if (!EXE) {
  console.log('SKIP: 未找到本机 Edge/Chrome，跳过（可用环境变量 EDGE_PATH 指定浏览器）。');
  process.exit(0);
}
const BASE = 'http://127.0.0.1:' + (process.env.PORT || 48620);
const DURATION = 4.8; // 取 test_mouth.wav 前段（含静音+低/中/高音量）
const OUT = fileURLToPath(new URL('../../input/test/test_video.webm', import.meta.url));

const browser = await chromium.launch({
  executablePath: EXE,
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
// 先导航到同源页面（about:blank 的 opaque origin 会被 Chromium 的 Private Network Access 拦截 localhost 请求）
await page.goto(`${BASE}/web/index.html`, { waitUntil: 'domcontentloaded' });

const b64 = await page.evaluate(async ({ duration }) => {
  const DUR = duration;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const actx = new AudioContext();
  const wav = await (await fetch('/api/input/test/test_mouth.wav')).arrayBuffer();
  const audioBuf = await actx.decodeAudioData(wav);
  const src = actx.createBufferSource();
  src.buffer = audioBuf;
  const recDest = actx.createMediaStreamDestination();
  src.connect(recDest);
  src.connect(actx.destination);

  const canvasStream = canvas.captureStream(30);
  const combined = new MediaStream([...canvasStream.getVideoTracks(), ...recDest.stream.getAudioTracks()]);
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
  const rec = new MediaRecorder(combined, { mimeType: mime });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise((res) => { rec.onstop = res; });
  rec.start(100);
  src.start();

  const t0 = performance.now();
  function frame() {
    const t = (performance.now() - t0) / 1000;
    if (t > DUR) { rec.stop(); return; }
    // 动画脸：嘴高 = 4 + 26*(0.35 + 0.3*sin(2π*2t))
    ctx.fillStyle = '#cdcdd4'; ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#3e302a'; ctx.beginPath(); ctx.ellipse(128, 92, 96, 88, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f0caaa'; ctx.beginPath(); ctx.ellipse(128, 134, 82, 94, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#28282e';
    ctx.beginPath(); ctx.arc(102, 120, 4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(154, 120, 4, 0, Math.PI * 2); ctx.fill();
    const mh = 4 + 26 * (0.35 + 0.3 * Math.sin(2 * Math.PI * 2 * t));
    ctx.fillStyle = '#802e2e'; ctx.fillRect(98, 178 - mh, 60, mh);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  await done;
  await new Promise((r) => setTimeout(r, 200));

  const blob = new Blob(chunks, { type: 'video/webm' });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}, { duration: DURATION });

await browser.close();
writeFileSync(OUT, Buffer.from(b64, 'base64'));
const magic = readFileSync(OUT).subarray(0, 4).toString('hex');
console.log(`已生成测试视频: ${OUT}`);
console.log(`大小: ${statSync(OUT).size} 字节 | EBML 魔数: ${magic}（${magic === '1a45dfa3' ? '✓' : '✗'}）`);
