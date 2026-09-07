// composer.mjs 自测：初始帧 / 交叉淡化切换（无暗帧）/ 连续切换 / key 追踪
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createComposer } from '../core/composer.mjs';

const img = (id) => ({ id });

test('初始帧直接显示，无过渡', () => {
  const c = createComposer({ transitionMs: 100 });
  c.enter({ key: '0_0', img: img('A') });
  const layers = c.step(0);
  assert.equal(layers.length, 1);
  assert.equal(layers[0].img.id, 'A');
  assert.equal(layers[0].alpha, 1);
});

test('交叉淡化：旧帧渐隐与新帧渐显同时进行，任一时刻不出现全暗帧', () => {
  const c = createComposer({ transitionMs: 100 });
  c.enter({ key: '0_0', img: img('A') });
  c.step(0);
  c.enter({ key: '1_0', img: img('B') });
  for (const t of [0, 10, 25, 50, 75, 90]) {
    const layers = c.step(t);
    // 两层不透明度之和恒为 1（身体部分两帧相同，合成无暗帧）
    const sum = layers.reduce((s, l) => s + l.alpha, 0);
    assert.ok(Math.abs(sum - 1) < 0.02, `t=${t}ms alpha 之和应为 1，实际 ${sum.toFixed(3)}`);
    if (t < 100) assert.equal(layers.length, 2, `t=${t}ms 过渡期新旧两帧共存`);
  }
  const done = c.step(150);
  assert.equal(done.length, 1);
  assert.equal(done[0].img.id, 'B');
  assert.equal(done[0].alpha, 1, '切换完成只显示新帧');
});

test('过渡期旧帧递减、新帧递增（新帧在上层）', () => {
  const c = createComposer({ transitionMs: 100 });
  c.enter({ key: '0_0', img: img('A') });
  c.step(0);
  c.enter({ key: '1_0', img: img('B') });
  const t25 = c.step(25);
  assert.equal(t25[0].img.id, 'A', '旧帧在下层先画');
  assert.ok(Math.abs(t25[0].alpha - 0.86) < 0.1, `25ms 旧帧 alpha≈0.86，实际 ${t25[0].alpha.toFixed(2)}`);
  assert.equal(t25[1].img.id, 'B', '新帧在上层后画');
  assert.ok(t25[1].alpha > 0.05 && t25[1].alpha < 0.2, `25ms 新帧 alpha≈0.14，实际 ${t25[1].alpha.toFixed(2)}`);
});

test('连续切换：中途再次 enter 从当前帧重新交叉', () => {
  const c = createComposer({ transitionMs: 100 });
  c.enter({ key: '0_0', img: img('A') });
  c.step(0);
  c.enter({ key: '1_0', img: img('B') });
  c.step(20);
  c.enter({ key: '2_0', img: img('C') });  // 快速连续切换：从当前混合状态切到 C
  const layers = c.step(25);
  assert.equal(layers.length, 2);
  assert.equal(layers[1].img.id, 'C', '新帧为 C');
  const done = c.step(200);
  assert.equal(done.length, 1);
  assert.equal(done[0].img.id, 'C');
  assert.equal(done[0].alpha, 1);
});

test('同 key 重复 enter 不触发过渡', () => {
  const c = createComposer({ transitionMs: 100 });
  c.enter({ key: '1_0', img: img('A') });
  c.step(0);
  c.enter({ key: '1_0', img: img('A2') });  // 同 key 换图对象：直接替换
  const layers = c.step(10);
  assert.equal(layers.length, 1);
  assert.equal(layers[0].alpha, 1);
});

test('currentKey 追踪当前状态', () => {
  const c = createComposer();
  c.enter({ key: '2_0', img: img('X') });
  assert.equal(c.currentKey(), '2_0');
  c.enter({ key: '3_1', img: img('Y') });
  assert.equal(c.currentKey(), '3_1');
});
