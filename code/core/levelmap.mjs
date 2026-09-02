// 能量 → 嘴档 映射（纯逻辑）：对真实音频（任意音量/麦克风）鲁棒的自适应方案
// 修复点：原方案 eMin 固定 -50dB，安静音频/低音量麦克风会被判成"闭嘴"；
//         弱音节相对峰值差 >25dB 时 level 归零，出现"还在说话却闭嘴"。
// 新方案：
//   1) eMin 自适应 = eMax - dynamicDb（语音动态范围，默认 25dB）→ 任意音量都能张开
//   2) 说话保底 floorLevel：非静音时 level 至少 0.3（对应 E1 微张），避免弱音节闭死
//   3) 静音门限自适应 = eMax - dynamicDb - silenceMarginDb（约峰值下 32dB）

/**
 * 由滑动峰值（95 分位）推导自适应的能量底与静音门限。
 * @param {number} eMax 滑动 95 分位（dB）
 * @param {object} opts
 * @param {number} opts.dynamicDb 语音动态范围（默认 25）
 * @param {number} opts.silenceMarginDb 静音余量（默认 7，静音门限 = eMin - 7）
 * @returns {{ eMin:number, silenceDb:number }}
 */
export function autoRange(eMax, { dynamicDb = 25, silenceMarginDb = 7 } = {}) {
  const eMin = eMax - dynamicDb;
  const silenceDb = eMin - silenceMarginDb;
  return { eMin, silenceDb };
}

/**
 * dB → 0~1 能量档。
 * @param {number} db 当前帧 dB
 * @param {number} eMax 滑动 95 分位（dB）
 * @param {object} opts
 * @param {number} opts.dynamicDb 语音动态范围（默认 25）
 * @param {number} opts.floorLevel 说话保底（非静音且确为说话声时最小 level，默认 0.3 → E1 微张）
 * @param {boolean} opts.silent 是否已判定静音（静音时不用保底，保持 0）
 * @param {number} opts.guardDb 保底激活余量：db 必须高于能量底 guardDb dB 才保底
 *   （防止"安静停顿"被保底抬成微张，保证闭嘴档位可用）
 * @returns {number} 0~1
 */
export function levelFromDb(db, eMax, { dynamicDb = 25, floorLevel = 0.3, silent = false, guardDb = 1 } = {}) {
  const { eMin } = autoRange(eMax, { dynamicDb });
  let lv = (db - eMin) / dynamicDb;
  lv = Math.min(1, Math.max(0, lv));
  if (!silent && lv < floorLevel && db > eMin + guardDb) lv = floorLevel;
  if (silent) lv = 0;
  return lv;
}

export default { autoRange, levelFromDb };
