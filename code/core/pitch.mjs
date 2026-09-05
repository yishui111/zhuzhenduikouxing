// F0 基频提取（纯计算，Node/浏览器通用，零依赖）
// 轻量自相关 + 清/浊音门限（V/UV）+ 中值滤波（抑制八度跳变）
// 参考方案文档 4.2：F0 升高 → 挑眉/上扬；F0 抖动剧烈 → 激动

/**
 * 单帧自相关音高检测。
 * @param {Float32Array|number[]} samples 时域样本（建议 ≥ 2 个周期，如 30ms@48k=1440）
 * @param {number} sampleRate
 * @param {object} opts
 * @param {number} opts.f0Min 最低音高 Hz（默认 70，男低音）
 * @param {number} opts.f0Max 最高音高 Hz（默认 400）
 * @param {number} opts.confidenceTh 浊音判定门限（归一化自相关峰值，默认 0.3）
 * @returns {{ f0:number, confidence:number, voiced:boolean }} f0=0 表示清音/无声
 */
export function autocorrPitch(samples, sampleRate, { f0Min = 70, f0Max = 400, confidenceTh = 0.3 } = {}) {
  const n = samples.length;
  const lagMin = Math.max(2, Math.round(sampleRate / f0Max));
  const lagMax = Math.min(n - 1, Math.round(sampleRate / f0Min));
  if (lagMax <= lagMin) return { f0: 0, confidence: 0, voiced: false };
  let e0 = 0;
  for (let i = 0; i < n; i++) e0 += samples[i] * samples[i];
  if (e0 < 1e-9) return { f0: 0, confidence: 0, voiced: false };
  const corrAt = (lag) => {
    let c = 0;
    for (let i = 0; i < n - lag; i++) c += samples[i] * samples[i + lag];
    return c / e0;
  };
  // 两阶段搜索：先按步长粗扫定位峰区，再在峰区邻域逐点细化。
  // 峰宽（≥半个周期）远大于步长，不会漏峰；乘加量约降 COARSE 倍（实时主循环省 CPU）
  const COARSE = 4;
  let bestLag = lagMin;
  let bestCorr = -1;
  for (let lag = lagMin; lag <= lagMax; lag += COARSE) {
    const c = corrAt(lag);
    if (c > bestCorr) { bestCorr = c; bestLag = lag; }
  }
  const from = Math.max(lagMin, bestLag - COARSE + 1);
  const to = Math.min(lagMax, bestLag + COARSE - 1);
  for (let lag = from; lag <= to; lag++) {
    const c = corrAt(lag);
    if (c > bestCorr) { bestCorr = c; bestLag = lag; }
  }
  bestCorr = Math.max(0, bestCorr);
  const voiced = bestCorr >= confidenceTh;
  return { f0: voiced ? sampleRate / bestLag : 0, confidence: bestCorr, voiced };
}

/**
 * 对整段样本逐帧提取 F0。
 * @param {Float32Array|number[]} samples
 * @param {number} sampleRate
 * @param {number} frameMs 帧长（默认 30ms）
 * @param {number} hopMs   帧移（默认 30ms）
 * @returns {{ f0: Float32Array, voiced: Uint8Array, times: Float32Array, conf: Float32Array }}
 */
export function f0Sequence(samples, sampleRate, frameMs = 30, hopMs = 30) {
  const frameLen = Math.max(64, Math.round((sampleRate * frameMs) / 1000));
  const hop = Math.max(16, Math.round((sampleRate * hopMs) / 1000));
  const nFrames = Math.max(1, Math.floor((samples.length - frameLen) / hop) + 1);
  const f0 = new Float32Array(nFrames);
  const voiced = new Uint8Array(nFrames);
  const conf = new Float32Array(nFrames);
  const times = new Float32Array(nFrames);
  const win = new Float32Array(frameLen);
  for (let i = 0; i < nFrames; i++) {
    const start = i * hop;
    for (let j = 0; j < frameLen; j++) win[j] = samples[start + j] ?? 0;
    const r = autocorrPitch(win, sampleRate);
    f0[i] = r.f0;
    voiced[i] = r.voiced ? 1 : 0;
    conf[i] = r.confidence;
    times[i] = start / sampleRate;
  }
  return { f0, voiced, times, conf };
}

/**
 * 中值滤波（窗口 5，只统计浊音帧）：抑制单帧八度跳变/毛刺。
 * @param {Float32Array} f0
 * @param {number} window 窗口大小（奇数，默认 5）
 * @returns {Float32Array}
 */
export function medianFilterPitch(f0, window = 5) {
  const n = f0.length;
  const out = new Float32Array(n);
  const half = Math.floor(window / 2);
  for (let i = 0; i < n; i++) {
    const vals = [];
    for (let k = Math.max(0, i - half); k <= Math.min(n - 1, i + half); k++) {
      if (f0[k] > 0) vals.push(f0[k]);
    }
    if (vals.length) {
      vals.sort((a, b) => a - b);
      out[i] = vals[Math.floor(vals.length / 2)];
    }
  }
  return out;
}

export default { autocorrPitch, f0Sequence, medianFilterPitch };
