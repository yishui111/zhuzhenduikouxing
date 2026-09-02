// 抽帧诊断：从视频中均匀抽几帧保存，用于人工查看画面内容
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBrowserExe } from './edge.mjs';

const EXE = resolveBrowserExe();
if (!EXE) {
  console.log('SKIP: 未找到本机 Edge/Chrome，跳过（可用环境变量 EDGE_PATH 指定浏览器）。');
  process.exit(0);
}
const BASE = 'http://127.0.0.1:' + (process.env.PORT || 48620);
const REL = basename(process.argv[2] || '');
if (!REL) {
  console.log('用法: node tools/grab-frames.mjs <视频文件名>（从服务器 input/ 下抽帧）');
  console.log('  例: node tools/grab-frames.mjs input/我的录像.mp4');
  process.exit(1);
}
const OUT_DIR = fileURLToPath(new URL('../../output/diag', import.meta.url));
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage();
await page.goto(`${BASE}/web/index.html`, { waitUntil: 'domcontentloaded' });

const frames = await page.evaluate(async (rel) => {
  const video = document.createElement('video');
  const blob = await (await fetch('/api/input/' + rel)).blob();
  video.src = URL.createObjectURL(blob);
  video.muted = true;
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('超时')), 15000);
    video.onloadedmetadata = () => { clearTimeout(t); res(); };
    video.onerror = () => rej(new Error('加载失败'));
  });
  const duration = video.duration;
  const times = [];
  for (let t = 1.5; t < duration; t += duration / 8) times.push(Math.min(t, duration - 0.1));
  const out = [];
  for (const t of times) {
    await new Promise((res) => { const h = () => { video.removeEventListener('seeked', h); res(); }; video.addEventListener('seeked', h); video.currentTime = t; });
    const c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    c.getContext('2d').drawImage(video, 0, 0, 512, 512);
    out.push({ t, data: c.toDataURL('image/jpeg', 0.85) });
  }
  return out;
}, REL);

await browser.close();
for (const f of frames) {
  const b64 = f.data.split(',')[1];
  writeFileSync(`${OUT_DIR}/t${f.t.toFixed(1).replace('.', '_')}s.jpg`, Buffer.from(b64, 'base64'));
  console.log(`已保存 ${f.t.toFixed(1)}s`);
}
console.log('目录:', OUT_DIR);
