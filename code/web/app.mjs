// 方案 B 运行时主应用（M2+M3）：
// 素材库加载 → 音频(文件/麦克风) → 能量特征(嘴档) + F0(表情档) → 防抖状态机 → 合成调度 → Canvas 渲染
import { currentDb } from '../core/features.mjs';
import { createStateMachine } from '../core/statemachine.mjs';
import { indexLib, getCandidates, pickCandidate } from '../core/libloader.mjs';
import { createComposer } from '../core/composer.mjs';
import { autocorrPitch } from '../core/pitch.mjs';
import { exprFromFeatures } from '../core/exprmapper.mjs';
import { autoRange, levelFromDb } from '../core/levelmap.mjs';
import { createRenderer } from './renderer.mjs';
import { createAudioInput } from './audio.mjs';

// —— DOM ——
const $ = (id) => document.getElementById(id);
const stage = $('stage');
const renderer = createRenderer(stage);
const audio = createAudioInput();
// 能量条画布与宽度启动时缓存一次（主循环 60fps，避免每帧 DOM 查询）
const meterRawEl = $('meterRaw');
const meterMappedEl = $('meterMapped');
const meterRawCtx = meterRawEl.getContext('2d');
const meterMappedCtx = meterMappedEl.getContext('2d');
const METER_RAW_W = meterRawEl.width;
const METER_MAPPED_W = meterMappedEl.width;
const statusEl = $('status');
const setDs = (key, val) => { if (statusEl.dataset[key] !== val) statusEl.dataset[key] = val; };

// —— 参数（滑块 → 状态机/合成器）——
const stateMachine = createStateMachine({ levelsPerFrame: 60, silenceMs: 500 });
const composer = createComposer({ transitionMs: 100, clipFrameMs: 33 });
let silenceManual = null;      // null=静音门限自适应；数值=手动覆盖（UI 滑块 0=自动）
let prevSilent = false;        // 上一帧静音判定（供 level 保底逻辑使用）
const params = {
  sensitivity: 1.0,   // 灵敏度：level 乘数
  strength: 1.0,      // 强度：整体表情幅度
  f0Weight: 0.34,     // 声音频率(F0)权重：0=纯能量，1=纯频率（滑块可调）
  transitionMs: 100,
  silenceDb: -50,
  energyLo: 0.3,      // 能量下限：低于此显示闭嘴图（可配置）
  energyHi: 0.85,     // 能量上限：高于此封顶最大张（可配置）
  eloHoldMs: 250,     // 低于下限的保持时长（节流防闪回，可配置 0~2000ms）
  switchIntervalMs: 140, // 换帧间隔：嘴型图片多久换一次（快语速需 ≤150ms 才不滞后，可配置）
};

function bindSlider(id, key, fmt, convert = (v) => v) {
  const el = $(id);
  const out = $(id + '_val');
  const apply = () => {
    const v = parseFloat(el.value);
    params[key] = convert(v);
    if (key === 'transitionMs') composer.setTransitionMs(v);
    if (key === 'silenceDb') stateMachine.params.silenceDb = v;
    out.textContent = fmt(v);
  };
  el.addEventListener('input', apply);
  apply();
}

