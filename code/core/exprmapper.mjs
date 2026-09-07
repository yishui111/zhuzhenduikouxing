// F0 → 表情档 映射（纯计算）：挑眉（F0 相对基线升高）/ 微笑（兴奋度：能量方差大）
// 状态机负责最终防抖（确认帧 + 保持期），这里只做原始档位估计
// 注：F0 基线与能量方差的实时统计由 web/app.mjs 内部维护（增量环形缓冲），
//     整段离线版本的 f0Baseline/levelVariance 已随无用功能清理移除。

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

export default { exprFromFeatures };
