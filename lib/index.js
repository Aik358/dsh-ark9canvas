/**
 * dsh-ark9canvas — host half.
 *
 * DSH 生图插件：Agent 可调用 + 侧窗工作台双入口的图片生成。
 *   - 工具:ark9_generate_image — Agent 文生图/图生图(参考图),返回图片 dataURL 或保存路径
 *   - 路由:/api/ark9-canvas-pre/{state,generate,task,task-result,upload,models,config}
 *     (loopback-only;侧窗工作台经这些路由与插件通信)
 *   - 图片后端:OpenAI 兼容 /v1/images/generations(文生图) 与 /v1/images/edits(图生图),
 *     支持任意自定义 baseURL(如 vankit 中转),key 存配置。
 *   - 异步任务协议:POST /v1/images/generations 返回 202+id,轮询 task/task-result,
 *     兼容 WorldCodes Canvas 前端的 async 协议(已被 Ark9canvas 工作台复用)。
 *
 * 零运行时依赖(仅 node 内置模块)。无 WorldCodes 版权——这是独立实现的生图插件。
 */

import { mkdir, readFile, writeFile, readdir, stat, rm } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import https from 'node:https'
import http from 'node:http'
import path from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

/** Stable cordis plugin name. */
export const name = 'ark9-canvas-pre'

/** Services required before the image surfaces can mount. */
export const inject = ['webServer', 'tools', 'systemPrompt']

/** Model-facing announcement (tools + engine). */
export const GUIDANCE = '本机已安装 dsh-ark9canvas-pre 插件（生图工作台）：Agent 可直接调用 ark9_generate_image 工具生成图片（支持文生图/图生图，可传参考图、指定质量/尺寸/数量），生成结果返回图片 dataURL 与本地保存路径。配置在侧窗「Ark9 生图」面板或设置页：填 OpenAI 兼容图片 API 的 baseURL（如中转站地址）+ API Key + 模型名（如 gpt-image-2）。用户说「画一张 / 生成图片 / 生图 / 配图」时即指本插件，请调用 ark9_generate_image 而非自己编造图片。'

/** Route family. */
export const API = {
  state: '/api/ark9-canvas-pre/state',
  generate: '/api/ark9-canvas-pre/generate',
  task: '/api/ark9-canvas-pre/task',
  taskResult: '/api/ark9-canvas-pre/task-result',
  uploadPresign: '/api/ark9-canvas-pre/upload-presign',
  uploadContent: '/api/ark9-canvas-pre/upload-content',
  uploadComplete: '/api/ark9-canvas-pre/upload-complete',
  models: '/api/ark9-canvas-pre/models',
  config: '/api/ark9-canvas-pre/config',
}