bindSlider('p_sens', 'sensitivity', (v) => v.toFixed(2));
bindSlider('p_strength', 'strength', (v) => v.toFixed(2));
bindSlider('p_sw', 'switchIntervalMs', (v) => Math.round(v) + 'ms');
bindSlider('p_trans', 'transitionMs', (v) => Math.round(v) + 'ms');
// 能量→图片 配置：滑块 0~100 整数 → 0~1
bindSlider('p_elo', 'energyLo', (v) => Math.round(v) + '%', (v) => v / 100);
bindSlider('p_ehi', 'energyHi', (v) => Math.round(v) + '%', (v) => v / 100);
bindSlider('p_eloHold', 'eloHoldMs', (v) => Math.round(v) + 'ms');
// F0 权重：滑块 0~100 整数 → params.f0Weight 0~1（单独处理，避免数值换算错误）
{
  const el = $('p_f0w');
  const out = $('p_f0w_val');
  const applyF0w = () => {
    params.f0Weight = parseFloat(el.value) / 100;
    out.textContent = Math.round(el.value) + '%';
  };
  el.addEventListener('input', applyF0w);
  applyF0w();
}
// 静音门限：0 = 自动（自适应峰值下 32dB），-70~-1 = 手动
{
  const el = $('p_sil');
  const out = $('p_sil_val');
  const applySil = () => {
    const v = parseFloat(el.value);
    silenceManual = v <= -1 ? v : null;
    if (silenceManual !== null) stateMachine.params.silenceDb = silenceManual;
    out.textContent = silenceManual === null ? '自动' : Math.round(v) + 'dB';
  };
  el.addEventListener('input', applySil);
  applySil();
}

// —— 素材库加载 ——
let lib = null;
let libName = 'lib_test';

/** 从服务器拉取素材库列表，填充下拉（只显示真实素材库，隐藏 lib_test* 测试库） */
async function populateLibSelect() {
  try {
    const r = await fetch('/api/libs');
    const { libs } = await r.json();
    const realLibs = libs.filter((n) => !n.startsWith('lib_test'));
    const sel = $('lib');
    sel.innerHTML = '';
    for (const name of realLibs) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    }
    if (realLibs.includes(libName)) sel.value = libName;
    else if (realLibs.length > 0) { libName = realLibs[0]; sel.value = realLibs[0]; }
    if (realLibs.length === 0) statusEl.textContent = '暂无素材库，请先用建库工具从真人录像导出';
  } catch (err) {
    statusEl.textContent = '素材库列表加载失败: ' + err.message;
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('图片加载失败: ' + src));
    im.src = src;
  });
}

async function fetchManifest(name) {
  const url = `/api/lib/${name}/manifest.json`;
  const fetchJson = async () => {
    const r = await fetch(url);
    if (r.status === 404) throw new Error(`素材库 "${name}" 不存在`);
    if (!r.ok) throw new Error(`manifest 加载失败: ${r.status}`);
    return r.json();
  };
  try {
    return await fetchJson();
  } catch (e) {
    if (String(e.message).includes('不存在')) throw e;
    // Windows 下偶发文件读取瞬抖（杀毒扫描/写入瞬间）导致半截响应，重试一次自愈
    await new Promise((r) => setTimeout(r, 300));
    return await fetchJson();
  }
}

