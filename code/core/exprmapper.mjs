// F0 → 表情档 映射（纯计算）：挑眉（F0 相对基线升高）/ 微笑（兴奋度：能量方差大）
// 状态机负责最终防抖（确认帧 + 保持期），这里只做原始档位估计

/**
 * 滑动 F0 基线（本人均值）：窗口内浊音帧的中位数。
 * @param {Float32Array} f0
 * @param {number} windowFrames 窗口帧数（默认 100，30ms 帧 ≈ 3s）
 * @param {number} refreshFrames 重算间隔（默认 15）
 * @returns {Float32Array}
 */
export function f0Baseline(f0, windowFrames = 100, refreshFrames = 15) {
  const n = f0.length;
  const out = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    if (i % refreshFrames === 0) {
      const s = Math.max(0, i - Math.floor(windowFrames / 2));
      const e = Math.min(n, s + windowFrames);
      const voiced = [];
      for (let k = s; k < e; k++) if (f0[k] > 0) voiced.push(f0[k]);
      if (voiced.length) {
        voiced.sort((a, b) => a - b);
        last = voiced[Math.floor(voiced.length / 2)];
      }
      // 无浊音帧则沿用上次基线
    }
    out[i] = last;
  }
  return out;
}

/**
 * 表情档估计。
 * @param {object} in
 * @param {number} in.f0 当前 F0（0=清音）
 * @param {number} in.f0Base 滑动基线（本人均值）
 * @param {number} in.levelVar 近期能量方差（兴奋度）
 * @param {number} in.ratioThr 挑眉阈值：f0/f0Base ≥ 此值 → 挑眉（默认 1.25）
 * @param {number} in.varThr   微笑阈值：levelVar ≥ 此值 → 微笑（默认 0.02）
 * @returns {0|1|2} 0 中性 / 1 微笑 / 2 挑眉
 */
export function exprFromFeatures({ f0, f0Base, levelVar = 0, ratioThr = 1.25, varThr = 0.02 }) {
  if (f0 <= 0 || f0Base <= 0) return 0;
  const ratio = f0 / f0Base;
  if (ratio >= ratioThr) return 2;   // 挑眉/上扬
  if (levelVar >= varThr) return 1;  // 兴奋 → 微笑
  return 0;
}

/**
 * 近期能量方差（兴奋度）：窗口内 level 的方差。
 * @param {Float32Array|number[]} levels 0~1 的归一化能量
 * @param {number} windowFrames
 * @returns {Float32Array}
 */
export function levelVariance(levels, windowFrames = 60) {
  const n = levels.length;
  const out = new Float32Array(n);
  const half = Math.floor(windowFrames / 2);
  for (let i = 0; i < n; i++) {
    const s = Math.max(0, i - half);
    const e = Math.min(n, i + half);
    let mean = 0;
    for (let k = s; k < e; k++) mean += levels[k];
    mean /= e - s;
    let v = 0;
    for (let k = s; k < e; k++) { const d = levels[k] - mean; v += d * d; }
    out[i] = v / (e - s);
  }
  return out;
}

export default { f0Baseline, exprFromFeatures, levelVariance };
