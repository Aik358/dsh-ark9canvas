/**
 * dsh-ark9canvas — host half.
 *
 * DSH 生图插件(全量对齐 WorldCodes Canvas 生图工作台能力,独立实现无其版权):
 *   - 工具:ark9_generate_image(默认审批门控) / ark9_list_images
 *   - 批量:张数 N → N 个子任务(n:1)聚合成 batch,部分成功也返回已出图
 *   - 尺寸:auto / "WxH"(客户端按质量预算+16px 对齐算好) / background:transparent
 *   - 多渠道:config.channels[] 聚合,activeChannelId 指定当前渠道(向后兼容单渠道字段)
 *   - 生成记录:LOGS_FILE 持久化,支持重试/删除/清空
 *   - 提示词源:POST /prompt-fetch {url} 由 node 代理拉取(绕开浏览器 CORS/CSP)
 *   - 路由:/api/ark9-canvas-pre/{state,config,models,generate,task,task-result,
 *     approvals,images,image-file,logs,prompt-fetch}
 */

import { mkdir, readFile, writeFile, readdir, stat, rm } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import https from 'node:https'
import http from 'node:http'
import path from 'node:path'
import { homedir } from 'node:os'

export const name = 'ark9-canvas-pre'
export const inject = ['webServer', 'tools', 'systemPrompt']

export const GUIDANCE = '本机已安装 dsh-ark9canvas-pre 插件（生图工作台）：调用 ark9_generate_image 生成图片（文生图/图生图/透明背景；images 可传参考图 dataURL 或之前生成的本地文件路径做多轮迭代；count 一次最多 10 张）。生成结果保存到输出目录并返回文件路径+尺寸，默认不内嵌 base64（returnDataUrl=true 才内嵌，占大量上下文慎用）。ark9_list_images 列出最近生成。审批纪律：默认每次 Agent 生图需用户在「Ark9 生图」面板批准——被拒后不要重试同一提示词，应询问用户；超时则提醒用户去面板「审批」页处理。用户说「画一张/生成图片/配图/把这张图改成…」时即用本插件，不要编造图片链接。'

export const API = {
  state: '/api/ark9-canvas-pre/state',
  generate: '/api/ark9-canvas-pre/generate',
  task: '/api/ark9-canvas-pre/task',
  taskResult: '/api/ark9-canvas-pre/task-result',
  approvals: '/api/ark9-canvas-pre/approvals',
  images: '/api/ark9-canvas-pre/images',
  imageFile: '/api/ark9-canvas-pre/image-file',
  logs: '/api/ark9-canvas-pre/logs',
  promptFetch: '/api/ark9-canvas-pre/prompt-fetch',
  models: '/api/ark9-canvas-pre/models',
  config: '/api/ark9-canvas-pre/config',
}

// ---------- 配置(含多渠道) ----------
function configPath() { return path.join(homedir(), '.dsh', 'ark9-canvas.json') }
const DEFAULT_CONFIG = {
  baseURL: '', apiKey: '', model: 'gpt-image-2',
  outputDir: '', quality: 'high', size: '1536x1024', count: 1,
  agentApproval: 'always', approvalTimeoutSec: 120,
  /** 多渠道:[{id,name,baseURL,apiKey,model}];空=用单渠道字段。 */
  channels: [],
  activeChannelId: '',
  /** 提示词来源:[{id,name,url}](JSON 数组 [{title,prompt,tags?,cover?}]),由 node 代理拉取。 */
  promptSources: [],
}
const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG)
function loadConfig() {
  try {
    const j = JSON.parse(readFileSync(configPath(), 'utf-8'))
    const cfg = { ...DEFAULT_CONFIG }
    for (const k of CONFIG_KEYS) if (j[k] !== undefined) cfg[k] = j[k]
    if (cfg.agentApproval !== 'always' && cfg.agentApproval !== 'never') cfg.agentApproval = 'always'
    cfg.approvalTimeoutSec = Math.max(5, Math.min(600, Math.floor(Number(cfg.approvalTimeoutSec) || 120)))
    if (!Array.isArray(cfg.channels)) cfg.channels = []
    if (!Array.isArray(cfg.promptSources)) cfg.promptSources = []
    return cfg
  } catch { return { ...DEFAULT_CONFIG } }
}
function saveConfig(cfg) {
  try {
    mkdirSync(path.dirname(configPath()), { recursive: true })
    writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf-8')
  } catch (e) {}
}
/** 当前生效渠道:优先 channels+activeChannelId,回退单渠道字段。 */
function activeChannel(cfg) {
  if (cfg.channels && cfg.channels.length) {
    const ch = cfg.channels.find((c) => c.id === cfg.activeChannelId) || cfg.channels[0]
    if (ch && ch.baseURL) return ch
  }
  return { id: 'default', name: '默认渠道', baseURL: cfg.baseURL, apiKey: cfg.apiKey, model: cfg.model }
}
function outputDir(cfg) {
  if (cfg.outputDir && path.isAbsolute(cfg.outputDir)) return cfg.outputDir
  return path.join(homedir(), 'Pictures', 'ark9-canvas')
}

