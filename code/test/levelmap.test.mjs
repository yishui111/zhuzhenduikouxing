// levelmap.mjs 自测：自适应能量底 / 说话保底 / 静音门限
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoRange, levelFromDb } from '../core/levelmap.mjs';

test('autoRange：自适应能量底与静音门限', () => {
  const { eMin, silenceDb } = autoRange(-20, { dynamicDb: 25, silenceMarginDb: 7 });
  assert.equal(eMin, -45, '能量底 = 峰值 - 25dB');
  assert.equal(silenceDb, -52, '静音门限 = 能量底 - 7dB');
});

test('levelFromDb：低音量音频也能张开（关键修复）', () => {
  // 模拟安静音频：峰值 -30dB（普通低音量语音）
  const weak = levelFromDb(-45, -30, { silent: false });
  assert.equal(weak, 0.4, '弱音节 -45dB → level 0.4（E1 微张），不再闭死');
  const strong = levelFromDb(-30, -30, { silent: false });
  assert.equal(strong, 1, '峰值音节 = 1');
  const mid = levelFromDb(-40, -30, { silent: false });
  assert.equal(mid, 0.6, '中段线性映射');
  // 更安静的音频（峰值 -45dB）：弱音节 -68dB → 线性值 0.08，保底抬到 0.3
  const quiet = levelFromDb(-68, -45, { silent: false });
  assert.equal(quiet, 0.3, '低音量弱音节保底 0.3');
});

test('levelFromDb：静音时归零，不使用保底', () => {
  const s = levelFromDb(-60, -20, { silent: true });
  assert.equal(s, 0, '静音 → 0（闭嘴）');
  const s2 = levelFromDb(-40, -20, { silent: true });
  assert.equal(s2, 0, '静音时即使能量不低也归零');
});

test('levelFromDb：大声音频不饱和异常', () => {
  // 峰值 -15dB，普通音节 -25dB → level 0.6
  const v = levelFromDb(-25, -15, { silent: false });
  assert.ok(v > 0.55 && v < 0.65, `应 ≈0.6，实际 ${v}`);
  const loud = levelFromDb(-10, -15, { silent: false });
  assert.equal(loud, 1, '超过峰值 → 1');
});

test('levelFromDb：安静停顿不被保底抬成微张（闭嘴档可用）', () => {
  // 能量底 -55，帧 -56（安静停顿）：仅低 1dB → 不保底 → level≈0（闭嘴）
  const quietPause = levelFromDb(-56, -30, { silent: false });
  assert.ok(quietPause < 0.1, `安静停顿应≈0（闭嘴），实际 ${quietPause}`);
  // 但确为说话声的弱音节（高于能量底 guardDb）→ 保底微张
  const weakSpeech = levelFromDb(-53, -30, { silent: false });
  assert.equal(weakSpeech, 0.3, '说话弱音节保底 0.3');
});

test('levelFromDb：输出限幅 0~1', () => {
  for (const db of [-120, -80, -50, -10, 0, 10]) {
    const v = levelFromDb(db, -20, { silent: false });
    assert.ok(v >= 0 && v <= 1, `db=${db} → ${v} 越界`);
  }
});
