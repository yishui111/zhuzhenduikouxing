// server.mjs 自测：静态文件 / 素材库读取与上传 / 路径越界防护
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createAppServer } from '../server.mjs';

let base = null;
let server = null;

test.before(async () => {
  server = createAppServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  server.closeAllConnections?.();   // 强制断开 keep-alive，避免 close 挂起
  await new Promise((resolve) => server.close(resolve));
  await rm(new URL('../../avatar/libs/lib_test/_probe.txt', import.meta.url), { force: true });
});

test('静态文件：首页/应用/样式可达', async () => {
  for (const p of ['/', '/web/index.html', '/web/app.mjs', '/web/style.css', '/web/preprocess.html']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, `${p} 应 200`);
    assert.ok((await r.text()).length > 50, `${p} 应有内容`);
  }
});

test('素材库读取：manifest 与帧图片可达（GET 与 HEAD）', async () => {
  const m = await (await fetch(`${base}/api/lib/lib_test/manifest.json`)).json();
  assert.ok(Array.isArray(m.frames) && m.frames.length >= 8, 'manifest 帧数 ≥8');
  const img = await fetch(`${base}/api/lib/lib_test/frames/E3_x0.png`);
  assert.equal(img.status, 200);
  const buf = new Uint8Array(await img.arrayBuffer());
  assert.equal(buf[1], 0x50, 'PNG 签名正确');
  // HEAD 也应 200（浏览器/健康检查常用）
  const head = await fetch(`${base}/api/lib/lib_test/manifest.json`, { method: 'HEAD' });
  assert.equal(head.status, 200, 'HEAD /api/lib 应 200');
  const headStatic = await fetch(`${base}/web/index.html`, { method: 'HEAD' });
  assert.equal(headStatic.status, 200, 'HEAD 静态文件应 200');
});

test('素材库上传 + 越界防护', async () => {
  // 上传一个临时文件到测试库
  const r = await fetch(`${base}/api/lib/lib_test/_probe.txt`, { method: 'POST', body: 'hello' });
  assert.equal(r.status, 200);
  const back = await (await fetch(`${base}/api/lib/lib_test/_probe.txt`)).text();
  assert.equal(back, 'hello');
  // 路径穿越请求被拒绝（URL 规范化后落不到 API 分支 → 405；safePath 越界 → 404，两者都是 4xx 且不会写出库外）
  for (const evil of ['/api/lib/../../evil.txt', '/api/lib/%2e%2e/%2e%2e/evil.txt']) {
    const post = await fetch(`${base}${evil}`, { method: 'POST', body: 'x' });
    assert.ok(post.status >= 400, `穿越上传应被拒绝，实际 ${post.status}`);
    const get = await fetch(`${base}${evil}`);
    assert.ok(get.status >= 400, `穿越读取应被拒绝，实际 ${get.status}`);
  }
});

test('视频转码 /api/transcode：HEVC → H.264', {
  // 该用例需要一份真实 HEVC 示例视频（本地录像），仓库不附带个人视频 → 无样例时跳过
  skip: !existsSync(new URL('../../input/2.mp4', import.meta.url)) && '未找到示例视频 input/2.mp4（可选依赖，跳过转码用例）',
}, async () => {
  const { readFile } = await import('node:fs/promises');
  const src = new Uint8Array(await readFile(new URL('../../input/2.mp4', import.meta.url)));
  const r = await fetch(`${base}/api/transcode`, { method: 'POST', body: src });
  assert.equal(r.status, 200, '转码接口应 200');
  const j = await r.json();
  assert.equal(j.transcoded, true, 'HEVC 应被转码');
  assert.ok(j.file.endsWith('_h264.mp4'), '输出应为 _h264.mp4');
  const out = await fetch(`${base}${j.url}`);
  assert.equal(out.status, 200, '转码文件应可读');
  const buf = new Uint8Array(await out.arrayBuffer());
  const boxType = String.fromCharCode(buf[4], buf[5], buf[6], buf[7]);
  assert.equal(boxType, 'ftyp', 'MP4 容器正常');
}, { timeout: 60000 });

test('素材库列表 /api/libs 返回库名数组', async () => {
  const j = await (await fetch(`${base}/api/libs`)).json();
  assert.ok(Array.isArray(j.libs), 'libs 应为数组');
  assert.ok(j.libs.includes('lib_test'), '应包含 lib_test');
});

test('测试素材 /api/input 只读可达，越界被拒', async () => {
  const wav = await fetch(`${base}/api/input/test/test_markers.wav`);
  assert.equal(wav.status, 200);
  const buf = new Uint8Array(await wav.arrayBuffer());
  assert.equal(String.fromCharCode(buf[0], buf[1], buf[2], buf[3]), 'RIFF', 'WAV 签名正确');
  // 编码形式的路径穿越（%2e%2e 不被 URL 规范化，safePath 应拒绝）
  const evil = await fetch(`${base}/api/input/%2e%2e/package.json`);
  assert.ok(evil.status >= 400, '越界读取应被拒绝');
  const evilGet = await fetch(`${base}/api/input/%2e%2e/%2e%2e/code/package.json`);
  assert.ok(evilGet.status >= 400, '深层越界读取应被拒绝');
});

test('不存在的路径 → 404', async () => {
  const r = await fetch(`${base}/web/nope.mjs`);
  assert.equal(r.status, 404);
});
