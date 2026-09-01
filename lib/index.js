/**
 * dsh-ark9canvas — host half.
 *
 * DSH 生图插件：Agent 可调用 + 侧窗工作台双入口的图片生成。
 *   - 工具:ark9_generate_image — Agent 文生图/图生图(参考图可传 dataURL 或本地文件路径)。
 *     默认需用户在面板「审批」批准后才执行(agentApproval=always;设置页可改 never 免审批)。
 *   - 工具:ark9_list_images — 列出输出目录最近生成的图片(路径/尺寸/时间),供 Agent 引用。
 *   - 路由:/api/ark9-canvas-pre/*(loopback-only):state/config/models/generate/task/
 *     task-result/approvals/images/image-file。
 *   - 图片后端:OpenAI 兼容 /v1/images/generations(文生图) 与 /v1/images/edits(图生图),
 *     支持任意自定义 baseURL(如 vankit 中转),key 存 ~/.dsh/ark9-canvas.json。
 *   - 异步任务协议:提交即返回 202+id,任务持久化到 ~/.dsh/ark9-canvas-tasks.json,
 *     服务器重启不丢任务。
 *
 * 零运行时依赖(仅 node 内置模块)。独立实现,无 WorldCodes 版权。
 */

import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import https from 'node:https'
import http from 'node:http'
import path from 'node:path'
import { homedir } from 'node:os'

/** Stable cordis plugin name. */
export const name = 'ark9-canvas-pre'

/** Services required before the image surfaces can mount. */
export const inject = ['webServer', 'tools', 'systemPrompt']

/** Model-facing announcement (tools + engine). */
export const GUIDANCE = '本机已安装 dsh-ark9canvas-pre 插件（生图工作台）：调用 ark9_generate_image 生成图片（文生图/图生图；images 参数可传参考图 dataURL 或之前生成的本地文件路径，实现多轮迭代修改）。生成结果保存到输出目录并返回文件路径+尺寸，默认不内嵌 base64（确需内嵌传 returnDataUrl=true，会占用大量上下文，慎用）。ark9_list_images 可列出最近生成的图片路径。审批纪律：默认每次 Agent 生图都需要用户在「Ark9 生图」面板点批准——工具会等待用户决定；若返回"用户拒绝"，不要重试同一提示词，应询问用户想怎么改；若返回"等待批准超时"，可提示用户去面板处理或在设置→Ark9生图→安全中调整审批模式。用户说「画一张/生成图片/配图/把这张图改成…」时即用本插件，不要自己编造图片链接。'

/** Route family. */
export const API = {
  state: '/api/ark9-canvas-pre/state',
  generate: '/api/ark9-canvas-pre/generate',
  task: '/api/ark9-canvas-pre/task',
  taskResult: '/api/ark9-canvas-pre/task-result',
  approvals: '/api/ark9-canvas-pre/approvals',
  images: '/api/ark9-canvas-pre/images',
  imageFile: '/api/ark9-canvas-pre/image-file',
  models: '/api/ark9-canvas-pre/models',
  config: '/api/ark9-canvas-pre/config',
}

