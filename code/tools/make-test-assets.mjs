// 生成方案 B 自测素材（零依赖）：
//   1) avatar/libs/lib_test/  —— 测试关键帧库 A（默认配色卡通脸 PNG + manifest）
//   2) avatar/libs/lib_test2/ —— 测试关键帧库 B（变体配色，验证多库切换）
//   3) input/test/  —— 测试音频 WAV（test_mouth.wav 口型 / test_markers.wav 记号 / test_pitch.wav 音高）
// 用法：node tools/make-test-assets.mjs
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from './png.mjs';
import { encodeWAV } from './wav.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url)); // code/
const LIBS = join(ROOT, '..', 'avatar', 'libs');
const INPUT = join(ROOT, '..', 'input', 'test');
mkdirSync(INPUT, { recursive: true });

const W = 256, H = 256;

// —— 配色（每套库一套，用于验证"换皮=换库"）——
const PALETTES = {
  default: { bg: [205, 205, 212], hair: [62, 48, 42], skin: [240, 202, 170], skinShade: [214, 174, 144], eye: [40, 40, 46], brow: [52, 46, 40], mouth: [128, 46, 46], ear: [232, 190, 158] },
  green: { bg: [225, 230, 200], hair: [30, 30, 60], skin: [178, 210, 160], skinShade: [150, 185, 130], eye: [60, 30, 90], brow: [40, 50, 40], mouth: [150, 30, 80], ear: [160, 195, 142] },
};

function px(rgba, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
}

function fillEllipse(rgba, cx, cy, rx, ry, r, g, b) {
  for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(H - 1, Math.ceil(cy + ry)); y++) {
    for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(W - 1, Math.ceil(cx + rx)); x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) px(rgba, x, y, r, g, b);
    }
  }
}

function fillRect(rgba, x0, y0, x1, y1, r, g, b) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(rgba, x, y, r, g, b);
}

function line(rgba, x0, y0, x1, y1, w, r, g, b) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let s = 0; s <= steps; s++) {
    const x = Math.round(x0 + ((x1 - x0) * s) / steps);
    const y = Math.round(y0 + ((y1 - y0) * s) / steps);
    for (let dy = -Math.floor(w / 2); dy <= Math.ceil(w / 2); dy++)
      for (let dx = -Math.floor(w / 2); dx <= Math.ceil(w / 2); dx++) px(rgba, x + dx, y + dy, r, g, b);
  }
}

/** 画一张测试"卡通脸"：嘴部高度随 slot 变化、眉毛随 expr 变化；颜色用调色板 */
function drawFace(slot, expr, pal) {
  const rgba = new Uint8Array(W * H * 4);
  fillRect(rgba, 0, 0, W - 1, H - 1, ...pal.bg);
  fillEllipse(rgba, 128, 92, 96, 88, ...pal.hair);
  fillEllipse(rgba, 128, 134, 82, 94, ...pal.skin);
  fillEllipse(rgba, 46, 140, 10, 18, ...pal.ear);
  fillEllipse(rgba, 210, 140, 10, 18, ...pal.ear);
  fillEllipse(rgba, 102, 120, 8, 9, 250, 250, 252);
  fillEllipse(rgba, 154, 120, 8, 9, 250, 250, 252);
  fillEllipse(rgba, 102, 121, 4, 5, ...pal.eye);
  fillEllipse(rgba, 154, 121, 4, 5, ...pal.eye);
  if (expr === 0) {
    line(rgba, 88, 104, 116, 104, 4, ...pal.brow);
    line(rgba, 140, 104, 168, 104, 4, ...pal.brow);
  } else if (expr === 1) {
    line(rgba, 88, 102, 116, 105, 4, ...pal.brow);
    line(rgba, 140, 105, 168, 102, 4, ...pal.brow);
  } else {
    line(rgba, 88, 92, 116, 98, 4, ...pal.brow);
    line(rgba, 140, 98, 168, 92, 4, ...pal.brow);
  }
  line(rgba, 128, 130, 128, 142, 3, ...pal.skinShade);
  const mouthH = 5 + Math.max(0, Math.min(1, slot)) * 30;
  const mx0 = 98, mx1 = 158, my = 178;
  if (expr === 1) {
    const bars = 7;
    for (let b = 0; b < bars; b++) {
      const t = b / (bars - 1);
      const h = mouthH * (0.45 + 0.55 * (1 - Math.abs(t - 0.5) * 2));
      const bx0 = Math.round(mx0 + t * (mx1 - mx0) - 3);
      fillRect(rgba, bx0, Math.round(my - h), bx0 + 6, Math.round(my), ...pal.mouth);
    }
  } else {
    fillRect(rgba, mx0, Math.round(my - mouthH), mx1, my, ...pal.mouth);
  }
  return rgba;
}

function writePng(libDir, relPath, rgba) {
  const buf = encodePNG(W, H, rgba);
  const full = join(libDir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, buf);
  const back = readFileSync(full);
  if (back.toString('ascii', 1, 4) !== 'PNG') throw new Error('PNG 自检失败: ' + relPath);
  if (back.readUInt32BE(16) !== W || back.readUInt32BE(20) !== H) throw new Error('PNG 尺寸自检失败: ' + relPath);
}

