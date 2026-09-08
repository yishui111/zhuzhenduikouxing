// 生成"口型同步测试"素材（自测闭环的标准答案）：
//   音频：共振峰合成的人声结构音节序列（慢速段 / 快速段 / 中速段），响度与嘴型开度对应
//   视频：二次元形象逐音节切换口型（与音频同一份时间轴，逐帧对齐）
//   素材库：lib_lipsync —— 8 档嘴部开合关键帧（比旧 4 档更细腻）
// 产物：input/test/test_lipsync.webm + .mp4 + test_lipsync_curve.json（理论开度曲线，供滞后分析）
// 用法：node tools/make-lipsync-demo.mjs（需开发服务器在 48620 运行，用于建库上传）
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveBrowserExe } from './edge.mjs';

const execFileP = promisify(execFile);
const EXE = resolveBrowserExe();
if (!EXE) { console.log('SKIP: 未找到本机 Edge/Chrome。'); process.exit(0); }
const PORT = process.env.PORT || 48620;
const BASE = 'http://127.0.0.1:' + PORT;
// 自管服务器生命周期：脚本内拉起（若未运行），结束/异常时带走
const server = spawn(process.execPath, ['server.mjs'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});
process.on('exit', () => { try { server.kill(); } catch {} });
const OUT = fileURLToPath(new URL('../../input/test/test_lipsync.webm', import.meta.url));
mkdirSync(dirname(OUT), { recursive: true });
const LIB = 'lib_lipsync';

// 音节时间轴（页面与 Node 共用的设计数据）：
//   slow：每音节 0.5s+间隔 0.12s；fast：0.2s+间隔 0.06s（快语速，考验切换跟随）；mid：0.32s+间隔 0.09s
//   open：嘴型开度目标（也是能量幅度系数——开口音更响，符合真实语音）
// loud = 开度的平方（响度差拉开，能量驱动才能区分口型档位）
const VOW = {
  a: { open: 1.0, loud: 1.0, F: [850, 1250, 2800], label: 'あ' },
  e: { open: 0.6, loud: 0.45, F: [500, 1800, 2500], label: 'え' },
  i: { open: 0.35, loud: 0.2, F: [300, 2300, 3000], label: 'い' },
  o: { open: 0.8, loud: 0.72, F: [500, 850, 2800], label: 'お' },
  u: { open: 0.25, loud: 0.1, F: [320, 800, 2600], label: 'う' },
};
function buildTimeline() {
  const syl = [];
  let t = 0.6;   // 开场静音
  const add = (v, dur, gap) => { syl.push({ v, t0: t, t1: t + dur, open: VOW[v].open, amp: VOW[v].loud }); t += dur + gap; };
  for (const v of ['a', 'e', 'i', 'o', 'u']) add(v, 0.5, 0.12);            // slow
  t += 0.25;
  for (const v of ['a', 'i', 'u', 'e', 'o', 'a', 'u', 'i', 'e', 'o']) add(v, 0.2, 0.06);   // fast
  t += 0.25;
  for (const v of ['o', 'a', 'u', 'i', 'e']) add(v, 0.32, 0.09);           // mid
  return { syl, total: t + 0.6 };
}