// ---------- 配置 ----------
function configPath() {
  return path.join(homedir(), '.dsh', 'ark9-canvas.json')
}
const DEFAULT_CONFIG = {
  /** OpenAI 兼容图片 API 的 baseURL(含 /v1)。示例:https://sub.vankit.top/v1 */
  baseURL: '',
  /** API Key。 */
  apiKey: '',
  /** 默认生图模型。 */
  model: 'gpt-image-2',
  /** 生成结果保存目录(绝对路径;默认用户图片目录下 ark9-canvas)。 */
  outputDir: '',
  /** 默认质量:auto/low/medium/high。 */
  quality: 'high',
  /** 默认尺寸:1024x1024 / 1536x1024 / 1024x1536 / auto。 */
  size: '1536x1024',
  /** 默认张数 1-4。 */
  count: 1,
  /** Agent 生图审批模式:always=每次需用户批准(默认) / never=免审批。面板手动生成不受影响。 */
  agentApproval: 'always',
  /** Agent 审批等待超时秒数(5-600,默认 120;超时取消本次生图)。 */
  approvalTimeoutSec: 120,
}
const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG)
function loadConfig() {
  try {
    const j = JSON.parse(readFileSync(configPath(), 'utf-8'))
    const cfg = { ...DEFAULT_CONFIG }
    for (const k of CONFIG_KEYS) if (j[k] !== undefined) cfg[k] = j[k]
    if (cfg.agentApproval !== 'always' && cfg.agentApproval !== 'never') cfg.agentApproval = 'always'
    cfg.approvalTimeoutSec = Math.max(5, Math.min(600, Math.floor(Number(cfg.approvalTimeoutSec) || 120)))
    return cfg
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}
function saveConfig(cfg) {
  try {
    mkdirSync(path.dirname(configPath()), { recursive: true })
    writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf-8')
  } catch (e) {}
}
function outputDir(cfg) {
  if (cfg.outputDir && path.isAbsolute(cfg.outputDir)) return cfg.outputDir
  return path.join(homedir(), 'Pictures', 'ark9-canvas')
}

// ---------- 异步任务(内存 + 磁盘持久化) ----------
const TASKS_FILE = path.join(homedir(), '.dsh', 'ark9-canvas-tasks.json')
const tasks = new Map()
function loadTasks() {
  try {
    const arr = JSON.parse(readFileSync(TASKS_FILE, 'utf-8'))
    if (Array.isArray(arr)) for (const t of arr) tasks.set(t.id, t)
  } catch {}
}
function saveTasks() {
  try {
    mkdirSync(path.dirname(TASKS_FILE), { recursive: true })
    writeFileSync(TASKS_FILE, JSON.stringify([...tasks.values()]), 'utf-8')
  } catch {}
}
function genId() {
  return 'ark9_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10)
}

// ---------- 审批队列(Agent 生图门控;内存态,重启即清——重启后旧的等待方已死) ----------
const approvals = new Map() // id -> {id,prompt,params,status,createdAt,decidedAt}
function createApproval(prompt, params) {
  const id = 'ap_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
  const ap = { id, prompt: String(prompt).slice(0, 500), params: params || {}, status: 'pending', createdAt: Date.now(), decidedAt: null }
  approvals.set(id, ap)
  // 防积压:只保留最近 50 条
  if (approvals.size > 50) {
    const oldest = [...approvals.values()].sort((a, b) => a.createdAt - b.createdAt)[0]
    if (oldest) approvals.delete(oldest.id)
  }
  return ap
}
function pendingApprovals() {
  return [...approvals.values()].filter((a) => a.status === 'pending').sort((a, b) => a.createdAt - b.createdAt)
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

// ---------- 上游调用 ----------
function upstreamCall(opts, body, cb) {
  const mod = opts.port === 443 ? https : http
  const req = mod.request(opts, (upRes) => {
    const chunks = []
    upRes.on('data', (c) => chunks.push(c))
    upRes.on('end', () => cb(null, upRes.statusCode, Buffer.concat(chunks), upRes.headers))
  })
  req.on('error', (e) => cb(e))
  req.setTimeout(300000, () => req.destroy(new Error('upstream timeout')))
  req.end(body)
}
function upstreamUrl(cfg, suffix) {
  const base = String(cfg.baseURL || '').replace(/\/+$/, '')
  try { return new URL(base + suffix) } catch { return null }
}

// ---------- 参考图归一化:dataURL 或本地文件路径 → {contentType,buf,filename} ----------
function normalizeRef(input, idx) {
  const s = String(input || '')
  const m = s.match(/^data:(.*?);base64,(.*)$/s)
  if (m) return { contentType: m[1] || 'image/png', buf: Buffer.from(m[2], 'base64'), filename: `ref-${idx}.png` }
  const p = s.replace(/^file:\/\//, '')
  if (p && existsSync(p)) {
    try { return { contentType: 'image/png', buf: readFileSync(p), filename: path.basename(p) } } catch { return null }
  }
  return null
}

// ---------- 文生图任务 ----------
function submitTextToImage(cfg, bodyObj) {
  const id = genId()
  const task = { id, status: 'queued', result: null, error: null, createdAt: Date.now(), kind: 'generations' }
  tasks.set(id, task)
  saveTasks()
  const u = upstreamUrl(cfg, '/images/generations')
  if (!u) { task.status = 'failed'; task.error = { message: 'baseURL 无效: ' + cfg.baseURL }; saveTasks(); return id }
  const payload = {
    model: bodyObj.model || cfg.model,
    prompt: bodyObj.prompt,
    n: Math.max(1, Math.min(4, Math.floor(Number(bodyObj.n) || 1))),
    response_format: 'b64_json',
    ...(bodyObj.quality ? { quality: bodyObj.quality } : {}),
    ...(bodyObj.size ? { size: bodyObj.size } : {}),
  }
  const opts = {
    hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + cfg.apiKey,
      accept: 'application/json',
      'user-agent': 'dsh-ark9canvas',
    },
  }
  upstreamCall(opts, JSON.stringify(payload), (err, statusCode, data) => {
    finishTask(task, err, statusCode, data)
  })
  return id
}

// ---------- 图生图任务(参考图已在内存 Buffer) ----------
function submitImageEdit(cfg, bodyObj, refBufs) {
  const id = genId()
  const task = { id, status: 'queued', result: null, error: null, createdAt: Date.now(), kind: 'edits' }
  tasks.set(id, task)
  saveTasks()
  const u = upstreamUrl(cfg, '/images/edits')
  if (!u) { task.status = 'failed'; task.error = { message: 'baseURL 无效' }; saveTasks(); return id }
  if (!refBufs || !refBufs.length) { task.status = 'failed'; task.error = { message: '缺少参考图' }; saveTasks(); return id }
  const boundary = '----ark9' + Date.now().toString(36)
  const chunks = []
  for (const fn of ['model', 'prompt', 'n', 'quality', 'size', 'background']) {
    const v = bodyObj[fn]
    if (v === undefined || v === null) continue
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fn}"\r\n\r\n${v}\r\n`))
  }
  for (const [i, r] of refBufs.entries()) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${r.filename || 'ref-' + i + '.png'}"\r\nContent-Type: ${r.contentType || 'image/png'}\r\n\r\n`))
    chunks.push(r.buf)
    chunks.push(Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  const bodyData = Buffer.concat(chunks)
  const opts = {
    hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search,
    method: 'POST',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': bodyData.length,
      authorization: 'Bearer ' + cfg.apiKey,
      accept: 'application/json',
      'user-agent': 'dsh-ark9canvas',
    },
  }
  upstreamCall(opts, bodyData, (err, statusCode, data) => {
    finishTask(task, err, statusCode, data)
  })
  return id
}

function finishTask(task, err, statusCode, data) {
  if (err) { task.status = 'failed'; task.error = { message: '请求图片 API 失败: ' + err.message }; saveTasks(); return }
  if (statusCode !== 200) {
    task.status = 'failed'
    let msg = '图片 API 返回 ' + statusCode
    try { const j = JSON.parse(data.toString()); msg = j.error?.message || j.message || msg } catch {}
    task.error = { message: msg }
    saveTasks(); return
  }
  try { const j = JSON.parse(data.toString()); task.status = 'succeeded'; task.result = j; saveTasks() }
  catch (e) { task.status = 'failed'; task.error = { message: '解析响应失败: ' + e.message }; saveTasks() }
}

// ---------- 结果落盘 + 摘要 ----------
function pngSize(buf) {
  try {
    if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
    }
  } catch {}
  return null
}
async function saveTaskResults(task, dir) {
  await mkdir(dir, { recursive: true })
  const out = []
  const dataArr = (task.result && task.result.data) || []
  for (let i = 0; i < dataArr.length; i++) {
    const item = dataArr[i]
    const b64 = item.b64_json
    const buf = b64 ? Buffer.from(b64, 'base64') : null
    const fn = `ark9-${new Date().toISOString().slice(0, 10)}-${task.id.slice(-6)}-${i}.png`
    const fp = path.join(dir, fn)
    if (buf) { await writeFile(fp, buf) }
    const dim = buf ? pngSize(buf) : null
    out.push({
      index: i + 1,
      path: buf ? fp : '',
      url: item.url || '',
      dataUrl: b64 ? `data:image/png;base64,${b64}` : '',
      width: dim ? dim.w : 0,
      height: dim ? dim.h : 0,
      sizeKB: buf ? Math.round(buf.length / 1024) : 0,
    })
  }
  return out
}

