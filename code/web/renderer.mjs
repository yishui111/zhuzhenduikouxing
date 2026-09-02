// 浏览器渲染器：Canvas 2D 图层合成（方案 B 运行时）
export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  let bg = null; // 背景图（可 null）

  /**
   * 绘制图层。
   * @param {Array<{img, alpha}>} layers
   * @param {object} motion 说话动感：{ scale, dy } —— 音量变化时画面轻微缩放/点头，
   *   即使关键帧嘴型差异小，"有声音画面在动"的观感也成立（参考 VTuber 常用做法）
   */
  function draw(layers, motion = {}) {
    const scale = motion.scale || 1;
    const dy = motion.dy || 0;
    ctx.clearRect(0, 0, w, h);
    if (bg) ctx.drawImage(bg, 0, 0, w, h);
    for (const l of layers) {
      if (!l.img) continue;
      ctx.globalAlpha = l.alpha;
      // 过渡层的缩放补偿：alpha<1 的层按 1+0.04*(1-alpha) 缩放
      // 旧帧淡出时 alpha↓ → 放大消失；新帧淡入时 alpha↑ → 从放大缩回
      // 切换因此有"推拉镜头"式的连续运动感，掩盖关键帧跳变，更接近视频观感
      const lscale = l.alpha < 1 ? 1 + 0.04 * (1 - l.alpha) : 1;
      const sw = w * scale * lscale;
      const sh = h * scale * lscale;
      const sx = (w - sw) / 2;
      const sy = (h - sh) / 2 + dy;
      ctx.drawImage(l.img, sx, sy, sw, sh);
    }
    ctx.globalAlpha = 1;
  }

  function setBackground(img) { bg = img; }

  return { draw, setBackground };
}

export default { createRenderer };
