# dsh-ark9canvas

DSH(DeepSeek Harness)生图插件。Agent 和用户都能直接生成图片,**Agent 发起的生图默认需要你批准**(防误计费):

- **Agent 工具**:`ark9_generate_image`(文生图/图生图),默认阻塞等待你在面板点批准;`ark9_list_images` 列出历史图片。
- **浮窗工作台**(默认):右下角 🖼️ FAB → 浮层面板:生成 / 审批 / 记录 / 说明。装了 dsh-cua 会自动堆叠在它的 FAB 上方。
- **侧栏集成**(可选):装了 dsh-better-sidebar 时自动注册为侧栏「Ark9 生图」页签,不再显示 FAB。
- **设置页**:设置 →「Ark9 生图」:API 配置 + 安全(Agent 审批模式/超时) + 输出目录。

完全独立实现,无任何 WorldCodes 版权。后端走标准 OpenAI 兼容接口(`/images/generations` 文生图、`/images/edits` 图生图),可接任意中转站(如 vankit)或官方 API。

## 功能

| 能力 | 说明 |
|---|---|
| Agent 生图工具 | `ark9_generate_image(prompt, images?, size?, quality?, count?, model?, returnDataUrl?)` |
| Agent 审批门控 | 默认 `always`:工具调用阻塞等待用户批准;拒绝/超时返回明确文案(未扣费)。设置页可改 `never` |
| 图片迭代 | `images` 参数可传参考图 dataURL **或上一次生成的本地文件路径**,实现多轮"改这张图" |
| AI 友好输出 | 默认返回保存路径+尺寸+大小(不内嵌 base64,不撑爆上下文);需要内嵌时 `returnDataUrl: true` |
| 历史列表工具 | `ark9_list_images(limit?)` |
| 浮窗工作台 | 生成(提示词/参考图/尺寸/质量/张数)/ 审批(批准/拒绝,带等待时长与参数)/ 记录(点击预览)/ 说明 |
| FAB 徽标 | 有待审批请求时 FAB 显示红色数字角标(5s 轮询) |
| dsh-cua 共存 | 检测 `cua-fab-root` 存在时自动堆叠,不互相遮挡 |
| better-sidebar | `ctx.get('betterSidebar')` 探测,`registerTab` 注册侧栏页签(同 dsh-cua-pre 方式) |
| 设置页 | BaseURL / API Key / 模型(可拉取列表) / 审批模式 / 超时 / 输出目录 |

## 安装

```bash
pnpm add @a9i5k4/dsh-ark9canvas
```

在 DSH 的 web profile 里按 dsh 插件协议加载(bundle patch + client inject 声明已在 package.json)。

## 配置

侧窗面板或 设置 →「Ark9 生图」:

| 字段 | 说明 | 示例 |
|---|---|---|
| BaseURL | OpenAI 兼容图片 API 地址(**含 /v1**) | `https://sub.vankit.top/v1` |
| API Key | 渠道密钥 | `sk-...` |
| 模型 | 生图模型名 | `gpt-image-2` |
| Agent 审批 | always(默认,每次批准) / never(免审批) | `always` |
| 审批超时 | 5-600 秒,超时自动取消(未扣费) | `120` |
| 输出目录 | 留空 = `~/Pictures/ark9-canvas` | `D:/my-images` |

配置存于 `~/.dsh/ark9-canvas.json`;任务持久化 `~/.dsh/ark9-canvas-tasks.json`(重启不丢)。

## Agent 用法

对话中说「画一张蓝发少女」「给文章配图」「把刚才那张图改成红色」,Agent 会:

1. 调用 `ark9_generate_image` → 插件弹审批请求(FAB 角标提醒)
2. 你在面板「审批」页点批准(或拒绝/等超时)
3. 批准后生成,结果保存到输出目录,工具返回路径+尺寸
4. 后续迭代:Agent 把路径传回 `images` 参数即可(参考图走 `/images/edits`)

拒绝后 Agent 会询问你想怎么改,不会重复扣费尝试。

## 开发

```bash
node --check lib/index.js && node --check lib/client.js
node smoke-test.mjs          # 15 项:工具/路由/审批批准/拒绝/超时/路径防护(不真调 API)
node e2e-approval-test.mjs   # 真实出图端到端(需先配置真实 API,会计费!)
```

### 结构

```
lib/
  index.js    # node 端:2 工具 + 9 路由 + OpenAI 兼容代理(异步任务) + 审批队列
  client.js   # 浏览器端:FAB + 浮窗(vanilla DOM,与 sidebar tab 共用实现) + 设置页
cordis.patch.yml  # DSH profile bundle 补丁
e2e-approval-test.mjs  # 真实出图端到端(计费)
smoke-test.mjs         # 离线联调测试
```

## 协议

BSD-3-Clause。独立实现,不包含 WorldCodes Canvas 的任何代码或品牌。
