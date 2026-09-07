// exprmapper.mjs 自测：表情档映射
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exprFromFeatures } from '../core/exprmapper.mjs';

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
