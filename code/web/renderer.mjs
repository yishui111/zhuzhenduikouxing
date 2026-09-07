// 浏览器渲染器：Canvas 2D 图层合成（方案 B 运行时）
// 画布尺寸由 app 按素材库的原始视频宽高比动态设置，这里每帧即时读取（支持库间切换）
export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let bg = null; // 背景图（可 null）

  /**
   * 绘制图层。
   * @param {Array<{img, alpha}>} layers
   * 关键帧之间构图完全一致（同一视频抽帧），切换时只有嘴部随 alpha 混合变化——
   * 画面其余部分必须绝对静止：任何整幅缩放/位移都会让逐帧播放看起来在闪（用户实测反馈）
   */
  function draw(layers) {
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (bg) ctx.drawImage(bg, 0, 0, w, h);
    for (const l of layers) {
      if (!l.img) continue;
      ctx.globalAlpha = l.alpha;
      ctx.drawImage(l.img, 0, 0, w, h);
    }
    ctx.globalAlpha = 1;
  }

  function setBackground(img) { bg = img; }

  return { draw, setBackground };
}

export default { createRenderer };
