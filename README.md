# dsh-ark9canvas

DSH(DeepSeek Harness)生图插件。Agent 和用户都能直接生成图片,**Agent 发起的生图默认需要你批准**(防误计费)。生图工作台能力对齐 WorldCodes Canvas(独立实现,无其版权):

- **Agent 工具**:`ark9_generate_image`(文生图/图生图/透明背景/批量 1-10 张),默认阻塞等待你在面板点批准;`ark9_list_images` 列历史。
- **浮窗工作台**(默认):右下角 🖼️ FAB → 生成 / 审批 / 提示词 / 记录 / 说明 五页签。装了 dsh-cua 自动堆叠其 FAB 上方。
- **侧栏集成**(可选):装了 dsh-better-sidebar 时自动注册为侧栏页签。
- **比例与尺寸**:比例预设网格(1:1…16:9(4k))+手动 W×H(16 倍数对齐);gpt-image 系自动吸附标准三档,其他模型按质量预算(低1K/中2K/高4K)计算。
- **提示词库**:本地收藏 + 自定义 JSON 来源(经本机代理拉取,绕开浏览器 CORS)。
- **多渠道**:渠道聚合,一键切换当前渠道,逐渠道拉取模型。
- **生成记录**:持久化历史,失败重试、多选删除、点击预览。
- **设置页**:渠道 / 安全(审批) / 提示词来源 / 输出目录 / 配置导入导出。

## 功能

| 能力 | 说明 |
|---|---|
| Agent 生图工具 | `ark9_generate_image(prompt, images?, size?, quality?, count?, transparent?, model?, returnDataUrl?)` |
| Agent 审批门控 | 默认 `always`:工具调用阻塞等待用户批准;拒绝/超时返回明确文案(未扣费)。设置页可改 `never` |
| 图片迭代 | `images` 可传参考图 dataURL **或上一次生成的本地文件路径** |
| 批量 | count 1-10,每张独立子任务聚合(batch),部分成功也返回已出图 |
| 透明背景 | `transparent: true` → `background:"transparent"` |
| 尺寸系统 | 比例网格(质量预算+16px 对齐,同 canvas 公式)/手动 W×H;gpt-image 系吸附标准三档 |
| 历史列表工具 | `ark9_list_images(limit?)` |
| 浮窗工作台 | 生成 / 审批(等待时长+参数) / 提示词(搜索+收藏+自定义源) / 记录(重试+删除+预览) / 说明 |
| FAB 徽标 | 待审批数角标(5s 轮询);dsh-cua 共存堆叠 |
| better-sidebar | `ctx.get('betterSidebar')` 探测,`registerTab` 侧栏页签 |
| 多渠道 | channels 聚合 + activeChannelId;Agent/面板用当前渠道 |
| 配置导入导出 | JSON 导出下载 / 导入回填 |
| 设置页 | 渠道(逐渠道拉模型) / 安全 / 提示词来源 / 输出目录 |

**与 canvas 的差异(后端/宿主限制,非缺失)**:视频创作台(vankit 无视频模型)、蒙版 inpainting UI、Gemini 格式、无限画布节点编辑、WebDAV 同步(以导入/导出替代)。提示词库不捆绑任何 WorldCodes 内容,来源由用户自行添加。

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
