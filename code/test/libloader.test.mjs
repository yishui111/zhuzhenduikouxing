// libloader.mjs 自测：索引 / 候选 / 确定性选取
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexLib, getCandidates, pickCandidate } from '../core/libloader.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(ROOT, '..', 'avatar', 'libs', 'lib_test', 'manifest.json'), 'utf8'));

test('indexLib：帧按 (slot,expr) 分组', () => {
  const lib = indexLib(manifest);
  assert.ok(lib.frames.has('0_0'), 'E0×中性 存在');
  assert.ok(lib.frames.has('3_0'), 'E3×中性 存在');
  assert.ok(getCandidates(lib, 2, 1), 'E2×微笑 存在');
});

test('pickCandidate：无随机数时行为确定；无素材返回 null', () => {
  const lib = indexLib(manifest);
  const a = pickCandidate(lib, 1, 0, () => 0.123);
  const b = pickCandidate(lib, 1, 0, () => 0.123);
  assert.equal(a.id, b.id, '同种子同结果');
  assert.equal(pickCandidate(lib, 3, 3), null, '未录制的组合返回 null');
});
