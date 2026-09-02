// statemachine.mjs 自测：滞回 / 确认 / 保持 / 静音 / 片段与淡化模式
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStateMachine, slotFromLevel } from '../core/statemachine.mjs';

const sm = (over = {}) => createStateMachine({ levelsPerFrame: 100, ...over });
const feed = (m, seq) => {
  // seq: [{db, level, expr, dtMs}] 以 10ms 步进
  const events = [];
  let now = 0;
  for (const s of seq) {
    now += s.dtMs ?? 10;
    events.push(m.step({ db: s.db, level: s.level, expr: s.expr ?? 0, nowMs: now }));
  }
  return events;
};

test('slotFromLevel 分档正确', () => {
  assert.equal(slotFromLevel(0.0, 4), 0);
  assert.equal(slotFromLevel(0.24, 4), 0);
  assert.equal(slotFromLevel(0.26, 4), 1);
  assert.equal(slotFromLevel(0.9, 4), 3);
  assert.equal(slotFromLevel(1.0, 4), 3);
});

test('静音 → 闭嘴（E0×中性）', () => {
  const m = sm();
  const ev = feed(m, [
    { db: -20, level: 0.8 },            // 先进入说话状态
    { db: -20, level: 0.8 },
    { db: -20, level: 0.8 },
    { db: -20, level: 0.8 },
    { db: -20, level: 0.8 },
    ...Array.from({ length: 30 }, () => ({ db: -70, level: 0 })), // 静音 300ms
  ]);
  const last = ev[ev.length - 1];
  assert.equal(last.state.slot, 0, '静音后嘴档归 0');
  assert.equal(last.state.expr, 0);
  assert.ok(last.silent, '标记 silent');
});

test('能量跳升 → 确认 3 帧后切到高档，mode=clip（同表情）', () => {
  const m = sm();
  const ev = feed(m, [
    { db: -25, level: 0.1 },
    { db: -25, level: 0.1 },
    { db: -25, level: 0.1 },
    { db: -25, level: 0.1 },
    { db: -25, level: 0.1 },
    ...Array.from({ length: 40 }, () => ({ db: -8, level: 0.95 })),
  ]);
  const changes = ev.filter(e => e.changed);
  assert.equal(changes.length, 1, '只发生一次切换');
  assert.equal(changes[0].to?.slot ?? changes[0].state.slot, 3);
  assert.equal(changes[0].mode, 'clip');
  // 切换发生在确认 3 帧之后（30ms）+ 保持期之后
  const idx = ev.findIndex(e => e.changed);
  assert.ok(idx >= 5 + 3 - 1, `切换应发生在确认之后（idx=${idx}）`);
});

test('滞回：能量小幅振荡不产生切换（防抖动）', () => {
  const m = sm({ hysteresis: 0.15 });
  const seq = [
    ...Array.from({ length: 12 }, () => ({ db: -10, level: 0.9 })), // 预热：先稳定到高档并过保持期
    ...Array.from({ length: 50 }, (_, i) => ({ db: -10, level: i % 2 === 0 ? 0.8 : 0.9 })),
  ];
  const ev = feed(m, seq);
  const afterWarmup = ev.slice(12);
  assert.equal(afterWarmup.filter(e => e.changed).length, 0, '0.8↔0.9 振荡不切换');
});

test('单帧脉冲（爆破音）：不足确认帧数 → 不切换', () => {
  const m = sm({ confirmFrames: 3 });
  const seq = [
    { db: -25, level: 0.1 }, { db: -25, level: 0.1 }, { db: -25, level: 0.1 },
    { db: -8, level: 1.0 },                                // 单帧脉冲
    { db: -25, level: 0.1 }, { db: -25, level: 0.1 }, { db: -25, level: 0.1 },
  ];
  const ev = feed(m, seq);
  assert.equal(ev.filter(e => e.changed).length, 0, '脉冲不足确认帧数，不切换');
});

test('保持期：切换后 holdMs 内的反向请求被挡住', () => {
  const m = sm({ holdMs: 100 });
  const s = (db, level, nowMs) => m.step({ db, level, expr: 0, nowMs });
  s(-25, 0.1, 10); s(-25, 0.1, 20);
  s(-8, 0.95, 30); s(-8, 0.95, 40); s(-8, 0.95, 50); s(-8, 0.95, 60);
  const sw = s(-8, 0.95, 100);                 // 确认 3 帧 + 保持期过 → 切到 E3
  assert.equal(sw.changed, true);
  assert.equal(sw.state.slot, 3);
  s(-25, 0.1, 110); s(-25, 0.1, 120); s(-25, 0.1, 130);  // 反向请求开始
  const blocked1 = s(-25, 0.1, 140);           // 确认 3 帧达成，但保持期未过 → 挡住
  assert.equal(blocked1.changed, false, '保持期内反向切换被挡');
  const blocked2 = s(-25, 0.1, 150);           // 150-100=50ms < 100ms
  assert.equal(blocked2.changed, false);
  const released = s(-25, 0.1, 210);           // 210-100=110ms > 100ms → 允许切回
  assert.equal(released.changed, true);
  assert.equal(released.state.slot, 0);
});

test('表情档变化 → mode=fade（跨表情无片段）', () => {
  const m = sm();
  const ev = feed(m, [
    { db: -20, level: 0.5, expr: 0 },
    { db: -20, level: 0.5, expr: 0 },
    { db: -20, level: 0.5, expr: 0 },
    { db: -20, level: 0.5, expr: 0 },
    ...Array.from({ length: 6 }, () => ({ db: -20, level: 0.5, expr: 1 })), // 确认3帧 + 保持期(100ms)
  ]);
  const change = ev.find(e => e.changed);
  assert.ok(change, '应有切换');
  assert.equal(change.mode, 'fade');
  assert.equal(change.state.expr, 1);
});

test('确定性：相同输入两次运行结果一致', () => {
  const seq = Array.from({ length: 100 }, (_, i) => ({
    db: i % 20 === 0 ? -60 : -15,
    level: Math.sin(i / 5) * 0.5 + 0.5,
  }));
  const a = feed(sm(), seq).map(e => `${e.state.slot}${e.state.expr}${e.changed ? '!' : ''}`).join('');
  const b = feed(sm(), seq).map(e => `${e.state.slot}${e.state.expr}${e.changed ? '!' : ''}`).join('');
  assert.equal(a, b);
});
