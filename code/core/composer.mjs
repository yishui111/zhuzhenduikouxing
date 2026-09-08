// 合成调度（纯逻辑）：状态机事件 → 画布绘制指令
// 切换采用"交叉淡化"：旧帧渐隐与新帧渐显同时进行（alpha 互补，任一时刻两层不透明度之和恒为 1）。
// 关键帧之间身体部分完全相同（不重影），只有嘴部平滑过渡——观感是"嘴在动"而不是闪黑。
// （旧版"先淡出再淡入"中途存在全暗瞬间，实测逐帧播放时画面一闪一闪，已废弃）
export function createComposer({ transitionMs = 90 } = {}) {
  let cur = null;       // { key, img }
  let fade = null;      // { fromImg, t0Ms }
  let now = 0;

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  /**
   * 推进到绝对时间 ms，返回绘制图层（先旧帧后新帧，新帧覆盖在上）。
   * @returns {Array<{img, alpha}>}
   */
  function step(ms) {
    now = ms;
    const layers = [];
    let fromAlpha = 0;
    if (fade) {
      const t = (now - fade.t0Ms) / transitionMs;
      if (t >= 1) fade = null;
      else fromAlpha = Math.max(0, 1 - easeInOutCubic(Math.max(0, t)));
    }
    if (fade && fromAlpha > 0) layers.push({ img: fade.fromImg, alpha: fromAlpha });
    if (cur && cur.img) layers.push({ img: cur.img, alpha: 1 - fromAlpha });
    return layers;
  }

  /**
   * 切换到目标状态（交叉淡化到新帧）。
   * @param {{key:string, img:object}} target
   */
  function enter(target) {
    if (!cur || cur.key === target.key) {
      // 初始帧或同帧：直接显示，无过渡
      cur = { key: target.key, img: target.img };
      fade = null;
      return;
    }
    const fromImg = cur.img;
    cur = { key: target.key, img: target.img };
    fade = { fromImg, t0Ms: now };
  }

  function currentKey() { return cur ? cur.key : null; }

  /** 清空当前帧与过渡（切换素材库时用：旧库帧不得残留在新库画布上） */
  function reset() { cur = null; fade = null; }

  return { step, enter, reset, currentKey, setTransitionMs: (v) => { transitionMs = v; } };
}

export default { createComposer };
