# dsh-ark9canvas

DSH(DeepSeek Harness)生图插件。让 Agent 和用户都能直接生成图片:

- **Agent 可调用**:`ark9_generate_image` 工具,文生图 / 图生图(参考图),返回图片 dataURL 与本地保存路径。
- **侧窗工作台**:侧边栏「Ark9 生图」入口 → 浮层面板,自己填提示词 / 传参考图 / 选质量尺寸张数 / 点生成。
- **设置页**:设置 →「Ark9 生图」,填 OpenAI 兼容图片 API(baseURL + Key + 模型)。

完全独立实现,无任何 WorldCodes 版权内容。图片后端走标准 OpenAI 兼容接口(`/images/generations` 文生图、`/images/edits` 图生图),可接任意中转站(如 vankit)或官方 API。

## 功能

| 能力 | 说明 |
|---|---|
| Agent 生图工具 | `ark9_generate_image(prompt, images?, size?, quality?, count?, model?)` |
| 文生图 | 纯提示词出图 |
| 图生图 | 传参考图 dataURL,按参考图修改 |
| 侧窗面板 | 生图工作台:提示词 / 参考图 / 尺寸 / 质量 / 张数 / 结果预览 / 下载 |
| 设置页 | baseURL / API Key / 模型 / 输出目录 |
| 模型列表拉取 | 自动拉取渠道可用模型 |

## 安装

```bash
# 在 DSH 的 web profile 里加载本插件(等同 auto-memory 的加载方式)
# 1. 把本仓库放到任意位置(如 D:/dsh-ark9canvas)
# 2. 在 DSH 插件配置里注册 bundle:
#    - 把 cordis.patch.yml 加入 profile bundle 层
#    - 或直接引用本包: npm/pnpm 安装后按 dsh 插件协议加载
```

## 配置

在 DSH 侧窗「Ark9 生图」或 设置 →「Ark9 生图」:

| 字段 | 说明 | 示例 |
|---|---|---|
| BaseURL | OpenAI 兼容图片 API 地址(**含 /v1**) | `https://sub.vankit.top/v1` |
| API Key | 渠道密钥 | `sk-...` |
| 模型 | 生图模型名 | `gpt-image-2` |
| 输出目录 | 生成图保存位置(留空= `~/Pictures/ark9-canvas`) | `D:/my-images` |

配置存于 `~/.dsh/ark9-canvas.json`。

## Agent 用法

对话中直接说「画一张蓝发少女」「给这篇文章配张图」,Agent 会调用 `ark9_generate_image`。也可在插件注入的 GUIDANCE 引导下主动使用。

## 开发

```bash
# 语法检查
node --check lib/index.js
node --check lib/client.js
# 联调测试(模拟 DSH host,验证工具/路由/配置;不真调 API)
node smoke-test.mjs
```

### 结构

```
lib/
  index.js    # node 端:工具 + /api/ark9-canvas-pre/* 路由 + OpenAI 兼容代理(异步任务协议)
  client.js   # 浏览器端:侧边栏按钮 + 生图面板(shell.overlay) + 设置页(settings.section)
cordis.patch.yml  # DSH profile bundle 补丁(注册插件行)
package.json      # dsh.client.inject 声明浏览器端加载
smoke-test.mjs    # 联调测试
```

## 协议

BSD-3-Clause。独立实现,不包含 WorldCodes Canvas 的任何代码或品牌。
