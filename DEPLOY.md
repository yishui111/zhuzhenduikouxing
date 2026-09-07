# 逐帧对口型 · 轻量表情数字人（zhuzhenduikouxing）· 部署方案

> 目标：在一台新电脑上把本项目「**复制即用**」。
> 本项目**运行时零 npm 依赖**（纯原生 JS + 浏览器 API + Node 原生模块），只需 Node.js 一个系统级依赖；ffmpeg 为可选的视频转码工具。

## 1. 环境要求

| 项 | 要求 | 说明 |
|----|------|------|
| 操作系统 | Windows 10/11（Linux / macOS 见第 9 节） | 路径避免含中文/空格更稳妥 |
| Node.js | **≥ 20** | 本地静态服务器与自测用；网页本身在浏览器运行，不需要 Node |
| 浏览器 | Chrome / Edge（推荐） | Web Audio + `canvas.captureStream()`/MediaRecorder 支持好 |
| ffmpeg（可选） | 见第 5 节 | 仅「浏览器解不了 HEVC/H.265 视频」时需要自动转码 |

> 网页应用本身**不需要 Node**：浏览器直接加载 JS 模块。Node 只用于本地静态服务器和测试。

## 2. 获取代码

```bash
git clone https://github.com/yishui111/zhuzhenduikouxing.git
cd zhuzhenduikouxing
```

> 不会用 git？到 GitHub 仓库页面点 `Code` → `Download ZIP` 解压即可，效果相同。

## 3. 安装依赖

```bash
cd code
npm install
```

- 运行时（服务器 + 网页）**零 npm 依赖**，`npm install` 仅安装 `playwright-core`（devDependency，浏览器自动化工具 smoke / e2e 等才用到，可跳过）。
- `package-lock.json` 已锁定版本，保证可复现。
- 若目标机未装 Node：到 https://nodejs.org 下载 LTS 版（≥20）安装。

## 4. 首次准备：生成测试素材（可选，推荐）

```bash
cd code
npm run make-test-assets
```

会自动创建并生成（全部为合成卡通素材，非真人）：

- `avatar/libs/lib_test/`、`avatar/libs/lib_test2/` —— 两套测试关键帧库（用于体验与验证多库切换）
- `input/test/test_mouth.wav`、`test_pitch.wav`、`test_vowel.wav` —— 测试音频

> 仓库根目录不附带 `avatar/`、`input/` 目录；脚本会按需创建。`.gitignore` 已忽略这两个目录（存放你的真人素材与运行时产物，不提交）。

## 5. 配置项（本机与目标机器可能不同的项）

| 配置 | 默认值 | 覆盖方式 | 说明 |
|------|--------|----------|------|
| 端口 | 48620 | 环境变量 `PORT`（`set PORT=9090` 后再 `start.bat`），或 `node server.mjs <端口>` | 服务器监听端口 |
| ffmpeg | 在 PATH 中查找 | 环境变量 `FFMPEG_PATH` / `FFPROBE_PATH` | `/api/transcode` 转码用；找不到时转码接口返回错误，可自行用外部 ffmpeg 转 H.264 |
| 浏览器（开发工具用） | 自动探测常见安装位置 | 环境变量 `EDGE_PATH` / `CHROME_PATH` | 仅 tools/ 下的浏览器自动化（smoke/e2e 等）使用 |

## 6. 启动 / 停止

```bat
start.bat      # Windows 一键启动：定位 Node → 在 code/ 启动服务器 → 自动打开主页面
stop.bat       # Windows 一键停止：结束监听 48620 端口的进程（可用 PORT 对齐）
```

Linux / macOS：

```bash
cd code
PORT=48620 node server.mjs &        # 启动
pkill -f "node server.mjs"          # 停止
```

启动后浏览器打开（**端口随配置变化**）：

| 页面 | 地址 | 用途 |
|------|------|------|
| 主页面（实时演示） | http://127.0.0.1:48620/web/index.html | 加载素材库 + 音频文件/麦克风 → 实时关键帧拼接 |
| 建库工具 | http://127.0.0.1:48620/web/preprocess.html | 导入真人录像 → 一键生成嘴型素材库 |

