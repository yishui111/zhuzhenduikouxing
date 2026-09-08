// 建库工具（一键生成嘴型图库）：
// 上传说话视频 → 采集能量 → 按"嘴巴张开弧度"（能量分位近似）抽帧（闭嘴→微张→大张梯度）
// → cover 抽帧 + 背景帧 → 生成 manifest → 上传到 avatar/libs/<库名>/，主页面用能量范围控制
import { rms, rmsDb, frameDbSequence } from '../core/features.mjs';

const $ = (id) => document.getElementById(id);
const video = $('videoEl');
const logEl = $('log');
const log = (msg) => { logEl.textContent += msg + '\n'; logEl.scrollTop = logEl.scrollHeight; };

// —— 1. 视频载入（含自动转码）——
function waitMetadata(timeoutMs = 20000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), timeoutMs);
    const h = () => { clearTimeout(t); resolve(true); };
    video.addEventListener('loadedmetadata', h, { once: true });
  });
}

$('video').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  video.style.display = 'block';
  log(`已载入: ${f.name}（${(f.size / 1024 / 1024).toFixed(1)}MB）`);
  video.src = URL.createObjectURL(f);
  const ok = await waitMetadata();
  if (ok && video.videoWidth) {
    $('generate').disabled = false;
    return;
  }
  // 浏览器解不了（HEVC/H.265 等）→ 自动走服务器转码
  log('⚠️ 浏览器无法解码此视频（可能是 HEVC/H.265）。正在调用服务器自动转码…');
  $('generate').disabled = true;
  try {
    const r = await fetch('/api/transcode', { method: 'POST', body: f });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    log(`✅ 转码完成（${j.codec} → H.264）：${j.file}`);
    const blob2 = await (await fetch(j.url)).blob();
    video.src = URL.createObjectURL(blob2);
    const ok2 = await waitMetadata();
    if (ok2 && video.videoWidth) {
      log('已载入转码后的视频，可以一键生成。');
      $('generate').disabled = false;
    } else {
      log('❌ 转码后仍无法解码，请检查文件。');
    }
  } catch (err) {
    log('❌ 自动转码失败: ' + err.message);
    log('替代方案：安装 ffmpeg（加入 PATH 或设 FFMPEG_PATH）后重试自动转码；或自己先用 ffmpeg 转 H.264 再上传。');
    $('generate').disabled = false;
  }
});

function setProgress(pct) {
  const prog = $('prog');
  prog.style.display = 'block';
  $('progbar').style.width = pct + '%';
}

$('p_cnt').addEventListener('input', () => { $('p_cnt_val').textContent = $('p_cnt').value + ' 帧'; });
$('p_cnt_val').textContent = $('p_cnt').value + ' 帧';

// —— 2. 能量采集 ——
// 首选：decodeAudioData 离线解出整段音轨 PCM → 逐帧 RMS（瞬时完成、10ms 均匀采样，
// 不受播放帧率/静音状态影响）；音轨编码解不了时回落到 captureStream + 2x 播放采样。
async function collectEnergy() {
  let buf;
  try {
    buf = await (await fetch(video.src)).arrayBuffer();
  } catch {
    return collectEnergyPlayback();   // blob 源读不出来 → 旧路径兜底
  }
  const actx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const audioBuf = await actx.decodeAudioData(buf);
    if (audioBuf.duration < 0.1) throw new Error('视频没有音轨（请确认录像带声音）');
    return frameDbSequence(audioBuf.getChannelData(0), audioBuf.sampleRate);
  } catch (err) {
    if (err.name === 'EncodingError') {
      log('   （音轨编码无法离线解码，改用播放采样）');
      return collectEnergyPlayback();
    }
    throw err;
  } finally {
    try { actx.close(); } catch { /* noop */ }
  }
}

// 回落方案：captureStream + 2x 播放，逐 rAF 采样 RMS（采样密度受帧率限制，仅兜底用）
function collectEnergyPlayback() {
  return new Promise((resolve, reject) => {
    const stream = video.captureStream();
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) { reject(new Error('视频没有音轨（请确认录像带声音）')); return; }
    const actx = new (window.AudioContext || window.webkitAudioContext)();
    const src = actx.createMediaStreamSource(new MediaStream(audioTracks));
    const analyser = actx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0;
    src.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const db = [];
    const times = [];
    video.playbackRate = 2;
    video.muted = true;
    video.play().catch(reject);
    let lastT = -1;
    const tick = () => {
      if (video.ended || video.paused) { finish(); return; }
      analyser.getFloatTimeDomainData(buf);
      const t = video.currentTime;
      if (t !== lastT) { lastT = t; db.push(rmsDb(rms(buf))); times.push(t); }
      requestAnimationFrame(tick);
    };
    const finish = () => {
      try { src.disconnect(); actx.close(); } catch { /* noop */ }
      resolve({ db: Float32Array.from(db), times: Float32Array.from(times) });
    };
    requestAnimationFrame(tick);
  });
}