/** 构建一个关键帧库 */
function buildLib(name, pal, note) {
  const libDir = join(LIBS, name);
  mkdirSync(libDir, { recursive: true });
  const frames = [];
  for (let slot = 0; slot <= 3; slot++) {
    const id = `E${slot}_x0`;
    writePng(libDir, `frames/${id}.png`, drawFace(slot, 0, pal));
    frames.push({ id, file: `frames/${id}.png`, slot, expr: 0 });
  }
  frames.push({ id: 'E1_x1', file: 'frames/E1_x1.png', slot: 1, expr: 1 }); writePng(libDir, 'frames/E1_x1.png', drawFace(1, 1, pal));
  frames.push({ id: 'E2_x1', file: 'frames/E2_x1.png', slot: 2, expr: 1 }); writePng(libDir, 'frames/E2_x1.png', drawFace(2, 1, pal));
  frames.push({ id: 'E2_x2', file: 'frames/E2_x2.png', slot: 2, expr: 2 }); writePng(libDir, 'frames/E2_x2.png', drawFace(2, 2, pal));
  frames.push({ id: 'E3_x2', file: 'frames/E3_x2.png', slot: 3, expr: 2 }); writePng(libDir, 'frames/E3_x2.png', drawFace(3, 2, pal));
  const clipFiles = [];
  for (let k = 1; k <= 4; k++) {
    const rel = `clips/E0_to_E3_x0/${String(k).padStart(2, '0')}.png`;
    writePng(libDir, rel, drawFace(k / 4, 0, pal));
    clipFiles.push(rel);
  }
  const manifest = {
    meta: {
      name,
      person: '测试占位（合成卡通脸）',
      created: new Date().toISOString().slice(0, 10),
      note,
      frameMs: 33,
    },
    background: null,
    frames,
    clips: [{ id: 'clip_E0_E3_x0', from: 0, to: 3, expr: 0, reversible: true, files: clipFiles }],
  };
  writeFileSync(join(libDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { frames: frames.length, clips: manifest.clips.length };
}

// —— 音频合成 ——
function makeNoise(seconds, sampleRate, amp, modHz = 0) {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  let state = 12345;
  for (let i = 0; i < n; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const white = (state / 0x7fffffff) * 2 - 1;
    const mod = modHz > 0 ? 0.6 + 0.4 * Math.sin(2 * Math.PI * modHz * (i / sampleRate)) : 1;
    out[i] = white * amp * mod;
  }
  return out;
}

function makeTone(seconds, sampleRate, freq, amp, fadeMs = 10) {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  const fade = Math.round((fadeMs / 1000) * sampleRate);
  for (let i = 0; i < n; i++) {
    const env = i < fade ? i / fade : i > n - fade ? (n - i) / fade : 1;
    out[i] = Math.sin(2 * Math.PI * freq * (i / sampleRate)) * amp * env;
  }
  return out;
}

function concat(parts) {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

const SR = 48000;
const t = (s) => Math.round(s * SR);

const mouth = concat([
  new Float32Array(t(0.5)),
  makeNoise(1.5, SR, 0.044, 4),
  makeNoise(1.5, SR, 0.128, 4),
  makeNoise(1.5, SR, 0.315, 4),
  new Float32Array(t(1.0)),
  makeNoise(2.5, SR, 0.15, 3),
]);
writeFileSync(join(INPUT, 'test_mouth.wav'), encodeWAV(mouth, SR));

const markers = concat([
  new Float32Array(t(0.3)),
  makeTone(0.12, SR, 1000, 0.7),
  makeNoise(1.2, SR, 0.08, 4),
  makeTone(0.12, SR, 1000, 0.7),
  makeNoise(1.2, SR, 0.14, 4),
  makeTone(0.12, SR, 1000, 0.7),
  makeNoise(1.2, SR, 0.22, 4),
  new Float32Array(t(0.5)),
]);
writeFileSync(join(INPUT, 'test_markers.wav'), encodeWAV(markers, SR));

const pitch = concat([
  makeTone(2.0, SR, 120, 0.3),
  makeTone(2.0, SR, 240, 0.3),
  new Float32Array(t(1.0)),
  makeTone(2.0, SR, 180, 0.3),
]);
writeFileSync(join(INPUT, 'test_pitch.wav'), encodeWAV(pitch, SR));

// —— 生成两套测试库 ——
const r1 = buildLib('lib_test', PALETTES.default, '合成测试素材 A（默认配色），非真人录像；用于驱动引擎自测与浏览器演示。');
const r2 = buildLib('lib_test2', PALETTES.green, '合成测试素材 B（变体配色），验证多库切换；非真人录像。');

console.log('已生成测试素材：');
console.log(`  avatar/libs/lib_test/  （${r1.frames} 帧 + ${r1.clips} 片段）`);
console.log(`  avatar/libs/lib_test2/ （${r2.frames} 帧 + ${r2.clips} 片段）`);
console.log(`  ${join(INPUT, 'test_mouth.wav')}（${(mouth.length / SR).toFixed(1)}s）`);
console.log(`  ${join(INPUT, 'test_markers.wav')}（${(markers.length / SR).toFixed(1)}s）`);
console.log(`  ${join(INPUT, 'test_pitch.wav')}（${(pitch.length / SR).toFixed(1)}s）`);
