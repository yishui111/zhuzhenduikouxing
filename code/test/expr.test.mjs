// exprmapper.mjs 自测：F0 基线 / 表情档映射 / 能量方差
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { f0Baseline, exprFromFeatures, levelVariance } from '../core/exprmapper.mjs';

test('exprFromFeatures：低音中性、高音挑眉、兴奋微笑、清音中性', () => {
  assert.equal(exprFromFeatures({ f0: 200, f0Base: 200 }), 0, '与基线一致 → 中性');
  assert.equal(exprFromFeatures({ f0: 260, f0Base: 200 }), 2, 'F0 升高 30% → 挑眉');
  assert.equal(exprFromFeatures({ f0: 210, f0Base: 200, levelVar: 0.05 }), 1, '能量起伏大 → 微笑');
  assert.equal(exprFromFeatures({ f0: 0, f0Base: 200 }), 0, '清音 → 中性');
  assert.equal(exprFromFeatures({ f0: 200, f0Base: 0 }), 0, '无基线 → 中性');
  // 阈值边界：1.25 正好不触发挑眉
  assert.equal(exprFromFeatures({ f0: 250, f0Base: 200 }), 2, '1.25 触发');
  assert.equal(exprFromFeatures({ f0: 249, f0Base: 200, ratioThr: 1.25 }), 0, '低于阈值 → 中性');
});

test('f0Baseline：含跳变尖峰的序列基线稳定在中位数', () => {
  const f0 = new Float32Array(200);
  for (let i = 0; i < 200; i++) f0[i] = 200;
  f0[50] = 500; // 单帧尖峰
  f0[100] = 0;  // 清音帧
  const base = f0Baseline(f0, 100, 15);
  for (let i = 30; i < 170; i++) assert.ok(base[i] > 195 && base[i] < 205, `基线≈200，实际 ${base[i]}`);
});

test('levelVariance：恒定能量方差为 0，起伏能量方差 >0', () => {
  const flat = new Float32Array(100).fill(0.5);
  const vf = levelVariance(flat, 20);
  assert.ok(vf[50] < 1e-9, '恒定能量方差≈0');
  const wave = new Float32Array(100);
  for (let i = 0; i < 100; i++) wave[i] = i % 2 === 0 ? 0.2 : 0.9;
  const vw = levelVariance(wave, 20);
  assert.ok(vw[50] > 0.05, `起伏能量方差>0.05，实际 ${vw[50].toFixed(3)}`);
});
