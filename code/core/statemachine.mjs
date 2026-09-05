// 档位映射 + 防抖状态机（纯逻辑，Node 可测）
// 设计要点（参考 CrazyTalk/Live2D/VTubeStudio 的防抖思路）：
//   1. 确认（confirm）：目标档连续 N 帧稳定才切换，防单帧脉冲（爆破音 p/b/t）与小幅振荡
//   2. 保持（hold）：切换后新状态至少停留 holdMs，防嘴高频抖动
//   3. 静音强制闭嘴：低于静音门限持续 silenceMs 后回 E0×中性
//   4. 过渡片段优先：同表情档的嘴档变化优先播"过渡片段"，否则交叉淡化

export const SLOT_NAMES = ['E0', 'E1', 'E2', 'E3'];

/**
 * 档位映射：连续 level(0~1) → 嘴档 0..slots-1
 * @param {number} level 0~1
 * @param {number} slots 档数（默认 4）
 */
export function slotFromLevel(level, slots = 4) {
  const v = Math.min(1, Math.max(0, level));
  if (v >= 0.999) return slots - 1;
  return Math.min(slots - 1, Math.floor(v * slots));
}

/**
 * 创建防抖状态机。
 * @param {object} opts
 * @param {number} opts.slots 嘴档数（默认 4）
   * @param {number} opts.hysteresis 已废弃（保留参数兼容旧调用，防抖实际由确认帧+保持期完成）
 * @param {number} opts.confirmFrames 确认帧数（默认 3）
 * @param {number} opts.holdMs 状态最小停留（默认 100）
 * @param {number} opts.silenceDb 静音门限 dB（默认 -50）
 * @param {number} opts.silenceMs 静音持续时长（默认 150）
 * @param {number} opts.levelsPerFrame 每秒特征帧数（确认帧按此换算，默认 100）
 */
export function createStateMachine(opts = {}) {
  const slots = opts.slots ?? 4;
  const hysteresis = opts.hysteresis ?? 0.15;
  const confirmFrames = opts.confirmFrames ?? 3;
  const holdMs = opts.holdMs ?? 100;
  const silenceDb = opts.silenceDb ?? -50;
  const silenceMs = opts.silenceMs ?? 150;
  const levelsPerSec = opts.levelsPerFrame ?? 100;

  return {
    slots,
    state: { slot: 0, expr: 0, sinceMs: 0, silent: false },
    params: { hysteresis, confirmFrames, holdMs, silenceDb, silenceMs, levelsPerSec },
    /**
     * 输入一帧特征，推进状态机。
     * @param {{ db:number, level:number, expr:number, nowMs:number }} in  nowMs 单调递增毫秒
     * @returns {{ state:{slot,expr}, changed:boolean, from:{slot,expr}|null, mode:'clip'|'fade'|null, silent:boolean }}
     */
    step(input) {
      const p = this.params;
      const s = this.state;
      const now = input.nowMs;
      // 静音检测
      const silent = input.db < p.silenceDb;
      const silentFor = silent ? (s.silentSince === undefined ? 0 : now - s.silentSince) : 0;
      if (silent && s.silentSince === undefined) s.silentSince = now;
      if (!silent) s.silentSince = undefined;

      let targetSlot = s.slot;
      let targetExpr = s.expr;
      if (silent && silentFor >= p.silenceMs) {
        targetSlot = 0;
        targetExpr = 0;
      } else {
        targetSlot = slotFromLevel(input.level, slots);
        targetExpr = input.expr ?? 0;
      }

      // 确认计数
      if (targetSlot !== s.pendingSlot || targetExpr !== s.pendingExpr) {
        s.pendingSlot = targetSlot;
        s.pendingExpr = targetExpr;
        s.confirmCount = 0;
      } else {
        s.confirmCount = (s.confirmCount ?? 0) + 1;
      }

      const confirmed = s.confirmCount >= p.confirmFrames;
      const holdElapsed = now - s.sinceMs >= p.holdMs;
      const wantChange = (targetSlot !== s.slot || targetExpr !== s.expr);
      const shouldSwitch = confirmed && holdElapsed && wantChange;

      if (shouldSwitch) {
        const from = { slot: s.slot, expr: s.expr };
        const sameExpr = targetExpr === s.expr;
        s.slot = targetSlot;
        s.expr = targetExpr;
        s.sinceMs = now;
        s.confirmCount = 0;
        return {
          state: { slot: s.slot, expr: s.expr },
          changed: true,
          from,
          mode: sameExpr ? 'clip' : 'fade',
          silent: silent && silentFor >= p.silenceMs,
        };
      }
      return {
        state: { slot: s.slot, expr: s.expr },
        changed: false,
        from: null,
        mode: null,
        silent: silent && silentFor >= p.silenceMs,
      };
    },
  };
}

export default { SLOT_NAMES, slotFromLevel, createStateMachine };