// ---------- 任务(内存+持久化;batch 聚合 N 个子任务) ----------
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
function genId() { return 'ark9_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10) }

// ---------- 审批(内存) ----------
const approvals = new Map()
function createApproval(prompt, params) {
  const id = 'ap_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
  const ap = { id, prompt: String(prompt).slice(0, 500), params: params || {}, status: 'pending', createdAt: Date.now(), decidedAt: null }
  approvals.set(id, ap)
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

// ---------- 生成记录(持久化) ----------
const LOGS_FILE = path.join(homedir(), '.dsh', 'ark9-canvas-logs.json')
const logs = []
function loadLogs() {
  try {
    const arr = JSON.parse(readFileSync(LOGS_FILE, 'utf-8'))
    if (Array.isArray(arr)) logs.push(...arr)
  } catch {}
}
function saveLogs() {
  try {
    mkdirSync(path.dirname(LOGS_FILE), { recursive: true })
    writeFileSync(LOGS_FILE, JSON.stringify(logs.slice(-200)), 'utf-8')
  } catch {}
}
function addLog(entry) {
  logs.push(entry)
  if (logs.length > 200) logs.splice(0, logs.length - 200)
  saveLogs()
  return entry
}

// ---------- 上游 ----------
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
function upstreamUrl(ch, suffix) {
  const base = String(ch.baseURL || '').replace(/\/+$/, '')
  try { return new URL(base + suffix) } catch { return null }
}
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

function submitSingle(ch, kind, bodyObj, refBufs) {
  const id = genId()
  const task = { id, status: 'queued', result: null, error: null, createdAt: Date.now(), kind }
  tasks.set(id, task)
  saveTasks()
  const u = upstreamUrl(ch, kind === 'edits' ? '/images/edits' : '/images/generations')
  if (!u) { task.status = 'failed'; task.error = { message: '渠道 baseURL 无效: ' + ch.baseURL }; saveTasks(); return id }
  let opts
  if (kind === 'edits') {
    if (!refBufs || !refBufs.length) { task.status = 'failed'; task.error = { message: '缺少参考图' }; saveTasks(); return id }
    const boundary = '----ark9' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
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
    opts = {
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': bodyData.length, authorization: 'Bearer ' + ch.apiKey, accept: 'application/json', 'user-agent': 'dsh-ark9canvas' },
    }
    upstreamCall(opts, bodyData, (err, sc, data) => finishTask(task, err, sc, data))
  } else {
    const payload = {
      model: bodyObj.model, prompt: bodyObj.prompt, n: 1, response_format: 'b64_json',
      ...(bodyObj.quality ? { quality: bodyObj.quality } : {}),
      ...(bodyObj.size ? { size: bodyObj.size } : {}),
      ...(bodyObj.background ? { background: bodyObj.background } : {}),
    }
    const bodyData = JSON.stringify(payload)
    opts = {
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(bodyData), authorization: 'Bearer ' + ch.apiKey, accept: 'application/json', 'user-agent': 'dsh-ark9canvas' },
    }
    upstreamCall(opts, bodyData, (err, sc, data) => finishTask(task, err, sc, data))
  }
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

/** 批量:count 个子任务(n:1)聚合。部分成功=聚合成功,带 ok/fail 计数。 */
function submitBatch(ch, bodyObj, refBufs, count) {
  const batchId = genId()
  const subIds = []
  for (let i = 0; i < count; i++) {
    subIds.push(submitSingle(ch, refBufs && refBufs.length ? 'edits' : 'generations', bodyObj, refBufs))
  }
  const batch = { id: batchId, kind: 'batch', subIds, status: 'queued', createdAt: Date.now() }
  tasks.set(batchId, batch)
  saveTasks()
  // 看门狗:子任务全部落定后聚合状态(轮询处理函数也会即时算,这里兜底写回持久化)
  const timer = setInterval(() => {
    const subs = batch.subIds.map((sid) => tasks.get(sid)).filter(Boolean)
    if (subs.length && subs.every((t) => t.status === 'succeeded' || t.status === 'failed')) {
      const ok = subs.filter((t) => t.status === 'succeeded').length
      batch.status = ok > 0 ? 'succeeded' : 'failed'
      batch.okCount = ok
      batch.failCount = subs.length - ok
      clearInterval(timer)
      saveTasks()
    }
  }, 1000)
  return batchId
}
/** batch 聚合视图(供 /task /task-result)。 */
function batchView(batch) {
  const subs = batch.subIds.map((sid) => tasks.get(sid)).filter(Boolean)
  const ok = subs.filter((t) => t.status === 'succeeded')
  const fail = subs.filter((t) => t.status === 'failed')
  const allDone = subs.length > 0 && subs.every((t) => t.status === 'succeeded' || t.status === 'failed')
  const status = allDone ? (ok.length > 0 ? 'succeeded' : 'failed') : 'queued'
  const data = ok.flatMap((t) => (t.result && t.result.data) || [])
  const firstErr = fail[0] && fail[0].error
  return { id: batch.id, status, okCount: ok.length, failCount: fail.length, total: subs.length, data, error: ok.length ? null : firstErr }
}

// ---------- 结果落盘 ----------
function pngSize(buf) {
  try {
    if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
    }
  } catch {}
  return null
}
async function saveTaskResults(view, dir) {
  await mkdir(dir, { recursive: true })
  const out = []
  const arr = view.data || []
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i]
    const b64 = item.b64_json
    const buf = b64 ? Buffer.from(b64, 'base64') : null
    const fn = `ark9-${new Date().toISOString().slice(0, 10)}-${view.id.slice(-6)}-${i}.png`
    const fp = path.join(dir, fn)
    if (buf) { await writeFile(fp, buf) }
    const dim = buf ? pngSize(buf) : null
    out.push({
      index: i + 1, path: buf ? fp : '', url: item.url || '',
      dataUrl: b64 ? `data:image/png;base64,${b64}` : '',
      width: dim ? dim.w : 0, height: dim ? dim.h : 0, sizeKB: buf ? Math.round(buf.length / 1024) : 0,
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
    name, description,
    parameters: { type: 'object', properties, required },
    output: { schema: { type: 'string' }, render(_args, value) { return [{ type: 'text', text: String(value) }] } },
    async execute(args, exec) {
      try { return await execute(args, exec) } catch (e) { return name + ' 失败: ' + (e && e.message ? e.message : String(e)) }
    },
  }
}

// ---------- 激活 ----------
export function activate(ctx) {
  let cfg = loadConfig()

  function startGeneration(bodyObj, refs, count) {
    const ch = activeChannel(cfg)
    const n = Math.max(1, Math.min(10, Math.floor(Number(count) || 1)))
    const params = {
      model: bodyObj.model || ch.model || cfg.model, prompt: bodyObj.prompt,
      quality: bodyObj.quality || cfg.quality, size: bodyObj.size || cfg.size,
      background: bodyObj.background === 'transparent' ? 'transparent' : undefined,
    }
    return submitBatch(ch, params, refs, n)
  }
  async function awaitTask(taskId, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 420000)
    for (;;) {
      const task = tasks.get(taskId)
      if (!task) return { status: 'failed', error: { message: '任务不存在' } }
      const view = task.kind === 'batch' ? batchView(task) : task
      if (view.status === 'succeeded' || view.status === 'failed') return { ...view, kind: task.kind }
      if (Date.now() > deadline) return { status: 'timeout' }
      await sleep(1200)
    }
  }

  const tools = [
    defineTool('ark9_generate_image', '生成图片(文生图/图生图/透明背景,一次最多 10 张)。images 可传参考图 dataURL 或之前生成的本地路径(多轮迭代);size 传 "WxH"(如 1024x1024,推荐标准三档 1024x1024/1536x1024/1024x1536)或 auto;transparent=true 出透明背景。默认需用户在「Ark9 生图」面板批准;成功返回保存路径+尺寸。', {
      prompt: { type: 'string', required: true, description: '生图提示词。' },
      images: { type: 'array', items: { type: 'string' }, description: '参考图数组(dataURL 或本地文件路径),提供时走图生图。' },
      size: { type: 'string', description: '尺寸 "WxH" 或 auto,默认取配置。' },
      quality: { type: 'string', enum: ['auto', 'low', 'medium', 'high'], description: '质量,默认取配置。' },
      count: { type: 'number', description: '张数 1-10,默认 1。' },
      transparent: { type: 'boolean', description: 'true 出透明背景 PNG(部分模型支持)。' },
      model: { type: 'string', description: '覆盖当前渠道默认模型。' },
      returnDataUrl: { type: 'boolean', description: 'true 时内嵌 base64(默认 false,防上下文膨胀)。' },
    }, async (args) => {
      cfg = loadConfig()
      const ch = activeChannel(cfg)
      if (!ch.baseURL || !ch.apiKey) {
        return 'ark9_generate_image: 尚未配置图片渠道。请让用户在侧窗「Ark9 生图」面板或设置页添加渠道(baseURL + API Key + 模型)。'
      }
      const prompt = String(args.prompt || '').trim()
      if (!prompt) return 'ark9_generate_image: prompt 为空。'

      if (cfg.agentApproval !== 'never') {
        const refsCount = Array.isArray(args.images) ? args.images.filter(Boolean).length : 0
        const ap = createApproval(prompt, {
          size: args.size || cfg.size, quality: args.quality || cfg.quality,
          count: args.count || 1, model: args.model || ch.model || cfg.model,
          refs: refsCount, channel: ch.name,
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

      const refInputs = Array.isArray(args.images) ? args.images.filter(Boolean) : []
      const refs = []
      for (const [i, r] of refInputs.entries()) {
        const norm = normalizeRef(r, i)
        if (norm) refs.push(norm)
      }
      if (refInputs.length && !refs.length) {
        return 'ark9_generate_image: 参考图无效(既不是 dataURL 也不是存在的本地文件路径)。'
      }

      const count = Math.max(1, Math.min(10, Math.floor(Number(args.count) || 1)))
      const batchId = startGeneration({
        prompt, model: args.model, size: args.size, quality: args.quality,
        background: args.transparent ? 'transparent' : undefined,
      }, refs, count)
      const view = await awaitTask(batchId)
      if (view.status === 'timeout') return `ark9_generate_image: 生成超时,批次 ${batchId} 仍在后台处理。可用 ark9_list_images 稍后查看产出。`
      if (view.status === 'failed') return 'ark9_generate_image: 生成失败 — ' + (view.error && view.error.message || '未知错误')

      const saved = await saveTaskResults(view, outputDir(cfg))
      const lines = saved.map((s) => `${s.index}. ${s.path || s.url}${s.width ? ` (${s.width}x${s.height}, ${s.sizeKB}KB)` : ''}`)
      let out = `图片生成成功,共 ${saved.length} 张${view.failCount ? `(另有 ${view.failCount} 张失败)` : ''}:\n${lines.join('\n')}\n\n已保存到 ${outputDir(cfg)}。引用某张图继续修改时,把它的路径传给 images 参数。`
      addLog({
        id: batchId, prompt: prompt.slice(0, 200),
        params: { size: args.size || cfg.size, quality: args.quality || cfg.quality, count, model: args.model || ch.model || cfg.model, refs: refs.length, transparent: !!args.transparent },
        status: view.failCount ? 'partial' : 'succeeded', ok: saved.length, fail: view.failCount || 0, total: count,
        images: saved.map((s) => ({ path: s.path, width: s.width, height: s.height, sizeKB: s.sizeKB })),
        error: view.failCount ? (view.error && view.error.message) || '' : '',
        source: 'agent', createdAt: Date.now(), finishedAt: Date.now(),
      })
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
      kind: 'exact', path: API['state'],
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        cfg = loadConfig()
        const ch = activeChannel(cfg)
        writeJson(res, 200, {
          configured: !!(ch.baseURL && ch.apiKey),
          channelName: ch.name || '', model: ch.model || cfg.model,
          baseURLMasked: ch.baseURL ? ch.baseURL.replace(/^https?:\/\/[^/]+/, '***') : '',
          channels: (cfg.channels || []).map((c) => ({ id: c.id, name: c.name, active: c.id === cfg.activeChannelId || (!cfg.activeChannelId && c.id === (cfg.channels[0] || {}).id) })),
          agentApproval: cfg.agentApproval, approvalTimeoutSec: cfg.approvalTimeoutSec,
          pendingApprovals: pendingApprovals().length, tasks: tasks.size,
        })
      },
    },
    {
      kind: 'exact', path: API['config'],
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        if (req.method === 'GET') { cfg = loadConfig(); return writeJson(res, 200, cfg) }
        if (req.method === 'POST') {
          const body = await readJsonBody(req)
          if (!body || typeof body !== 'object') return writeJson(res, 400, { error: 'bad json' })
          cfg = loadConfig()
          for (const k of CONFIG_KEYS) {
            if (body[k] === undefined) continue
            if (k === 'agentApproval' && body[k] !== 'always' && body[k] !== 'never') continue
            if (k === 'approvalTimeoutSec') body[k] = Math.max(5, Math.min(600, Math.floor(Number(body[k]) || 120)))
            if (k === 'channels' && !Array.isArray(body[k])) continue
            if (k === 'promptSources' && !Array.isArray(body[k])) continue
            cfg[k] = body[k]
          }
          saveConfig(cfg)
          return writeJson(res, 200, { ok: true })
        }
        writeJson(res, 405, { error: 'method not allowed' })
      },
    },
    {
      kind: 'exact', path: API['models'],
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        cfg = loadConfig()
        const body = req.method === 'POST' ? (await readJsonBody(req)) || {} : {}
        const ch = (body.baseURL && { baseURL: body.baseURL, apiKey: body.apiKey || '' }) || activeChannel(cfg)
        if (!ch.baseURL) return writeJson(res, 200, { models: [] })
        const u = upstreamUrl(ch, '/models')
        if (!u) return writeJson(res, 200, { models: [] })
        const opts = {
          hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search,
          method: 'GET', headers: { authorization: 'Bearer ' + ch.apiKey, accept: 'application/json', 'user-agent': 'dsh-ark9canvas' },
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
      kind: 'exact', path: API['generate'],
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        cfg = loadConfig()
        const ch = activeChannel(cfg)
        if (!ch.baseURL || !ch.apiKey) return writeJson(res, 400, { error: '未配置图片渠道' })
        const body = await readJsonBody(req)
        if (!body || !body.prompt) return writeJson(res, 400, { error: '缺少 prompt' })
        const refInputs = Array.isArray(body.images) ? body.images : []
        const refs = []
        for (const [i, r] of refInputs.entries()) {
          const norm = normalizeRef(r, i)
          if (norm) refs.push(norm)
        }
        const count = Math.max(1, Math.min(10, Math.floor(Number(body.count) || 1)))
        const batchId = startGeneration(body, refs, count)
        // 记录排队日志(完成后由 task-result 更新? 简化:面板成功/失败时 POST /logs 不必——由 /generate 记 pending,完成时在 task 轮询侧补写)
        writeJson(res, 200, { id: batchId, status: 'queued', count })
      },
    },
    {
      kind: 'exact', path: API['task'],
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        const body = await readJsonBody(req)
        const task = tasks.get(body && body.id)
        if (!task) return writeJson(res, 404, { error: 'task not found' })
        const view = task.kind === 'batch' ? batchView(task) : { id: task.id, status: task.status, okCount: task.status === 'succeeded' ? 1 : 0, failCount: task.status === 'failed' ? 1 : 0, total: 1, data: [], error: task.error }
        writeJson(res, 200, view)
      },
    },
    {
      kind: 'exact', path: API['taskResult'],
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        const body = await readJsonBody(req)
        const task = tasks.get(body && body.id)
        if (!task) return writeJson(res, 404, { error: 'task not found' })
        const view = task.kind === 'batch' ? batchView(task) : { id: task.id, status: task.status, data: task.status === 'succeeded' ? (task.result && task.result.data) || [] : [], okCount: task.status === 'succeeded' ? 1 : 0, failCount: task.status === 'failed' ? 1 : 0, total: 1, error: task.error }
        if (view.status !== 'succeeded') return writeJson(res, 200, { id: view.id, status: view.status, okCount: view.okCount, failCount: view.failCount, total: view.total })
        writeJson(res, 200, { id: view.id, status: 'succeeded', okCount: view.okCount, failCount: view.failCount, total: view.total, data: view.data })
      },
    },
    {
      kind: 'exact', path: API['approvals'],
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        if (req.method === 'GET') {
          return writeJson(res, 200, {
            approvals: pendingApprovals().map((a) => ({ id: a.id, prompt: a.prompt, params: a.params, createdAt: a.createdAt, waitSec: Math.round((Date.now() - a.createdAt) / 1000) })),
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
      kind: 'exact', path: API['images'],
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
        } catch (e) { writeJson(res, 200, { images: [], dir, error: e.message }) }
      },
    },
    {
      kind: 'exact', path: API['imageFile'],
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
        } catch (e) { writeJson(res, 500, { error: e.message }) }
      },
    },
    {
      kind: 'exact', path: API['logs'],
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        if (req.method === 'GET') {
          return writeJson(res, 200, { logs: [...logs].reverse().slice(0, 100) })
        }
        if (req.method === 'POST') {
          const body = await readJsonBody(req)
          const action = body && body.action
          if (action === 'delete' && Array.isArray(body.ids)) {
            for (const id of body.ids) {
              const i = logs.findIndex((l) => l.id === id)
              if (i >= 0) logs.splice(i, 1)
            }
            saveLogs()
            return writeJson(res, 200, { ok: true })
          }
          if (action === 'clear') {
            logs.length = 0
            saveLogs()
            return writeJson(res, 200, { ok: true })
          }
          if (action === 'add' && body.entry) {
            addLog(body.entry)
            return writeJson(res, 200, { ok: true })
          }
          return writeJson(res, 400, { error: 'bad action' })
        }
        writeJson(res, 405, { error: 'method not allowed' })
      },
    },
    {
      kind: 'exact', path: API['promptFetch'],
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        const body = await readJsonBody(req)
        const url = body && body.url
        if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return writeJson(res, 400, { error: 'bad url' })
        let u
        try { u = new URL(url) } catch { return writeJson(res, 400, { error: 'bad url' }) }
        const opts = {
          hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search,
          method: 'GET', headers: { accept: 'application/json', 'user-agent': 'dsh-ark9canvas' },
        }
        upstreamCall(opts, Buffer.alloc(0), (err, statusCode, data) => {
          if (err) return writeJson(res, 200, { prompts: [], error: err.message })
          if (statusCode !== 200) return writeJson(res, 200, { prompts: [], error: 'HTTP ' + statusCode })
          try {
            const j = JSON.parse(data.toString())
            const arr = Array.isArray(j) ? j : (Array.isArray(j.prompts) ? j.prompts : [])
            const prompts = arr.slice(0, 300).map((p, i) => ({
              id: String(p.id || i),
              title: String(p.title || p.name || '').slice(0, 120),
              prompt: String(p.prompt || p.text || p.content || '').slice(0, 4000),
              tags: Array.isArray(p.tags) ? p.tags.slice(0, 8).map(String) : [],
              cover: typeof p.cover === 'string' ? p.cover.slice(0, 500) : '',
            })).filter((p) => p.prompt)
            writeJson(res, 200, { prompts })
          } catch (e) { writeJson(res, 200, { prompts: [], error: '解析失败: ' + e.message }) }
        })
      },
    },
  ]

  const disposers = []
  for (const tool of tools) disposers.push(ctx.tools.register(tool))
  for (const route of routes) disposers.push(ctx.webServer.register(route))
  ctx.effect(() => () => { for (const d of disposers) { try { d() } catch (_) {} } })

  return { api: API, getConfig: () => loadConfig(), dispose() {} }
}

loadTasks()
loadLogs()
