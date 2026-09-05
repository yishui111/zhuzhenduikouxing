// 素材库索引（纯逻辑）：manifest.json → 查询索引
// manifest 结构见 tools/make-test-assets.mjs 生成示例 / avatar/libs/*/manifest.json
// 关键帧 key = `${slot}_${expr}`；同一 key 可有多个候选帧（自然感轮换用）
// 元音帧：frames[].vowel = 'a'|'e'|'i'|'o'|'u'（可选字段）→ 独立索引 vowelFrames，
//   不进通用 frames（避免污染中性口型序列/候选轮换）。元音定嘴形、能量定开合。

/**
 * 建立素材库索引。
 * @param {object} manifest
 * @returns {{ meta, frames: Map, clips: Map, vowelFrames: Map, bg }}
 *   frames: Map<key, Array<{id,file,slot,expr,img}>>
 *   clips:  Map<clipKey, Array<{from,to,expr,files,reversed}>>
 *   vowelFrames: Map<'a'|'e'|'i'|'o'|'u', Array<{id,file,slot,vowel,img}>>（按 slot 升序）
 *   clipKey = `${from}_${to}_${expr}`
 */
export function indexLib(manifest) {
  const frames = new Map();
  const vowelFrames = new Map();
  for (const f of manifest.frames ?? []) {
    if (f.vowel) {
      const v = String(f.vowel).toLowerCase();
      if (!'aeiou'.includes(v) || v.length !== 1) continue;
      if (!vowelFrames.has(v)) vowelFrames.set(v, []);
      vowelFrames.get(v).push({ ...f, vowel: v, img: null });
      continue;
    }
    const key = `${f.slot}_${f.expr}`;
    if (!frames.has(key)) frames.set(key, []);
    frames.get(key).push({ ...f, img: null });
  }
  for (const list of vowelFrames.values()) list.sort((a, b) => a.slot - b.slot);
  const clips = new Map();
  for (const c of manifest.clips ?? []) {
    const key = `${c.from}_${c.to}_${c.expr}`;
    if (!clips.has(key)) clips.set(key, []);
    clips.get(key).push(c);
    // 可反向播放：自动补一条反向条目
    if (c.reversible) {
      const rkey = `${c.to}_${c.from}_${c.expr}`;
      if (!clips.has(rkey)) clips.set(rkey, []);
      clips.get(rkey).push({ ...c, reversed: true });
    }
  }
  return { meta: manifest.meta ?? {}, frames, clips, vowelFrames, bg: manifest.background ?? null };
}

/** 取某 (slot,expr) 的候选帧列表；无则 null */
export function getCandidates(lib, slot, expr) {
  return lib.frames.get(`${slot}_${expr}`) ?? null;
}

/** 取过渡片段列表；无则 null */
export function getClips(lib, fromSlot, toSlot, expr) {
  return lib.clips.get(`${fromSlot}_${toSlot}_${expr}`) ?? null;
}

/** 取一个候选帧（可选随机数发生器，便于测试确定性） */
export function pickCandidate(lib, slot, expr, rng = Math.random) {
  const cands = getCandidates(lib, slot, expr);
  if (!cands || cands.length === 0) return null;
  return cands[Math.floor(rng() * cands.length)];
}

export default { indexLib, getCandidates, getClips, pickCandidate };
