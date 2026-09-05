// 轻量静态服务器 + 素材库读写端点（本地开发/建库工具用）
// 用法：node server.mjs [端口]（默认 48620，可用环境变量 PORT 覆盖）
// 静态文件服务 code/ 目录；/api/lib/<库名>/<路径> 读写 avatar/libs/
// 另导出 createAppServer() 供自测复用
import { createServer } from 'node:http';
import { readFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { extname, join, normalize, sep, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileP = promisify(execFile);
// ffmpeg/ffprobe 路径：可用环境变量 FFMPEG_PATH / FFPROBE_PATH 覆盖，默认在 PATH 中查找。
// 仅 /api/transcode（视频转 H.264）用到；未安装 ffmpeg 时该接口返回 500，可先用外部工具转码（见 DEPLOY.md）。
const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE_BIN = process.env.FFPROBE_PATH || 'ffprobe';

const ROOT = normalize(fileURLToPath(new URL('.', import.meta.url)));
const PORT = Number(process.env.PORT) || Number(process.argv[2]) || 48620;
const LIBS_DIR = join(ROOT, '..', 'avatar', 'libs');
const INPUT_DIR = join(ROOT, '..', 'input');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

/** 安全拼接：防止路径越界；base 的尾部分隔符会被剥掉再比较 */
function safePath(base, rel) {
  const root = normalize(base).replace(/[\\/]+$/, '');
  const target = normalize(join(base, rel));
  if (target !== root && !target.startsWith(root + sep)) throw new Error('路径越界');
  return target;
}

/**
 * 请求体流式写入目标文件（内存峰值 O(1)，不随文件大小增长）。
 * 超过 maxBytes 抛 Error('too large')；失败时调用方负责清理半截文件。
 * @returns {Promise<number>} 实际写入字节数
 */
async function drainTo(req, target, maxBytes) {
  let total = 0;
  const limit = new Transform({
    transform(chunk, _enc, cb) {
      total += chunk.length;
      if (total > maxBytes) { cb(new Error('too large')); return; }
      cb(null, chunk);
    },
  });
  await pipeline(req, limit, createWriteStream(target));
  return total;
}

/** 上传失败统一响应：too large → 413，其余 → 500（JSON），并清理半截文件 */
async function uploadFail(res, target, err) {
  if (target) await unlink(target).catch(() => { /* noop */ });
  const tooLarge = err.message === 'too large';
  res.writeHead(tooLarge ? 413 : 500, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(tooLarge ? { error: '文件过大' } : { error: '上传失败: ' + err.message }));
}

function handle(req, res, port) {
  // 本地开发/工具场景放开跨源（如浏览器自动化脚本从 about:blank 抓取素材）
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url, `http://localhost:${port}`);
  const libPrefix = '/api/lib/';

  // —— 视频转码：POST /api/transcode（上传原始视频 → HEVC 等自动转 H.264 → 返回转码文件名）——
  if (req.method === 'POST' && url.pathname === '/api/transcode') {
    return (async () => {
      const base = `upload_${Date.now()}`;
      const srcPath = join(INPUT_DIR, base + '.mp4');
      await mkdir(INPUT_DIR, { recursive: true });
      await drainTo(req, srcPath, 500 * 1024 * 1024)
        .catch((err) => uploadFail(res, srcPath, err));
      if (res.writableEnded) return;
      // 探测视频编码
      const probe = await execFileP(FFPROBE_BIN, [
        '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', srcPath,
      ]);
      const codec = probe.stdout.trim();
      let file = base + '.mp4';
      let transcoded = false;
      if (codec !== 'h264') {
        const outPath = join(INPUT_DIR, base + '_h264.mp4');
        await execFileP(FFMPEG_BIN, [
          '-y', '-i', srcPath,
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-movflags', '+faststart', outPath,
        ]);
        file = base + '_h264.mp4';
        transcoded = true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ file, transcoded, codec, url: '/api/input/' + file }));
    })().catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '转码失败: ' + err.message }));
    });
  }

  // —— 素材库列表：GET /api/libs ——
  if (req.method === 'GET' && url.pathname === '/api/libs') {
    return readdir(LIBS_DIR, { withFileTypes: true }).then(
      (entries) => {
        const names = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ libs: names }));
      },
      (err) => sendError(res, err)
    );
  }

  // —— 测试素材读取：GET /api/input/<相对路径>（只读 input/ 目录）——
  if (req.method === 'GET' && url.pathname.startsWith('/api/input/')) {
    const rel = url.pathname.slice('/api/input/'.length);
    return readFile(safePath(INPUT_DIR, rel)).then(
      (data) => {
        res.writeHead(200, { 'Content-Type': MIME[extname(rel).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
      },
      (err) => sendError(res, err)
    );
  }

  // —— 素材库读取：GET/HEAD /api/lib/<库名>/<相对路径> ——
  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith(libPrefix)) {
    const rel = url.pathname.slice(libPrefix.length);
    return readFile(safePath(LIBS_DIR, rel)).then(
      (data) => {
        res.writeHead(200, { 'Content-Type': MIME[extname(rel).toLowerCase()] || 'application/octet-stream' });
        res.end(req.method === 'HEAD' ? undefined : data);
      },
      (err) => sendError(res, err)
    );
  }

  // —— 素材库上传：POST /api/lib/<库名>/<相对路径> ——
  if (req.method === 'POST' && url.pathname.startsWith(libPrefix)) {
    const rel = url.pathname.slice(libPrefix.length);
    return (async () => {
      const target = safePath(LIBS_DIR, rel);
      await mkdir(dirname(target), { recursive: true });
      await drainTo(req, target, 100 * 1024 * 1024).catch((err) => uploadFail(res, target, err));
      if (res.writableEnded) return;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: rel }));
    })().catch((err) => sendError(res, err));
  }

  // —— 静态文件 ——
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/web/index.html';
  return readFile(safePath(ROOT, pathname)).then(
    (data) => {
      res.writeHead(200, {
        'Content-Type': MIME[extname(pathname).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    },
    (err) => sendError(res, err)
  );
}

function sendError(res, err) {
  if (err.code === 'ENOENT' || err.message === '路径越界') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  } else {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500: ' + err.message);
  }
}

/** 创建应用服务器（不自带 listen，供自测/复用） */
export function createAppServer() {
  return createServer((req, res) => {
    // 访问日志：排查用户端"黑屏"时确认请求是否到达、返回什么
    const start = Date.now();
    const origEnd = res.end;
    res.end = function (...args) {
      try {
        console.log(`[req] ${new Date().toISOString().slice(11, 19)} ${req.method} ${new URL(req.url, 'http://x').pathname} -> ${res.statusCode} (${Date.now() - start}ms)`);
      } catch { /* noop */ }
      return origEnd.apply(this, args);
    };
    return handle(req, res, PORT);
  });
}

// 直接运行（node server.mjs）时启动监听
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  createAppServer().listen(PORT, () => {
    console.log(`light-avatar 开发服务器已启动: http://127.0.0.1:${PORT}`);
    console.log(`  网页应用: http://127.0.0.1:${PORT}/web/index.html`);
    console.log(`  建库工具: http://127.0.0.1:${PORT}/web/preprocess.html`);
  });
}
