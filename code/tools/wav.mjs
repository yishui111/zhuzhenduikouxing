// 极简 WAV 编码器（16-bit PCM 单声道，零依赖）
/** 把 Float32Array(-1~1) 样本编码为 WAV Buffer */
export function encodeWAV(samples, sampleRate = 48000) {
  const n = samples.length;
  const dataSize = n * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);          // fmt chunk size
  buf.writeUInt16LE(1, 20);           // PCM
  buf.writeUInt16LE(1, 22);           // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32);           // block align
  buf.writeUInt16LE(16, 34);          // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

/** 读取 WAV（16-bit PCM mono/stereo）→ Float32Array（混为单声道） */
export function decodeWAV(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('不是 WAV 文件');
  const fmt = buf.toString('ascii', 8, 12);
  if (fmt !== 'WAVE') throw new Error('不是 WAVE 格式');
  let off = 12;
  let sampleRate = 48000, channels = 1, bits = 16, dataOff = 0, dataLen = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      sampleRate = buf.readUInt32LE(off + 8 + 4);
      channels = buf.readUInt16LE(off + 8 + 2);
      bits = buf.readUInt16LE(off + 8 + 14);
    } else if (id === 'data') {
      dataOff = off + 8;
      dataLen = size;
      break;
    }
    off += 8 + size + (size % 2);
  }
  if (!dataOff) throw new Error('WAV 无 data 块');
  const bytesPerSample = bits / 8;
  const frames = Math.floor(dataLen / (bytesPerSample * channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let ch = 0; ch < channels; ch++) {
      const p = dataOff + (i * channels + ch) * bytesPerSample;
      let v;
      if (bits === 16) v = buf.readInt16LE(p) / 32768;
      else if (bits === 8) v = (buf.readUInt8(p) - 128) / 128;
      else if (bits === 32) v = buf.readFloatLE(p);
      else v = 0;
      sum += v;
    }
    out[i] = sum / channels;
  }
  return { samples: out, sampleRate };
}

export default { encodeWAV, decodeWAV };