// —— 3. 按能量分位分档，每档按时间均匀选帧（闭嘴→大张的"嘴巴弧度"梯度）——
function pickFrameTimes(times, db, framesPerSlot, slots = 4) {
  const sorted = [...db].sort((a, b) => a - b);
  const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const bounds = [p(0.25), p(0.5), p(0.75)];
  const slotOf = (d) => (d < bounds[0] ? 0 : d < bounds[1] ? 1 : d < bounds[2] ? 2 : 3);
  const picks = [];
  for (let s = 0; s < slots; s++) {
    const idx = [];
    for (let i = 0; i < db.length; i++) if (slotOf(db[i]) === s) idx.push(i);
    if (!idx.length) continue;
    idx.sort((a, b) => times[a] - times[b]);   // 按时间均匀，避免帧挤在同一时刻
    for (let k = 0; k < framesPerSlot; k++) {
      const pos = Math.floor(((k + 0.5) / framesPerSlot) * idx.length);
      picks.push({ slot: s, t: times[idx[pos]] });
    }
  }
  return picks.sort((a, b) => a.slot - b.slot || a.t - b.t);
}

// —— 4. cover 抽帧（等比铺满、居中裁剪，无黑边不变形）——
// 输出 JPEG Blob。优先 toBlob（硬件编码直出）；个别内嵌浏览器 toBlob 会产出
// 0 字节 blob（实测），此时自动回落 toDataURL（base64 解码，兼容性最好）。
const grabCanvas = document.createElement('canvas');
grabCanvas.width = 512; grabCanvas.height = 512;   // 尺寸在生成时按视频宽高比重设
function canvasToJpegBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob && blob.size > 0) { resolve(blob); return; }
      try {
        const data = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
        if (!data) { reject(new Error('抽帧编码失败（画布为空）')); return; }
        const bin = atob(data);
        resolve(new Blob([Uint8Array.from(bin, (ch) => ch.charCodeAt(0))], { type: 'image/jpeg' }));
      } catch (err) { reject(err); }
    }, 'image/jpeg', 0.85);
  });
}
function grabFrameCanvas(time) {
  return new Promise((resolve, reject) => {
    const onSeek = () => {
      const ctx = grabCanvas.getContext('2d');
      const vw = video.videoWidth || 720;
      const vh = video.videoHeight || 1280;
      const cw = grabCanvas.width, ch = grabCanvas.height;
      const sc = Math.max(cw / vw, ch / vh);
      ctx.drawImage(video, (cw - vw * sc) / 2, (ch - vh * sc) / 2, vw * sc, vh * sc);
      const out = document.createElement('canvas');
      out.width = cw; out.height = ch;
      out.getContext('2d').drawImage(grabCanvas, 0, 0);
      video.removeEventListener('seeked', onSeek);
      resolve(out);
    };
    video.addEventListener('seeked', onSeek);
    video.currentTime = Math.max(0, Math.min(video.duration - 0.05, time));
  });
}
function grabFrame(time) {
  return grabFrameCanvas(time).then((cv) => canvasToJpegBlob(cv));
}

// —— 5. 一键生成 ——
async function postFile(name, rel, body) {
  if (!body || body.size === 0) throw new Error(`空文件被拦截: ${rel}（浏览器编码异常或代码缺陷）`);
  const r = await fetch(`/api/lib/${name}/${rel}`, { method: 'POST', body });
  if (!r.ok) throw new Error(`上传失败 ${rel}: ${r.status}`);
}

