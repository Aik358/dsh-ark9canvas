# dsh-ark9canvas — DeepSeek Harness 生图工作台与 Agent 生图工具

<p align="center">
  <b>中文</b> · <a href="README.md">English</a> · License BSD-3-Clause · <code>pnpm add @a9i5k4/dsh-ark9canvas</code>
</p>

> **v0.4.0 更新** —— 界面双语（中/英文，面板标题栏与设置页一键切换）+ 全套线性 SVG 图标替换 emoji，贴合 DeepSeek Harness 视觉语言。进化路线图：[docs/ROADMAP.md](docs/ROADMAP.md)。 —— 生图工作台全面对齐参考设计：比例网格（同款质量预算 + 16px 对齐公式）、透明背景、批量生成最多 10 张（独立子任务，部分成功也返回已完成部分）、提示词库（自定义 JSON 来源）、多渠道聚合、生成记录持久化与一键重试、配置导入导出。

DeepSeek Harness Web GUI 的**生图插件**：Agent 用一个工具按需作画，你用浮窗工作台随手出图——而 Agent 发起的每一次生图，**默认都要等你批准**，没有人点头就不会计费。

**解决的问题**：图片 API 按次计费，而 Agent 发起的生图通常是盲跑——一次坏提示词自我重试、一个循环就能烧穿余额。本插件把人放回回路：工具调用会阻塞，直到你在面板批准（或拒绝/超时，返回明确文案且零扣费）；而工作台本身永远一键可达，你自己的操作不受门控。

---

## 30 秒亮点

| | |
|---|---|
| **默认审批门控** | Agent 每次生图都进面板「审批」页等你裁决——批准 / 拒绝 / 超时；拒绝与超时绝不扣费 |
| **一个工作台，两个家** | 开箱即得悬浮 FAB + 玻璃面板；装了 `dsh-better-sidebar` 自动注册为侧栏页签；与 `dsh-cua` 同时安装时自动堆叠在它的 FAB 上方 |
| **完整尺寸系统** | 比例网格（12 档 + auto）按质量预算 + 16px 对齐公式计算；手动 W×H 带 16 倍数吸附；gpt-image 系自动吸附三个原生尺寸 |
| **批量最多 10 张** | 每张图为独立子任务聚合成一个批次——部分成功也返回已完成部分，带 ok/fail 计数 |
| **透明背景** | 一个开关发送 `background:"transparent"`（gpt-image 系支持） |
| **提示词库** | 本地收藏（☆）+ 自定义 JSON 来源经宿主代理拉取——无 CORS，不捆绑任何第三方内容 |
| **多渠道聚合** | 保存多个 OpenAI 兼容中转（各自 baseURL + key + 模型），一键切换当前渠道，逐渠道拉模型列表 |
| **生成记录持久化** | 每个批次记录参数与结果；失败批次一键重试；多选删除 |
| **双语界面** | 中/英文一键切换(面板标题栏+设置页)，按浏览器语言初始化 |
| **AI 友好设计** | 工具结果返回保存路径 + 尺寸——绝不内嵌 base64（除非明确要求）；参考图接受 dataURL **或**上次输出路径，多轮迭代 |

---

## 功能导览

### 审批门控——默认有人在回路

Agent 调用 `ark9_generate_image` 时，请求会出现在面板**审批**页，带提示词、参数与已等待时长。批准 → 开始生成并计费；拒绝 → 工具返回明确的"用户拒绝"文案，Agent 会询问你想改什么而不是闷头重试；超时（可配 5–600 秒）→ 取消、零扣费。想无人值守自动生成，在 **设置 → Ark9 生图 → 安全** 改为 `never`。

### 工作台——五个页签

- **生成**：提示词、参考图（上传或剪切板粘贴）、模型下拉（逐渠道拉取）、比例网格 / 手动 W×H、质量、透明开关、张数 1–10
- **审批**：待审 Agent 请求，一键批准/拒绝
- **提示词**：搜索、点击应用、☆ 收藏到本地；自定义 JSON 来源（`[{title, prompt, tags?}]`）经宿主代理拉取，绕开浏览器 CSP/CORS
- **记录**：每次生成带状态徽标（成功 / 部分成功 / 失败）、重试、多选删除、点击预览
- **说明**：速查

### 尺寸系统——忠实还原参考公式

比例按质量预算（低 1K² / 中 2K² / 高 4K²）计算像素边长并做 16 像素对齐，与参考工作台完全一致。由于 gpt-image 系只接受三个原生尺寸（1024×1024、1536×1024、1024×1536），gpt-image 模型会把计算结果自动吸附到最近的原生档位；其他模型发送原始计算值。手动 W×H + 16 倍数对齐开关随时可用。

### 迭代改图——传路径，不传大块数据

`ark9_generate_image` 返回保存路径与尺寸。把上次的输出路径传回 `images` 参数，插件读取文件并走 `/images/edits` multipart 调用——"把机器人改成红色"的多轮迭代，全程不往对话里塞 base64。确需内嵌时 `returnDataUrl: true` 显式开启。

### 渠道——聚合你的中转站

配置多个 OpenAI 兼容渠道（名称 + baseURL + key + 默认模型），标记一个当前渠道，从各自 `/models` 拉取模型列表。当前渠道同时服务 Agent 工具与工作台；旧版单渠道配置自动迁移。

---

