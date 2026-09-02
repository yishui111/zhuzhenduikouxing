// composer.mjs 自测：初始帧 / 渐隐渐现切换 / 候选轮换
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

test('渐隐渐现：旧帧先淡出（新帧不出现），再淡入新帧，两层不叠加', () => {
  const c = createComposer({ transitionMs: 100 }); // outDur=50, inDur=50
  c.enter({ key: '0_0', img: img('A') });
  c.step(0);
  c.enter({ key: '1_0', img: img('B') });
  // 淡出阶段：只有旧帧 A，alpha 从 1 → 0
  const t0 = c.step(0);
  assert.equal(t0.length, 1);
  assert.equal(t0[0].img.id, 'A');
  assert.equal(t0[0].alpha, 1);
  const t25 = c.step(25);
  assert.equal(t25.length, 1, '淡出期不显示新帧（不叠加）');
  assert.ok(Math.abs(t25[0].alpha - 0.5) < 0.05, `25ms 旧帧 alpha≈0.5，实际 ${t25[0].alpha}`);
  // 淡入阶段：只有新帧 B，alpha 从 0 → 1
  const t50 = c.step(50);
  assert.equal(t50[0].img.id, 'B');
  assert.ok(t50[0].alpha < 0.05, `50ms 新帧 alpha≈0，实际 ${t50[0].alpha}`);
  const t75 = c.step(75);
  assert.equal(t75[0].img.id, 'B');
  assert.ok(Math.abs(t75[0].alpha - 0.5) < 0.05, `75ms 新帧 alpha≈0.5，实际 ${t75[0].alpha}`);
  const t110 = c.step(110);
  assert.equal(t110.length, 1);
  assert.equal(t110[0].img.id, 'B');
  assert.equal(t110[0].alpha, 1, '切换完成显示新帧');
});

test('连续切换：中途再次 enter 会重新开始渐隐', () => {
  const c = createComposer({ transitionMs: 100 });
  c.enter({ key: '0_0', img: img('A') });
  c.step(0);
  c.enter({ key: '1_0', img: img('B') });
  c.step(20);
  c.enter({ key: '2_0', img: img('C') });  // 快速连续切换
  const layers = c.step(25);
  assert.equal(layers.length, 1, '同一时刻只有一层（不叠加）');
  assert.equal(layers[0].img.id, 'B', '从 B 淡出');
});

test('候选轮换 swap：渐隐渐现替换底图', () => {
  const c = createComposer({ transitionMs: 100 });
  c.enter({ key: '1_0', img: img('A') });
  c.step(0);
  c.swap(img('A2'));
  const mid = c.step(20);
  assert.equal(mid.length, 1, '轮换期也只有一层');
  assert.equal(mid[0].img.id, 'A', '先淡出旧图');
  const after = c.step(200);
  assert.equal(after.length, 1);
  assert.equal(after[0].img.id, 'A2');
  assert.equal(after[0].alpha, 1);
});

test('currentKey 追踪当前状态', () => {
  const c = createComposer();
  c.enter({ key: '2_0', img: img('X') });
  assert.equal(c.currentKey(), '2_0');
  c.enter({ key: '3_1', img: img('Y') });
  assert.equal(c.currentKey(), '3_1');
});
