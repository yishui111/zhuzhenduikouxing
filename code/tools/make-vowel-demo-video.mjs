// 生成"AEIOU 口型对比演示"视频（二次元卡通形象）+ 配套素材库 lib_aeiou
//   画面：二次元脸，依次发 a/e/i/o/u，嘴形同步变化，屏幕大字标注当前元音（标准答案）
//   音频：共振峰合成（F0 脉冲串过 F1/F2/F3 谐振器级联，人声结构，可被 core/formants.mjs 检测）
//   产物：input/test/test_vowel_demo.webm（~10s）+ avatar/libs/lib_aeiou（元音标签关键帧库）
// 用法：node tools/make-vowel-demo-video.mjs（需开发服务器在 48620 运行，用于建库上传）
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBrowserExe } from './edge.mjs';

const EXE = resolveBrowserExe();
if (!EXE) { console.log('SKIP: 未找到本机 Edge/Chrome。'); process.exit(0); }
const BASE = 'http://127.0.0.1:' + (process.env.PORT || 48620);
const OUT = fileURLToPath(new URL('../../input/test/test_vowel_demo.webm', import.meta.url));
const LIB = 'lib_aeiou';
mkdirSync(dirname(OUT), { recursive: true });

// 页面端代码：二次元脸绘制 + 共振峰合成 + 录制。时间轴（秒）：
//   0~0.8 开场标题（闭嘴）；之后 5 段、每段 1.8s：0~0.35 预备 / 0.35~1.3 发音（音频 0.4 起、长 0.95s）/ 1.3~1.8 收
const PAGE_CODE = `
// —— 元音参数（与 core/formants.mjs VOWEL_REFS 一致，F3 补充人声质感）——
const VOWELS = [
  { key: 'a', F: [850, 1250, 2800], label: 'あ a', cn: '啊', mouth: [0.80, 1.00] },
  { key: 'e', F: [500, 1800, 2500], label: 'え e', cn: '欸', mouth: [1.15, 0.40] },
  { key: 'i', F: [300, 2300, 3000], label: 'い i', cn: '衣', mouth: [1.25, 0.30] },
  { key: 'o', F: [500, 850, 2800],  label: 'お o', cn: '哦', mouth: [0.66, 0.85] },
  { key: 'u', F: [320, 800, 2600],  label: 'う u', cn: '乌', mouth: [0.40, 0.50] },
];
const LEAD = 0.8, SEG = 1.8, OPEN = 0.35, SING = 0.95, SING_DELAY = 0.4;
const TOTAL = LEAD + SEG * VOWELS.length;   // 9.8s
const W = 640, H = 640;

const canvas = document.createElement('canvas');
canvas.width = W; canvas.height = H;
document.body.appendChild(canvas);
const ctx = canvas.getContext('2d');

// —— 口型开合度（0~1）：给定段内局部时间，预备→发音→收，缓动 ——
function openness(segIdx, t) {
  const lt = t - (LEAD + segIdx * SEG);
  if (lt < 0 || lt >= SEG) return 0;
  const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
  if (lt < OPEN) return ease(lt / OPEN);
  if (lt < OPEN + SING) return 1;
  return 1 - ease((lt - OPEN - SING) / (SEG - OPEN - SING));
}

// —— 二次元脸绘制 ——
function drawFace(vowelKey, open, blink, title) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#fdf2f8'); g.addColorStop(1, '#e0e7ff');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // 装饰泡泡
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (const [bx, by, br] of [[80, 110, 26], [560, 90, 34], [590, 480, 22], [60, 520, 18]]) {
    ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
  }
  // 后发
  ctx.fillStyle = '#5b4b8a';
  ctx.beginPath(); ctx.ellipse(320, 330, 258, 270, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(96, 470, 52, 130, 0.15, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(544, 470, 52, 130, -0.15, 0, Math.PI * 2); ctx.fill();
  // 脸
  ctx.fillStyle = '#ffe3d0';
  ctx.beginPath(); ctx.ellipse(320, 340, 178, 196, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff0e6';
  ctx.beginPath(); ctx.ellipse(320, 452, 96, 84, 0, 0, Math.PI * 2); ctx.fill();
  // 刘海
  ctx.fillStyle = '#6b59a8';
  for (const [fx, fr] of [[168, 74], [252, 92], [340, 96], [428, 88], [492, 66]]) {
    ctx.beginPath(); ctx.arc(fx, 214, fr, 0, Math.PI); ctx.fill();
  }
  ctx.beginPath(); ctx.ellipse(320, 158, 210, 62, 0, 0, Math.PI * 2); ctx.fill();
  // 眉毛
  ctx.strokeStyle = '#4a3f6b'; ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(210, 268); ctx.quadraticCurveTo(252, 256, 292, 266); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(348, 266); ctx.quadraticCurveTo(388, 256, 430, 268); ctx.stroke();
  // 眼睛（眨眼 = 高度压缩）
  const eh = 44 * (1 - blink);
  for (const ex of [248, 392]) {
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(ex, 318, 40, Math.max(3, eh), 0, 0, Math.PI * 2); ctx.fill();
    if (eh > 10) {
      ctx.fillStyle = '#7c6cf0';
      ctx.beginPath(); ctx.ellipse(ex, 320, 26, Math.min(28, eh * 0.62), 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#241f38';
      ctx.beginPath(); ctx.ellipse(ex, 321, 12, Math.min(16, eh * 0.36), 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(ex - 8, 308, 7, 0, Math.PI * 2); ctx.fill();
    }
  }
  // 腮红 + 鼻
  ctx.fillStyle = 'rgba(255,150,160,0.55)';
  ctx.beginPath(); ctx.ellipse(216, 386, 30, 16, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(424, 386, 30, 16, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e8a87c';
  ctx.beginPath(); ctx.arc(320, 392, 5, 0, Math.PI * 2); ctx.fill();
  // 嘴（中心 320,470）：vowel 定形状、open 定大小；中性 = 小椭圆或闭唇线
  const mx = 320, my = 470;
  if (open <= 0.02) {
    ctx.strokeStyle = '#c2545e'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(mx - 26, my); ctx.quadraticCurveTo(mx, my + 10, mx + 26, my); ctx.stroke();
  } else {
    let rx = 34, ry = 34;
    const v = VOWELS.find((x) => x.key === vowelKey);
    if (v) { rx = 40 * v.mouth[0]; ry = 40 * v.mouth[1]; }
    rx *= 0.35 + 0.65 * open; ry *= 0.3 + 0.7 * open;
    ctx.fillStyle = '#8e2f3c';
    ctx.beginPath(); ctx.ellipse(mx, my, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    // 上排牙 + 舌头
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(mx, my - ry + Math.min(10, ry * 0.3), rx * 0.8, Math.min(9, ry * 0.25), 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e06a70';
    ctx.beginPath(); ctx.ellipse(mx, my + ry * 0.45, rx * 0.62, ry * 0.34, 0, 0, Math.PI * 2); ctx.fill();
  }
  // 文字标注（白描边保证在头发上可读）
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  const outlined = (text, x, y, font, fill) => {
    ctx.font = font;
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = 10;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
  };
  if (title) outlined(title, W / 2, 96, 'bold 54px "Segoe UI", sans-serif', '#4a3f6b');
  if (vowelKey) {
    const v = VOWELS.find((x) => x.key === vowelKey);
    outlined(v.label + '  ' + v.cn, W / 2, H - 58, 'bold 84px "Segoe UI", sans-serif', '#4a3f6b');
  }
}

// —— 共振峰合成：脉冲串（F0 微降）→ F1/F2/F3 谐振器级联 → 辐射差分 → 归一 ——
function synthVowelSamples(sr, dur, F, f0Start = 138, f0End = 112) {
  const n = Math.round(dur * sr);
  const pulse = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const f0 = f0Start + (f0End - f0Start) * (i / n);
    phase += f0 / sr;
    if (phase >= 1) { phase -= 1; pulse[i] = 1; }
  }
  const resonate = (input, Fq, BW) => {
    const r = Math.exp((-Math.PI * BW) / sr);
    const theta = (2 * Math.PI * Fq) / sr;
    const B = 2 * r * Math.cos(theta), C = -r * r, A = 1 - B - C;
    let y1 = 0, y2 = 0;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) { const y = A * input[i] + B * y1 + C * y2; y2 = y1; y1 = y; out[i] = y; }
    return out;
  };
  let sig = resonate(pulse, F[0], 80);
  sig = resonate(sig, F[1], 100);
  sig = resonate(sig, F[2], 130);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = sig[i] - sig[Math.max(0, i - 1)] * 0.96;   // 辐射近似
  // 包络（50ms 淡入淡出）+ 归一
  const fade = Math.round(0.05 * sr);
  let peak = 1e-9;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < n; i++) {
    let env = i < fade ? i / fade : i > n - fade ? (n - i) / fade : 1;
    env *= 0.8 / peak;
    out[i] = Math.tanh(out[i] * env * 3) * 0.55;
  }
  return out;
}

// —— 主流程：合成音频 → 录制（captureStream()+requestFrame + 音轨）——
window.renderDemo = async function () {
  const actx = new AudioContext();
  const recDest = actx.createMediaStreamDestination();
  const sr = actx.sampleRate;
  for (let i = 0; i < VOWELS.length; i++) {
    const v = VOWELS[i];
    const samples = synthVowelSamples(sr, SING, v.F);
    const buf = actx.createBuffer(1, samples.length, sr);
    buf.copyToChannel(samples, 0);
    const src = actx.createBufferSource();
    src.buffer = buf;
    src.connect(recDest);
    src.start(actx.currentTime + LEAD + i * SEG + SING_DELAY);
  }
  const stream = canvas.captureStream();
  const track = stream.getVideoTracks()[0];
  const combined = new MediaStream([...stream.getVideoTracks(), ...recDest.stream.getAudioTracks()]);
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
  const rec = new MediaRecorder(combined, { mimeType: mime });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise((res) => { rec.onstop = res; });
  rec.start(200);
  const t0 = performance.now();
  let lastBlink = -10, blinkUntil = -10;
  await new Promise((res) => {
    function frame() {
      const t = (performance.now() - t0) / 1000;
      // 眨眼：每 2.7s 眨 0.12s
      if (t - lastBlink > 2.7) { lastBlink = t; blinkUntil = t + 0.12; }
      const blink = t < blinkUntil ? 1 : 0;
      let vk = null, open = 0, title = 'A  E  I  O  U  口型演示';
      if (t < LEAD) { open = 0; }
      else {
        const segIdx = Math.min(VOWELS.length - 1, Math.floor((t - LEAD) / SEG));
        vk = VOWELS[segIdx].key;
        open = openness(segIdx, t);
        title = '';
      }
      drawFace(vk, open, blink, title);
      if (track.requestFrame) track.requestFrame();
      if (t < TOTAL + 0.3) requestAnimationFrame(frame); else { rec.stop(); res(); }
    }
    requestAnimationFrame(frame);
  });
  await stopped;
  await actx.close();
  const blob = new Blob(chunks, { type: 'video/webm' });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return { b64: btoa(bin), size: buf.length };
};

// —— 建库帧：把画面摆到位后导出 ——
const LIB = 'lib_aeiou';
window.grabLibFrames = async function () {
  async function shot(vowelKey, open, name, meta) {
    drawFace(vowelKey, open, 0, '');
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
    if (!blob || blob.size === 0) throw new Error('空帧: ' + name);
    const r = await fetch('/api/lib/' + LIB + '/' + name, { method: 'POST', body: blob });
    if (!r.ok) throw new Error('上传失败: ' + name + ' ' + r.status);
    return meta;
  }
  const frames = [];
  frames.push(await shot(null, 0.02, 'frames/N0.jpg', { id: 'N0', file: 'frames/N0.jpg', slot: 0, expr: 0 }));
  frames.push(await shot(null, 0.3, 'frames/N1.jpg', { id: 'N1', file: 'frames/N1.jpg', slot: 1, expr: 0 }));
  frames.push(await shot(null, 0.6, 'frames/N2.jpg', { id: 'N2', file: 'frames/N2.jpg', slot: 2, expr: 0 }));
  frames.push(await shot(null, 0.95, 'frames/N3.jpg', { id: 'N3', file: 'frames/N3.jpg', slot: 3, expr: 0 }));
  for (const v of VOWELS) {
    frames.push(await shot(v.key, 1, 'frames/V_' + v.key + '.jpg', { id: 'V_' + v.key, file: 'frames/V_' + v.key + '.jpg', slot: 3, expr: 0, vowel: v.key }));
  }
  drawFace(null, 0.02, 0, 'A E I O U');
  const bgBlob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
  const bg = await fetch('/api/lib/' + LIB + '/frames/background.jpg', { method: 'POST', body: bgBlob });
  if (!bg.ok) throw new Error('背景上传失败');
  const manifest = {
    meta: {
      name: LIB,
      person: '二次元卡通形象（合成演示）',
      created: new Date().toISOString().slice(0, 10),
      note: 'AEIOU 口型对比演示配套库：a/e/i/o/u 元音标签帧 + 中性开合序列；配合 input/test/test_vowel_demo.webm 自测元音驱动。',
      frameMs: 33,
    },
    background: 'frames/background.jpg',
    frames,
    clips: [],
  };
  const mr = await fetch('/api/lib/' + LIB + '/manifest.json', {
    method: 'POST',
    body: new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }),
  });
  if (!mr.ok) throw new Error('manifest 上传失败');
  return frames.length + 1;
};
`;

const browser = await chromium.launch({
  executablePath: EXE,
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
page.on('console', (msg) => { if (msg.type() === 'error') console.log('console:', msg.text()); });
// 同源页面里注入脚本（fetch /api/lib 与 canvas 均可用）
await page.goto(`${BASE}/web/index.html`, { waitUntil: 'domcontentloaded' });
await page.evaluate(PAGE_CODE);

console.log('① 录制演示视频（约 11 秒）…');
const { b64, size } = await page.evaluate(() => window.renderDemo());
writeFileSync(OUT, Buffer.from(b64, 'base64'));
console.log(`   已保存 ${OUT}（${size} 字节）`);

console.log('② 生成素材库 lib_aeiou（元音标签帧 + 中性序列 + 背景）…');
const n = await page.evaluate(() => window.grabLibFrames());
console.log(`   已入库 avatar/libs/${LIB}/（${n} 个文件）`);
await browser.close();
console.log('✅ 完成：视频 input/test/test_vowel_demo.webm + 素材库 lib_aeiou');
