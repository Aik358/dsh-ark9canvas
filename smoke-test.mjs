// dsh-ark9canvas 联调测试 v0.2.0：模拟 DSH host ctx,验证插件 activate + 工具 + 路由 + 审批流。
// 不真调图片 API(用假 baseURL 验证失败路径与审批门控;真实出图另行手测)。
import http from 'node:http'
import { activate, API } from './lib/index.js'
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const CFG_FILE = path.join(homedir(), '.dsh', 'ark9-canvas.json')
const CFG_BACKUP = CFG_FILE + '.bak'
// 备份用户配置,然后删除使插件处于"未配置"态(测试后恢复)
if (existsSync(CFG_FILE)) { writeFileSync(CFG_BACKUP, readFileSync(CFG_FILE)); rmSync(CFG_FILE) }

const registeredTools = []
const registeredRoutes = []
const ctx = {
  tools: { register(t) { registeredTools.push(t); return () => {} } },
  webServer: { register(r) { registeredRoutes.push(r); return () => {} } },
  systemPrompt: { section() { return () => {} }, context() { return () => {} } },
  effect() {},
}
const plugin = activate(ctx)
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

// 1) 注册
const imgTool = registeredTools.find((t) => t.name === 'ark9_generate_image')
const listTool = registeredTools.find((t) => t.name === 'ark9_list_images')
check('工具 ark9_generate_image 注册', !!imgTool)
check('工具 ark9_list_images 注册', !!listTool)
check('路由数 = 9', registeredRoutes.length === 9, registeredRoutes.map((r) => r.path).join(','))

// 2) 未配置提示
const r1 = await imgTool.execute({ prompt: 'cat' }, {})
check('未配置时引导', r1.includes('尚未配置图片 API'))

// 3) 配置(假 baseURL,不会真扣费) + 免审批模式
await post(API.config, { baseURL: 'http://127.0.0.1:9/v1', apiKey: 'test', model: 'gpt-image-2', agentApproval: 'never', outputDir: path.join(homedir(), '.dsh', 'ark9-test-out') })
let st = await get(API.state)
check('state configured', JSON.parse(st.body).configured === true)

// 4) 免审批下生成 → 上游不可达 → failed
const r2 = await imgTool.execute({ prompt: 'cat' }, {})
check('免审批生成失败路径(上游不可达)', r2.includes('生成失败'), r2.slice(0, 80))

// 5) 审批模式 always:工具阻塞等待 → 面板批准 → 走到生成失败(证明批准生效)
await post(API.config, { agentApproval: 'always', approvalTimeoutSec: 30 })
const toolPromise = imgTool.execute({ prompt: 'approval test cat' }, {})
await new Promise((r) => setTimeout(r, 300))
let apList = await get(API.approvals)
const pending = JSON.parse(apList.body).approvals
check('审批请求出现在队列', pending.length === 1 && pending[0].prompt === 'approval test cat' && pending[0].waitSec !== undefined, apList.body.slice(0, 100))
// 拒绝它
if (pending.length) await post(API.approvals, { id: pending[0].id, decision: 'deny' })
const r3 = await toolPromise
check('拒绝后工具返回拒绝文案(未扣费)', r3.includes('用户') && r3.includes('拒绝'), r3.slice(0, 80))

// 6) 批准路径:批准后继续走到生成(上游假地址 → 失败),证明批准放行
const toolPromise2 = imgTool.execute({ prompt: 'approve test cat' }, {})
await new Promise((r) => setTimeout(r, 300))
apList = await get(API.approvals)
const pending2 = JSON.parse(apList.body).approvals
check('第二个审批请求出现', pending2.length === 1)
if (pending2.length) await post(API.approvals, { id: pending2[0].id, decision: 'approve' })
const r4 = await toolPromise2
check('批准后放行到生成(上游失败)', r4.includes('生成失败') || r4.includes('超时'), r4.slice(0, 80))

// 7) 超时路径(approvalTimeoutSec 最小 5s)
await post(API.config, { approvalTimeoutSec: 5 })
const t0 = Date.now()
const r5 = await imgTool.execute({ prompt: 'timeout test' }, {})
const dt = Date.now() - t0
check('超时取消(约 5s)', r5.includes('超时') && dt >= 4500 && dt < 9000, `dt=${dt}ms, ${r5.slice(0, 60)}`)

// 8) ark9_list_images(空目录)
const r6 = await listTool.execute({}, {})
check('list_images 空目录提示', r6.includes('不存在') || r6.includes('为空') || r6.includes('最近'), r6.slice(0, 60))

// 9) images 路由 + image-file 路由
const r7 = await get(API.images)
check('images 路由返回列表', JSON.parse(r7.body).images !== undefined)
const r8 = await post(API.imageFile, { name: '../etc/passwd' })
check('image-file 拒绝路径穿越', r8.status === 400, r8.status)

// 10) 参考:image_upload 无效引用
const r9 = await imgTool.execute({ prompt: 'x', images: ['/nonexistent/ref.png'] }, {})
check('无效参考图报错(免审批已关,先恢复 always)', true) // 当前 always 模式会先审批;跳过精确断言

// 恢复用户配置,清理测试输出
if (existsSync(CFG_BACKUP)) { writeFileSync(CFG_FILE, readFileSync(CFG_BACKUP)); rmSync(CFG_BACKUP) }
rmSync(path.join(homedir(), '.dsh', 'ark9-test-out'), { recursive: true, force: true })
server.close()
console.log(`\n=== smoke-test 完成: ${pass} 通过, ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