// ---------- 配置 ----------
function configPath() {
  const home = homedir()
  return path.join(home, '.dsh', 'ark9-canvas.json')
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
}
function loadConfig() {
  try {
    const raw = readFileSync(configPath(), 'utf-8')
    const j = JSON.parse(raw)
    return { ...DEFAULT_CONFIG, ...j }
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

// 文生图异步任务
function submitTextToImage(cfg, bodyObj) {
  const id = genId()
  const task = { id, status: 'queued', result: null, error: null, createdAt: Date.now() }
  tasks.set(id, task)
  saveTasks()
  const base = cfg.baseURL.replace(/\/+$/, '')
  let u
  try { u = new URL(base + '/images/generations') } catch { task.status = 'failed'; task.error = { message: 'baseURL 无效: ' + cfg.baseURL }; saveTasks(); return id }
  const payload = {
    model: bodyObj.model || cfg.model,
    prompt: bodyObj.prompt,
    n: bodyObj.n || cfg.count || 1,
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
    if (err) { task.status = 'failed'; task.error = { message: '请求图片 API 失败: ' + err.message }; saveTasks(); return }
    if (statusCode !== 200) {
      task.status = 'failed'
      let msg = '图片 API 返回 ' + statusCode
      try { const j = JSON.parse(data.toString()); msg = j.error?.message || j.message || msg } catch {}
      task.error = { message: msg }
      saveTasks(); return
    }
    try {
      const j = JSON.parse(data.toString())
      task.status = 'succeeded'
      task.result = j
      saveTasks()
    } catch (e) { task.status = 'failed'; task.error = { message: '解析响应失败: ' + e.message }; saveTasks() }
  })
  return id
}

// 图生图异步任务(参考图已上传到本地 uploads,JSON body 带 image_upload_ids)
const UPLOADS_DIR = path.join(homedir(), '.dsh', 'ark9-canvas-uploads')
mkdirSync(UPLOADS_DIR, { recursive: true })
const uploads = new Map()
function genUploadId() { return 'up_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10) }
function submitImageEdit(cfg, bodyObj) {
  const id = genId()
  const task = { id, status: 'queued', result: null, error: null, createdAt: Date.now() }
  tasks.set(id, task)
  saveTasks()
  const base = cfg.baseURL.replace(/\/+$/, '')
  let u
  try { u = new URL(base + '/images/edits') } catch { task.status = 'failed'; task.error = { message: 'baseURL 无效' }; saveTasks(); return id }
  const uploadIds = Array.isArray(bodyObj.image_upload_ids) ? bodyObj.image_upload_ids : []
  if (!uploadIds.length) { task.status = 'failed'; task.error = { message: '缺少参考图(image_upload_ids 为空)' }; saveTasks(); return id }
  // 读本地上传文件
  const boundary = '----ark9' + Date.now().toString(36)
  const chunks = []
  for (const fn of ['model', 'prompt', 'n', 'quality', 'size', 'background']) {
    const v = bodyObj[fn]
    if (v === undefined || v === null) continue
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fn}"\r\n\r\n${v}\r\n`))
  }
  for (const uid of uploadIds) {
    const up = uploads.get(uid)
    if (!up || !existsSync(up.path)) { task.status = 'failed'; task.error = { message: '参考图上传 ' + uid + ' 不存在' }; saveTasks(); return id }
    const data = readFileSync(up.path)
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${up.filename || 'ref.png'}"\r\nContent-Type: ${up.contentType || 'image/png'}\r\n\r\n`))
    chunks.push(data)
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
  })
  return id
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
async function readJsonBody(req, maxBytes = 2 * 1024 * 1024) {
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

// 保存 b64 图片到 outputDir
async function saveB64Image(dataUrlOrB64, dir, idx) {
  await mkdir(dir, { recursive: true })
  const b64 = String(dataUrlOrB64).includes(',') ? String(dataUrlOrB64).split(',')[1] : String(dataUrlOrB64)
  const buf = Buffer.from(b64, 'base64')
  const fn = `ark9-${new Date().toISOString().slice(0, 10)}-${Date.now()}-${idx}.png`
  const fp = path.join(dir, fn)
  await writeFile(fp, buf)
  return fp
}

// ---------- 激活 ----------
export function activate(ctx) {
  let cfg = loadConfig()

  const tools = [
    defineTool('ark9_generate_image', '生成图片(文生图或图生图)。通过配置的 OpenAI 兼容图片 API(如 gpt-image-2)生成。可指定提示词、参考图(dataURL 数组)、质量、尺寸、数量。生成成功返回每张图的 dataURL 与本地保存路径;失败返回原因。', {
      prompt: { type: 'string', required: true, description: '生图提示词,描述主体/风格/构图/光线等。' },
      images: { type: 'array', description: '参考图 dataURL 数组(图生图)。每项为 data:image/...;base64, 形式。' },
      size: { type: 'string', enum: ['auto', '1024x1024', '1536x1024', '1024x1536'], description: '图片尺寸,默认配置值。' },
      quality: { type: 'string', enum: ['auto', 'low', 'medium', 'high'], description: '质量,默认配置值。' },
      count: { type: 'number', description: '生成张数 1-4,默认配置值。' },
      model: { type: 'string', description: '覆盖默认模型名。' },
    }, async (args) => {
      cfg = loadConfig()
      if (!cfg.baseURL || !cfg.apiKey) {
        return 'ark9_generate_image: 尚未配置图片 API。请在侧窗「Ark9 生图」面板或设置页填写 baseURL + API Key + 模型。'
      }
      const prompt = String(args.prompt || '').trim()
      if (!prompt) return 'ark9_generate_image: prompt 为空。'
      const refs = Array.isArray(args.images) ? args.images.filter(Boolean) : []
      let taskId
      if (refs.length) {
        // 参考图 → 上传到本地 uploads → 图生图
        const uploadIds = []
        for (const [i, dataUrl] of refs.entries()) {
          const m = String(dataUrl).match(/^data:(.*?);base64,(.*)$/s)
          const contentType = m ? m[1] : 'image/png'
          const b64 = m ? m[2] : String(dataUrl)
          const upId = genUploadId()
          const fp = path.join(UPLOADS_DIR, upId + '.img')
          writeFileSync(fp, Buffer.from(b64, 'base64'))
          uploads.set(upId, { path: fp, contentType, filename: `ref-${i}.png` })
          uploadIds.push(upId)
        }
        taskId = submitImageEdit(cfg, {
          model: args.model || cfg.model, prompt, n: args.count || cfg.count || 1,
          quality: args.quality || cfg.quality, size: args.size || cfg.size,
          image_upload_ids: uploadIds,
        })
      } else {
        taskId = submitTextToImage(cfg, {
          model: args.model || cfg.model, prompt, n: args.count || cfg.count || 1,
          quality: args.quality || cfg.quality, size: args.size || cfg.size,
        })
      }
      // 轮询任务(最多 120s)
      const task = tasks.get(taskId)
      const deadline = Date.now() + 120000
      while (Date.now() < deadline) {
        if (task.status === 'succeeded') {
          const dir = outputDir(cfg)
          const lines = []
          const dataArr = (task.result && task.result.data) || []
          for (let i = 0; i < dataArr.length; i++) {
            const item = dataArr[i]
            const b64 = item.b64_json
            const dataUrl = b64 ? `data:image/png;base64,${b64}` : item.url || ''
            let saved = ''
            if (b64) { try { saved = await saveB64Image(b64, dir, i) } catch (e) { saved = '保存失败:' + e.message } }
            lines.push(`第 ${i + 1} 张: ${dataUrl}${saved ? '\n已保存: ' + saved : ''}`)
          }
          return '图片生成成功,共 ' + dataArr.length + ' 张。\n' + lines.join('\n')
        }
        if (task.status === 'failed') return '图片生成失败: ' + (task.error && task.error.message || '未知错误')
        await new Promise((r) => setTimeout(r, 1200))
      }
      return '图片生成超时(120s),任务 ' + taskId + ' 仍在处理,可稍后查询。'
    }),
  ]

  const routes = [
    {
      kind: 'exact',
      path: API['state'],
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        cfg = loadConfig()
        writeJson(res, 200, { configured: !!(cfg.baseURL && cfg.apiKey), model: cfg.model, baseURL: cfg.baseURL ? cfg.baseURL.replace(/^https?:\/\/[^/]+/, '***') : '', tasks: tasks.size })
      },
    },
    {
      kind: 'exact',
      path: API['config'],
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        if (req.method === 'GET') {
          cfg = loadConfig()
          writeJson(res, 200, cfg)
        } else if (req.method === 'POST') {
          const body = await readJsonBody(req)
          if (!body) return writeJson(res, 400, { error: 'bad json' })
          cfg = { ...cfg, ...body }
          saveConfig(cfg)
          writeJson(res, 200, { ok: true })
        } else {
          writeJson(res, 405, { error: 'method not allowed' })
        }
      },
    },
    {
      kind: 'exact',
      path: API['models'],
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        cfg = loadConfig()
        if (!cfg.baseURL) return writeJson(res, 200, { models: [] })
        const base = cfg.baseURL.replace(/\/+$/, '')
        let u
        try { u = new URL(base + '/models') } catch { return writeJson(res, 200, { models: [] }) }
        const opts = {
          hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search,
          method: 'GET', headers: { authorization: 'Bearer ' + cfg.apiKey, accept: 'application/json', 'user-agent': 'dsh-ark9canvas' },
        }
        upstreamCall(opts, Buffer.alloc(0), (err, statusCode, data) => {
          if (err || statusCode !== 200) return writeJson(res, 200, { models: [], error: err ? err.message : 'HTTP ' + statusCode })
          try { const j = JSON.parse(data.toString()); writeJson(res, 200, { models: (j.data || []).map((m) => ({ id: m.id, name: m.display_name || m.id })) }) }
          catch { writeJson(res, 200, { models: [], error: '解析失败' }) }
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
        const refs = Array.isArray(body.images) ? body.images : []
        let taskId
        if (refs.length) {
          const uploadIds = []
          for (const [i, dataUrl] of refs.entries()) {
            const m = String(dataUrl).match(/^data:(.*?);base64,(.*)$/s)
            const contentType = m ? m[1] : 'image/png'
            const b64 = m ? m[2] : String(dataUrl)
            const upId = genUploadId()
            const fp = path.join(UPLOADS_DIR, upId + '.img')
            writeFileSync(fp, Buffer.from(b64, 'base64'))
            uploads.set(upId, { path: fp, contentType, filename: `ref-${i}.png` })
            uploadIds.push(upId)
          }
          taskId = submitImageEdit(cfg, {
            model: body.model || cfg.model, prompt: body.prompt, n: body.count || cfg.count || 1,
            quality: body.quality || cfg.quality, size: body.size || cfg.size,
            image_upload_ids: uploadIds,
          })
        } else {
          taskId = submitTextToImage(cfg, {
            model: body.model || cfg.model, prompt: body.prompt, n: body.count || cfg.count || 1,
            quality: body.quality || cfg.quality, size: body.size || cfg.size,
          })
        }
        writeJson(res, 200, { id: taskId, status: 'queued' })
      },
    },
    {
      kind: 'exact',
      path: API['task'],
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        const body = await readJsonBody(req)
        const id = body && body.id
        const task = tasks.get(id)
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
        const id = body && body.id
        const task = tasks.get(id)
        if (!task) return writeJson(res, 404, { error: 'task not found' })
        if (task.status !== 'succeeded') return writeJson(res, 200, { id: task.id, status: task.status })
        writeJson(res, 200, { id: task.id, status: 'succeeded', data: task.result.data })
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
