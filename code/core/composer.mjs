// 合成调度（纯逻辑）：状态机事件 → 画布绘制指令
// 产出每帧要画的图层列表 [{img, alpha}]，img 是浏览器 Image 或测试占位对象
// 切换采用"渐隐渐现"：先淡出旧帧（outDur），再淡入新帧（inDur），两层不叠加 ——
// 真人帧叠加会产生"闪/重影"，渐隐渐现更干净

export function createComposer({ transitionMs = 90 } = {}) {
  let cur = null;       // { key, img }
  let fade = null;      // { fromImg, targetImg, t0Ms, outDur, inDur }
  let now = 0;

  /**
   * 推进到绝对时间 ms，返回绘制图层。
   * @returns {Array<{img, alpha}>}
   */
  function step(ms) {
    now = ms;
    const layers = [];
    let curVisible = true;
    if (fade) {
      // 缓动曲线：ease-in-out cubic，开头结尾慢、中间快，过渡更柔和
      const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      const tOut = (now - fade.t0Ms) / fade.outDur;
      if (tOut < 1) {
        // 阶段1：淡出旧帧（新帧不显示）
        layers.push({ img: fade.fromImg, alpha: Math.max(0, 1 - ease(Math.max(0, tOut))) });
        curVisible = false;
      } else {
        const tIn = (now - fade.t0Ms - fade.outDur) / fade.inDur;
        if (tIn < 1) {
          // 阶段2：淡入新帧（旧帧已消失）
          layers.push({ img: fade.targetImg, alpha: Math.max(0, ease(Math.max(0, tIn))) });
          curVisible = false;
        } else {
          fade = null;   // 切换完成
        }
      }
    }
    if (cur && curVisible) layers.push({ img: cur.img, alpha: 1 });
    return layers;
  }

  /**
   * 切换到目标状态（渐隐渐现：淡出旧帧 → 淡入新帧）。
   * @param {{key:string, img:object}} target
   */
  function enter(target) {
    if (!cur) {
      // 初始帧：直接显示，无过渡
      cur = { key: target.key, img: target.img };
      fade = null;
      return;
    }
    const fromImg = cur.img;
    cur = { key: target.key, img: target.img };
    fade = {
      fromImg,
      targetImg: cur.img,
      t0Ms: now,
      outDur: transitionMs / 2,
      inDur: transitionMs / 2,
    };
  }

  /** 候选帧轮换：同状态内更换底图（渐隐渐现） */
  function swap(img) {
    if (!cur) return;
    const fromImg = cur.img;
    cur.img = img;
    fade = {
      fromImg,
      targetImg: cur.img,
      t0Ms: now,
      outDur: Math.min(40, transitionMs / 2),
      inDur: Math.min(40, transitionMs / 2),
    };
  }

  function currentKey() { return cur ? cur.key : null; }

  return { step, enter, swap, currentKey, setTransitionMs: (v) => { transitionMs = v; } };
}

export default { createComposer };
