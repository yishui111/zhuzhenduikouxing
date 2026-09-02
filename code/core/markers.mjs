// 记号检测（纯逻辑）：从能量包络里找出录音脚本中"喊记号"的位置
// 用于 M1 建库：按记号把录像时间轴切成段，每段自动打初始标签
// 假设：记号是短促、响亮的声音（如喊"一/二/三…"），间隔 ≥ minGapMs

/**
 * 检测能量峰值（记号候选）。
 * 自适应设计：候选峰必须同时满足
 *   1) 绝对底线：db > thresholdDb（防止噪声被误判）
 *   2) 相对突出：db > 周围 meanWindowMs 窗口的均值 + relativeMarginDb（适应任意录音响度）
 * 避免固定门限在响度漂移（如视频音频重编码）时漏检/误检。
 * @param {Float32Array} db 逐帧 dB
 * @param {Float32Array} times 逐帧时间（秒）
 * @param {object} opts
 * @param {number} opts.thresholdDb 绝对底线（默认 -25dB）
 * @param {number} opts.minGapMs 两个记号最小间隔（默认 500ms）
 * @param {number} opts.refineWindowMs 峰值细化窗口（默认 ±80ms）
 * @param {number} opts.relativeMarginDb 相对均值高出量（默认 6dB）
 * @param {number} opts.meanWindowMs 局部均值窗口（默认 500ms）
 * @returns {Array<{index:number, time:number, db:number}>}
 */
export function detectMarkers(db, times, {
  thresholdDb = -25,
  minGapMs = 500,
  refineWindowMs = 80,
  relativeMarginDb = 6,
  meanWindowMs = 500,
} = {}) {
  const n = db.length;
  const dt = times.length > 1 ? Math.max(1e-6, times[1] - times[0]) : 0.01;
  const minGapFrames = Math.max(1, Math.round(minGapMs / 1000 / dt));
  const refineFrames = Math.max(1, Math.round(refineWindowMs / 1000 / dt));
  const meanWin = Math.max(2, Math.round(meanWindowMs / 1000 / dt / 2));

  // 预计算局部均值（滑动窗口，前缀和 O(1)）
  const localMean = new Float32Array(n);
  {
    const prefix = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + db[i];
    for (let i = 0; i < n; i++) {
      const s = Math.max(0, i - meanWin);
      const e = Math.min(n - 1, i + meanWin);
      localMean[i] = (prefix[e + 1] - prefix[s]) / (e - s + 1);
    }
  }

  const out = [];
  let i = 0;
  while (i < n) {
    const aboveFloor = db[i] > thresholdDb;
    const aboveRelative = db[i] > localMean[i] + relativeMarginDb;
    if (aboveFloor && aboveRelative) {
      // 向后找局部最大（覆盖整个峰值）
      let peak = i;
      let j = i;
      while (j < n && j <= i + refineFrames) {
        if (db[j] > db[peak]) peak = j;
        j++;
      }
      out.push({ index: peak, time: times[peak], db: db[peak] });
      i = peak + minGapFrames;
    } else {
      i++;
    }
  }
  return out;
}

/**
 * 把时间轴切成段：按记号位置划分（含头尾静音段）。
 * @param {Float32Array} times
 * @param {number[]} markerSeconds 记号时间（秒，升序）
 * @returns {Array<{start:number, end:number, startIndex:number, endIndex:number}>}
 */
export function sliceByMarkers(times, markerSeconds) {
  const segs = [];
  const boundary = [0, ...markerSeconds.map(t => t * 1000), times.length ? times[times.length - 1] * 1000 : 0];
  // 记号点本身算下一段的开始（记号是"喊出标签"的时刻）
  for (let k = 0; k + 1 < boundary.length; k++) {
    const startMs = boundary[k];
    const endMs = boundary[k + 1];
    if (endMs - startMs < 50) continue;
    // 记号时刻从段内剔除：段 [startMs, endMs) 中挖掉 [endMs-200ms, endMs)？简化：记号计入下一段起点，本段到下一记号前结束
    let si = 0, ei = times.length - 1;
    for (let i = 0; i < times.length; i++) {
      if (times[i] * 1000 >= startMs) { si = i; break; }
    }
    for (let i = times.length - 1; i >= 0; i--) {
      if (times[i] * 1000 <= endMs) { ei = i; break; }
    }
    segs.push({ start: startMs / 1000, end: endMs / 1000, startIndex: si, endIndex: ei });
  }
  return segs;
}

export default { detectMarkers, sliceByMarkers };
