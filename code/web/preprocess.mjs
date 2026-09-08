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

// 随机库名：每次建库自动生成新名字，避免同名覆盖之前的素材库（去掉易混淆字符 i/l/o/0/1）
function randomLibName() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let tail = '';
  for (let i = 0; i < 6; i++) tail += chars[Math.floor(Math.random() * chars.length)];
  return 'lib_' + tail;
}
$('libname').value = randomLibName();
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

    // 整幅帧提取：按嘴巴张开弧度抓取完整画面（不裁剪、不贴片——帧与帧之间是原视频的完整画面）
    log('② 逐帧提取口型图片…');
    const frames = [];
    for (let i = 0; i < picks.length; i++) {
      const blob = await grabFrame(picks[i].t);
      frames.push({ slot: picks[i].slot, blob });
      setProgress(5 + ((i + 1) / picks.length) * 55);
      if ((i + 1) % 8 === 0 || i === picks.length - 1) log(`   帧 ${i + 1}/${picks.length}`);
    }

    // 背景帧 = 声音最低（闭嘴/静音）时刻的整幅画面
    log('③ 生成背景帧（闭嘴时刻的完整画面，切换间隙显示）');
    setProgress(65);
    let minIdx = 0;
    for (let i = 1; i < db.length; i++) if (db[i] < db[minIdx]) minIdx = i;
    const bg = await grabFrame(Math.max(0, Math.min(video.duration - 0.05, times[minIdx])));

    log(`④ 上传素材库 avatar/libs/${name}/ …`);
    setProgress(70);
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
    $('libname').value = randomLibName();   // 自动换新名字，方便紧接着建下一个库

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