// ---------- HTTP 辅助 ----------
function isLoopbackRequest(req) {
  const address = req.socket && req.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = req.headers.host
  if (typeof host !== 'string') return false
  let hostUrl
  try { hostUrl = new URL('http://' + host) } catch { return false }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try { return new URL(origin).host === hostUrl.host } catch { return false }
}
function writeJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(JSON.stringify(body))
}
async function readJsonBody(req, maxBytes = 8 * 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) return undefined
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return undefined }
}

// ---------- 工具 ----------
function defineTool(name, description, parameters, execute) {
  const properties = {}
  const required = []
  for (const [key, spec] of Object.entries(parameters || {})) {
    const prop = { type: spec.type || 'string', description: spec.description || '' }
    if (spec.enum) prop.enum = spec.enum
    if (spec.items) prop.items = spec.items
    properties[key] = prop
    if (spec.required) required.push(key)
  }
  return {
    name,
    description,
    parameters: { type: 'object', properties, required },
    output: {
      schema: { type: 'string' },
      render(_args, value) { return [{ type: 'text', text: String(value) }] },
    },
    async execute(args, exec) {
      try { return await execute(args, exec) } catch (e) { return name + ' 失败: ' + (e && e.message ? e.message : String(e)) }
    },
  }
}

// ---------- 激活 ----------
export function activate(ctx) {
  let cfg = loadConfig()

  // 从请求体发起生成(面板与工具共用);refs 已是归一化 Buffer 数组
  function startGeneration(bodyObj, refs) {
    if (refs && refs.length) {
      return submitImageEdit(cfg, {
        model: bodyObj.model || cfg.model, prompt: bodyObj.prompt, n: bodyObj.count || cfg.count || 1,
        quality: bodyObj.quality || cfg.quality, size: bodyObj.size || cfg.size,
      }, refs)
    }
    return submitTextToImage(cfg, {
      model: bodyObj.model || cfg.model, prompt: bodyObj.prompt, n: bodyObj.count || cfg.count || 1,
      quality: bodyObj.quality || cfg.quality, size: bodyObj.size || cfg.size,
    })
  }
  // 等任务完成(工具用;面板走轮询路由)
  async function awaitTask(taskId, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 300000)
    for (;;) {
      const task = tasks.get(taskId)
      if (!task) return { status: 'failed', error: { message: '任务不存在' } }
      if (task.status === 'succeeded' || task.status === 'failed') return task
      if (Date.now() > deadline) return { status: 'timeout' }
      await sleep(1200)
    }
  }

  const tools = [
    defineTool('ark9_generate_image', '生成图片(文生图或图生图)。images 可传参考图:dataURL 或之前生成返回的本地文件路径(多轮迭代)。默认每次调用需用户在「Ark9 生图」面板批准后才会执行;被拒/超时按 GUIDANCE 处理。成功返回保存路径+尺寸;returnDataUrl=true 时额外内嵌 base64(占上下文,慎用)。', {
      prompt: { type: 'string', required: true, description: '生图提示词,描述主体/风格/构图/光线等。' },
      images: { type: 'array', items: { type: 'string' }, description: '参考图数组(dataURL 或本地文件路径),提供时走图生图。' },
      size: { type: 'string', enum: ['auto', '1024x1024', '1536x1024', '1024x1536'], description: '尺寸,默认取配置。' },
      quality: { type: 'string', enum: ['auto', 'low', 'medium', 'high'], description: '质量,默认取配置。' },
      count: { type: 'number', description: '张数 1-4,默认取配置。' },
      model: { type: 'string', description: '覆盖默认模型名。' },
      returnDataUrl: { type: 'boolean', description: 'true 时在结果中内嵌 base64 图片(默认 false,防止上下文膨胀)。' },
    }, async (args) => {
      cfg = loadConfig()
      if (!cfg.baseURL || !cfg.apiKey) {
        return 'ark9_generate_image: 尚未配置图片 API。请让用户在侧窗「Ark9 生图」面板或设置页填写 baseURL + API Key + 模型。'
      }
      const prompt = String(args.prompt || '').trim()
      if (!prompt) return 'ark9_generate_image: prompt 为空。'

      // ---- 审批门控(仅 Agent 调用;面板手动生成走 /generate 路由不经过这里) ----
      if (cfg.agentApproval !== 'never') {
        const refsCount = Array.isArray(args.images) ? args.images.filter(Boolean).length : 0
        const ap = createApproval(prompt, {
          size: args.size || cfg.size, quality: args.quality || cfg.quality,
          count: args.count || cfg.count || 1, model: args.model || cfg.model, refs: refsCount,
        })
        const timeoutMs = cfg.approvalTimeoutSec * 1000
        const deadline = Date.now() + timeoutMs
        for (;;) {
          if (ap.status === 'approved') break
          if (ap.status === 'denied') {
            return 'ark9_generate_image: 用户在面板拒绝了本次生图请求。不要重试同一提示词;询问用户想如何调整(提示词/参数),或确认是否真的需要生图。'
          }
          if (Date.now() > deadline) {
            ap.status = 'expired'
            return `ark9_generate_image: 等待用户批准超时(${cfg.approvalTimeoutSec}s),本次生图已取消、未扣费。可提醒用户在「Ark9 生图」面板的「审批」页处理,或在 设置→Ark9生图→安全 中调整审批模式/超时。`
          }
          await sleep(1500)
        }
      }

      // ---- 归一化参考图 ----
      const refInputs = Array.isArray(args.images) ? args.images.filter(Boolean) : []
      const refs = []
      for (const [i, r] of refInputs.entries()) {
        const norm = normalizeRef(r, i)
        if (norm) refs.push(norm)
      }
      if (refInputs.length && !refs.length) {
        return 'ark9_generate_image: 参考图无效(既不是 dataURL 也不是存在的本地文件路径)。'
      }

      const taskId = startGeneration({ prompt, model: args.model, size: args.size, quality: args.quality, count: args.count }, refs)
      const task = await awaitTask(taskId)
      if (task.status === 'timeout') return `ark9_generate_image: 生成超时,任务 ${taskId} 仍在后台处理。可用 ark9_list_images 稍后查看产出。`
      if (task.status === 'failed') return 'ark9_generate_image: 生成失败 — ' + (task.error && task.error.message || '未知错误')

      const saved = await saveTaskResults(task, outputDir(cfg))
      const lines = saved.map((s) => `${s.index}. ${s.path || s.url}${s.width ? ` (${s.width}x${s.height}, ${s.sizeKB}KB)` : ''}`)
      let out = `图片生成成功,共 ${saved.length} 张:\n${lines.join('\n')}\n\n图片已保存到 ${outputDir(cfg)}。引用某张图做后续修改时,把它的路径传给 images 参数即可。`
      if (args.returnDataUrl) {
        out += '\n\n<dataURL>\n' + saved.map((s) => s.dataUrl).filter(Boolean).join('\n') + '\n</dataURL>'
      }
      return out
    }),

    defineTool('ark9_list_images', '列出输出目录最近生成的图片(路径/尺寸/大小/时间),供引用或向用户展示。', {
      limit: { type: 'number', description: '最多返回条数,默认 10,上限 50。' },
    }, async (args) => {
      cfg = loadConfig()
      const dir = outputDir(cfg)
      if (!existsSync(dir)) return `ark9_list_images: 输出目录不存在(${dir}),还没有生成过图片。`
      const names = (await readdir(dir)).filter((n) => /\.png$/i.test(n))
      const items = []
      for (const n of names) {
        try {
          const st = await stat(path.join(dir, n))
          items.push({ name: n, path: path.join(dir, n), sizeKB: Math.round(st.size / 1024), mtime: st.mtimeMs })
        } catch {}
      }
      items.sort((a, b) => b.mtime - a.mtime)
      const limit = Math.max(1, Math.min(50, Math.floor(Number(args.limit) || 10)))
      const slice = items.slice(0, limit)
      if (!slice.length) return 'ark9_list_images: 输出目录为空。'
      const lines = slice.map((it, i) => {
        const dim = (() => { try { return pngSize(readFileSync(it.path)) } catch { return null } })()
        return `${i + 1}. ${it.path} (${dim ? dim.w + 'x' + dim.h + ', ' : ''}${it.sizeKB}KB, ${new Date(it.mtime).toLocaleString()})`
      })
      return `最近 ${slice.length} 张(共 ${items.length} 张):\n${lines.join('\n')}`
    }),
  ]

  const routes = [
    {
      kind: 'exact',
      path: API['state'],
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        cfg = loadConfig()
        writeJson(res, 200, {
          configured: !!(cfg.baseURL && cfg.apiKey),
          model: cfg.model,
          baseURLMasked: cfg.baseURL ? cfg.baseURL.replace(/^https?:\/\/[^/]+/, '***') : '',
          agentApproval: cfg.agentApproval,
          approvalTimeoutSec: cfg.approvalTimeoutSec,
          pendingApprovals: pendingApprovals().length,
          tasks: tasks.size,
        })
      },
    },
    {
      kind: 'exact',
      path: API['config'],
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        if (req.method === 'GET') {
          cfg = loadConfig()
          return writeJson(res, 200, cfg)
        }
        if (req.method === 'POST') {
          const body = await readJsonBody(req)
          if (!body || typeof body !== 'object') return writeJson(res, 400, { error: 'bad json' })
          cfg = loadConfig()
          for (const k of CONFIG_KEYS) {
            if (body[k] === undefined) continue
            if (k === 'agentApproval' && body[k] !== 'always' && body[k] !== 'never') continue
            cfg[k] = body[k]
          }
          saveConfig(cfg)
          return writeJson(res, 200, { ok: true })
        }
        writeJson(res, 405, { error: 'method not allowed' })
      },
    },
    {
      kind: 'exact',
      path: API['models'],
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        cfg = loadConfig()
        if (!cfg.baseURL) return writeJson(res, 200, { models: [] })
        const u = upstreamUrl(cfg, '/models')
        if (!u) return writeJson(res, 200, { models: [] })
        const opts = {
          hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search,
          method: 'GET', headers: { authorization: 'Bearer ' + cfg.apiKey, accept: 'application/json', 'user-agent': 'dsh-ark9canvas' },
        }
        upstreamCall(opts, Buffer.alloc(0), (err, statusCode, data) => {
          if (err || statusCode !== 200) return writeJson(res, 200, { models: [], error: err ? err.message : 'HTTP ' + statusCode })
          try {
            const j = JSON.parse(data.toString())
            writeJson(res, 200, { models: (j.data || []).map((m) => ({ id: m.id, name: m.display_name || m.id })) })
          } catch { writeJson(res, 200, { models: [], error: '解析失败' }) }
        })
      },
    },
    {
      kind: 'exact',
      path: API['generate'],
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        cfg = loadConfig()
        if (!cfg.baseURL || !cfg.apiKey) return writeJson(res, 400, { error: '未配置图片 API' })
        const body = await readJsonBody(req)
        if (!body || !body.prompt) return writeJson(res, 400, { error: '缺少 prompt' })
        const refInputs = Array.isArray(body.images) ? body.images : []
        const refs = []
        for (const [i, r] of refInputs.entries()) {
          const norm = normalizeRef(r, i)
          if (norm) refs.push(norm)
        }
        const taskId = startGeneration(body, refs)
        writeJson(res, 200, { id: taskId, status: 'queued' })
      },
    },
    {
      kind: 'exact',
      path: API['task'],
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        const body = await readJsonBody(req)
        const task = tasks.get(body && body.id)
        if (!task) return writeJson(res, 404, { error: 'task not found' })
        writeJson(res, 200, { id: task.id, status: task.status, error: task.error })
      },
    },
    {
      kind: 'exact',
      path: API['taskResult'],
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        const body = await readJsonBody(req)
        const task = tasks.get(body && body.id)
        if (!task) return writeJson(res, 404, { error: 'task not found' })
        if (task.status !== 'succeeded') return writeJson(res, 200, { id: task.id, status: task.status })
        writeJson(res, 200, { id: task.id, status: 'succeeded', data: task.result.data })
      },
    },
    {
      kind: 'exact',
      path: API['approvals'],
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        if (req.method === 'GET') {
          return writeJson(res, 200, {
            approvals: pendingApprovals().map((a) => ({
              id: a.id, prompt: a.prompt, params: a.params, createdAt: a.createdAt,
              waitSec: Math.round((Date.now() - a.createdAt) / 1000),
            })),
          })
        }
        if (req.method === 'POST') {
          const body = await readJsonBody(req)
          const ap = approvals.get(body && body.id)
          if (!ap) return writeJson(res, 404, { error: 'approval not found' })
          if (ap.status !== 'pending') return writeJson(res, 200, { ok: true, status: ap.status })
          ap.status = body.decision === 'approve' ? 'approved' : 'denied'
          ap.decidedAt = Date.now()
          return writeJson(res, 200, { ok: true, status: ap.status })
        }
        writeJson(res, 405, { error: 'method not allowed' })
      },
    },
    {
      kind: 'exact',
      path: API['images'],
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        cfg = loadConfig()
        const dir = outputDir(cfg)
        if (!existsSync(dir)) return writeJson(res, 200, { images: [], dir })
        try {
          const names = (await readdir(dir)).filter((n) => /\.png$/i.test(n))
          const items = []
          for (const n of names.slice(0, 200)) {
            try {
              const st = await stat(path.join(dir, n))
              items.push({ name: n, sizeKB: Math.round(st.size / 1024), mtime: st.mtimeMs })
            } catch {}
          }
          items.sort((a, b) => b.mtime - a.mtime)
          writeJson(res, 200, { images: items.slice(0, 50), dir })
        } catch (e) {
          writeJson(res, 200, { images: [], dir, error: e.message })
        }
      },
    },
    {
      kind: 'exact',
      path: API['imageFile'],
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        const body = await readJsonBody(req)
        const name = body && body.name
        if (typeof name !== 'string' || !/^[\w.-]+\.png$/i.test(name)) return writeJson(res, 400, { error: 'bad name' })
        cfg = loadConfig()
        const fp = path.join(outputDir(cfg), name)
        if (!existsSync(fp)) return writeJson(res, 404, { error: 'not found' })
        try {
          const buf = await readFile(fp)
          writeJson(res, 200, { name, dataUrl: 'data:image/png;base64,' + buf.toString('base64') })
        } catch (e) {
          writeJson(res, 500, { error: e.message })
        }
      },
    },
  ]

  const disposers = []
  for (const tool of tools) disposers.push(ctx.tools.register(tool))
  for (const route of routes) disposers.push(ctx.webServer.register(route))
  ctx.effect(() => () => { for (const d of disposers) { try { d() } catch (_) {} } })

  return {
    api: API,
    getConfig: () => loadConfig(),
    dispose() {},
  }
}

// 启动时加载持久化任务
loadTasks()
