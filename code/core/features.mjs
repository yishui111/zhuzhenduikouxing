// 特征提取（纯计算，Node/浏览器通用，与 DOM 无关）
// 方案 B 与方案 A 共用：能量（RMS/dB）→ 嘴档；F0/语速（M3）→ 表情档/微动

/** 计算一帧样本的 RMS（均方根）能量 */
export function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** RMS 转 dB（相对满幅 1.0） */
export function rmsDb(rmsValue, ref = 1.0) {
  if (rmsValue <= 1e-9) return -120;
  return 20 * Math.log10(rmsValue / ref);
}

/**
 * 把整段样本切成帧，逐帧计算 RMS。
 * @param {Float32Array|number[]} samples
 * @param {number} sampleRate
 * @param {number} frameMs 帧长（默认 20ms）
 * @param {number} hopMs   帧移（默认 10ms）
 * @returns {{ db: Float32Array, times: Float32Array }} 每帧 dB 与帧起始时间（秒）
 */
export function frameDbSequence(samples, sampleRate, frameMs = 20, hopMs = 10) {
  const frameLen = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  const hop = Math.max(1, Math.round((sampleRate * hopMs) / 1000));
  const nFrames = Math.max(1, Math.floor((samples.length - frameLen) / hop) + 1);
  const db = new Float32Array(nFrames);
  const times = new Float32Array(nFrames);
  const win = new Float32Array(frameLen);
  for (let i = 0; i < nFrames; i++) {
    const start = i * hop;
    for (let j = 0; j < frameLen; j++) win[j] = samples[start + j] ?? 0;
    db[i] = rmsDb(rms(win));
    times[i] = start / sampleRate;
  }
  return { db, times };
}

/**
 * 滑动分位（滑动窗口 q 分位数），用于自适应归一化：3s 窗口 95 分位作 E_max。
 * 实现：每隔 refreshFrames 帧重排窗口内数据取分位，帧间用上次值（低成本近似，误差可忽略）。
 * @param {Float32Array} values 逐帧数值（dB）
 * @param {number} windowFrames 窗口帧数
 * @param {number} q 分位 0~1
 * @param {number} refreshFrames 刷新间隔（默认 windowFrames/2，至少 1）
 * @returns {Float32Array} 每帧对应的分位值
 */
export function slidingQuantile(values, windowFrames = 300, q = 0.95, refreshFrames = 0) {
  const n = values.length;
  const out = new Float32Array(n);
  if (n === 0) return out;
  const win = Math.max(1, Math.min(windowFrames, n));
  const refresh = Math.max(1, refreshFrames || Math.floor(win / 2));
  const arr = new Float32Array(win);
  let last = values[0];
  for (let i = 0; i < n; i++) {
    if (i % refresh === 0 || i === 0) {
      const half = Math.floor(win / 2);
      const s = Math.max(0, i - half);
      const e = Math.min(n, s + win);
      const len = e - s;
      for (let k = 0; k < len; k++) arr[k] = values[s + k];
      const sorted = Array.from(arr.subarray(0, len)).sort((a, b) => a - b);
      const idx = Math.min(len - 1, Math.floor(q * len));
      last = sorted[Math.max(0, idx)];
    }
    out[i] = last;
  }
  return out;
}

/**
 * 自适应归一化：把 dB 序列映射到 0~1。
 * eMax = 滑动 95 分位，eMin = 固定下限（默认 -50dB）。
 * @returns {{ level: Float32Array, eMax: Float32Array }}
 */
export function adaptiveLevel(db, { windowFrames = 300, q = 0.95, eMinDb = -50 } = {}) {
  const eMax = slidingQuantile(db, windowFrames, q);
  const level = new Float32Array(db.length);
  for (let i = 0; i < db.length; i++) {
    const span = eMax[i] - eMinDb;
    level[i] = span > 0 ? Math.min(1, Math.max(0, (db[i] - eMinDb) / span)) : 0;
  }
  return { level, eMax };
}

/** 单帧音频 → 当前 dB（浏览器实时用：传入 AnalyserNode 的时域缓冲区） */
export function currentDb(samples) {
  return rmsDb(rms(samples));
}

export default { rms, rmsDb, frameDbSequence, slidingQuantile, adaptiveLevel, currentDb };
