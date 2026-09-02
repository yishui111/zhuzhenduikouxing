// markers.mjs 自测：用合成 test_markers.wav 验证记号检测与切片
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { frameDbSequence } from '../core/features.mjs';
import { detectMarkers, sliceByMarkers } from '../core/markers.mjs';
import { decodeWAV } from '../tools/wav.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { samples, sampleRate } = decodeWAV(readFileSync(join(ROOT, '..', 'input', 'test', 'test_markers.wav')));

test('detectMarkers：检测到 3 个记号，位置≈0.36/1.68/3.00s', () => {
  const { db, times } = frameDbSequence(samples, sampleRate, 20, 10);
  const marks = detectMarkers(db, times, { thresholdDb: -15, minGapMs: 500, refineWindowMs: 80 });
  assert.equal(marks.length, 3, `应检测 3 个记号，实际 ${marks.length}`);
  const expect = [0.36, 1.68, 3.0];
  marks.forEach((m, i) => {
    assert.ok(Math.abs(m.time - expect[i]) < 0.08, `记号${i + 1} 时间≈${expect[i]}s，实际 ${m.time.toFixed(2)}s`);
  });
});

test('detectMarkers：相对突出判定（响度自适应）', () => {
  // 场景 A：整体响度低但记号相对突出 → 应检出
  const dbA = new Float32Array(200).fill(-40);
  dbA[50] = -20;
  const timesA = Float32Array.from({ length: 200 }, (_, i) => i * 0.01);
  const marksA = detectMarkers(dbA, timesA, { thresholdDb: -60, minGapMs: 500 });
  assert.equal(marksA.length, 1, '低响度中突出峰应检出');
  // 场景 B：整体响度高、只有小幅起伏 → 不应检出（响度漂移不误报）
  const dbB = new Float32Array(200).fill(-10);
  dbB[50] = -6; // 只高出 4dB，小于相对余量 6dB
  const timesB = Float32Array.from({ length: 200 }, (_, i) => i * 0.01);
  const marksB = detectMarkers(dbB, timesB, { thresholdDb: -60, minGapMs: 500 });
  assert.equal(marksB.length, 0, '小幅起伏不应误报为记号');
});

test('sliceByMarkers：按记号切出 4 段（首尾含静音）', () => {
  const { times } = frameDbSequence(samples, sampleRate, 20, 10);
  const segs = sliceByMarkers(times, [0.36, 1.68, 3.0]);
  assert.equal(segs.length, 4);
  assert.ok(segs[0].start <= 0.01, '第 1 段从头开始');
  assert.ok(segs[3].end >= 4.7, '最后一段覆盖结尾');
  for (let i = 1; i < segs.length; i++) assert.ok(segs[i].start >= segs[i - 1].start, '段起点递增');
});