async function loadLib(name) {
  if (!name) { statusEl.textContent = '未指定素材库'; return; }
  const manifest = await fetchManifest(name);
  const idx = indexLib(manifest);
  // 画布按素材库的原始视频宽高比（"视频啥样窗口就啥样"，不裁剪不变形）；旧库无 aspect 默认方形
  const aspect = Number(manifest.meta?.aspect) || 1;
  stage.width = aspect >= 1 ? 512 : Math.round(512 * aspect);
  stage.height = aspect >= 1 ? Math.round(512 / aspect) : 512;
  stage.style.aspectRatio = `${stage.width} / ${stage.height}`;
  // 预加载全部帧
  const jobs = [];
  for (const list of idx.frames.values()) {
    for (const f of list) {
      f.img = null;
      jobs.push(loadImage(`/api/lib/${name}/${f.file}`).then((im) => { f.img = im; }));
    }
  }
  await Promise.all(jobs);
  lib = { ...idx, name };
  // 背景图：切换中间显示（避免黑背景）
  if (manifest.background) {
    loadImage(`/api/lib/${name}/${manifest.background}`).then(
      (im) => renderer.setBackground(im),
      () => { /* 背景加载失败不阻塞 */ }
    );
  } else {
    renderer.setBackground(null);
  }
  // 构建"连续嘴型序列"：expr=0 的帧按嘴档排序（E0帧→E1帧→E2帧→E3帧），
  // 运行时用 level 连续映射到序列位置，嘴型直接跟随能量波动（像能量条一样灵敏）
  const expr0 = [];
  faceSeq.length = 0;
  exprFrames = { 1: new Map(), 2: new Map() };  // 表情档：slot → 帧（预建索引，运行时免遍历）
  exprFirst = { 1: null, 2: null };             // 各表情档无对应嘴档时的兜底帧
  for (const [key, list] of idx.frames.entries()) {
    const parts = key.split('_').map(Number);
    const slot = parts[0];
    const expr = parts[1] ?? 0;
    for (const f of list) {
      if (expr === 0) expr0.push({ ...f, slot });
      else if (exprFrames[expr]) {
        const frame = { ...f, slot };
        if (!exprFrames[expr].has(slot)) exprFrames[expr].set(slot, frame);
        if (!exprFirst[expr]) exprFirst[expr] = frame;
      }
    }
  }
  expr0.sort((a, b) => a.slot - b.slot);
  faceSeq = expr0;
  midStart = Math.floor(faceSeq.length * 0.15);  // 中间段起始帧（接近闭嘴→微张），随库缓存
  // 换库必须重置换帧状态：不同库的帧 id 命名同构（如都叫 E0_x0_0），
  // 残留的 curFaceKey 会让程序误以为"帧没变"而拒绝换图——表现为切库后画面毫无变化
  levelAvg = 0;
  lastSwitchLevel = -1;
  curMappedIdx = 0;
  belowLoSince = null;
  curFaceKey = null;
  lastSwitchMs = 0;
  statusEl.textContent = `素材库已加载: ${name}（${manifest.frames.length} 帧，嘴型序列 ${faceSeq.length} 帧）`;
}

// 连续嘴型状态（"能量条波动直接驱动嘴"模式）
let faceSeq = [];            // expr=0 帧按嘴档排序的连续序列
let exprFrames = { 1: new Map(), 2: new Map() }; // 表情档帧索引（slot → 帧，F0 驱动切换用）
let exprFirst = { 1: null, 2: null };           // 表情档兜底帧
let midStart = 0;            // faceSeq 中间段起始帧索引（loadLib 时算好）
let levelAvg = 0;            // level 平滑（连续映射防毛刺）
let lastSwitchLevel = -1;    // 上次切帧时的 levelAvg（最小变化阈值）
let curMappedIdx = 0;        // 当前映射到的帧索引（节流时保持用）
let belowLoSince = null;     // 能量低于下限的起始时间（节流计时）
let curFaceKey = null;       // 当前显示帧 id
let lastSwitchMs = 0;        // 上次切帧时间（切帧冷却）
let lastStatusSlot = -1;     // 状态栏上次显示的档位
let lastStatusSilent = false;

// —— 实时自适应归一化（滑动 95 分位，3s 窗口）——
// 修复"说话时闭嘴"：eMin 不再固定 -50dB，而是自适应（峰值 -25dB）；说话保底微张；静音门限自适应
const HIST_LEN = 180;          // 3s @ 60fps
const histDb = new Float32Array(HIST_LEN);
let histPos = 0;
let histCount = 0;
let eMax = -20;

function pushDb(db) {
  // 静音帧封顶 -65：避免静音间隙把自适应参考 eMax 拖到 -120，导致声音回来时饱和卡最高档
  histDb[histPos] = db > -65 ? db : -65;
  histPos = (histPos + 1) % HIST_LEN;
  histCount = Math.min(histCount + 1, HIST_LEN);
  if (histCount % 30 === 0) {   // 每 30 帧重算分位 + 自适应参数
    const arr = Array.from(histDb.subarray(0, histCount)).sort((a, b) => a - b);
    const idx = Math.min(histCount - 1, Math.floor(0.95 * histCount));
    eMax = Math.max(-35, arr[Math.max(0, idx)]);   // 下限保护
    if (silenceManual === null) {
      stateMachine.params.silenceDb = autoRange(eMax).silenceDb;
    }
  }
}

