// 端到端管线测试：WAV → 特征 → 自适应归一化 → 状态机
// 验证整体行为（非精确档位）：静音闭嘴、强段达最高档、切换次数有界、确定性
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { frameDbSequence, adaptiveLevel } from '../core/features.mjs';
import { createStateMachine } from '../core/statemachine.mjs';
import { decodeWAV } from '../tools/wav.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { samples, sampleRate } = decodeWAV(readFileSync(join(ROOT, '..', 'input', 'test', 'test_mouth.wav')));

function runPipeline() {
  const { db, times } = frameDbSequence(samples, sampleRate, 20, 10);
  const { level } = adaptiveLevel(db, { windowFrames: 300, q: 0.95, eMinDb: -50 });
  const m = createStateMachine({ levelsPerFrame: 100 });
  const states = [];
  for (let i = 0; i < db.length; i++) {
    const r = m.step({ db: db[i], level: level[i], expr: 0, nowMs: i * 10 });
    states.push({ t: times[i], ...r.state, changed: r.changed, silent: r.silent });
  }
  return states;
}

test('管线：静音段闭嘴、强段达最高档、切换次数有界、确定性', () => {
  const states = runPipeline();
  const n = states.length;
  assert.ok(n > 500, `帧数足够（${n}）`);

  // 1) 结尾静音段（6.0~6.5s，之后是 2.5s 中等段）：检查 5.0~6.0s 静音段
  const silentSeg = states.filter(s => s.t >= 5.05 && s.t <= 5.9);
  assert.ok(silentSeg.length > 0);
  const silentSlots = new Set(silentSeg.map(s => s.slot));
  assert.ok(silentSlots.size === 1 && silentSlots.has(0), `静音段应闭嘴 E0，实际 ${[...silentSlots]}`);

  // 2) 大张段（3.5~5.0s）出现过最高档 E3
  const loudSeg = states.filter(s => s.t >= 3.5 && s.t <= 4.9);
  assert.ok(loudSeg.some(s => s.slot === 3), '大张段应到达 E3');

  // 3) 切换次数有界（8.5s、100fps 下不应出现抖动脉冲式切换）
  const changes = states.filter(s => s.changed).length;
  assert.ok(changes < 80, `切换次数应 <80，实际 ${changes}`);

  // 4) 确定性
  const a = runPipeline().map(s => `${s.slot}${s.silent ? 's' : ''}`).join('');
  const b = runPipeline().map(s => `${s.slot}${s.silent ? 's' : ''}`).join('');
  assert.equal(a, b);
});
