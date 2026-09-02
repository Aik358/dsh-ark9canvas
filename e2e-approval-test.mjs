// 真实端到端验证:Agent 工具 → 审批(主进程内模拟用户批准) → 真实图片 API 出图。
// low 质量 1024x1024 单张,最小成本。
import { apply, API } from './lib/index.js'
import http from 'node:http'

const tools = [], routes = []
const ctx = {
  tools: { register(t) { tools.push(t); return () => {} } },
  webServer: { register(r) { routes.push(r); return () => {} } },
  systemPrompt: { section() { return () => {} }, context() { return () => {} } },
  effect() {},
}
apply(ctx)
const tool = tools.find((t) => t.name === 'ark9_generate_image')

// 主进程挂 HTTP(模拟宿主路由),供审批模拟走真实协议
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const route = routes.find((r) => r.path === url.pathname)
  if (!route) { res.writeHead(404); res.end(); return }
  req.headers.host = '127.0.0.1:8080'
  req.headers['sec-fetch-site'] = 'same-origin'
  await route.handler(req, res)
})
await new Promise((r) => server.listen(8082, '127.0.0.1', r))

const get = (p) => new Promise((res2) => http.get('http://127.0.0.1:8082' + p, (r) => { let b = ''; r.on('data', (c) => b += c); r.on('end', () => res2(b)) }))
const post = (p, body) => new Promise((res2) => { const data = JSON.stringify(body); const rq = http.request('http://127.0.0.1:8082' + p, { method: 'POST', headers: { 'content-type': 'application/json' } }, (r) => { let b = ''; r.on('data', (c) => b += c); r.on('end', () => res2(b)) }); rq.write(data); rq.end() })

// 模拟用户:2s 后轮询审批队列并批准
const fakeUser = setTimeout(async () => {
  for (let i = 0; i < 20; i++) {
    try {
      const list = JSON.parse(await get(API.approvals))
      if (list.approvals && list.approvals.length) {
        const ap = list.approvals[0]
        await post(API.approvals, { id: ap.id, decision: 'approve' })
        console.log('[审批模拟] 已批准:', ap.id, '-', ap.prompt.slice(0, 40))
        return
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  console.log('[审批模拟] 20 次轮询都没等到审批请求(异常)')
}, 2000)

console.log('→ Agent 发起生图(审批模式,应等待批准后执行)…')
const t0 = Date.now()
const result = await tool.execute({
  prompt: 'a tiny cute robot holding a blue paintbrush, minimal flat style, white background',
  size: '1024x1024', quality: 'low', count: 1,
}, {})
console.log('→ 工具返回(耗时 ' + Math.round((Date.now() - t0) / 1000) + 's):')
console.log(result.slice(0, 600))
clearTimeout(fakeUser)
server.close()
process.exit(result.includes('生成成功') ? 0 : 1)
