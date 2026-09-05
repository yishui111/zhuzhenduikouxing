// 快速傅里叶变换（纯计算，零依赖，Node/浏览器通用）
// 用途：离线/测试场景把时域信号变幅度谱（dB）。浏览器实时链路直接用
// AnalyserNode 的 getFloatFrequencyData，不走这里。

/** 汉宁窗（就地应用于副本，返回新数组） */
export function hannWindow(samples) {
  const n = samples.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = samples[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return out;
}

/**
 * 基-2 FFT（迭代法）。输入实信号，返回 0~nyquist 的幅度谱（dB，-120 封底）。
 * @param {Float32Array|number[]} samples 时域样本（长度建议为 2 的幂；不足 2 的幂会拒绝）
 * @param {number} sampleRate
 * @returns {{ magDb: Float32Array, binHz: number }} magDb 长度 = n/2
 */
export function spectrumDb(samples, sampleRate) {
  const n = samples.length;
  if ((n & (n - 1)) !== 0 || n < 8) throw new Error('spectrumDb 要求样本数为 2 的幂且 ≥8');
  const win = hannWindow(samples);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = win[i];
  // 位反转重排
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  // 蝶形
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
  const half = n >> 1;
  const magDb = new Float32Array(half);
  for (let i = 0; i < half; i++) {
    const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / (n / 4);
    magDb[i] = mag > 1e-6 ? 20 * Math.log10(mag) : -120;
  }
  return { magDb, binHz: sampleRate / n };
}

export default { hannWindow, spectrumDb };
