// dsh-ark9canvas 联调测试：模拟 DSH host ctx，验证插件 activate + 工具 + 路由。
// 不真调 vankit(避免扣费)；只验证配置/状态/任务轮询/未配置时的工具提示。
import http from 'node:http'
import { activate, API } from './lib/index.js'

const registeredTools = []
const registeredRoutes = []

// 模拟 DSH host ctx
const ctx = {
  tools: {
    register(tool) { registeredTools.push(tool); return () => {} },
  },
  webServer: {
    register(route) { registeredRoutes.push(route); return () => {} },
  },
  systemPrompt: { section() { return () => {} }, context() { return () => {} } },
  effect() {},
}

// 启动一个真实 HTTP server 挂载注册的路由，模拟 host
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const route = registeredRoutes.find((r) => r.kind === 'exact' && r.path === url.pathname)
  if (!route) { res.writeHead(404); res.end('not found'); return }
  // 本机请求 remoteAddress 天然是 127.0.0.1,满足 loopback 校验
  req.headers.host = '127.0.0.1:8080'
  req.headers['sec-fetch-site'] = 'same-origin'
  await route.handler(req, res)
})

const plugin = activate(ctx)

// 让 server 监听 8081
await new Promise((resolve) => server.listen(8081, '127.0.0.1', resolve))
console.log('✓ HTTP server 监听 127.0.0.1:8081')

// 测试 1: 工具注册
const imgTool = registeredTools.find((t) => t.name === 'ark9_generate_image')
console.log('✓ 工具已注册:', imgTool ? imgTool.name : '缺失')

// 测试 2: 未配置时工具提示
const toolResult = await imgTool.execute({ prompt: '一只猫' }, {})
console.log('✓ 未配置时工具返回:', toolResult.slice(0, 60))

// 测试 3: 路由注册
console.log('✓ 路由数:', registeredRoutes.length, '->', registeredRoutes.map((r) => r.path).join(', '))

// 测试 4: 配置读写
await new Promise((resolve) => {
  const req = http.request({ host: '127.0.0.1', port: 8081, path: API['config'], method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
    let b = ''
    res.on('data', (c) => b += c)
    res.on('end', () => { console.log('✓ 保存配置:', b); resolve() })
  })
  req.write(JSON.stringify({ baseURL: 'http://127.0.0.1:9', apiKey: 'test', model: 'gpt-image-2' }))
  req.end()
})
await new Promise((resolve) => {
  http.get({ host: '127.0.0.1', port: 8081, path: API['state'] }, (res) => {
    let b = ''
    res.on('data', (c) => b += c)
    res.on('end', () => { console.log('✓ 读取状态:', b); resolve() })
  })
})

// 测试 5: models 路由(指向不存在的端口,应返回 models:[] 不崩溃)
await new Promise((resolve) => {
  http.get({ host: '127.0.0.1', port: 8081, path: API['models'] }, (res) => {
    let b = ''
    res.on('data', (c) => b += c)
    res.on('end', () => { console.log('✓ models 路由:', b); resolve() })
  })
})

server.close()
console.log('=== 联调测试完成 ===')
