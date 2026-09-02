// 素材库索引（纯逻辑）：manifest.json → 查询索引
// manifest 结构见 tools/make-test-assets.mjs 生成示例 / avatar/libs/*/manifest.json
// 关键帧 key = `${slot}_${expr}`；同一 key 可有多个候选帧（自然感轮换用）

/**
 * 建立素材库索引。
 * @param {object} manifest
 * @returns {{ meta, frames: Map, clips: Map, bg }}
 *   frames: Map<key, Array<{id,file,slot,expr,img}>>
 *   clips:  Map<clipKey, Array<{from,to,expr,files,reversed}>>
 *   clipKey = `${from}_${to}_${expr}`
 */
export function indexLib(manifest) {
  const frames = new Map();
  for (const f of manifest.frames ?? []) {
    const key = `${f.slot}_${f.expr}`;
    if (!frames.has(key)) frames.set(key, []);
    frames.get(key).push({ ...f, img: null });
  }
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
  return { meta: manifest.meta ?? {}, frames, clips, bg: manifest.background ?? null };
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
