// 浏览器音频输入封装：文件 / 麦克风 → AnalyserNode 时域数据
// 结构：source → analyser → destination；同时 source → recGain → recDest（录制用）
export function createAudioInput() {
  let ctx = null;
  let analyser = null;
  let recDest = null;
  let recGain = null;
  let bufSrc = null;
  let stream = null;
  let timeBuf = null;              // 复用的时域缓冲（每帧就地覆写，避免每帧分配）
  let freqBuf = null;              // 复用的频域缓冲（dB 谱，元音共振峰用）
  const EMPTY = new Float32Array(0);

  async function ensure() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;   // 42.7ms@48k 连续时域窗口：能量(前21ms)+F0(全窗) 共用
    analyser.smoothingTimeConstant = 0;
    analyser.connect(ctx.destination);
    timeBuf = new Float32Array(analyser.fftSize);
    freqBuf = new Float32Array(analyser.frequencyBinCount);
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

  /** 读取当前时域样本（长度 = analyser.fftSize）；返回复用缓冲，调用方当帧用完即弃，勿跨帧持有 */
  function getTimeData() {
    if (!analyser) return EMPTY;
    analyser.getFloatTimeDomainData(timeBuf);
    return timeBuf;
  }

  /** 读取当前频谱（dB，长度 = frequencyBinCount）；复用缓冲，勿跨帧持有 */
  function getFreqData() {
    if (!analyser) return EMPTY;
    analyser.getFloatFrequencyData(freqBuf);
    return freqBuf;
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

  return { loadFile, startMic, getTimeData, getFreqData, getSampleRate, getRecordStream, stopAll };
}

export default { createAudioInput };
