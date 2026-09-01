// dsh-ark9canvas 联调测试 v0.3.0：模拟 DSH host ctx,验证工具 + 11 路由 + 审批流 + 批量 + 日志 + 提示词代理。
// 不真调图片 API(假 baseURL 验证失败路径与审批门控;真实出图走 e2e-approval-test.mjs)。
import http from 'node:http'
import { activate, API } from './lib/index.js'
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const CFG_FILE = path.join(homedir(), '.dsh', 'ark9-canvas.json')
const CFG_BACKUP = CFG_FILE + '.bak'
if (existsSync(CFG_FILE)) { writeFileSync(CFG_BACKUP, readFileSync(CFG_FILE)); rmSync(CFG_FILE) }

const registeredTools = []
const registeredRoutes = []
const ctx = {
  tools: { register(t) { registeredTools.push(t); return () => {} } },
  webServer: { register(r) { registeredRoutes.push(r); return () => {} } },
  systemPrompt: { section() { return () => {} }, context() { return () => {} } },
  effect() {},
}
activate(ctx)
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const route = registeredRoutes.find((r) => r.kind === 'exact' && r.path === url.pathname)
  if (!route) { res.writeHead(404); res.end('not found'); return }
  req.headers.host = '127.0.0.1:8080'
  req.headers['sec-fetch-site'] = 'same-origin'
  await route.handler(req, res)
})
await new Promise((resolve) => server.listen(8081, '127.0.0.1', resolve))

function get(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: 8081, path: p, headers: { host: '127.0.0.1:8080', 'sec-fetch-site': 'same-origin' } }, (res) => {
      let b = ''; res.on('data', (c) => b += c); res.on('end', () => resolve({ status: res.statusCode, body: b }))
    }).on('error', reject)
  })
}
function post(p, obj) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(obj || {})
    const req = http.request({ host: '127.0.0.1', port: 8081, path: p, method: 'POST', headers: { host: '127.0.0.1:8080', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
      let b = ''; res.on('data', (c) => b += c); res.on('end', () => resolve({ status: res.statusCode, body: b }))
    })
    req.write(data); req.end()
  })
}
let pass = 0, fail = 0
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, detail ? '— ' + String(detail).slice(0, 120) : '') }
}

const imgTool = registeredTools.find((t) => t.name === 'ark9_generate_image')
const listTool = registeredTools.find((t) => t.name === 'ark9_list_images')
check('工具注册 x2', !!imgTool && !!listTool)
check('路由数 = 11', registeredRoutes.length === 11, registeredRoutes.length + ':' + registeredRoutes.map((r) => r.path.replace('/api/ark9-canvas-pre/', '')).join(','))

const r1 = await imgTool.execute({ prompt: 'cat' }, {})
check('未配置引导', r1.includes('尚未配置'), r1.slice(0, 60))

// 配置:假渠道 + 免审批
await post(API.config, {
  baseURL: 'http://127.0.0.1:9/v1', apiKey: 'test', model: 'gpt-image-2',
  agentApproval: 'never', outputDir: path.join(homedir(), '.dsh', 'ark9-test-out'),
  channels: [{ id: 'c1', name: '测试渠道', baseURL: 'http://127.0.0.1:9/v1', apiKey: 'test', model: 'gpt-image-2' }],
  activeChannelId: 'c1',
  promptSources: [{ id: 'ps1', name: '本地测试', url: 'http://127.0.0.1:9/prompts.json' }],
})
const st = await get(API.state)
const stj = JSON.parse(st.body)
check('state:渠道名/审批模式', stj.configured === true && stj.channelName === '测试渠道' && stj.agentApproval === 'never', st.body.slice(0, 150))

// 免审批批量:count=2 → batch 聚合失败(上游不可达)
const r2 = await imgTool.execute({ prompt: 'batch cat', count: 2 }, {})
check('免审批批量失败路径', r2.includes('生成失败'), r2.slice(0, 80))

// 审批流:拒绝
await post(API.config, { agentApproval: 'always', approvalTimeoutSec: 30 })
const toolPromise = imgTool.execute({ prompt: 'deny me' }, {})
await new Promise((r) => setTimeout(r, 300))
let apList = JSON.parse((await get(API.approvals)).body)
check('审批出现', apList.approvals.length === 1 && apList.approvals[0].params.channel === '测试渠道')
await post(API.approvals, { id: apList.approvals[0].id, decision: 'deny' })
check('拒绝文案', (await toolPromise).includes('拒绝'))

// 超时(approvalTimeoutSec=5)
await post(API.config, { approvalTimeoutSec: 5 })
const t0 = Date.now()
const r5 = await imgTool.execute({ prompt: 'timeout' }, {})
const dt = Date.now() - t0
check('超时取消 ~5s', r5.includes('超时') && dt >= 4500 && dt < 9000, 'dt=' + dt)

// logs 路由
await post(API.logs, { action: 'add', entry: { id: 'logtest1', prompt: 'p', params: {}, status: 'failed', ok: 0, fail: 1, total: 1, images: [], createdAt: Date.now() } })
let lg = JSON.parse((await get(API.logs)).body)
check('logs add+list', lg.logs.some((l) => l.id === 'logtest1'))
await post(API.logs, { action: 'delete', ids: ['logtest1'] })
lg = JSON.parse((await get(API.logs)).body)
check('logs delete', !lg.logs.some((l) => l.id === 'logtest1'))

// prompt-fetch:坏 URL 校验
const pf1 = await post(API.promptFetch, { url: 'ftp://x' })
check('prompt-fetch 拒绝非 http', pf1.status === 400)
const pf2 = await post(API.promptFetch, { url: 'http://127.0.0.1:9/prompts.json' })
check('prompt-fetch 上游不可达优雅返回', JSON.parse(pf2.body).prompts !== undefined && JSON.parse(pf2.body).error, pf2.body.slice(0, 80))

// image-file 防穿越
const r8 = await post(API.imageFile, { name: '../x.png' })
check('image-file 防穿越', r8.status === 400)

// 恢复配置
if (existsSync(CFG_BACKUP)) { writeFileSync(CFG_FILE, readFileSync(CFG_BACKUP)); rmSync(CFG_BACKUP) } else { rmSync(CFG_FILE) }
rmSync(path.join(homedir(), '.dsh', 'ark9-test-out'), { recursive: true, force: true })
server.close()
console.log(`\n=== smoke-test v0.3.0: ${pass} 通过, ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
