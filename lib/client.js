/* dsh-ark9canvas — browser half.
 * Registers three additive surfaces:
 *   1. sidebar.footer.action — 「Ark9 生图」入口按钮(开关左下角浮层面板)
 *   2. shell.overlay         — 生图工作台:提示词 / 参考图 / 质量尺寸 / 生成记录 / 结果预览
 *   3. settings.section      — 图片 API 设置(baseURL / key / 模型 / 输出目录)
 * Data flows over /api/ark9-canvas-pre/* (loopback-only host routes).
 */
console.log('[dsh-ark9canvas] client v0.1.0')
window.__ModuleLoader__.load({
  id: '@deepseek-ai/dsh-ark9canvas',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect
    var useRef = React.useRef

    // ─────────────── 工具函数 ───────────────
    function api(path, opts) {
      return fetch('/api/ark9-canvas-pre' + path, {
        method: (opts && opts.method) || 'GET',
        headers: { 'content-type': 'application/json' },
        body: opts && opts.body ? JSON.stringify(opts.body) : undefined,
      }).then(function (r) { return r.json() })
    }
    function t(s) { return s } // 中文直用,不引 i18n

    // 面板几何持久化
    var GEOM_KEY = 'dsh-ark9-canvas.panel.geom'
    var DEFAULT_W = 520
    var DEFAULT_H = 640
    var DEFAULT_GAP = 16
    function defaultGeom() {
      var vw = window.innerWidth || 1280
      var vh = window.innerHeight || 800
      return { left: Math.max(DEFAULT_GAP, vw - DEFAULT_W - DEFAULT_GAP), top: DEFAULT_GAP, width: DEFAULT_W, height: DEFAULT_H }
    }
    function loadGeom() {
      try { var g = JSON.parse(localStorage.getItem(GEOM_KEY)); if (g && g.width) return g } catch (e) {}
      return defaultGeom()
    }
    function persistGeom(g) { try { localStorage.setItem(GEOM_KEY, JSON.stringify(g)) } catch (e) {} }

    // 全局状态:面板开关 + 最近一次任务 id(供结果页轮询)
    var listeners = new Set()
    var panelOpen = false
    var store = { taskId: null }
    function setPanelOpen(v) {
      panelOpen = v
      listeners.forEach(function (l) { l() })
    }
    function setTaskId(id) {
      store.taskId = id
      listeners.forEach(function (l) { l() })
    }
    function useStore() {
      var [, force] = useState(0)
      useEffect(function () {
        function upd() { force(function (x) { return x + 1 }) }
        listeners.add(upd)
        return function () { listeners.delete(upd) }
      }, [])
      return { panelOpen: panelOpen, taskId: store.taskId }
    }

    // ─────────────── 侧边栏按钮 ───────────────
    function SidebarButton() {
      var st = useStore()
      return h('button', {
        'data-ark9-sidebar-btn': true,
        onClick: function () { setPanelOpen(!st.panelOpen) },
        title: 'Ark9 生图工作台',
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px',
          borderRadius: 8, cursor: 'pointer', background: 'transparent', border: 'none',
          color: 'var(--dsw-foreground, #333)', fontSize: 13,
        },
      }, h('span', { style: { fontSize: 16 } }, '🖼️'), h('span', null, 'Ark9 生图'))
    }

    // ─────────────── 生图工作台面板 ───────────────
    var SIZES = ['auto', '1024x1024', '1536x1024', '1024x1536']
    var QUALITIES = ['auto', 'low', 'medium', 'high']
    var RATIOS = [
      { label: '1:1', w: 1024, h: 1024 },
      { label: '3:2', w: 1536, h: 1024 },
      { label: '2:3', w: 1024, h: 1536 },
    ]

    function Ark9Panel() {
      var st = useStore()
      var [cfg, setCfg] = useState(null)
      var [prompt, setPrompt] = useState('')
      var [refs, setRefs] = useState([]) // dataURL[]
      var [size, setSize] = useState('1536x1024')
      var [quality, setQuality] = useState('high')
      var [count, setCount] = useState(1)
      var [busy, setBusy] = useState(false)
      var [status, setStatus] = useState('')
      var [results, setResults] = useState([]) // {dataUrl}[]
      var [error, setError] = useState('')
      var [pollTimer, setPollTimer] = useState(null)
      var [geom, setGeom] = useState(loadGeom)

      // 载入配置
      useEffect(function () {
        api('/config').then(function (c) {
          setCfg(c)
          if (c && c.size) setSize(c.size)
          if (c && c.quality) setQuality(c.quality)
          if (c && c.count) setCount(c.count)
        }).catch(function () {})
      }, [])

      // 拖动
      var dragRef = useRef(null)
      function onDragStart(e) {
        var startX = e.clientX, startY = e.clientY
        var g0 = geom
        dragRef.current = { startX: startY, g0: g0 }
        function move(ev) {
          var dx = ev.clientX - startX, dy = ev.clientY - startY
          var g = { ...g0, left: g0.left + dx, top: Math.max(0, g0.top + dy) }
          setGeom(g)
          persistGeom(g)
        }
        function up() {
          document.removeEventListener('mousemove', move)
          document.removeEventListener('mouseup', up)
        }
        document.addEventListener('mousemove', move)
        document.addEventListener('mouseup', up)
        e.preventDefault()
      }

      function pollTask(id) {
        setBusy(true)
        setStatus('生成中…')
        setError('')
        var tries = 0
        function tick() {
          api('/task', { method: 'POST', body: { id: id } }).then(function (r) {
            if (r.status === 'succeeded') {
              api('/task-result', { method: 'POST', body: { id: id } }).then(function (rr) {
                var arr = (rr.data || []).map(function (item) {
                  if (item.b64_json) return { dataUrl: 'data:image/png;base64,' + item.b64_json }
                  return { dataUrl: item.url || '' }
                }).filter(function (x) { return x.dataUrl })
                setResults(arr)
                setBusy(false)
                setStatus('完成,共 ' + arr.length + ' 张')
              }).catch(function () { setBusy(false); setError('取结果失败') })
              return
            }
            if (r.status === 'failed') {
              setBusy(false)
              setError((r.error && r.error.message) || '生成失败')
              setStatus('')
              return
            }
            if (tries++ > 200) { setBusy(false); setStatus('超时'); return }
            pollTimer && clearTimeout(pollTimer)
            setPollTimer(setTimeout(tick, 1500))
          }).catch(function () { setBusy(false); setError('请求失败') })
        }
        tick()
      }

      function onGenerate() {
        if (!prompt.trim()) { setError('请输入提示词'); return }
        if (!cfg || !cfg.baseURL || !cfg.apiKey) { setError('请先到设置页配置图片 API(baseURL + Key + 模型)'); return }
        setError('')
        setResults([])
        setStatus('提交中…')
        api('/generate', {
          method: 'POST',
          body: { prompt: prompt, images: refs, size: size, quality: quality, count: count },
        }).then(function (r) {
          if (r.error) { setBusy(false); setError(r.error); setStatus(''); return }
          setTaskId(r.id)
          pollTask(r.id)
        }).catch(function () { setBusy(false); setError('提交失败') })
      }

      function onFileSelected(e) {
        var files = Array.prototype.slice.call(e.target.files || [])
        var readers = files.map(function (f) {
          return new Promise(function (resolve) {
            var rd = new FileReader()
            rd.onload = function () { resolve(rd.result) }
            rd.onerror = function () { resolve('') }
            rd.readAsDataURL(f)
          })
        })
        Promise.all(readers).then(function (urls) {
          setRefs(function (prev) { return prev.concat(urls.filter(Boolean)) })
        })
      }

      if (!st.panelOpen) return null
      return h('div', {
        style: {
          position: 'fixed', left: geom.left, top: geom.top, width: geom.width, height: geom.height,
          zIndex: 9999, background: 'var(--dsw-panel-bg, rgba(255,255,255,0.92))',
          border: '1px solid var(--dsw-border, #ddd)', borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column',
          overflow: 'hidden', backdropFilter: 'blur(12px)', fontFamily: 'system-ui, sans-serif', color: 'var(--dsw-foreground, #222)',
        },
      },
        // 标题栏(可拖动)
        h('div', {
          onMouseDown: onDragStart, style: {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', cursor: 'move', borderBottom: '1px solid var(--dsw-border, #eee)',
            background: 'linear-gradient(135deg, #4f8cff22, #7c5cff22)', flexShrink: 0,
          },
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 14 } },
            h('span', { style: { fontSize: 16 } }, '🖼️'),
            h('span', null, 'Ark9 生图工作台')),
          h('button', {
            onClick: function () { setPanelOpen(false) },
            style: { background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 16, color: 'inherit' },
          }, '✕')),

        // 主体(可滚动)
        h('div', { style: { flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 } },
          // 配置提示
          !cfg || !cfg.baseURL || !cfg.apiKey
            ? h('div', { style: { background: '#fff3cd', border: '1px solid #ffe08a', color: '#7a5c00', padding: '10px 12px', borderRadius: 8, fontSize: 13 } },
              '未配置图片 API。请到 设置 → Ark9 生图 填入 baseURL(OpenAI 兼容,如 https://sub.vankit.top/v1)、API Key、模型(如 gpt-image-2)。')
            : null,

          // 提示词
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h('label', { style: { fontSize: 13, fontWeight: 600 } }, '提示词'),
            h('textarea', {
              value: prompt,
              onChange: function (e) { setPrompt(e.target.value) },
              placeholder: '描述画面主体、风格、构图、光线和用途…',
              rows: 3,
              style: { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--dsw-border, #ddd)', fontSize: 13, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' },
            })),

          // 参考图
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h('label', { style: { fontSize: 13, fontWeight: 600 } }, '参考图(可选,图生图)'),
            h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
              h('input', { type: 'file', accept: 'image/*', multiple: true, onChange: onFileSelected, style: { fontSize: 12 } }),
              refs.length ? h('button', {
                onClick: function () { setRefs([]) },
                style: { background: 'transparent', border: 'none', color: '#d33', cursor: 'pointer', fontSize: 12 },
              }, '清空(' + refs.length + ')') : null),
            refs.length ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
              refs.map(function (d, i) {
                return h('img', { key: i, src: d, style: { width: 56, height: 56, objectFit: 'cover', borderRadius: 6, border: '1px solid #ddd' } })
              })) : null),

          // 参数
          h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 } },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
              h('label', { style: { fontSize: 12, color: '#666' } }, '尺寸'),
              h('select', { value: size, onChange: function (e) { setSize(e.target.value) }, style: { padding: '6px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 } },
                SIZES.map(function (s) { return h('option', { key: s, value: s }, s) }))),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
              h('label', { style: { fontSize: 12, color: '#666' } }, '质量'),
              h('select', { value: quality, onChange: function (e) { setQuality(e.target.value) }, style: { padding: '6px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 } },
                QUALITIES.map(function (s) { return h('option', { key: s, value: s }, s) }))),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
              h('label', { style: { fontSize: 12, color: '#666' } }, '张数'),
              h('select', { value: count, onChange: function (e) { setCount(Number(e.target.value)) }, style: { padding: '6px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 } },
                [1, 2, 3, 4].map(function (n) { return h('option', { key: n, value: n }, n + ' 张') })))),

          // 生成按钮
          h('button', {
            onClick: onGenerate,
            disabled: busy,
            style: {
              padding: '10px 0', borderRadius: 8, border: 'none', cursor: busy ? 'wait' : 'pointer',
              background: 'linear-gradient(135deg, #4f8cff, #7c5cff)', color: '#fff', fontWeight: 600, fontSize: 14,
              opacity: busy ? 0.7 : 1,
            },
          }, busy ? status || '生成中…' : '开始生成'),

          // 状态/错误
          status ? h('div', { style: { fontSize: 13, color: '#555', textAlign: 'center' } }, status) : null,
          error ? h('div', { style: { background: '#fde8e8', border: '1px solid #f5c2c2', color: '#b91c1c', padding: '8px 10px', borderRadius: 8, fontSize: 13, wordBreak: 'break-all' } }, error) : null,

          // 结果
          results.length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
            h('div', { style: { fontSize: 13, fontWeight: 600 } }, '生成结果'),
            results.map(function (r, i) {
              return h('div', { key: i, style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                h('img', { src: r.dataUrl, style: { width: '100%', borderRadius: 8, border: '1px solid #ddd' } }),
                h('a', { href: r.dataUrl, download: 'ark9-' + i + '.png', style: { fontSize: 12, color: '#4f8cff', textAlign: 'center' } }, '下载第 ' + (i + 1) + ' 张'))
            })) : null,
        ),
      )
    }

    // ─────────────── 设置页 ───────────────
    function SettingsPage(props) {
      var [cfg, setCfg] = useState(null)
      var [models, setModels] = useState([])
      var [saved, setSaved] = useState(false)
      var close = props && props.close
      useEffect(function () {
        api('/config').then(function (c) { setCfg(c) }).catch(function () {})
      }, [])
      function upd(k, v) { setCfg(function (prev) { return { ...prev, [k]: v } }) }
      function onSave() {
        api('/config', { method: 'POST', body: cfg }).then(function (r) {
          if (r.ok) { setSaved(true); setTimeout(function () { setSaved(false) }, 2000) }
        })
      }
      function onFetchModels() {
        api('/models').then(function (r) {
          if (r.models) setModels(r.models)
          if (r.error) alert('拉取模型失败: ' + r.error)
        }).catch(function () { alert('拉取模型失败') })
      }
      if (!cfg) return h('div', { style: { padding: 20 } }, '加载中…')
      return h('div', { style: { padding: 20, display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560 } },
        h('h2', { style: { margin: 0, fontSize: 18, fontWeight: 700 } }, 'Ark9 生图设置'),
        h('p', { style: { fontSize: 13, color: '#666', margin: 0 } }, '配置 OpenAI 兼容图片 API。baseURL 需含 /v1(如 https://sub.vankit.top/v1)。支持文生图(/images/generations)与图生图(/images/edits)。'),
        h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 } },
          'BaseURL(含 /v1)',
          h('input', { value: cfg.baseURL || '', onChange: function (e) { upd('baseURL', e.target.value) }, placeholder: 'https://sub.vankit.top/v1', style: { padding: '8px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 } })),
        h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 } },
          'API Key',
          h('input', { value: cfg.apiKey || '', onChange: function (e) { upd('apiKey', e.target.value) }, placeholder: 'sk-...', type: 'password', style: { padding: '8px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 } })),
        h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 } },
          '模型',
          h('div', { style: { display: 'flex', gap: 8 } },
            h('input', { value: cfg.model || '', onChange: function (e) { upd('model', e.target.value) }, placeholder: 'gpt-image-2', style: { flex: 1, padding: '8px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 } }),
            h('button', { onClick: onFetchModels, style: { padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: 13 } }, '拉取模型列表'))),
        models.length ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
          models.map(function (m) {
            return h('button', {
              key: m.id, onClick: function () { upd('model', m.id) },
              style: {
                padding: '4px 10px', borderRadius: 16, border: '1px solid #4f8cff', background: cfg.model === m.id ? '#4f8cff' : '#fff',
                color: cfg.model === m.id ? '#fff' : '#4f8cff', cursor: 'pointer', fontSize: 12,
              },
            }, m.name || m.id)
          })) : null,
        h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 } },
          '输出目录(留空=~/Pictures/ark9-canvas)',
          h('input', { value: cfg.outputDir || '', onChange: function (e) { upd('outputDir', e.target.value) }, placeholder: '留空使用默认', style: { padding: '8px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 } })),
        h('div', { style: { display: 'flex', gap: 10 } },
          h('button', { onClick: onSave, style: { padding: '10px 24px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #4f8cff, #7c5cff)', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 14 } }, '保存'),
          saved ? h('span', { style: { color: '#16a34a', fontSize: 13, alignSelf: 'center' } }, '✓ 已保存') : null,
          close ? h('button', { onClick: close, style: { padding: '10px 24px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: 14 } }, '关闭') : null),
      )
    }

    // ─────────────── 注册 surface ───────────────
    var surfaceDisposers = []
    function mount(slots) {
      surfaceDisposers.push(slots.inject('sidebar.footer.action', function () {
        return slots.register({ name: 'sidebar.footer.action', id: 'ark9-canvas-pre', order: 4, label: 'Ark9 生图' }, function () { return h(SidebarButton) })
      }))
      surfaceDisposers.push(slots.inject('shell.overlay', function () {
        return slots.register({ name: 'shell.overlay', id: 'ark9-canvas-pre', order: 4 }, function () { return h(Ark9Panel) })
      }))
      surfaceDisposers.push(slots.inject('settings.section', function () {
        return slots.register({ name: 'settings.section', id: 'ark9-canvas-pre', order: 30, label: 'Ark9 生图' }, function (props) { return h(SettingsPage, { close: props && props.close }) })
      }))
    }
    var slots = null
    try { slots = require('@deepseek-ai/dsh-client-ui-slots') } catch (e) {}
    if (slots && slots.inject) {
      mount(slots)
    } else {
      // slots 未就绪则延迟挂载
      var ready = function () {
        try {
          var s2 = require('@deepseek-ai/dsh-client-ui-slots')
          if (s2 && s2.inject) { mount(s2) }
        } catch (e) {}
      }
      setTimeout(ready, 300)
      setTimeout(ready, 1500)
    }
    exports.default = { mount: mount }
    return module.exports
  },
})
