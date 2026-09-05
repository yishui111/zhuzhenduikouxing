<div align="center">

# 🎭 逐帧对口型 · 轻量表情数字人（light-avatar）

> ⭐ **喜欢这个项目？请先点个 Star 支持一下，让更多人看到！** ⭐

![GitHub stars](https://img.shields.io/github/stars/yishui111/zhuzhenduikouxing.svg?style=flat-square&color=orange)
![GitHub forks](https://img.shields.io/github/forks/yishui111/zhuzhenduikouxing.svg?style=flat-square)
![GitHub repo size](https://img.shields.io/github/repo-size/yishui111/zhuzhenduikouxing.svg?style=flat-square)

**上传一段真人说话视频 → 一键生成「嘴巴张开弧度」关键帧库；播放音频 / 开麦克风 → 用声音能量与基频实时驱动嘴型图片拼接 —— 低配电脑也能实时跑的数字人口型工具。**

</div>

---

## ✨ 项目简介

本项目实现「**逐帧对口型**」的轻量方案：**不做语音内容识别，只用声学特征（能量为主、基频 F0 与元音共振峰为辅）驱动表情**，替代 MuseTalk 一类需要 NVIDIA GPU + 十几个 GB 镜像的重方案。

核心玩法（三步）：

1. 📹 **录一段说话视频**（手机放稳、头别动、嘴型夸张一点，1~2 分钟）
2. ⚡ **建库工具一键生成**「嘴巴张开弧度」帧序列（闭嘴 → 微张 → 中张 → 大张，每档按能量分位自动抽帧）
3. 🎛️ **主页面用声音能量实时控制**：能量条 0~100% 落在哪个范围，就显示对应那张嘴型图（下限 / 上限 / 防闪回均可配置，可选掺入基频 F0 控制挑眉）

效果定位：**真人级观感 + 动画级口型**（节奏对、音素不对）。素材质量决定上限——录得越「嘴型分明」，效果越好。

- **全程无神经网络推理**：特征提取几毫秒 + Canvas 2D 图片拼接，CPU 集成显卡即可实时（≥60fps 目标）
- **网页版优先、零安装**：浏览器即用；Node.js 只用于本地静态服务器与自测
- **自研、自包含、可自测**：特征提取 → 档位映射 → 平滑状态机为独立 JS 模块，`npm test` 一键回归

> 📄 主方案设计（建库流程 / 驱动引擎 / 元音口型）见 [`docs/方案-真人关键帧表情合成.md`](docs/方案-真人关键帧表情合成.md)。

## 🎯 主要功能

- 🎥 **建库工具（`/web/preprocess.html`）**：上传说话视频 → 浏览器解不了的 HEVC/H.265 自动经服务器转码（需本机 ffmpeg）→ 按「嘴巴张开弧度」（能量分位）抽帧 → 生成 `manifest.json + 帧图片 + 背景帧` 到 `avatar/libs/<库名>/`
- 🔊 **主页面（`/web/index.html`）实时演示**：加载素材库 + 播放音频文件 / 开麦克风 → 实时显示能量档位与嘴型切换
- 🎚️ **「能量 → 图片」映射可配置**：能量下限（低于 → 闭嘴图）、能量上限（高于 → 固定最大张）、低于下限保持时长（防闪回）；可选 F0 权重掺入音调控制（0 = 纯能量）
- 👄 **元音口型驱动（A/E/I/O/U）**：实时共振峰分析（F1/F2）判定当前元音，元音定嘴形、能量定开合——说「啊」张大嘴、说「鱼」撅小圆嘴；清音/置信度不足自动回落纯能量驱动，不比原来差。素材库支持方法：在 `manifest.json` 的帧上加 `"vowel": "a"~"u"` 字段即可（合成示例库 `lib_test_vowel`，播放 `input/test/test_vowel.wav` 可验证；主页面支持 `?lib=<库名>` 直接指定）
- 🧩 **防抖状态机**：滞回 + 连续确认 + 状态保持，避免爆破音 / 噪音导致嘴型高频乱跳
- ✨ **画面过渡**：关键帧之间渐隐渐现 + 缓动，背景使用视频帧，不闪黑
- 🖥️ **录屏导出**：`canvas.captureStream()` + Web Audio 合成单路流录制，导出音画同步的 `.webm`（Chrome / Edge）
- 🧪 **自测完备**：`npm run make-test-assets` 生成合成测试库与测试音频（卡通脸，非真人），`npm test` 覆盖特征 / 映射 / 状态机 / 合成 / 记号 / 管线 / 素材库加载 / 服务器 API 等
- 📦 **零运行时依赖**：运行时纯浏览器 API + Node 原生模块；`playwright-core` 仅为开发期浏览器自动化工具的可选依赖

## 🗂️ 目录结构

```
zhuzhenduikouxing/
├── README.md               # 本文件
├── DEPLOY.md               # 新机器部署方案（照做即可复原）
├── AGENTS.md               # 项目级约定（给 AI 编程助手 / 协作者）
├── 录制指南.md               # 录一段好素材的简单要求（照着做就行）
├── start.bat / stop.bat    # Windows 一键启停（默认端口 48625）
├── docs/                   # 设计文档
│   └── 方案-真人关键帧表情合成.md  # 主方案设计（建库 + 驱动引擎 + 元音口型）
└── code/                   # 全部源代码（Node ≥20）
    ├── server.mjs          # 本地静态服务器 + 素材库读写 API + /api/transcode 转码
    ├── core/               # 纯逻辑模块（能量/F0/元音共振峰特征、档位映射、状态机等，Node 可测）
    ├── web/                # 主页面 index.html + 建库工具 preprocess.html
    ├── tools/              # 测试素材生成 / 浏览器冒烟 / 端到端等开发工具
    └── test/               # node --test 自测
```

> 💡 本仓库只包含**源代码 / 脚本 / 配置 / 文档**。
> `avatar/libs/`（你的真人关键帧素材库）与 `input/`（本地录像/测试音频）属于**素材与运行时产物，不随仓库分发**——克隆后由脚本或你自己的录制自动生成，见下方「大件资源下载」与 DEPLOY.md。

## 🚀 快速开始（拉到新电脑即可部署）

### 环境要求

- 操作系统：Windows 10/11（Linux / macOS 用法见 DEPLOY.md）
- 运行时：**Node.js ≥ 20**（本地服务器与自测用；网页本身在浏览器运行，不需要 Node）
- 浏览器：Chrome / Edge（推荐；Web Audio 与录屏导出支持好）
- 可选：ffmpeg（在 PATH 中，或设 `FFMPEG_PATH`；用于 HEVC 视频自动转码）

### 1. 克隆

```bash
git clone https://github.com/yishui111/zhuzhenduikouxing.git
cd zhuzhenduikouxing
```

### 2. （可选）生成体验用的合成测试素材

```bash
cd code
npm run make-test-assets    # 自动创建 avatar/libs/lib_test* 与 input/test/*.wav
```

### 3. 启动

```bash
# Windows：双击 start.bat（自动启动服务器并打开主页面）
start.bat
```

### 4. 验证

打开浏览器访问 http://127.0.0.1:48625/web/index.html，看到界面即部署成功。
主页面上「素材库」下拉选 `lib_test` → 选择音频文件 `input/test/test_mouth.wav` 播放 → 观察画面随声音能量切换嘴型档位。

| 页面 | 地址 | 用途 |
|------|------|------|
| **主页面** | http://127.0.0.1:48625/web/index.html | 加载素材库 + 播放音频/麦克风 → 实时关键帧拼接 |
| **建库工具** | http://127.0.0.1:48625/web/preprocess.html | 上传说话视频 → 一键生成嘴型图库 |

### 5. 生成你自己的真人素材库（三步）

1. **录视频**：按 [`录制指南.md`](录制指南.md) 录 1~2 分钟（手机放稳、头别动、嘴从小张到大 + 笑 + 瞪眼挑眉，带声音，mp4/webm 均可）
2. **建库工具**：把视频放进项目 `input/` 文件夹（或直接用浏览器选文件）→ 打开建库工具页 → 上传视频 → 调「生成帧数」（默认 40）→ 点「⚡ 一键生成」→ 生成到 `avatar/libs/<库名>/`
3. **主页面**：素材库下拉选刚生成的库 → 播放音频 / 开麦克风 → 用右侧「能量 → 图片」配置能量下限 / 上限 / 防闪回时长，找到舒服的设置

## 📥 大件资源下载（素材 / 模型 / 运行时）

| 资源 | 用途 | 下载地址 / 获取方式 |
| ---- | ---- | ---- |
| 真人关键帧素材库 `avatar/libs/<库名>/` | 演示与正式使用的「嘴型素材」（含本人画面，属于个人素材） | 不随仓库分发：按 [`录制指南.md`](录制指南.md) 自录后用建库工具一键生成 |
| 合成测试素材（`avatar/libs/lib_test*` + `input/test/*.wav`） | 跑自测 / 首次体验 | 无需下载：`cd code && npm run make-test-assets` 自动生成（卡通脸，非真人） |
| ffmpeg（系统工具，非仓库文件） | HEVC/H.265 视频自动转 H.264（`/api/transcode`） | Windows：`winget install Gyan.FFmpeg`；或官网 ffmpeg.org 下载并加入 PATH |

## 🛠️ 测试（自测与回归）

```bash
cd code
npm test                # 先自动生成测试素材（pretest），再跑全部单测（node --test）

# 浏览器级验证（可选：需 npm install + 本机 Edge/Chrome + 服务器已在 48620 运行）
npm run make-test-video # 生成合成"说话"测试视频（供建库工具端到端用）
npm run smoke           # 主页面全链路冒烟（素材库加载/切换/音频驱动/录屏导出）
npm run test-build-lib  # 建库工具端到端（上传 → 一键生成 → 校验素材库）
```

## ❓ 常见问题（FAQ）

- **Q：双击 `start.bat` 一闪而过？** A：未安装 Node.js 或不在 PATH。安装 https://nodejs.org 的 LTS（≥20）后重试。
- **Q：主页面提示「素材库加载失败 / 列表为空」？** A：还没有任何素材库。先 `cd code && npm run make-test-assets` 生成测试库，或用建库工具建真人库。
- **Q：上传的视频画面黑屏？** A：多为 HEVC/H.265 编码，浏览器不支持。安装 ffmpeg（加入 PATH 或设 `FFMPEG_PATH`）后建库工具会自动转码，或自行转 H.264：`ffmpeg -i in.mp4 -c:v libx264 -pix_fmt yuv420p out.mp4`。
- **Q：端口被占用？** A：启动前 `set PORT=9090`（再运行 `start.bat`），页面地址随之变为 9090。
- **Q：嘴型乱跳 / 太灵敏？** A：主页面右侧把「能量 → 图片」的下限调高、上限调低，并增大「低于下限保持时长」（防闪回）。
- **Q：换一个人？** A：换人 = 按录制指南重录一段视频，用建库工具生成新库即可（换皮能力暂缓）。

## ⚠️ 注意事项

- **素材质量决定效果上限**：录视频时手机放稳、头别动、嘴型变化明显最重要（见 [`录制指南.md`](录制指南.md)）。
- **隐私与敏感素材**：含本人画面的录像/音频/素材库属于个人素材，放在本地 `input/` 与 `avatar/libs/`（已被 `.gitignore` 忽略），**不要提交到公开仓库**。
- **效果边界**：本方案不识别语音内容，属于「节奏对、音素不对」的动画级口型；需要真人级高保真口型请评估 MuseTalk 一类重方案。
- 所有文档与注释使用简体中文。

## 📄 许可证

MIT License，详见仓库内 [`LICENSE`](LICENSE)。

## 🙏 支持与致谢

如果这个项目帮到了你，**请点亮右上角的 ⭐ Star**，你的支持是我持续更新的最大动力！
