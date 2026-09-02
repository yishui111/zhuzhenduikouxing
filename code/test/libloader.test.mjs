// libloader.mjs 自测：索引 / 候选 / 可逆片段 / 确定性选取
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexLib, getCandidates, getClips, pickCandidate } from '../core/libloader.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(ROOT, '..', 'avatar', 'libs', 'lib_test', 'manifest.json'), 'utf8'));

test('indexLib：帧按 (slot,expr) 分组，片段含可逆反向条目', () => {
  const lib = indexLib(manifest);
  assert.ok(lib.frames.has('0_0'), 'E0×中性 存在');
  assert.ok(lib.frames.has('3_0'), 'E3×中性 存在');
  assert.ok(getCandidates(lib, 2, 1), 'E2×微笑 存在');
  assert.ok(getClips(lib, 0, 3, 0), '正向片段 E0→E3 存在');
  assert.ok(getClips(lib, 3, 0, 0), '可逆片段自动生成反向 E3→E0');
});

test('pickCandidate：无随机数时行为确定；无素材返回 null', () => {
  const lib = indexLib(manifest);
  const a = pickCandidate(lib, 1, 0, () => 0.123);
  const b = pickCandidate(lib, 1, 0, () => 0.123);
  assert.equal(a.id, b.id, '同种子同结果');
  assert.equal(pickCandidate(lib, 3, 3), null, '未录制的组合返回 null');
});

test('getClips 返回的片段结构与 manifest 一致', () => {
  const lib = indexLib(manifest);
  const clips = getClips(lib, 0, 3, 0);
  assert.equal(clips.length, 1);
  assert.ok(clips[0].files.length >= 2, '片段至少 2 帧');
  assert.ok(!clips[0].reversed, '正向条目未标记 reversed');
  const rev = getClips(lib, 3, 0, 0);
  assert.equal(rev[0].reversed, true, '反向条目标记 reversed');
});
