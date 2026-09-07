// 素材库索引（纯逻辑）：manifest.json → 查询索引
// manifest 结构见 tools/make-test-assets.mjs 生成示例 / avatar/libs/*/manifest.json
// 关键帧 key = `${slot}_${expr}`；同一 key 可有多个候选帧（自然感轮换用）
// 注：manifest 旧版的 clips（过渡片段）与 vowel（元音帧）字段对应的功能已移除，读取时忽略。

/**
 * 建立素材库索引。
 * @param {object} manifest
 * @returns {{ meta, frames: Map, bg }}
 *   frames: Map<key, Array<{id,file,slot,expr,img}>>
 */
export function indexLib(manifest) {
  const frames = new Map();
  for (const f of manifest.frames ?? []) {
    const key = `${f.slot}_${f.expr}`;
    if (!frames.has(key)) frames.set(key, []);
    frames.get(key).push({ ...f, img: null });
  }
  return { meta: manifest.meta ?? {}, frames, bg: manifest.background ?? null };
}

/** 取某 (slot,expr) 的候选帧列表；无则 null */
export function getCandidates(lib, slot, expr) {
  return lib.frames.get(`${slot}_${expr}`) ?? null;
}

/** 取一个候选帧（可选随机数发生器，便于测试确定性） */
export function pickCandidate(lib, slot, expr, rng = Math.random) {
  const cands = getCandidates(lib, slot, expr);
  if (!cands || cands.length === 0) return null;
  return cands[Math.floor(rng() * cands.length)];
}

export default { indexLib, getCandidates, pickCandidate };
