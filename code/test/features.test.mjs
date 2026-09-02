// features.mjs 自测
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rms, rmsDb, frameDbSequence, slidingQuantile, adaptiveLevel } from '../core/features.mjs';

test('rms：静音≈0，正弦波 1/√2 倍幅值', () => {
  assert.ok(rms(new Float32Array(1000)) < 1e-6, '静音 RMS 应≈0');
  const sr = 48000;
  const buf = new Float32Array(sr / 10); // 100ms
  for (let i = 0; i < buf.length; i++) buf[i] = Math.sin((2 * Math.PI * 440 * i) / sr);
  const expect = 1 / Math.SQRT2;
  assert.ok(Math.abs(rms(buf) - expect) < 0.01, `正弦 RMS ≈ ${expect.toFixed(3)}，实际 ${rms(buf).toFixed(3)}`);
});

test('rmsDb：满幅正弦 ≈ -3.01dB，静音 ≈ -120dB', () => {
  assert.ok(Math.abs(rmsDb(1 / Math.SQRT2) - (-3.01)) < 0.05);
  assert.ok(rmsDb(1e-12) <= -119);
});

test('frameDbSequence：帧长/帧移/帧数正确', () => {
  const sr = 48000;
  const buf = new Float32Array(sr); // 1s
  for (let i = 0; i < buf.length; i++) buf[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.5;
  const { db, times } = frameDbSequence(buf, sr, 20, 10);
  const expectFrames = Math.floor((buf.length - 960) / 480) + 1;
  assert.equal(db.length, expectFrames, '帧数正确');
  assert.ok(Math.abs(times[1] - times[0] - 0.01) < 1e-4, '帧移 10ms（Float32 精度内）');
  const expectDb = 20 * Math.log10(0.5 / Math.SQRT2);
  assert.ok(Math.abs(db[50] - expectDb) < 0.3, `中段能量 ≈ ${expectDb.toFixed(1)}dB（帧${db.length}个）`);
});

test('slidingQuantile：单调且接近 q 分位', () => {
  const v = new Float32Array(200);
  for (let i = 0; i < 200; i++) v[i] = i;
  const q = slidingQuantile(v, 100, 0.95);
  for (let i = 1; i < 200; i++) assert.ok(q[i] >= q[i - 1], '分位序列单调');
  // i=50：窗口覆盖值 0..99，95 分位 ≈ 95
  assert.ok(q[50] >= 93 && q[50] <= 96, `窗口 100、q=0.95 时 i=50 处 ≈95，实际 ${q[50]}`);
});

test('adaptiveLevel：随能量单调，输出限幅 0~1', () => {
  const db = new Float32Array([-120, -60, -40, -30, -20, -10, 0]);
  const { level } = adaptiveLevel(db, { windowFrames: 7, q: 0.95, eMinDb: -50 });
  for (let i = 1; i < level.length; i++) assert.ok(level[i] >= level[i - 1], 'level 单调');
  assert.equal(level[0], 0, '静音 → 0');
  assert.ok(level[level.length - 1] <= 1);
});
