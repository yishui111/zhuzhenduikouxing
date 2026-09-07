import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolveBrowserExe } from './tools/edge.mjs';
// 自管服务器生命周期：测试进程的子进程（避免外部进程存活问题）
const server = spawn(process.execPath, ['server.mjs'], {
  cwd: new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
  env: { ...process.env, PORT: '48620' },
  stdio: 'ignore',
});
process.on('exit', () => { try { server.kill(); } catch {} });
const curve = JSON.parse(readFileSync('../input/test/test_lipsync_curve.json', 'utf8'));
const browser = await chromium.launch({ executablePath: resolveBrowserExe(), headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
let up = false;
for (let i = 0; i < 20; i++) {
  try { const r = await fetch('http://127.0.0.1:48620/api/libs'); if (r.ok) { up = true; break; } } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
if (!up) { console.log('服务器启动失败'); process.exit(1); }
await page.goto('http://127.0.0.1:48620/web/index.html?lib=lib_lipsync', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
await page.evaluate(async () => {
  const m = await (await fetch('/api/lib/lib_lipsync/manifest.json')).json();
  const hashes = [];
  for (const f of m.frames) {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = '/api/lib/lib_lipsync/' + f.file; });
    const c = document.createElement('canvas'); c.width = 32; c.height = 16;
    const cc = c.getContext('2d');
    cc.drawImage(img, 0, img.height * 0.68, img.width, img.height * 0.2, 0, 0, 32, 16);
    hashes.push({ slot: f.slot, d: cc.getImageData(0, 0, 32, 16).data });
  }
  window._match = (stage) => {
    const c = document.createElement('canvas'); c.width = 32; c.height = 16;
    const cc = c.getContext('2d');
    cc.drawImage(stage, 0, stage.height * 0.68, stage.width, stage.height * 0.2, 0, 0, 32, 16);
    const d = cc.getImageData(0, 0, 32, 16).data;
    let best = 0, bd = Infinity;
    for (const h of hashes) {
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += Math.abs(d[i] - h.d[i]) + Math.abs(d[i + 1] - h.d[i + 1]) + Math.abs(d[i + 2] - h.d[i + 2]);
      if (s < bd) { bd = s; best = h.slot; }
    }
    return best;
  };
});
await page.setInputFiles('#file', 'D:/xm/zhuzhenduikouxing/input/test/test_lipsync.webm');
await page.waitForTimeout(400);
// 页面内 rAF 自采样（与渲染同频，无 evaluate 往返延迟）
await page.evaluate(() => {
  window._tl = [];
  const t0 = performance.now();
  function tick() {
    window._tl.push({ t: (performance.now() - t0) / 1000, slot: window._match(document.getElementById('stage')) });
    if (window._tl.length < 700) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
});
await page.waitForTimeout(11000);
const tl = await page.evaluate(() => window._tl);
const theoryAt = (t) => { for (const s of curve.syl) if (t >= s.t0 - 0.03 && t < s.t1 + 0.03) return s.open; return 0; };
function score(off) { let e = 0, n = 0; for (const s of tl) e += Math.abs(s.slot / 7 - theoryAt(s.t - off)), n++; return e / n; }
let best = { off: 0, e: Infinity };
for (let off = 0; off <= 1.8; off += 0.05) { const e = score(off); if (e < best.e) best = { off, e }; }
// 相关系数（去系统性映射偏差，看起伏是否同步）
function corr(off) {
  const pairs = [];
  for (const s of tl) { const th = theoryAt(s.t - off); if (th > 0 || s.slot > 0) pairs.push([s.slot / 7, th]); }
  const n = pairs.length;
  const mx = pairs.reduce((a, p) => a + p[0], 0) / n, my = pairs.reduce((a, p) => a + p[1], 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (const [x, y] of pairs) { num += (x - mx) * (y - my); dx += (x - mx) ** 2; dy += (y - my) ** 2; }
  return num / Math.sqrt(dx * dy);
}
console.log(`固有偏移(含解码): ${(best.off * 1000).toFixed(0)}ms | 对齐后开度相关系数: ${corr(best.off).toFixed(3)}（≥0.8 为自然）`);
const segs = { slow: curve.syl.slice(0, 5), fast: curve.syl.slice(5, 15), mid: curve.syl.slice(15) };
for (const [name, list] of Object.entries(segs)) {
  let e = 0, n = 0;
  for (const s of list) for (const sp of tl) {
    const tt = sp.t - best.off;
    if (tt >= s.t0 + 0.05 && tt < s.t1 - 0.05) { e += Math.abs(sp.slot / 7 - s.open); n++; }
  }
  console.log(`${name} 段误差: ${n ? (e / n).toFixed(3) : '无样本'}（样本 ${n}）`);
}
const f0t = segs.fast[0].t0, f1t = segs.fast[segs.fast.length - 1].t1;
const fs = tl.filter((s) => s.t - best.off >= f0t && s.t - best.off <= f1t);
let sw = 0;
for (let i = 1; i < fs.length; i++) if (fs[i].slot !== fs[i - 1].slot) sw++;
console.log(`快速段: 理论 10 音节 | 口型切换 ${sw} 次`);
await browser.close();
server.kill();