/** db → level（0~1）；说话时保底 0.3（至少 E1 微张），静音归零 */
function normalize(db, silent) {
  const lv = levelFromDb(db, eMax, { silent });
  return Math.min(1, Math.max(0, lv)) * params.sensitivity * params.strength;
}

// —— F0 / 兴奋度（M3：表情自动档）——
// 直接用 analyser 的连续时域快照（2048 样本 ≈ 42.7ms@48k，覆盖 70Hz 男低音约 3 个周期）做自相关；
// 能量用前 1024 样本（≈21ms），音高用全窗 —— 无需环形缓冲（rAF 与音频时钟不同步会让环形缓冲时间失真）
const ENERGY_LEN = 1024;
const f0Hist = new Float32Array(120);      // 最近 120 帧 F0（约 4s @30fps）
let f0HistPos = 0;
let f0HistCount = 0;
let f0Base = 0;                            // 滑动基线（本人均值）
const levelHist = new Float32Array(60);    // 最近 60 帧 level（约 1s）
let lvPos = 0;
let lvCount = 0;
let levelVar = 0;                          // 兴奋度
let frameCount = 0;
let lastF0 = 0;                            // 上次测得的 F0（跨帧保持，供表情映射）

function estimatePitch(samples, sampleRate) {
  const r = autocorrPitch(samples, sampleRate);
  return r.voiced ? r.f0 : 0;
}

function recomputeF0Base() {
  const vals = [];
  for (let i = 0; i < f0HistCount; i++) if (f0Hist[i] > 0) vals.push(f0Hist[i]);
  if (vals.length) {
    vals.sort((a, b) => a - b);
    f0Base = vals[Math.floor(vals.length / 2)];
  }
}

function recomputeLevelVar() {
  const n = Math.max(1, lvCount);
  let mean = 0;
  for (let i = 0; i < lvCount; i++) mean += levelHist[i];
  mean /= n;
  let v = 0;
  for (let i = 0; i < lvCount; i++) { const d = levelHist[i] - mean; v += d * d; }
  levelVar = v / n;
}