$('generate').addEventListener('click', async () => {
  const btn = $('generate');
  const name = $('libname').value.trim();
  if (!/^[A-Za-z0-9_\-]+$/.test(name)) { log('❌ 库名只能含字母/数字/下划线'); return; }
  btn.disabled = true;
  logEl.textContent = '';
  $('done').style.display = 'none';
  $('preview').innerHTML = '';
  try {
    // 编码检测：HEVC(H.265) 等浏览器解不了 → 提前提示，避免生成全黑帧
    if (!video.videoWidth || !video.videoHeight) {
      log('⚠️ 视频画面无法解码（videoWidth=0）。可能是 HEVC/H.265 编码，浏览器不支持。');
      log('解决办法：安装 ffmpeg（加入 PATH 或设 FFMPEG_PATH）后重试，页面会自动转 H.264；或先手动转码：');
      log('   ffmpeg -i in.mp4 -c:v libx264 -pix_fmt yuv420p out.mp4');
      btn.disabled = false;
      return;
    }
    // 抽帧画布按原视频宽高比设置（"视频啥样窗口就啥样"，不裁剪不变形），短边归一到 512
    const vw0 = video.videoWidth, vh0 = video.videoHeight;
    const aspect = vw0 / vh0;
    const fit = 512 / Math.min(vw0, vh0);
    grabCanvas.width = Math.round(vw0 * fit);
    grabCanvas.height = Math.round(vh0 * fit);
    log(`   画面比例 ${(vw0 / vh0).toFixed(3)}（${vw0}×${vh0}），抽帧 ${grabCanvas.width}×${grabCanvas.height}`);

    log('① 采集能量（离线解码音轨…）');
    setProgress(5);
    const { db, times } = await collectEnergy();
    log(`   完成：${db.length} 帧，时长 ${(times[times.length - 1] || 0).toFixed(1)}s`);

    const total = parseInt($('p_cnt').value, 10);
    const framesPerSlot = Math.max(1, Math.round(total / 4));
    log(`② 按嘴巴张开弧度抽帧（闭嘴→微张→中张→大张 各 ${framesPerSlot} 张，共 ${framesPerSlot * 4} 张）`);
    const picks = pickFrameTimes(times, db, framesPerSlot);
    log(`   ${picks.length} 个候选帧（按嘴巴张开弧度分档）`);

    // 先抓原始帧画面（canvas 副本）
    const rawFrames = [];
    for (let i = 0; i < picks.length; i++) {
      const cv = await grabFrameCanvas(picks[i].t);
      rawFrames.push({ slot: picks[i].slot, cv });
      setProgress(5 + ((i + 1) / picks.length) * 45);
      if ((i + 1) % 8 === 0 || i === picks.length - 1) log(`   抓帧 ${i + 1}/${picks.length}`);
    }

    // 底板 = 能量最低（闭嘴/静音）的一帧
    let minIdx = 0;
    for (let i = 1; i < db.length; i++) if (db[i] < db[minIdx]) minIdx = i;
    const baseIdx = picks.findIndex((p) => Math.abs(p.t - times[minIdx]) < 0.15);
    const baseCv = rawFrames[baseIdx >= 0 ? baseIdx : 0].cv;

    // 嘴部活动区域自动检测：所有帧与底板的差异包围盒（说话时嘴部变化最大）
    const dw = 96, dh = Math.max(1, Math.round(96 * baseCv.height / baseCv.width));
    const dCanvas = document.createElement('canvas'); dCanvas.width = dw; dCanvas.height = dh;
    const dCtx = dCanvas.getContext('2d');
    const pixelsOf = (cv) => { dCtx.clearRect(0, 0, dw, dh); dCtx.drawImage(cv, 0, 0, dw, dh); return dCtx.getImageData(0, 0, dw, dh).data; };
    const basePx = pixelsOf(baseCv);
    const rowHit = new Float32Array(dh), colHit = new Float32Array(dw);
    for (const f of rawFrames) {
      const px = pixelsOf(f.cv);
      for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
        const i = (y * dw + x) * 4;
        const d = Math.abs(px[i] - basePx[i]) + Math.abs(px[i + 1] - basePx[i + 1]) + Math.abs(px[i + 2] - basePx[i + 2]);
        if (d > 48) { rowHit[y]++; colHit[x]++; }
      }
    }
    // 嘴部活动区域 = 以帧间差异质心为中心、上限尺寸（高 32% × 宽 64%）的窗口。
    // 录制规范要求头不动 → 帧间变化集中在嘴部；窗口收紧后窗外画面绝对静止
    // （大窗口会把头部/脸部的微小活动全部带入，整幅画面看起来就在动）
    const centroid = (arr) => { let s = 0, w = 0; for (let i = 0; i < arr.length; i++) { s += i * arr[i]; w += arr[i]; } return w ? Math.round(s / w) : Math.floor(arr.length / 2); };
    const cyy = centroid(rowHit), cxx = centroid(colHit);
    const bh = Math.max(Math.round(dh * 0.06), Math.round(dh * 0.32));
    const bw = Math.max(Math.round(dw * 0.1), Math.round(dw * 0.64));
    const boxRows = [Math.max(0, Math.min(dh - bh, cyy - Math.round(bh / 2))), 0];
    boxRows[1] = boxRows[0] + bh - 1;
    const boxCols = [Math.max(0, Math.min(dw - bw, cxx - Math.round(bw / 2))), 0];
    boxCols[1] = boxCols[0] + bw - 1;
    let [ry0, ry1] = boxRows;
    let [cx0, cx1] = boxCols;
    const my = (ry1 - ry0) * 0.12, mx = (cx1 - cx0) * 0.12;
    ry0 = Math.max(0, ry0 - my); ry1 = Math.min(dh - 1, ry1 + my);
    cx0 = Math.max(0, cx0 - mx); cx1 = Math.min(dw - 1, cx1 + mx);
    const kx = baseCv.width / dw, ky = baseCv.height / dh;
    const box = { x: Math.floor(cx0 * kx), y: Math.floor(ry0 * ky), w: Math.ceil((cx1 - cx0 + 1) * kx), h: Math.ceil((ry1 - ry0 + 1) * ky) };
    log(`   嘴部活动区域：x=${box.x} y=${box.y} ${box.w}×${box.h}（其余画面将保持绝对静止）`);

    // 每帧 = 底板 + 嘴部活动区域替换为该帧画面 → 除嘴区外像素完全一致（画面绝对静止）
    // 嘴区贴片边缘做羽化（渐变过渡到底板）：帧间人脸的微小错位不会在贴片边界形成"小视频框"缝
    const feather = Math.max(12, Math.round(Math.min(box.w, box.h) * 0.09));
    const mask = document.createElement('canvas');
    mask.width = box.w; mask.height = box.h;
    const mctx = mask.getContext('2d');
    mctx.fillStyle = '#fff';
    mctx.fillRect(feather, feather, box.w - feather * 2, box.h - feather * 2);
    const patch = document.createElement('canvas');
    patch.width = box.w; patch.height = box.h;
    const pctx = patch.getContext('2d');
    log('④ 合成口型帧（底板 + 嘴部区域羽化贴片）…');
    const frames = [];
    for (let i = 0; i < rawFrames.length; i++) {
      pctx.clearRect(0, 0, box.w, box.h);
      pctx.drawImage(rawFrames[i].cv, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
      pctx.globalCompositeOperation = 'destination-in';
      pctx.filter = `blur(${Math.round(feather / 3)}px)`;
      pctx.drawImage(mask, 0, 0);
      pctx.filter = 'none';
      pctx.globalCompositeOperation = 'source-over';
      const out = document.createElement('canvas');
      out.width = baseCv.width; out.height = baseCv.height;
      const octx = out.getContext('2d');
      octx.drawImage(baseCv, 0, 0);
      octx.drawImage(patch, box.x, box.y);
      const blob = await canvasToJpegBlob(out);
      frames.push({ slot: rawFrames[i].slot, blob });
      setProgress(50 + ((i + 1) / rawFrames.length) * 20);
    }
    // 背景帧 = 底板闭嘴画面（切换间隙显示）
    const bg = await canvasToJpegBlob(baseCv);

    log(`⑥ 上传素材库 avatar/libs/${name}/ …`);
    setProgress(75);
    const manifestFrames = [];
    for (let i = 0; i < frames.length; i++) {
      const id = `E${frames[i].slot}_x0_${i}`;
      const rel = `frames/${id}.jpg`;
      await postFile(name, rel, frames[i].blob);
      manifestFrames.push({ id, file: rel, slot: frames[i].slot, expr: 0 });
      setProgress(65 + ((i + 1) / frames.length) * 30);
    }
    await postFile(name, 'frames/background.jpg', bg);
    const manifest = {
      meta: {
        name,
        person: '（真人录像生成）',
        created: new Date().toISOString().slice(0, 10),
        note: `由建库工具一键生成：${(times[times.length - 1] || 0).toFixed(1)}s 录像按嘴巴张开弧度（能量）抽帧 ${frames.length} 张。主页面用能量范围控制显示。`,
        frameMs: 33,
        aspect: Number(aspect.toFixed(4)),
      },
      background: 'frames/background.jpg',
      frames: manifestFrames,
      clips: [],
    };
    await postFile(name, 'manifest.json', new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }));
    setProgress(100);
    log(`✅ 生成完成：avatar/libs/${name}/（${manifestFrames.length} 帧 + 背景图）`);
    log('下一步：去主页面，素材库下拉选 ' + name + '，用"能量 → 图片"配置控制嘴型。');

    // 预览：按嘴档分组显示生成的图片
    $('done').style.display = 'block';
    $('doneInfo').textContent = `素材库 ${name}：${manifestFrames.length} 帧（闭嘴 ${framesPerSlot} / 微张 ${framesPerSlot} / 中张 ${framesPerSlot} / 大张 ${framesPerSlot}）+ 背景图`;
    const slotNames = ['闭嘴', '微张', '中张', '大张'];
    const preview = $('preview');
    for (let s = 0; s < 4; s++) {
      const row = document.createElement('div');
      row.className = 'slot-row';
      row.innerHTML = `<div class="slot-label">${slotNames[s]}（能量档 ${s}/4）</div><div class="preview-grid"></div>`;
      const grid = row.querySelector('.preview-grid');
      frames.filter((f) => f.slot === s).forEach((f) => {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(f.blob);
        img.title = `档${s}`;
        grid.appendChild(img);
      });
      preview.appendChild(row);
    }
  } catch (err) {
    log('❌ 生成失败: ' + err.message);
  }
  btn.disabled = false;
});