## 工程内核（克制即设计）

- **零运行时依赖**，仅 Node 内置模块
- **批量聚合**：count N → N 个独立子任务（每个 n:1），合并为一个批次视图（ok/fail 计数）——一张慢图不拖累其他
- **状态持久化**：任务与日志落盘 `~/.dsh/ark9-canvas-*.json`，服务重启不会让轮询变孤儿
- **路由仅限回环**：所有 API 路由拒绝非本机调用；文件路由对文件名做消毒防路径穿越
- **不捆绑第三方提示词内容**：来源全部由用户提供

---

## 安装（一条命令）

> 前置：安装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 并至少启动过一次 `dsh web`。

在 **profile 目录**（`~/.dsh/profiles/web`）执行：

```bash
cd ~/.dsh/profiles/web
pnpm add @a9i5k4/dsh-ark9canvas
```

然后编辑该目录的 `package.json`，在 `dsh.profile.bundles` 数组中追加：

```json
"@a9i5k4/dsh-ark9canvas"
```

重启 **dsh web**——出现 🖼️ 悬浮按钮（装了 Better Sidebar 则是侧栏页签）。到 **设置 → Ark9 生图** 添加一个渠道（含 `/v1` 的 baseURL、API Key、模型如 `gpt-image-2`）。

> 没有 pnpm？`npm install @a9i5k4/dsh-ark9canvas` 等效。
> pnpm v11 会拦截发布不满一天的包：在 pnpm-workspace.yaml 设 `minimumReleaseAge: 0`，或当天更新时锁定明确版本。

### AI 时代安装法

把这段复制给你正在用的 AI 助手：

```text
在 DeepSeek Harness 的 web profile 目录 ~/.dsh/profiles/web 安装 npm 包
@a9i5k4/dsh-ark9canvas（pnpm add 或 npm install），
把 "@a9i5k4/dsh-ark9canvas" 追加到 package.json 的 dsh.profile.bundles 数组，
重启 dsh web 激活插件。然后打开 设置 → Ark9 生图，添加一个 OpenAI 兼容
图片渠道（含 /v1 的 baseURL、API Key、模型名）。
```

### 更新

```bash
cd ~/.dsh/profiles/web && pnpm up @a9i5k4/dsh-ark9canvas
```

---

## 配置

配置文件 `~/.dsh/ark9-canvas.json`（所有项都可在设置页调整）：

```json
{
  "baseURL": "https://your-relay.example/v1",
  "apiKey": "sk-...",
  "model": "gpt-image-2",
  "quality": "high",
  "size": "1536x1024",
  "count": 1,
  "agentApproval": "always",
  "approvalTimeoutSec": 120,
  "channels": [
    { "id": "c1", "name": "relay-a", "baseURL": "https://your-relay.example/v1", "apiKey": "sk-...", "model": "gpt-image-2" }
  ],
  "activeChannelId": "c1",
  "promptSources": [
    { "id": "ps1", "name": "my prompts", "url": "https://example.com/prompts.json" }
  ],
  "outputDir": ""
}
```

| 键 | 含义 |
|---|---|
| `agentApproval` | `always`（默认）——Agent 生图需面板批准；`never`——无人值守 |
| `approvalTimeoutSec` | 5–600 秒；超时取消且不计费 |
| `channels` / `activeChannelId` | 多渠道聚合；为空时回退顶层 `baseURL`/`apiKey`/`model` |
| `outputDir` | 出图保存目录；留空 = `~/Pictures/ark9-canvas` |

任务持久化在 `~/.dsh/ark9-canvas-tasks.json`，生成记录在 `~/.dsh/ark9-canvas-logs.json`。

---

## 结构

- `lib/index.js` — 宿主半区：2 个 Agent 工具、11 条路由、OpenAI 兼容图片代理（异步任务协议 + 批量聚合）、审批队列、持久化日志（零运行时依赖）
- `lib/client.js` — 浏览器半区：悬浮 FAB + 玻璃工作台（同一份 vanilla DOM 实现，浮窗与侧栏页签共用）、设置页
- `cordis.patch.yml` — 插件注册行
- `docs/ROADMAP.md` — 进化路线图：DSH 宿主协同（AI 扩写提示词/记忆驱动风格）、成本仪表盘、能力注册表、蒙版编辑
- `smoke-test.mjs` — 离线联调测试（工具 / 路由 / 审批路径，不调 API）
- `e2e-approval-test.mjs` — 真实出图端到端测试（会计费！）

## 已知限制

- 视频生成、蒙版 inpainting 画笔、Gemini 格式调用、无限画布节点编辑、WebDAV 同步不在范围内（后端无视频模型；同步以配置导入导出替代）。
- 提示词库不附带任何第三方内容——来源需自行添加。
- 面板手动生成不受审批门控：按下按钮**就是**批准，会计费。
- 插件集变更需重启 dsh。

---

## 署名

本项目为人机协作产物：

- **Aik358** — 项目所有者：产品方向与工程。
- **ZCode (GLM, Z.ai)** — 自主工程 Agent：插件实现、异步任务/媒体上传中转协议的逆向对接、测试套件。

---

## 发布

- GitHub: https://github.com/Aik358/dsh-ark9canvas
- npm: `@a9i5k4/dsh-ark9canvas`
- License: BSD-3-Clause · 独立实现，不含 WorldCodes Canvas 任何代码或品牌
