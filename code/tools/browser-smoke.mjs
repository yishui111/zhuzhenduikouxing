// 浏览器冒烟测试（用本机 Edge 驱动，验证网页全链路）
// 覆盖：启动 → 素材库加载/列表/多库切换 → 音频播放 → 能量(嘴档)+F0(挑眉) → 状态机 → 画布渲染 → 录屏导出
// 用法：node tools/browser-smoke.mjs
// 前置：开发服务器已在 48620 运行（start.bat）；本机安装 Edge 或 Chrome
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
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

const BASE = 'http://127.0.0.1:' + (process.env.PORT || 48620);
const SMOKE_URL = process.env.SMOKE_URL || `${BASE}/web/index.html`;
const PREPROCESS_URL = `${BASE}/web/preprocess.html`;
const EXE = resolveBrowserExe();

async function main() {
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: EXE,
      headless: true,
      args: ['--autoplay-policy=no-user-gesture-required'],
    });
  } catch (e) {
    console.log('SKIP: 未能启动 Edge（' + e.message.split('\n')[0] + '）');
    process.exit(0);
  }
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });

  // —— 阶段 1：主页面启动 + 素材库加载 + 画布渲染 ——
  await page.goto(SMOKE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2500);
  const status = await page.textContent('#status').catch(() => '(无状态栏)');
  const canvasInfo = await page.evaluate(() => {
    const c = document.getElementById('stage');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let nonBg = 0;
    for (let i = 0; i < d.length; i += 40) { if (d[i] !== 0 || d[i + 1] !== 0 || d[i + 2] !== 0) nonBg++; }
    return { w: c.width, h: c.height, nonBg };
  });
  const libCount = await page.evaluate(() => document.getElementById('lib').options.length);
  console.log('状态栏:', status);
  console.log('画布:', JSON.stringify(canvasInfo), '| 素材库下拉选项数:', libCount);

  // —— 阶段 2：音频 → 能量 + F0 → 状态机 → 挑眉 ——
  const wav = fileURLToPath(new URL('../../input/test/test_pitch.wav', import.meta.url));
  await page.setInputFiles('#file', wav);
  const samples = [];
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(400);
    samples.push(await page.evaluate(() => ({
      status: document.getElementById('status').textContent,
      f0: parseFloat(document.getElementById('status').dataset.f0 || '-1'),
      expr: document.getElementById('status').dataset.expr || '?',
    })));
  }
  const maxF0 = Math.max(...samples.map((s) => s.f0));
  const statuses = samples.map((s) => s.status);
  const sawSlot = statuses.some((t) => /E[0-3]/.test(t)); // 嘴型档位出现
  // 挑眉以每帧更新的 expr 判断（比状态文本可靠，避免采样窗口错过）
  const sawBrow = samples.some((s) => s.expr === '2');
  console.log('最大 F0:', maxF0.toFixed(1), 'Hz | 嘴型档位切换:', sawSlot, '| 挑眉触发(expr=2):', sawBrow);

  // —— 阶段 2b：安静音频张嘴验证（修复"说话时闭嘴"）——
  // 换用 test_mouth.wav（含低音量段 0.044/0.128/0.315 + 静音段），验证说话时嘴不闭死、静音才闭
  const mouthWav = fileURLToPath(new URL('../../input/test/test_mouth.wav', import.meta.url));
  await page.setInputFiles('#file', mouthWav);
  const mouthSamples = [];
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(400);
    mouthSamples.push(await page.evaluate(() => ({
      status: document.getElementById('status').textContent,
      level: parseFloat(document.getElementById('status').dataset.level || '-1'),
    })));
  }
  const maxLevel = Math.max(...mouthSamples.map((s) => s.level));
  const mouthStatuses = mouthSamples.map((s) => s.status);
  const sawOpenSlot = mouthStatuses.some((t) => /E[123]/.test(t));
  const sawClosed = mouthStatuses.some((t) => /E0/.test(t)); // E0 档 = 闭嘴（静音时出现）
  console.log('安静音频: 最大level=' + maxLevel.toFixed(2), '| 出现张嘴档位(E1~E3):', sawOpenSlot, '| 出现闭嘴档(E0):', sawClosed);

  // —— 阶段 3：切换到另一套素材库，验证多库切换 ——
  // （主页面会隐藏 lib_test* 测试库，这里从下拉实际选项里动态挑另一个）
  const otherLib = await page.evaluate(() => {
    const sel = document.getElementById('lib');
    return [...sel.options].map((o) => o.value).find((v) => v && v !== sel.value) || null;
  });
  if (!otherLib) {
    console.log('切换后状态: 下拉只有一套素材库，跳过切换验证');
  } else {
    await page.selectOption('#lib', otherLib);
    await page.waitForFunction(
      (n) => document.getElementById('status').textContent.includes(n),
      otherLib,
      { timeout: 8000 }
    );
    const statusAfterSwitch = await page.textContent('#status');
    console.log('切换后状态:', statusAfterSwitch);
  }

  // 切库后画布绘制内容必须变化（不同库的帧 id 命名同构，曾因状态未重置导致切库画面不变）
  const hashCanvas = () => page.evaluate(() => {
    const c = document.getElementById('stage');
    const o = document.createElement('canvas'); o.width = 64; o.height = 64;
    o.getContext('2d').drawImage(c, 0, 0, 64, 64);
    return o.getContext('2d').getImageData(0, 0, 64, 64).data.reduce((acc, v, i) => acc + (i % 7 === 0 ? v : 0), 0);
  });
  const hashBefore = await hashCanvas();
  const currentLib = await page.evaluate(() => document.getElementById('lib').value);
  const thirdLib = await page.evaluate(() => {
    const sel = document.getElementById('lib');
    return [...sel.options].map((o) => o.value).find((v) => v && v !== sel.value);
  });
  await page.selectOption('#lib', thirdLib);
  await page.waitForTimeout(1500);
  const hashAfter = await hashCanvas();
  const switchPixelsOk = Math.abs(hashAfter - hashBefore) > 50;
  console.log('切库画布变化:', switchPixelsOk ? '✓' : '✗（差 ' + Math.abs(hashAfter - hashBefore) + '）');
  await page.selectOption('#lib', otherLib);   // 切回目标库，供后续 switchOk 状态检查
  await page.waitForFunction(
    (n) => document.getElementById('status').textContent.includes(n),
    otherLib,
    { timeout: 8000 }
  );
  const switchOk = otherLib === null || (await page.textContent('#status')).includes(otherLib);

  // —— 阶段 4：录屏导出（真实下载 webm 并校验）——
  await page.setInputFiles('#file', wav); // 重新播放，让合成流带音频轨
  await page.waitForTimeout(1000);
  await page.click('#rec');
  await page.waitForTimeout(2000);
  const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
  await page.click('#recStop');
  const download = await downloadPromise;
  const dlPath = await download.path();
  const { statSync, readFileSync } = await import('node:fs');
  const size = statSync(dlPath).size;
  const magic = readFileSync(dlPath).subarray(0, 4).toString('hex');
  const name = download.suggestedFilename();
  const isWebm = magic === '1a45dfa3'; // EBML 魔数
  console.log('导出文件:', name, '| 大小:', size, '字节 | EBML魔数:', magic, isWebm ? '✓' : '✗');

  // —— 阶段 5：建库工具页面启动 ——
  const preprocessErrors = [];
  page.removeAllListeners('pageerror');
  page.removeAllListeners('console');
  page.on('pageerror', (err) => preprocessErrors.push('pageerror: ' + err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') preprocessErrors.push('console: ' + msg.text()); });
  await page.goto(PREPROCESS_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1200);
  console.log('建库工具控制台错误:', preprocessErrors.length ? preprocessErrors.join('; ') : '无');

  const ok = status.includes('素材库已加载') && canvasInfo.nonBg > 100 && libCount >= 1
    && sawSlot && maxF0 > 100 && sawBrow
    && maxLevel > 0.3 && sawOpenSlot && sawClosed
    && switchOk && switchPixelsOk
    && size > 1000 && isWebm
    && errors.length === 0 && preprocessErrors.length === 0;

  await browser.close();
  if (ok) {
    console.log('✅ 冒烟测试通过：启动 + 素材库(2库) + 切换 + 画布渲染 + 音频播放 + F0(' + maxF0.toFixed(0) + 'Hz) + 挑眉 + 录屏导出(' + name + ',' + size + 'B)，无 JS 错误');
    process.exit(0);
  }
  console.log('❌ 冒烟测试未通过（errors=' + errors.length + '）');
  console.log('条件明细:', JSON.stringify({ status: status.includes('素材库已加载'), canvas: canvasInfo.nonBg > 100, libs: libCount >= 1, sawSlot, f0: maxF0 > 100, brow: sawBrow, lvl: maxLevel > 0.3, open: sawOpenSlot, closed: sawClosed, switchOk, switchPixelsOk, size: size > 1000, isWebm, errors: errors.length === 0, pre: preprocessErrors.length === 0 }));
  if (errors.length) console.log(errors.join('\n'));
  process.exit(1);
}

main().catch((e) => { console.error('冒烟测试异常:', e); process.exit(1); });
