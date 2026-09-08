// 建库工具端到端验证（真实浏览器）：
// 上传合成测试视频(test_video.webm) → 一键生成嘴型图库(lib_e2e) → 校验服务器素材库 → 清理
// 用法：node tools/build-lib-e2e.mjs（需开发服务器 48620 运行 + 已生成 test_video.webm）
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolveBrowserExe } from './edge.mjs';
// 自管服务器：48620 不可达时自动拉起（本进程子进程），结束时带走；已在运行则直接复用
let _server = null;
let _owned = false;
try {
  const r = await fetch('http://127.0.0.1:48620/api/libs');
  if (!r.ok) throw 0;
} catch {
  _server = spawn(process.execPath, ['server.mjs'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, PORT: '48620' },
    stdio: 'ignore',
  });
  _owned = true;
  let up = false;
  for (let i = 0; i < 20; i++) {
    try { const r = await fetch('http://127.0.0.1:48620/api/libs'); if (r.ok) { up = true; break; } } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  if (!up) { console.log('SKIP: 服务器启动失败'); process.exit(0); }
}
process.on('exit', () => { if (_owned && _server) { try { _server.kill(); } catch {} } });

const EXE = resolveBrowserExe();
if (!EXE) {
  console.log('SKIP: 未找到本机 Edge/Chrome，跳过（可用环境变量 EDGE_PATH 指定浏览器）。');
  process.exit(0);
}
const VIDEO = fileURLToPath(new URL('../../input/test/test_video.webm', import.meta.url));
const BASE = 'http://127.0.0.1:' + (process.env.PORT || 48620);
const LIB = 'lib_e2e';

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });

// 1) 打开建库工具并上传视频
await page.goto(`${BASE}/web/preprocess.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
await page.setInputFiles('#video', VIDEO);
await page.fill('#libname', LIB);

// 2) 一键生成（分析 4.8s @2x ≈ 2.4s + 抽帧上传）
await page.click('#generate');
await page.waitForFunction(
  () => document.getElementById('log').textContent.includes('生成完成'),
  { timeout: 120000 }
);
const log = await page.textContent('#log');
console.log('生成日志:', log.replace(/\n/g, ' | '));

// 3) 校验服务器素材库
const libs = await (await fetch(`${BASE}/api/libs`)).json();
console.log('素材库列表:', libs.libs.join(', '));
const manifest = await (await fetch(`${BASE}/api/lib/${LIB}/manifest.json`)).json();
console.log(`manifest: ${manifest.frames.length} 帧 + 背景 ${manifest.background}`);
const slotCounts = [0, 1, 2, 3].map((s) => manifest.frames.filter((f) => f.slot === s).length);
console.log('各嘴档帧数 E0~E3:', slotCounts.join('/'));
// 帧必须非空（0 字节 = 浏览器抽帧编码异常，曾因只查状态码漏过）
const frameSize = await fetch(`${BASE}/api/lib/${LIB}/${manifest.frames[0].file}`).then((r) => r.arrayBuffer()).then((b) => b.byteLength);
const frameOk = frameSize > 1000;
const bgOk = await fetch(`${BASE}/api/lib/${LIB}/${manifest.background}`).then((r) => r.arrayBuffer()).then((b) => b.byteLength > 1000);
console.log(`首帧可读: ${frameOk}（${frameSize}B） | 背景可读: ${bgOk}`);

// 4) 清理
await rm(fileURLToPath(new URL(`../../avatar/libs/${LIB}`, import.meta.url)), { recursive: true, force: true });
console.log(`已清理临时库 ${LIB}`);

await browser.close();
const ok = libs.libs.includes(LIB) && manifest.frames.length >= 12
  && slotCounts.every((n) => n > 0)
  && frameOk && bgOk && errors.length === 0;
if (ok) {
  console.log('✅ 建库工具端到端验证通过：上传 → 一键生成(4 档梯度) → 素材库可读，无 JS 错误');
  process.exit(0);
}
console.log('❌ 建库工具端到端验证未通过');
if (errors.length) console.log(errors.join('\n'));
process.exit(1);