// —— 主循环 ——
function frame(nowMs) {
  requestAnimationFrame(frame);
  const samples = audio.getTimeData();
  // 无音频输入时按静音推进，保证初始帧（闭嘴）立即显示
  const db = samples.length > 0 ? currentDb(samples.subarray(0, ENERGY_LEN)) : -120;
  pushDb(db);
  const silent = prevSilent;
  const level = samples.length > 0 ? normalize(db, silent) : 0;
  frameCount++;

  // F0：每 2 帧算一次（省 CPU），基线/兴奋度每 30 帧刷新；跨帧保持上次测量值
  let f0 = lastF0;
  if (samples.length >= 1024) {
    if (frameCount % 2 === 0) {
      lastF0 = estimatePitch(samples, audio.getSampleRate());
      f0 = lastF0;
      f0Hist[f0HistPos] = f0;
      f0HistPos = (f0HistPos + 1) % f0Hist.length;
      f0HistCount = Math.min(f0HistCount + 1, f0Hist.length);
      if (frameCount % 30 === 0) recomputeF0Base();
    }
  }
  levelHist[lvPos] = level;
  lvPos = (lvPos + 1) % levelHist.length;
  lvCount = Math.min(lvCount + 1, levelHist.length);
  if (frameCount % 30 === 0) recomputeLevelVar();

  const autoExpr = exprFromFeatures({ f0, f0Base, levelVar });
  const expr = autoExpr;   // 表情由 F0 自动驱动（素材含表情帧时生效）
  const r = stateMachine.step({ db, level, expr, nowMs });
  prevSilent = r.silent;
  setDs('f0', f0.toFixed(0));             // 供自动化测试/调试读取（仅变化时写 DOM）
  setDs('f0base', f0Base.toFixed(0));
  setDs('expr', String(expr));
  setDs('level', level.toFixed(2));
  setDs('emax', eMax.toFixed(1));

  // —— 嘴型：连续跟随能量波动 + 声音频率(1/3)辅助 ——
  // mouthDrive = 能量(2/3) + F0 归一化(1/3)：F0 变化比能量平滑，掺入后切换更稳（用户建议）
  if (lib && faceSeq.length > 0) {
    levelAvg += (level - levelAvg) * 0.15;
    // F0 归一化（0~1）：相对本人基线，高音→1（嘴张），低音→0；无浊音时保持 0
    let f0Drive = 0;
    if (f0Base > 0 && f0 > 0) {
      f0Drive = Math.min(1, Math.max(0, (f0 - f0Base * 0.8) / (f0Base * 0.8)));
    }
    // 嘴型驱动：有音高时 = 能量(1-f0Weight) + 频率 f0Weight（滑块可调，默认 1/3）；
    // 无音高时（噪声/清音）全额用能量，避免 F0 权重把驱动信号缩小
    const mouthDrive = f0 > 0 && f0Base > 0
      ? levelAvg * (1 - params.f0Weight) + f0Drive * params.f0Weight
      : levelAvg;

    // —— 能量有效范围绑定（可配置，参数面板"能量→图片"）——
    // 太低( <energyLo )不绑定 → 闭嘴图（带节流，快速掉零不闪回）；太高( >energyHi )封顶 → 最大张图；
    // 中间段 [energyLo, energyHi] 按区间映射到中间帧，能量落在哪个范围就显示哪张图
    const LO = params.energyLo;
    const HI = params.energyHi;
    if (mouthDrive >= LO) belowLoSince = null;   // 能量达标：清掉低能量节流计时
    let mappedIdx = curMappedIdx;
    if (r.silent) {
      mappedIdx = 0;
    } else if (mouthDrive > HI) {
      mappedIdx = faceSeq.length - 1;                    // 封顶：最大张
    } else if (mouthDrive >= LO) {
      const t = (mouthDrive - LO) / Math.max(0.001, HI - LO);  // 0~1 区间
      mappedIdx = Math.min(faceSeq.length - 1, midStart + Math.round(t * (faceSeq.length - 1 - midStart)));
    } else {
      // 低于下限：区分"连续说话中的轻音节"与"真正静音"——
      // 说话中（平滑能量仍高）保持微开帧（快语速时嘴型小幅连续变化，不静止）；
      // 平滑能量也低（真停顿）才启动 eloHoldMs 闭嘴节流
      if (levelAvg > 0.25) {
        belowLoSince = nowMs;
        mappedIdx = Math.min(faceSeq.length - 1, midStart > 0 ? midStart : 1);
      } else {
        if (belowLoSince === null) belowLoSince = nowMs;
        mappedIdx = nowMs - belowLoSince >= params.eloHoldMs ? 0 : curMappedIdx;
      }
    }

    let target = null;
    if (expr === 0) {
      target = faceSeq[mappedIdx];
    } else {
      // 表情档（微笑/挑眉）：选该表情、嘴档接近当前驱动的帧（Map 预建索引，O(1)）
      const slot = Math.min(3, Math.round(mouthDrive * 3));
      target = exprFrames[expr].get(slot) ?? exprFirst[expr] ?? null;
    }
    // 切换节奏：换帧间隔滑块可调（默认 300ms，越大换得越慢）+ 最小变化 2%
    const switchCooldown = params.switchIntervalMs;
    const minLevelStep = 0.02;
    if (target && target.img && target.id !== curFaceKey
      && nowMs - lastSwitchMs >= switchCooldown
      && (Math.abs(mouthDrive - lastSwitchLevel) >= minLevelStep || curFaceKey === null)) {
      lastSwitchMs = nowMs;
      lastSwitchLevel = mouthDrive;
      curMappedIdx = mappedIdx;
      const isFirst = curFaceKey === null;
      curFaceKey = target.id;
      composer.enter({ key: target.id, img: target.img });
      // 状态栏只在档位/静音状态变化时更新（避免每帧闪烁文字）
      const slotOf = Math.min(3, Math.max(0, target.slot ?? 0));
      if (!isFirst && (slotOf !== lastStatusSlot || r.silent !== lastStatusSilent)) {
        lastStatusSlot = slotOf;
        lastStatusSilent = r.silent;
        statusEl.textContent = `${r.silent ? '静音 ' : ''}嘴型 E${slotOf}（驱动 ${mouthDrive.toFixed(2)}）`;
      }
    }
  } else if (lib && composer.currentKey() === null) {
    // 初始帧
    const cand = pickCandidate(lib, 0, expr);
    if (cand && cand.img) composer.enter({ key: cand.id, img: cand.img });
  }

  // 渲染：画面其余部分绝对静止，只有嘴部随换帧混合（任何整幅缩放/位移都会产生闪烁感）
  const layers = composer.step(nowMs);
  renderer.draw(layers);
  if (recorder && recVideoTrack && recVideoTrack.requestFrame) recVideoTrack.requestFrame();

  // —— 原始声音能量条（对比用：绿色填充随声音能量伸缩 + 4 档刻度）——
  {
    const w = METER_RAW_W;
    const ctx = meterRawCtx;
    ctx.clearRect(0, 0, w, 44);
    ctx.fillStyle = '#333';
    ctx.fillRect(10, 16, w - 20, 8);
    ctx.fillStyle = '#4caf50';
    ctx.fillRect(10, 16, (w - 20) * Math.min(1, level), 8);
    for (let s = 0; s < 4; s++) {
      const x = 10 + (w - 20) * (s / 3);
      ctx.fillStyle = '#888';
      ctx.fillRect(x, 12, 1, 16);
    }
    ctx.fillStyle = '#aaa';
    ctx.font = '10px sans-serif';
    ctx.fillText(`声音能量 ${Math.round(level * 100)}%  dB ${db.toFixed(0)}  F0 ${f0.toFixed(0)}Hz`, 10, 40);
  }
  // —— 嘴型映射能量条（下限/上限范围 + 当前指针：能量落在哪段嘴型就显示哪张）——
  {
    const w = METER_MAPPED_W;
    const ctx = meterMappedCtx;
    const bw = w - 20;
    const y0 = 16;
    const bh = 8;
    ctx.clearRect(0, 0, w, 44);
    ctx.fillStyle = '#333';
    ctx.fillRect(10, y0, bw, bh);
    const loX = 10 + bw * Math.min(1, Math.max(0, params.energyLo));
    const hiX = 10 + bw * Math.min(1, Math.max(0, params.energyHi));
    ctx.fillStyle = '#4caf50';
    ctx.fillRect(loX, y0, Math.max(0, hiX - loX), bh);
    ctx.fillStyle = '#e53935';
    ctx.fillRect(loX - 1, y0 - 3, 2, bh + 6);
    ctx.fillStyle = '#fb8c00';
    ctx.fillRect(hiX - 1, y0 - 3, 2, bh + 6);
    const px = 10 + bw * Math.min(1, Math.max(0, level));
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(px, y0 - 5);
    ctx.lineTo(px - 3, y0 - 1);
    ctx.lineTo(px + 3, y0 - 1);
    ctx.fill();
    for (let s = 0; s < 4; s++) {
      const x = 10 + bw * (s / 3);
      ctx.fillStyle = '#888';
      ctx.fillRect(x, y0 + bh + 1, 1, 6);
    }
    ctx.fillStyle = '#aaa';
    ctx.font = '10px sans-serif';
    ctx.fillText(
      `嘴型映射 [${Math.round(params.energyLo * 100)}%~${Math.round(params.energyHi * 100)}%] 当前 ${Math.round(level * 100)}%`,
      10,
      40
    );
  }
}

