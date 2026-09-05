// formants.mjs 自测：FFT 频谱 / 共振峰提取 / 元音分类 / 平滑跟踪 / 真实 wav 端到端
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spectrumDb } from '../core/fft.mjs';
import { estimateFormants, classifyVowel, createVowelTracker, VOWEL_REFS } from '../core/formants.mjs';
import { decodeWAV } from '../tools/wav.mjs';

const SR = 48000;

const tone2 = (f1, f2, seconds, amp1 = 0.3, amp2 = 0.2) => {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] = Math.sin(2 * Math.PI * f1 * t) * amp1 + Math.sin(2 * Math.PI * f2 * t) * amp2;
  }
  return out;
};

test('spectrumDb：正弦峰落在正确频点', () => {
  const { magDb, binHz } = spectrumDb(tone2(1000, 3000, 2048 / SR), SR);
  // 找最大峰后清掉其主瓣邻域（±4bin），再在剩余里找第二峰，避免旁瓣干扰
  let p1 = 1;
  for (let i = 1; i < magDb.length; i++) if (magDb[i] > magDb[p1]) p1 = i;
  let p2 = 1;
  for (let i = 1; i < magDb.length; i++) {
    if (Math.abs(i - p1) <= 4) continue;
    if (magDb[i] > magDb[p2]) p2 = i;
  }
  assert.ok(Math.abs(p1 * binHz - 1000) < 40, `第一峰 ≈1000Hz，实际 ${(p1 * binHz).toFixed(0)}`);
  assert.ok(Math.abs(p2 * binHz - 3000) < 40, `第二峰 ≈3000Hz，实际 ${(p2 * binHz).toFixed(0)}`);
});

test('estimateFormants：双共振峰信号 → F1/F2 近似正确', () => {
  for (const [v, [f1, f2]] of Object.entries(VOWEL_REFS)) {
    const { magDb } = spectrumDb(tone2(f1, f2, 2048 / SR), SR);
    const fm = estimateFormants(magDb, SR);
    assert.ok(fm, `${v}: 应提取到共振峰`);
    assert.ok(Math.abs(fm.f1 - f1) < 60, `${v}: F1≈${f1}，实际 ${fm.f1.toFixed(0)}`);
    assert.ok(Math.abs(fm.f2 - f2) < 90, `${v}: F2≈${f2}，实际 ${fm.f2.toFixed(0)}`);
  }
});

test('estimateFormants：平谱/静音 → null（无有效峰）', () => {
  const flat = new Float32Array(1024).fill(-60);
  assert.equal(estimateFormants(flat, SR), null, '平谱无峰');
  const tiny = new Float32Array(4).fill(-60);
  assert.equal(estimateFormants(tiny, SR), null, '谱太短');
});

test('classifyVowel：参考点命中自身，偏离判空', () => {
  for (const [v, [f1, f2]] of Object.entries(VOWEL_REFS)) {
    const { vowel, confidence } = classifyVowel(f1, f2);
    assert.equal(vowel, v, `(${f1},${f2}) 应判为 ${v}`);
    assert.ok(confidence > 0.9, `置信度应高，实际 ${confidence.toFixed(2)}`);
  }
  // 半径外的偏点（如 e 与 i 之间的远点）：应判空
  const off = classifyVowel(1150, 2100);
  assert.equal(off.vowel, '', '远离所有参考点应判空');
  assert.equal(classifyVowel(0, 0).vowel, '', '无效输入 → 空');
});

test('createVowelTracker：确认帧 + 保持期 + 清音确认', () => {
  const tr = createVowelTracker({ confirmFrames: 2, holdMs: 200 });
  let now = 0;
  assert.equal(tr.step('a', now), '', '单帧不确认');
  now += 33;
  assert.equal(tr.step('a', now), 'a', '连续 2 帧确认切入');
  now += 33;
  assert.equal(tr.step('u', now), 'a', '保持期内新元音被挡');
  now += 50;
  assert.equal(tr.step('u', now), 'a', '保持期内（80ms<200ms）仍保持 a');
  now += 200;
  assert.equal(tr.step('u', now), 'u', '保持期过后确认切换到 u');
  // 清音：单帧 '' 不清空，连续 2 帧才清
  now += 250;
  assert.equal(tr.step('', now), 'u', '单帧清音不清空');
  now += 33;
  assert.equal(tr.step('', now), '', '连续 2 帧清音 → 清空');
});

test('端到端：test_vowel.wav 五段元音分类正确（FFT→共振峰→分类）', () => {
  const { samples, sampleRate } = decodeWAV(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'input', 'test', 'test_vowel.wav'))
  );
  // 段结构见 make-test-assets：每段 1.0s + 0.5s 静音，序 a,e,i,o,u
  const order = ['a', 'e', 'i', 'o', 'u'];
  const segSec = 1.5;
  const win = 2048;
  for (let s = 0; s < order.length; s++) {
    const center = Math.round((s * segSec + 0.5) * sampleRate); // 段中心
    const { magDb } = spectrumDb(samples.subarray(center, center + win), sampleRate);
    const fm = estimateFormants(magDb, sampleRate);
    const { vowel, confidence } = fm ? classifyVowel(fm.f1, fm.f2) : { vowel: '', confidence: 0 };
    assert.equal(vowel, order[s], `段 ${s + 1} 应为 ${order[s]}（F1=${fm?.f1.toFixed(0)},F2=${fm?.f2.toFixed(0)},conf=${confidence.toFixed(2)}）`);
  }
  // 静音段：无元音（末段 u 在 6.0~7.0s，取 7.25s 处的静音间隙，避免越界）
  const tail = Math.round(7.25 * sampleRate);
  const { magDb: silentSpec } = spectrumDb(samples.subarray(tail, tail + win), sampleRate);
  assert.equal(estimateFormants(silentSpec, sampleRate), null, '静音段无共振峰');
});