## 7. 生成自己的真人素材库（三步，核心流程）

1. **录视频**：手机放稳、人坐好头别动、说话时嘴型夸张点（闭嘴说两句 → 嘴张大说两句 → 笑着/挑眉各来一遍），10 秒 ~ 2 分钟，带声音（mp4/webm 均可）。要求详见项目根目录 [`录制指南.md`](录制指南.md)。
2. **建库工具**：把视频放进 `input/` 文件夹，打开建库工具页 → 选择视频（HEVC 编码会自动转码）→ 调「生成帧数」（默认 40）→ 点「⚡ 一键生成」→ 按嘴巴张开弧度（能量分位）自动抽帧生成素材库到 `avatar/libs/<库名>/`。
3. **主页面配置**：素材库下拉选新库 → 播放音频 / 开麦克风 → 右侧「能量 → 图片」配置能量下限 / 上限 / 防闪回时长。

> 视频若为 HEVC(H.265) 编码浏览器打不开（黑屏）：装好 ffmpeg 后建库工具会提示自动转码；或手动转：`ffmpeg -i in.mp4 -c:v libx264 -pix_fmt yuv420p out.mp4`。

## 8. 自测与回归

```bash
cd code
npm test                    # 推荐：pretest 自动先生成测试素材，再跑全部单测（node --test）
# 等价于手动两步：
#   npm run make-test-assets
#   node --test

# 浏览器级验证（可选：需第 3 步 npm install + 本机 Edge/Chrome + 服务器已在运行）
npm run make-test-video     # 生成合成"说话"测试视频 input/test/test_video.webm
npm run smoke               # 主页面全链路冒烟（素材库加载/多库切换/音频驱动/录屏导出 webm）
npm run test-build-lib      # 建库工具端到端（上传合成视频 → 一键生成 → 校验素材库 → 清理）
```

## 9. Linux / macOS

Node ≥20 安装后，除第 6 节启动/停止命令外，其余步骤一致（`npm run xxx` 通用）。
浏览器自动化工具在无 Edge/Chrome 或未安装 `playwright-core` 时会打印 `SKIP` 并以退出码 0 跳过，不影响使用。

## 10. 常见问题排查

| 现象 | 原因与处理 |
|------|-----------|
| `start.bat` 一闪而过 | Node 未安装或不在 PATH → 安装 Node ≥20 后重试 |
| 页面打不开 | 端口被占用 → 改 `PORT`；或防火墙拦截 → 放行 node.exe |
| 主页面提示素材库加载失败 | `avatar/libs/` 下没有库 → 先 `npm run make-test-assets`，或用建库工具建真人库 |
| 上传视频黑屏 / 无法解码 | HEVC(H.265) → 安装 ffmpeg 后自动转码，或手动转 H.264（见第 7 节） |
| 录屏导出无声 / 无画面 | 浏览器需允许麦克风/媒体权限；导出依赖 `captureStream`（Chrome/Edge 支持，Safari 受限） |
| 麦克风没声音 | 浏览器地址栏权限 → 允许麦克风；Windows 隐私设置 → 允许应用访问麦克风 |
| `npm test` 里转码用例被跳过 | 该用例需要一份本地 HEVC 示例视频（仓库不附带个人视频），无样例时自动跳过，属预期 |

## 11. 目录约定与「不随仓库分发」的内容

| 路径 | 内容 | 是否进仓库 |
|------|------|-----------|
| `code/` | 全部源代码、测试、package 锁定 | ✅ 分发 |
| `docs/`、`录制指南.md`、`AGENTS.md` | 文档 | ✅ 分发 |
| `avatar/libs/` | 你的真人关键帧素材库（含本人画面） | ❌ 本地生成，`.gitignore` 忽略 |
| `input/` | 本地录像、转码产物、生成的测试音频 | ❌ 本地生成，`.gitignore` 忽略 |
| `output/` | 开发工具导出产物 | ❌ 本地生成，`.gitignore` 忽略 |

## 12. 更新约定

每次修改代码后同步更新本文件与 README.md，并跑一遍第 8 节自测确认可交付。