// —— 事件 ——
$('lib').addEventListener('change', async (e) => {
  libName = e.target.value;
  try { await loadLib(libName); } catch (err) { statusEl.textContent = '素材库加载失败: ' + err.message; }
});

$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const dur = await audio.loadFile(f);
    statusEl.textContent = `播放中: ${f.name}（${dur.toFixed(1)}s）`;
  } catch (err) {
    statusEl.textContent = '音频加载失败: ' + err.message;
  }
});

$('mic').addEventListener('click', async () => {
  try { await audio.startMic(); statusEl.textContent = '麦克风已开启'; }
  catch (err) { statusEl.textContent = '麦克风失败: ' + err.message; }
});

$('stop').addEventListener('click', () => { audio.stopAll(); statusEl.textContent = '已停止'; });

// —— 录制导出（单 MediaRecorder：canvas 视频轨 + 音频流合成）——
let recorder = null;
let recVideoTrack = null;      // canvas 视频轨：主循环每帧 requestFrame 推帧（后台标签/无合成器环境也能稳定出帧）
const chunks = [];
$('rec').addEventListener('click', async () => {
  if (recorder) return;
  const canvasStream = stage.captureStream();
  recVideoTrack = canvasStream.getVideoTracks()[0] ?? null;
  const audioStream = audio.getRecordStream();
  const tracks = [...canvasStream.getVideoTracks()];
  if (audioStream) tracks.push(...audioStream.getAudioTracks());
  const combined = new MediaStream(tracks);
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
  recorder = new MediaRecorder(combined, { mimeType: mime });
  chunks.length = 0;
  recorder.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `light-avatar_${Date.now()}.webm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    recorder = null;
    recVideoTrack = null;
    $('rec').disabled = false;
    $('recStop').disabled = true;
    statusEl.textContent = '已导出视频（webm）';
  };
  recorder.start(200);
  $('rec').disabled = true;
  $('recStop').disabled = false;
});
$('recStop').addEventListener('click', () => { if (recorder) recorder.stop(); });

// —— 启动 ——
const banner = (text, kind = '') => {
  const el = $('bootbanner');
  if (el) { el.textContent = text; el.className = kind; }
};
(async () => {
  try {
    // 防呆：必须通过服务器访问（双击打开 file:// 无法加载素材库，会黑屏）
    if (location.protocol !== 'http:' && location.protocol !== 'https:') {
      const msg = '⚠️ 请通过 http://127.0.0.1:48620 访问（先运行 start.bat），不要直接双击打开文件';
      statusEl.textContent = msg;
      banner(msg, 'bad');
      return;
    }
    banner('✓ 页面脚本运行正常，正在加载素材库…', 'ok');
    // 支持 ?lib=<库名> 直接指定素材库（可指定被下拉隐藏的测试库，调试/自动化用）
    const urlLib = new URLSearchParams(location.search).get('lib');
    if (urlLib) libName = urlLib;
    await populateLibSelect();
    if (urlLib && libName !== urlLib) libName = urlLib;   // populateLibSelect 会把隐藏库重置为默认库，这里恢复 URL 指定
    if (![...$('lib').options].some((o) => o.value === libName)) {
      const opt = document.createElement('option');
      opt.value = libName;
      opt.textContent = libName;
      $('lib').appendChild(opt);
    }
    $('lib').value = libName;
    await loadLib(libName);
    banner(`✓ 运行正常 · 素材库 ${libName}`, 'ok');
    requestAnimationFrame(frame);
  } catch (err) {
    const msg = '启动失败: ' + err.message;
    statusEl.textContent = msg;
    banner(msg, 'bad');
  }
})();
