// 验证真人素材库在主页面加载并驱动（默认素材库 lib_real，可用参数指定）
// 用法：node tools/verify-lib-real.mjs [库名]
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { resolveBrowserExe } from './edge.mjs';

const EXE = resolveBrowserExe();
if (!EXE) {
  console.log('SKIP: 未找到本机 Edge/Chrome，跳过（可用环境变量 EDGE_PATH 指定浏览器）。');
  process.exit(0);
}
const BASE = 'http://127.0.0.1:' + (process.env.PORT || 48620);
const LIB = process.argv[2] || 'lib_real';
const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(`${BASE}/web/index.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
await page.waitForTimeout(2000);
await page.selectOption('#lib', LIB);
await page.waitForFunction((lib) => document.getElementById('status').textContent.includes(lib), LIB, { timeout: 10000 });
console.log('加载状态:', await page.textContent('#status'));

// 播放测试音频，采样状态与档位
const wav = fileURLToPath(new URL('../../input/test/test_mouth.wav', import.meta.url));
await page.setInputFiles('#file', wav);
const samples = [];
for (let i = 0; i < 14; i++) {
  await page.waitForTimeout(400);
  samples.push(await page.evaluate(() => ({
    status: document.getElementById('status').textContent,
    level: document.getElementById('status').dataset.level,
    emax: document.getElementById('status').dataset.emax,
  })));
}
const slots = new Set(samples.map((s) => (s.status.match(/E[0-3]/) || ['?'])[0]));
const levels = samples.map((s) => parseFloat(s.level)).filter((v) => !isNaN(v));
console.log('出现档位:', [...slots].join(','));
console.log('level 范围:', Math.min(...levels).toFixed(2), '~', Math.max(...levels).toFixed(2));
console.log('控制台错误:', errors.length ? errors.join('; ') : '无');

await browser.close();
const ok = errors.length === 0 && slots.size >= 2 && Math.max(...levels) > 0.3;
console.log(ok ? '✅ 真人库主页面验证通过' : '❌ 验证未通过');
process.exit(ok ? 0 : 1);