const PAGE_HTML = `<!DOCTYPE html><html><head>
<base href="${BASE}/">
<meta charset="UTF-8">
<style>body{margin:0}</style>
</head><body>
<script type="module">
const W = 512, H = 512;
const VOW = ${JSON.stringify(VOW)};
const TIMELINE = ${JSON.stringify(buildTimeline())};
const SMOOTH_MS = 60;   // 口型过渡（毫秒）

const canvas = document.createElement('canvas');
canvas.width = W; canvas.height = H;
document.body.appendChild(canvas);
const ctx = canvas.getContext('2d');

// —— 二次元形象（精绘）——
function drawFace(open) {
  // 背景
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#fdf6f0'); g.addColorStop(1, '#e8ecf7');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // 后发
  ctx.fillStyle = '#4a3a63';
  ctx.beginPath(); ctx.ellipse(256, 268, 216, 236, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(70, 470, 46, 130, 0.12, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(442, 470, 46, 130, -0.12, 0, Math.PI * 2); ctx.fill();
  // 脖子与水手服肩部
  ctx.fillStyle = '#f2c9a8';
  ctx.fillRect(228, 438, 56, 46);
  ctx.fillStyle = '#f5f7fa';
  ctx.beginPath(); ctx.moveTo(96, 512); ctx.quadraticCurveTo(150, 448, 256, 444);
  ctx.quadraticCurveTo(362, 448, 416, 512); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#2c3e66';
  ctx.beginPath(); ctx.moveTo(196, 452); ctx.quadraticCurveTo(256, 470, 316, 452);
  ctx.lineTo(330, 512); ctx.lineTo(182, 512); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(212, 470); ctx.quadraticCurveTo(256, 486, 300, 470);
  ctx.quadraticCurveTo(300, 492, 256, 496); ctx.quadraticCurveTo(212, 492, 212, 470); ctx.fill();
  ctx.fillStyle = '#d33'; ctx.beginPath(); ctx.ellipse(256, 496, 12, 16, 0, 0, Math.PI * 2); ctx.fill();
  // 脸（瓜子轮廓：宽额 + 收窄下巴）
  ctx.fillStyle = '#ffe9d6';
  ctx.beginPath();
  ctx.moveTo(118, 240);
  ctx.bezierCurveTo(118, 140, 178, 96, 256, 96);
  ctx.bezierCurveTo(334, 96, 394, 140, 394, 240);
  ctx.bezierCurveTo(394, 330, 330, 436, 256, 440);
  ctx.bezierCurveTo(182, 436, 118, 330, 118, 240);
  ctx.closePath(); ctx.fill();
  // 耳朵
  ctx.fillStyle = '#ffdfc8';
  ctx.beginPath(); ctx.ellipse(122, 282, 16, 26, 0.1, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(390, 282, 16, 26, -0.1, 0, Math.PI * 2); ctx.fill();
  // 刘海（多层，带高光）
  ctx.fillStyle = '#5a4a80';
  ctx.beginPath(); ctx.moveTo(108, 236);
  ctx.quadraticCurveTo(104, 96, 256, 84);
  ctx.quadraticCurveTo(408, 96, 404, 236);
  ctx.quadraticCurveTo(380, 150, 330, 176);
  ctx.quadraticCurveTo(300, 108, 246, 168);
  ctx.quadraticCurveTo(216, 112, 186, 180);
  ctx.quadraticCurveTo(136, 150, 108, 236);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(196, 100); ctx.quadraticCurveTo(246, 88, 300, 102); ctx.stroke();
  // 眉毛
  ctx.strokeStyle = '#4a3a5e'; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(160, 244); ctx.quadraticCurveTo(198, 234, 232, 242); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(280, 242); ctx.quadraticCurveTo(314, 234, 352, 244); ctx.stroke();
  // 眼睛（大杏眼 + 多层虹膜）
  for (const ex of [196, 316]) {
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(ex, 288, 34, 40, 0, 0, Math.PI * 2); ctx.fill();
    const iris = ctx.createRadialGradient(ex, 292, 4, ex, 292, 30);
    iris.addColorStop(0, '#8a6cf5'); iris.addColorStop(0.6, '#6b4fc0'); iris.addColorStop(1, '#3f2f80');
    ctx.fillStyle = iris;
    ctx.beginPath(); ctx.ellipse(ex, 292, 24, 30, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a1430';
    ctx.beginPath(); ctx.ellipse(ex, 293, 10, 16, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(ex - 9, 280, 7, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(ex + 7, 302, 3.5, 0, Math.PI * 2); ctx.fill();
    // 上睫毛
    ctx.strokeStyle = '#2c2440'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(ex - 32, 272); ctx.quadraticCurveTo(ex, 244, ex + 32, 272); ctx.stroke();
  }
  // 鼻
  ctx.strokeStyle = '#d9a582'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(254, 350); ctx.lineTo(258, 356); ctx.stroke();
  // 腮红
  ctx.fillStyle = 'rgba(255,140,150,0.5)';
  ctx.beginPath(); ctx.ellipse(168, 348, 26, 14, 0.1, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(344, 348, 26, 14, -0.1, 0, Math.PI * 2); ctx.fill();
  // 嘴（中心 256,394）：open 定开合
  const my = 394;
  if (open <= 0.03) {
    ctx.strokeStyle = '#b8505c'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(234, my); ctx.quadraticCurveTo(256, my + 9, 278, my); ctx.stroke();
  } else {
    const rx = 20 + 26 * open;
    const ry = 6 + 40 * open;
    ctx.fillStyle = '#7e2a36';
    ctx.beginPath(); ctx.ellipse(256, my, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(256, my - ry + Math.min(7, ry * 0.28), rx * 0.78, Math.max(2.5, ry * 0.22), 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d4606b';
    ctx.beginPath(); ctx.ellipse(256, my + ry * 0.42, rx * 0.6, ry * 0.32, 0, 0, Math.PI * 2); ctx.fill();
  }
}

// —— 共振峰合成（人声结构的测试音）——
function synthVowelSamples(sr, dur, F, amp, f0Start = 132, f0End = 116) {
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
  for (let i = 0; i < n; i++) out[i] = sig[i] - sig[Math.max(0, i - 1)] * 0.96;
  const fade = Math.round(0.03 * sr);
  let peak = 1e-9;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < n; i++) {
    let env = i < fade ? i / fade : i > n - fade ? (n - i) / fade : 1;
    env *= amp / peak;
    out[i] = Math.tanh(out[i] * env * 3) * 0.55;
  }
  return out;
}

// 音频调度：音节幅度即理论开度曲线的能量对应
window.startAudio = function (actx, recDest) {
  const sr = actx.sampleRate;
  for (const s of TIMELINE.syl) {
    const samples = synthVowelSamples(sr, s.t1 - s.t0, VOW[s.v].F, s.amp);
    const buf = actx.createBuffer(1, samples.length, sr);
    buf.copyToChannel(samples, 0);
    const src = actx.createBufferSource();
    src.buffer = buf;
    src.connect(recDest);
    src.start(actx.currentTime + s.t0);
  }
};

// 理论开度（给定时刻）：音节内 = 开度（30ms 缓入缓出），音节间 = 0
window.theoreticalOpen = function (t) {
  for (const s of TIMELINE.syl) {
    if (t >= s.t0 - 0.02 && t < s.t1 + 0.02) return s.open;
  }
  return 0;
};

// —— 录制 ——
window.renderDemo = async function () {
  const actx = new AudioContext();
  const recDest = actx.createMediaStreamDestination();
  window.startAudio(actx, recDest);
  // 预热渲染
  for (let i = 0; i < 6; i++) { drawFace(0); }
  const stream = canvas.captureStream();
  const track = stream.getVideoTracks()[0];
  const combined = new MediaStream([...stream.getVideoTracks(), ...recDest.stream.getAudioTracks()]);
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ? 'video/webm;codecs=vp8' : 'video/webm';
  const rec = new MediaRecorder(combined, { mimeType: mime });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise((res) => { rec.onstop = res; });
  rec.start(200);
  if (track.requestFrame) track.requestFrame();
  const t0 = performance.now();
  let curOpen = 0, targetOpen = 0, curLabel = '';
  await new Promise((res) => {
    function frame() {
      const t = (performance.now() - t0) / 1000;
      // 理论开度 → 口型平滑过渡（SMOOTH_MS）
      targetOpen = window.theoreticalOpen(t);
      curOpen += (targetOpen - curOpen) * Math.min(1, (performance.now() - (frame._p || t0)) / SMOOTH_MS);
      frame._p = performance.now();
      drawFace(curOpen);
      if (track.requestFrame) track.requestFrame();
      if (t < TIMELINE.total + 1.0) requestAnimationFrame(frame); else { rec.stop(); res(); }
    }
    requestAnimationFrame(frame);
  });
  await stopped;
  await actx.close();
  const blob = new Blob(chunks, { type: 'video/webm' });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return { b64: btoa(bin), size: buf.length, total: TIMELINE.total };
};

// —— 建库帧：8 档开合 + 背景 ——
window.grabLibFrames = async function () {
  const LIB = 'lib_lipsync';
  const OPENS = [0.03, 0.16, 0.29, 0.43, 0.57, 0.71, 0.86, 1.0];
  const frames = [];
  for (let i = 0; i < OPENS.length; i++) {
    drawFace(OPENS[i]);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
    if (!blob || blob.size === 0) throw new Error('空帧 ' + i);
    const rel = 'frames/M' + i + '.jpg';
    const r = await fetch('/api/lib/' + LIB + '/' + rel, { method: 'POST', body: blob });
    if (!r.ok) throw new Error('上传失败 ' + rel + ' ' + r.status);
    frames.push({ id: 'M' + i, file: rel, slot: i, expr: 0 });
  }
  const manifest = {
    meta: {
      name: LIB,
      person: '二次元形象（合成演示·8 档口型）',
      created: new Date().toISOString().slice(0, 10),
      note: '口型同步自测库：8 档嘴部开合（比 4 档更细腻），配合 test_lipsync.webm 自测口型跟随。',
      frameMs: 33,
    },
    background: 'frames/M0.jpg',
    frames,
    clips: [],
  };
  const mr = await fetch('/api/lib/' + LIB + '/manifest.json', {
    method: 'POST',
    body: new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }),
  });
  if (!mr.ok) throw new Error('manifest 上传失败');
  return frames.length;
};
</script></body></html>`;

