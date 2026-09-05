// 元音口型特征（纯计算，Node/浏览器通用，零依赖）
// 原理：元音的嘴形由共振峰（formant）决定——声道共振在频谱上形成的两个主要峰 F1/F2。
//   中文五元音参考点（Hz，男女折中）：a 大开嘴 / e 中开 / i 扁长 / o 圆嘴 / u 撅小圆。
//   对 (F1,F2) 做对数频率最近邻分类即得元音；不需要语音识别，不涉及内容理解。
// 参考修改建议.md（源自 AIRI 口型线方案），落地为"元音 → 关键帧组"映射：
//   元音定嘴形、能量定开合；置信度不足/清音时回落纯能量驱动（保证不比原来差）。

/** 五元音共振峰参考点 [F1, F2]（Hz） */
export const VOWEL_REFS = {
  a: [850, 1250],
  e: [500, 1800],
  i: [300, 2300],
  o: [500, 850],
  u: [320, 800],
};

/**
 * 从幅度谱（dB）提取前两个共振峰。
 * 频带内取最大峰 + 三点抛物线插值细化频率；峰需高出频带中位数 prominence dB 才有效。
 * @param {Float32Array|number[]} spectrum dB 幅度谱（AnalyserNode.getFloatFrequencyData 或 fft.spectrumDb）
 * @param {number} sampleRate
 * @param {object} opts
 * @param {[number,number]} opts.f1Band F1 搜索频带（默认 [250,1000]Hz）
 * @param {[number,number]} opts.f2Band F2 搜索频带（默认 [900,2800]Hz，实际下限会避开 F1）
 * @param {number} opts.prominence 峰显著度门限（默认 8dB，抗噪声底/平谱）
 * @returns {{ f1:number, f2:number, f1Db:number, f2Db:number }|null} 无有效峰 → null（清音/静音/纯噪声）
 */
export function estimateFormants(spectrum, sampleRate, {
  f1Band = [250, 1000],
  f2Band = [700, 2800],
  prominence = 8,
} = {}) {
  const n = spectrum.length;
  if (n < 8) return null;
  const binHz = sampleRate / 2 / n;
  const median = (arr) => {
    const s = Float32Array.from(arr).sort();
    return s[Math.floor(s.length / 2)];
  };
  // 频带内最大峰（抛物线插值）；返回 [freqHz, peakDb, bandMedianDb] 或 null
  const peakIn = (lo, hi) => {
    const b0 = Math.max(1, Math.floor(lo / binHz));
    const b1 = Math.min(n - 2, Math.ceil(hi / binHz));
    if (b1 <= b0) return null;
    let best = b0;
    const band = [];
    for (let i = b0; i <= b1; i++) {
      band.push(spectrum[i]);
      if (spectrum[i] > spectrum[best]) best = i;
    }
    const med = median(band);
    const peak = spectrum[best];
    // 数字静音段浏览器会输出 -Infinity dB，差值成 NaN；非有限一律视为无峰
    const diff = peak - med;
    if (!Number.isFinite(diff) || diff < prominence) return null;
    // 抛物线顶点插值（用峰点两邻 bin）
    const a = spectrum[best - 1];
    const c = spectrum[best + 1];
    const denom = a - 2 * peak + c;
    const delta = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
    return { freq: (best + Math.max(-0.5, Math.min(0.5, delta))) * binHz, peakDb: peak - med };
  };
  const p1 = peakIn(f1Band[0], f1Band[1]);
  if (!p1) return null;
  const p2 = peakIn(Math.max(f2Band[0], p1.freq + 250), f2Band[1]);
  if (!p2) return null;
  return { f1: p1.freq, f2: p2.freq, f1Db: p1.peakDb, f2Db: p2.peakDb };
}

/**
 * 元音分类：对数频率空间最近邻。
 * @param {number} f1 共振峰 1（Hz）
 * @param {number} f2 共振峰 2（Hz）
 * @param {object} opts
 * @param {number} opts.radius 判定半径（对数距离，默认 0.4 ≈ 频率比 1.5 倍）
 * @returns {{ vowel:'a'|'e'|'i'|'o'|'u'|'', confidence:number }} vowel='' 表示无把握，置信度 0~1
 */
export function classifyVowel(f1, f2, { radius = 0.4 } = {}) {
  if (!(f1 > 0) || !(f2 > 0)) return { vowel: '', confidence: 0 };
  const lf1 = Math.log(f1);
  const lf2 = Math.log(f2);
  let best = '';
  let bestD = Infinity;
  for (const [v, [r1, r2]] of Object.entries(VOWEL_REFS)) {
    const d = Math.hypot(lf1 - Math.log(r1), lf2 - Math.log(r2));
    if (d < bestD) { bestD = d; best = v; }
  }
  if (bestD > radius) return { vowel: '', confidence: 0 };
  return { vowel: best, confidence: Math.max(0, Math.min(1, 1 - bestD / radius)) };
}

/**
 * 元音平滑跟踪器：确认帧（连续 N 帧一致才切，防清辅音/噪声瞬跳）+ 保持期（切换后锁 M ms）。
 * 与防抖状态机同一思想；vowel=''（清音/低置信）同样需要连续确认才清空当前元音。
 * @param {object} opts
 * @param {number} opts.confirmFrames 确认帧数（默认 2；调用方约 30Hz 喂帧 ≈ 66ms 确认）
 * @param {number} opts.holdMs 切换后保持（默认 200ms，避免元音高频抖动）
 */
export function createVowelTracker({ confirmFrames = 2, holdMs = 200 } = {}) {
  let active = '';
  let sinceMs = -Infinity;   // 首次激活不受保持期限制
  let pending = '';
  let count = 0;
  return {
    get vowel() { return active; },
    /**
     * 喂入一帧元音判定，返回当前生效元音（'' 表示无）。
     * @param {'a'|'e'|'i'|'o'|'u'|''} vowel
     * @param {number} nowMs 单调递增毫秒
     */
    step(vowel, nowMs) {
      if (vowel !== pending) { pending = vowel; count = 1; }   // 与上帧不同：本帧即第 1 帧
      else count++;
      if (count < confirmFrames) return active;
      if (vowel !== active && nowMs - sinceMs >= holdMs) {
        active = vowel;
        sinceMs = nowMs;
        count = 0;
      }
      return active;
    },
    reset() { active = ''; pending = ''; count = 0; sinceMs = 0; },
  };
}

export default { VOWEL_REFS, estimateFormants, classifyVowel, createVowelTracker };
