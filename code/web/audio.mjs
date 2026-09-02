// 浏览器音频输入封装：文件 / 麦克风 → AnalyserNode 时域数据
// 结构：source → analyser → destination；同时 source → recGain → recDest（录制用）
export function createAudioInput() {
  let ctx = null;
  let analyser = null;
  let recDest = null;
  let recGain = null;
  let bufSrc = null;
  let stream = null;

  async function ensure() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;   // 42.7ms@48k 连续时域窗口：能量(前21ms)+F0(全窗) 共用
    analyser.smoothingTimeConstant = 0;
    analyser.connect(ctx.destination);
    recDest = ctx.createMediaStreamDestination();
    recGain = ctx.createGain();
    recGain.gain.value = 1;
    recGain.connect(recDest);
  }

  /** 加载音频文件并开始播放；返回时长（秒） */
  async function loadFile(file) {
    await ensure();
    await ctx.resume();
    const buf = await file.arrayBuffer();
    const audioBuf = await ctx.decodeAudioData(buf);
    if (bufSrc) { try { bufSrc.stop(); } catch { /* noop */ } }
    bufSrc = ctx.createBufferSource();
    bufSrc.buffer = audioBuf;
    bufSrc.connect(analyser);
    bufSrc.connect(recGain);
    bufSrc.start();
    return audioBuf.duration;
  }

  /** 打开麦克风 */
  async function startMic() {
    await ensure();
    await ctx.resume();
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const src = ctx.createMediaStreamSource(stream);
    src.connect(analyser);
    src.connect(recGain);
  }

  /** 读取当前时域样本（长度 = analyser.fftSize） */
  function getTimeData() {
    if (!analyser) return new Float32Array(0);
    const a = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(a);
    return a;
  }

  /** 音频上下文采样率（F0 提取需要） */
  function getSampleRate() {
    return ctx ? ctx.sampleRate : 48000;
  }

  /** 录制混合目标（canvas.captureStream + 此流 → MediaRecorder） */
  function getRecordStream() {
    return recDest ? recDest.stream : null;
  }

  function stopAll() {
    if (bufSrc) { try { bufSrc.stop(); } catch { /* noop */ } bufSrc = null; }
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  }

  return { loadFile, startMic, getTimeData, getSampleRate, getRecordStream, stopAll };
}

export default { createAudioInput };