const browser = await chromium.launch({
  executablePath: EXE,
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader'],
});
const page = await browser.newPage();
page.on('pageerror', (err) => console.log('pageerror:', err.message));
page.on('console', (msg) => { if (msg.type() === 'error') console.log('console:', msg.text()); });
let up = false;
for (let i = 0; i < 20; i++) {
  try { const r = await fetch(`${BASE}/api/libs`); if (r.ok) { up = true; break; } } catch {}
  if (up) break;
  await new Promise((r) => setTimeout(r, 500));
}
if (!up) { console.error('❌ 服务器启动失败'); process.exit(1); }
await page.setContent(PAGE_HTML, { waitUntil: 'domcontentloaded' });

console.log('① 录制口型同步演示视频（快慢混合语速）…');
const { b64, size, total } = await page.evaluate(() => window.renderDemo());
writeFileSync(OUT, Buffer.from(b64, 'base64'));
console.log(`   已保存 ${OUT}（${size} 字节，内容 ${total.toFixed(1)}s）`);

// 理论开度曲线导出（供滞后分析）
const timeline = buildTimeline();
writeFileSync(OUT.replace('.webm', '_curve.json'), JSON.stringify(timeline, null, 2));

console.log(`② 生成素材库 ${LIB}（8 档口型开合）…`);
const n = await page.evaluate(() => window.grabLibFrames());
await browser.close();

// mp4 对照副本
const MP4 = OUT.replace(/\.webm$/, '.mp4');
try {
  await execFileP('ffmpeg', ['-y', '-v', 'error', '-i', OUT,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', MP4]);
  console.log(`✅ 完成：${OUT}\n          ${MP4} + 素材库 lib_lipsync（${n} 帧）`);
} catch {
  console.log(`✅ 完成（跳过 mp4）：${OUT} + 素材库 lib_lipsync（${n} 帧）`);
}
