// pitch.mjs 自测：自相关音高 / 清浊音 / 中值滤波 / 整段序列
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { autocorrPitch, f0Sequence, medianFilterPitch } from '../core/pitch.mjs';
import { decodeWAV } from '../tools/wav.mjs';

const SR = 48000;
const tone = (freq, seconds, amp = 0.3) => {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / SR) * amp;
  return out;
};

test('自相关：纯音 100Hz → f0≈100，浊音判定通过', () => {
  const s = tone(100, 0.03);
  const r = autocorrPitch(s, SR);
  assert.ok(r.voiced, '纯音应判定为浊音');
  assert.ok(Math.abs(r.f0 - 100) < 3, `f0≈100，实际 ${r.f0.toFixed(1)}`);
  assert.ok(r.confidence > 0.3);
});

test('自相关：220Hz / 静音 / 噪声', () => {
  const r220 = autocorrPitch(tone(220, 0.03), SR);
  assert.ok(Math.abs(r220.f0 - 220) < 6, `f0≈220，实际 ${r220.f0.toFixed(1)}`);
  const sil = autocorrPitch(new Float32Array(1440), SR);
  assert.equal(sil.f0, 0);
  assert.ok(!sil.voiced);
  const noise = new Float32Array(1440);
  let state = 7;
  for (let i = 0; i < 1440; i++) { state = (state * 1103515245 + 12345) & 0x7fffffff; noise[i] = (state / 0x7fffffff) * 2 - 1; }
  const rn = autocorrPitch(noise, SR);
  assert.ok(!rn.voiced || rn.confidence < 0.5, '白噪声不应有稳定音高');
});

test('中值滤波：单帧八度跳变被抑制', () => {
  const f0 = Float32Array.from([200, 200, 400, 200, 200, 200, 200]);
  const out = medianFilterPitch(f0);
  for (const v of out) assert.ok(v > 190 && v < 210, `滤波后应≈200，实际 ${v}`);
});

test('整段序列 + 中值滤波：test_pitch.wav 四段音高正确', () => {
  const { samples, sampleRate } = decodeWAV(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'input', 'test', 'test_pitch.wav')));
  const { f0, times } = f0Sequence(samples, sampleRate, 30, 30);
  const f = medianFilterPitch(f0);
  const seg = (t0, t1) => {
    const vals = [];
    for (let i = 0; i < times.length; i++) if (times[i] >= t0 && times[i] <= t1 && f[i] > 0) vals.push(f[i]);
    vals.sort((a, b) => a - b);
    return vals.length ? vals[Math.floor(vals.length / 2)] : 0;
  };
  assert.ok(Math.abs(seg(0.2, 1.8) - 120) < 5, `段1≈120Hz，实际 ${seg(0.2, 1.8).toFixed(1)}`);
  assert.ok(Math.abs(seg(2.2, 3.8) - 240) < 10, `段2≈240Hz，实际 ${seg(2.2, 3.8).toFixed(1)}`);
  assert.equal(seg(4.2, 4.8), 0, '静音段无音高');
  assert.ok(Math.abs(seg(5.2, 6.8) - 180) < 7, `段4≈180Hz，实际 ${seg(5.2, 6.8).toFixed(1)}`);
});
