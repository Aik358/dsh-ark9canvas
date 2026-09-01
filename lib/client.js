/* dsh-ark9canvas — browser half.
 * Registers three additive surfaces (same mechanism as dsh-cua-pre):
 *   1. floating FAB (fixed, right-bottom corner — decoupled from third-party sidebar;
 *      auto-stacks above dsh-cua's FAB when both installed)
 *   2. Better Sidebar tab (if host provides ctx.get('betterSidebar')) — replaces FAB
 *   3. settings.section      — 「Ark9 生图」设置页(API / 安全(审批) / 输出)
 * Panel content is one vanilla-DOM implementation shared by floating panel and
 * sidebar inline tab. Data flows over /api/ark9-canvas-pre/* (loopback-only).
 */
console.log('[dsh-ark9canvas] client v0.2.0 loading')
window.__ModuleLoader__.load({
  id: '@a9i5k4/dsh-ark9canvas',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect
    var useRef = React.useRef

    var API = {
      state: '/api/ark9-canvas-pre/state',
      config: '/api/ark9-canvas-pre/config',
      generate: '/api/ark9-canvas-pre/generate',
      task: '/api/ark9-canvas-pre/task',
      taskResult: '/api/ark9-canvas-pre/task-result',
      approvals: '/api/ark9-canvas-pre/approvals',
      images: '/api/ark9-canvas-pre/images',
      imageFile: '/api/ark9-canvas-pre/image-file',
      models: '/api/ark9-canvas-pre/models',
    }
    function apiGet(path) {
      return fetch(path).then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json() })
    }
    function apiPost(path, body) {
      return fetch(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      }).then(function (r) { return r.json() })
    }

    // ───────────────────────── 主题令牌(对齐 dsh-cua 玻璃风) ─────────────────────────
    var GLASS_BG = 'rgba(22,26,34,0.94)'
    var GLASS_BORDER = 'rgba(255,255,255,0.16)'
    var FG = '#e8eaf0'
    var MUTED = 'rgba(232,234,240,0.55)'
    var ACCENT = 'rgba(121,192,255,0.25)'
    var ACCENT_SOLID = '#79c0ff'
    var OK_BG = 'rgba(76,175,80,0.25)'
    var ERR_BG = 'rgba(244,67,54,0.22)'

    var SIZES = ['auto', '1024x1024', '1536x1024', '1024x1536']
    var QUALITIES = ['auto', 'low', 'medium', 'high']

    // ───────────────────────── 面板共享状态(浮窗/inline 各自独立实例) ─────────────────────────
    function buildPanelState() {
      return { tab: 'generate', prompt: '', refs: [], size: '1536x1024', quality: 'high', count: 1, busy: false, status: '', error: '', results: [], cfg: null, histPreview: '', pollTimer: null }
    }

    // ───────────────────────── 核心:vanilla DOM 面板内容(浮窗与 sidebar tab 共用) ─────────────────────────
    // container: 已挂到 DOM 的空 div(inline 时由 React wrapper 提供)
    // opts: { inline: true } 时去掉 fixed 定位,高度撑满父容器。
    // 返回 cleanup 函数。
    function mountPanelContent(container, opts) {
      var inline = !!(opts && opts.inline)
      var st = buildPanelState()
      var disposed = false
      var root = document.createElement('div')
      root.style.cssText = inline
        ? 'display:flex;flex-direction:column;height:100%;min-height:0;color:' + FG + ';font:13px/1.6 system-ui;'
        : 'display:flex;flex-direction:column;height:100%;min-height:0;color:' + FG + ';font:13px/1.6 system-ui;'
      container.appendChild(root)

      // 头部
      var header = document.createElement('div')
      header.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.1);font-weight:700;font-size:13px;flex-shrink:0;'
      var icon = document.createElement('span'); icon.textContent = '🖼️'; header.appendChild(icon)
      var title = document.createElement('span'); title.textContent = 'Ark9 生图'; header.appendChild(title)
      var badge = document.createElement('span')
      badge.style.cssText = 'display:none;background:' + ERR_BG + ';border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;'
      header.appendChild(badge)
      var sp = document.createElement('span'); sp.style.cssText = 'flex:1'; header.appendChild(sp)
      if (!inline) {
        var closeBtn = document.createElement('button')
        closeBtn.textContent = '✕'
        closeBtn.style.cssText = 'background:transparent;border:0;color:inherit;opacity:.7;cursor:pointer;font-size:18px;'
        closeBtn.onclick = function () { setPanelOpen(false) }
        header.appendChild(closeBtn)
      }
      root.appendChild(header)

      // 页签
      var tabsRow = document.createElement('div')
      tabsRow.style.cssText = 'display:flex;gap:6px;padding:8px 10px 0;flex-shrink:0;'
      var TABS = [['generate', '生成'], ['approvals', '审批'], ['history', '记录'], ['about', '说明']]
      var tabBtns = {}
      TABS.forEach(function (t) {
        var b = document.createElement('button')
        b.textContent = t[1]
        b.style.cssText = tabBtnCss(false)
        b.onclick = function () { st.tab = t[0]; renderTab() }
        tabBtns[t[0]] = b
        tabsRow.appendChild(b)
      })
      root.appendChild(tabsRow)

      // 主体
      var body = document.createElement('div')
      body.style.cssText = 'flex:1;overflow-y:auto;padding:12px 14px 14px;min-height:0;'
      root.appendChild(body)

      function tabBtnCss(active) {
        return 'padding:6px 14px;border:0;border-radius:999px;cursor:pointer;font-size:12px;' +
          'background:' + (active ? ACCENT : 'rgba(255,255,255,0.08)') + ';color:' + (active ? '#fff' : MUTED) + ';'
      }
      function el(tag, cssText, text) {
        var e = document.createElement(tag)
        if (cssText) e.style.cssText = cssText
        if (text !== undefined) e.textContent = text
        return e
      }

      // ---- 生成页 ----
      function renderGenerate() {
        body.innerHTML = ''
        if (!st.cfg || !st.cfg.baseURL || !st.cfg.apiKey) {
          var warn = el('div', 'background:rgba(255,193,7,0.15);border:1px solid rgba(255,193,7,0.4);color:#ffe08a;padding:8px 10px;border-radius:8px;font-size:12px;margin-bottom:10px;',
            '未配置图片 API。请到 设置 → Ark9 生图 填 baseURL(OpenAI 兼容,含 /v1)、Key、模型。')
          body.appendChild(warn)
        }
        // 提示词
        var lb1 = el('div', 'font-weight:600;margin-bottom:4px;', '提示词')
        body.appendChild(lb1)
        var ta = el('textarea')
        ta.value = st.prompt
        ta.placeholder = '描述画面主体、风格、构图、光线和用途…'
        ta.rows = 4
        ta.style.cssText = 'width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.06);color:inherit;font:inherit;resize:vertical;'
        ta.oninput = function () { st.prompt = ta.value }
        body.appendChild(ta)
        // 参考图
        var lb2 = el('div', 'font-weight:600;margin:10px 0 4px;', '参考图(可选,图生图)')
        body.appendChild(lb2)
        var refRow = el('div', 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;')
        var file = document.createElement('input')
        file.type = 'file'; file.accept = 'image/*'; file.multiple = true
        file.style.cssText = 'font-size:12px;max-width:220px;'
        file.onchange = function () {
          var files = Array.prototype.slice.call(file.files || [])
          var left = 4 - st.refs.length
          files.slice(0, Math.max(0, left)).forEach(function (f) {
            var rd = new FileReader()
            rd.onload = function () { if (rd.result) { st.refs.push(rd.result); renderRefs() } }
            rd.readAsDataURL(f)
          })
          file.value = ''
        }
        refRow.appendChild(file)
        var clearBtn = el('button', 'background:transparent;border:0;color:#ff8a80;cursor:pointer;font-size:12px;', '清空')
        clearBtn.onclick = function () { st.refs = []; renderRefs() }
        refRow.appendChild(clearBtn)
        body.appendChild(refRow)
        var refThumbs = el('div', 'display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;')
        body.appendChild(refThumbs)
        function renderRefs() {
          refThumbs.innerHTML = ''
          st.refs.forEach(function (d, i) {
            var im = document.createElement('img')
            im.src = d
            im.style.cssText = 'width:52px;height:52px;object-fit:cover;border-radius:6px;border:1px solid rgba(255,255,255,0.2);cursor:pointer;'
            im.title = '点击移除'
            im.onclick = function () { st.refs.splice(i, 1); renderRefs() }
            refThumbs.appendChild(im)
          })
        }
        renderRefs()
        // 参数行
        var paramRow = el('div', 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin:10px 0;')
        function mkSelect(label, values, cur, onchg) {
          var box = el('div')
          var lb = el('div', 'font-size:11px;color:' + MUTED + ';margin-bottom:2px;', label)
          box.appendChild(lb)
          var s = document.createElement('select')
          s.style.cssText = 'width:100%;padding:5px;border-radius:6px;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.08);color:inherit;font-size:12px;'
          values.forEach(function (v) {
            var o = document.createElement('option'); o.value = String(v.v || v); o.textContent = String(v.label || v)
            s.appendChild(o)
          })
          s.value = String(cur)
          s.onchange = function () { onchg(s.value) }
          box.appendChild(s)
          return box
        }
        paramRow.appendChild(mkSelect('尺寸', SIZES, st.size, function (v) { st.size = v }))
        paramRow.appendChild(mkSelect('质量', QUALITIES, st.quality, function (v) { st.quality = v }))
        paramRow.appendChild(mkSelect('张数', [1, 2, 3, 4].map(function (n) { return { v: n, label: n + ' 张' } }), st.count, function (v) { st.count = Number(v) }))
        body.appendChild(paramRow)
        // 生成按钮
        var genBtn = el('button', 'width:100%;padding:9px 0;border:0;border-radius:8px;cursor:pointer;font-weight:600;font-size:13px;background:linear-gradient(135deg,#4f8cff,#7c5cff);color:#fff;', '开始生成')
        genBtn.onclick = function () { doGenerate() }
        body.appendChild(genBtn)
        // 状态
        var statusLine = el('div', 'font-size:12px;color:' + MUTED + ';text-align:center;margin-top:8px;min-height:16px;', st.status || '')
        body.appendChild(statusLine)
        var errBox = el('div', 'display:none;background:' + ERR_BG + ';padding:8px 10px;border-radius:8px;font-size:12px;margin-top:8px;word-break:break-all;')
        body.appendChild(errBox)
        // 结果
        var resultBox = el('div', 'display:flex;flex-direction:column;gap:10px;margin-top:10px;')
        body.appendChild(resultBox)

        function syncStatus() { statusLine.textContent = st.status || ''; errBox.style.display = st.error ? 'block' : 'none'; errBox.textContent = st.error }
        function renderResults() {
          resultBox.innerHTML = ''
          st.results.forEach(function (r, i) {
            var im = document.createElement('img')
            im.src = r.dataUrl
            im.style.cssText = 'width:100%;border-radius:8px;border:1px solid rgba(255,255,255,0.15);'
            resultBox.appendChild(im)
            var dl = el('a', 'font-size:12px;color:' + ACCENT_SOLID + ';text-align:center;text-decoration:none;', '下载第 ' + (i + 1) + ' 张')
            dl.href = r.dataUrl
            dl.download = 'ark9-' + Date.now() + '-' + i + '.png'
            resultBox.appendChild(dl)
          })
        }
        if (st.results.length) renderResults()

        function doGenerate() {
          if (st.busy) return
          if (!st.prompt.trim()) { st.error = '请输入提示词'; syncStatus(); return }
          if (!st.cfg || !st.cfg.baseURL || !st.cfg.apiKey) { st.error = '请先在设置页配置图片 API'; syncStatus(); return }
          st.error = ''; st.results = []; resultBox.innerHTML = ''
          st.busy = true; st.status = '提交中…'; genBtn.textContent = '生成中…'; genBtn.style.opacity = '0.7'; syncStatus()
          apiPost(API.generate, { prompt: st.prompt, images: st.refs, size: st.size, quality: st.quality, count: st.count })
            .then(function (r) {
              if (r.error) throw new Error(r.error)
              poll(r.id, 0)
            })
            .catch(function (e) { st.busy = false; st.status = ''; st.error = '提交失败: ' + e.message; genBtn.textContent = '开始生成'; genBtn.style.opacity = '1'; syncStatus() })
        }
        function poll(id, n) {
          if (disposed) return
          apiPost(API.task, { id: id }).then(function (r) {
            if (r.status === 'succeeded') {
              return apiPost(API.taskResult, { id: id }).then(function (rr) {
                st.results = (rr.data || []).map(function (it) {
                  return { dataUrl: it.b64_json ? 'data:image/png;base64,' + it.b64_json : (it.url || '') }
                }).filter(function (x) { return x.dataUrl })
                st.busy = false; st.status = '完成,共 ' + st.results.length + ' 张'
                genBtn.textContent = '开始生成'; genBtn.style.opacity = '1'
                syncStatus(); renderResults()
              })
            }
            if (r.status === 'failed') {
              st.busy = false; st.status = ''; st.error = (r.error && r.error.message) || '生成失败'
              genBtn.textContent = '开始生成'; genBtn.style.opacity = '1'; syncStatus(); return
            }
            if (n > 200) { st.busy = false; st.status = '超时'; genBtn.textContent = '开始生成'; genBtn.style.opacity = '1'; syncStatus(); return }
            st.status = '生成中…(' + n * 2 + 's)'; syncStatus()
            st.pollTimer = setTimeout(function () { poll(id, n + 1) }, 2000)
          }).catch(function () {
            st.pollTimer = setTimeout(function () { poll(id, n + 1) }, 2500)
          })
        }
      }

      // ---- 审批页 ----
      function renderApprovals() {
        body.innerHTML = ''
        var tip = el('div', 'font-size:12px;color:' + MUTED + ';margin-bottom:10px;', 'Agent 发起的生图请求会出现在这里,等待你批准。批准后才开始生成(才会计费)。')
        body.appendChild(tip)
        var listBox = el('div', 'display:flex;flex-direction:column;gap:10px;')
        body.appendChild(listBox)
        function refresh() {
          if (disposed) return
          apiGet(API.approvals).then(function (r) {
            if (disposed) return
            listBox.innerHTML = ''
            var list = r.approvals || []
            if (!list.length) {
              listBox.appendChild(el('div', 'color:' + MUTED + ';font-size:12px;text-align:center;padding:20px 0;', '暂无待审批请求'))
              return
            }
            list.forEach(function (a) {
              var card = el('div', 'border:1px solid rgba(255,255,255,0.14);border-radius:10px;padding:10px;background:rgba(255,255,255,0.04);')
              var head = el('div', 'font-weight:600;font-size:12px;margin-bottom:4px;', 'Agent 生图请求 · 已等待 ' + a.waitSec + 's')
              card.appendChild(head)
              var p = el('div', 'font-size:12px;margin-bottom:6px;word-break:break-all;', a.prompt)
              p.style.maxHeight = '72px'; p.style.overflow = 'auto'
              card.appendChild(p)
              var meta = el('div', 'font-size:11px;color:' + MUTED + ';margin-bottom:8px;',
                [a.params && a.params.model, a.params && a.params.size, a.params && a.params.quality, (a.params && a.params.count) + ' 张', a.params && a.params.refs ? '参考图 x' + a.params.refs : ''].filter(Boolean).join(' · '))
              card.appendChild(meta)
              var btnRow = el('div', 'display:flex;gap:8px;')
              var ok = el('button', 'flex:1;padding:6px 0;border:0;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;background:' + OK_BG + ';color:#a5d6a7;', '✓ 批准')
              ok.onclick = function () { decide(a.id, 'approve') }
              var no = el('button', 'flex:1;padding:6px 0;border:0;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;background:' + ERR_BG + ';color:#ff8a80;', '✕ 拒绝')
              no.onclick = function () { decide(a.id, 'deny') }
              btnRow.appendChild(ok); btnRow.appendChild(no)
              card.appendChild(btnRow)
              listBox.appendChild(card)
            })
          }).catch(function () {})
        }
        function decide(id, decision) {
          apiPost(API.approvals, { id: id, decision: decision }).then(function () { refresh(); refreshBadge() })
        }
        refresh()
        var timer = setInterval(refresh, 2500)
        if (st.pollTimer) clearTimeout(st.pollTimer)
        st.pollTimer = timer
      }

      // ---- 记录页 ----
      function renderHistory() {
        body.innerHTML = ''
        var listBox = el('div', 'display:flex;flex-direction:column;gap:6px;')
        body.appendChild(listBox)
        var preview = el('div', 'margin-top:10px;')
        body.appendChild(preview)
        apiGet(API.images).then(function (r) {
          listBox.innerHTML = ''
          var list = r.images || []
          if (!list.length) { listBox.appendChild(el('div', 'color:' + MUTED + ';font-size:12px;text-align:center;padding:20px 0;', '还没有生成记录')); return }
          listBox.appendChild(el('div', 'font-size:11px;color:' + MUTED + ';margin-bottom:4px;', '保存于 ' + (r.dir || '')))
          list.forEach(function (it) {
            var row = el('div', 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer;background:rgba(255,255,255,0.04);')
            var nm = el('div', 'flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', it.name)
            var meta = el('div', 'font-size:11px;color:' + MUTED + ';white-space:nowrap;', it.sizeKB + 'KB · ' + new Date(it.mtime).toLocaleString())
            row.appendChild(nm); row.appendChild(meta)
            row.onclick = function () {
              preview.innerHTML = ''
              var im = document.createElement('img')
              im.style.cssText = 'width:100%;border-radius:8px;border:1px solid rgba(255,255,255,0.15);'
              im.alt = it.name
              preview.appendChild(im)
              apiPost(API.imageFile, { name: it.name }).then(function (rr) {
                if (rr.dataUrl) im.src = rr.dataUrl
              })
            }
            listBox.appendChild(row)
          })
        }).catch(function () {
          listBox.appendChild(el('div', 'color:' + MUTED + ';font-size:12px;', '读取失败(宿主未就绪?)'))
        })
      }

      // ---- 说明页 ----
      function renderAbout() {
        body.innerHTML = ''
        var box = el('div', 'font-size:12px;line-height:1.8;color:' + MUTED + ';')
        box.appendChild(el('div', null, 'Ark9 生图 — DSH 生图插件(独立实现,OpenAI 兼容图片 API)。'))
        box.appendChild(el('div', { style: { marginTop: '8px' } }, '· 「生成」页:手动生图(你的操作,无需审批,直接计费)。'))
        box.appendChild(el('div', null, '· 「审批」页:Agent 发起的生图默认在这里等你批准(设置页可改免审批/超时)。'))
        box.appendChild(el('div', null, '· 「记录」页:输出目录的历史图片,点击预览。'))
        box.appendChild(el('div', null, '· Agent 侧工具:ark9_generate_image / ark9_list_images。'))
        box.appendChild(el('div', { style: { marginTop: '8px' } }, '· 若安装了 dsh-better-sidebar,本面板会注册为侧栏页签,而非悬浮窗。'))
        body.appendChild(box)
      }

      function renderTab() {
        TABS.forEach(function (t) { tabBtns[t[0]].style.cssText = tabBtnCss(st.tab === t[0]) })
        if (st.pollTimer) { clearInterval(st.pollTimer); if (st.pollTimer._interval) {} try { clearInterval(st.pollTimer) } catch (_) {} clearTimeout(st.pollTimer); st.pollTimer = null }
        if (st.tab === 'generate') renderGenerate()
        else if (st.tab === 'approvals') renderApprovals()
        else if (st.tab === 'history') renderHistory()
        else renderAbout()
      }

      // 配置加载 + 首渲染
      apiGet(API.config).then(function (c) { st.cfg = c }).catch(function () {})
      renderTab()

      // 审批徽标刷新(FAB 用;头部 badge 也顺带更新)
      function refreshBadge() {
        apiGet(API.state).then(function (s) {
          var n = s.pendingApprovals || 0
          if (n > 0) {
            badge.style.display = 'inline-block'
            badge.textContent = n + ' 待审批'
          } else {
            badge.style.display = 'none'
          }
        }).catch(function () {})
      }
      var badgeTimer = setInterval(refreshBadge, 5000)
      refreshBadge()

      return function cleanup() {
        disposed = true
        clearInterval(badgeTimer)
        if (st.pollTimer) { clearInterval(st.pollTimer); clearTimeout(st.pollTimer) }
        try { container.innerHTML = '' } catch (_) {}
      }
    }

    // ───────────────────────── 浮窗(直挂 body,不依赖任何侧栏槽) ─────────────────────────
    var panelRoot = null
    var panelMounted = false
    var panelOpen = false
    var panelCleanup = null
    var uiListeners = new Set()

    function cuaFabPresent() { return !!document.getElementById('cua-fab-root') }
    function fabBottom() { return cuaFabPresent() ? 148 : 96 }
    function panelBottom() { return fabBottom() + 56 }

    function ensurePanelRoot() {
      var m = document.getElementById('ark9-panel-root')
      if (m) { panelRoot = m; return m }
      m = document.createElement('div')
      m.id = 'ark9-panel-root'
      m.style.cssText =
        'position:fixed;right:16px;bottom:' + panelBottom() + 'px;z-index:9997;' +
        'width:420px;max-width:calc(100vw - 32px);height:min(72vh,640px);' +
        'display:none;flex-direction:column;overflow:hidden;' +
        'border-radius:16px;border:1px solid ' + GLASS_BORDER + ';' +
        'background:' + GLASS_BG + ';backdrop-filter:blur(22px) saturate(1.35);' +
        '-webkit-backdrop-filter:blur(22px) saturate(1.35);' +
        'box-shadow:0 16px 48px rgba(0,0,0,0.45);'
      document.body.appendChild(m)
      panelRoot = m
      return m
    }
    function setPanelOpen(v) {
      panelOpen = v
      setPanelVisible(v)
      uiListeners.forEach(function (l) { l() })
    }
    function setPanelVisible(v) {
      if (!panelRoot) return
      panelRoot.style.display = v ? 'flex' : 'none'
      if (v && !panelMounted) {
        panelMounted = true
        var host = document.createElement('div')
        host.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:0;'
        panelRoot.appendChild(host)
        panelCleanup = mountPanelContent(host, { inline: false })
      }
      // 重开时刷新审批/状态由面板内部 timer 负责
    }

    // ───────────────────────── FAB ─────────────────────────
    var fabRoot = null
    var fabBadge = null
    function ensureFAB() {
      if (fabRoot && document.getElementById('ark9-fab-root')) return
      var mount = document.getElementById('ark9-fab-root')
      if (!mount) {
        mount = document.createElement('div')
        mount.id = 'ark9-fab-root'
        mount.style.cssText = 'position:fixed;right:16px;bottom:' + fabBottom() + 'px;z-index:9998;'
        document.body.appendChild(mount)
      }
      fabRoot = mount
      renderFAB(false)
      // 徽标轮询
      setInterval(function () {
        apiGet(API.state).then(function (s) {
          var n = (s && s.pendingApprovals) || 0
          if (fabBadge) {
            fabBadge.style.display = n > 0 ? 'flex' : 'none'
            fabBadge.textContent = String(n)
          }
        }).catch(function () {})
      }, 5000)
    }
    function renderFAB(silent) {
      if (!fabRoot) return
      fabRoot.innerHTML = ''
      var btn = document.createElement('button')
      btn.setAttribute('aria-label', 'Ark9 生图')
      btn.textContent = '🖼️'
      btn.style.cssText =
        'width:44px;height:44px;border-radius:999px;cursor:pointer;position:relative;' +
        'border:1px solid rgba(255,255,255,0.18);box-shadow:0 8px 32px rgba(0,0,0,0.35);' +
        'background:' + (panelOpen ? 'rgba(121,192,255,0.92)' : 'rgba(30,34,44,0.88)') + ';' +
        'color:' + (panelOpen ? '#0b1220' : '#e8eaf0') + ';font-size:18px;' +
        'display:flex;align-items:center;justify-content:center;'
      btn.onclick = function () { setPanelOpen(!panelOpen); renderFAB(false) }
      fabBadge = document.createElement('span')
      fabBadge.style.cssText =
        'display:none;position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;' +
        'border-radius:999px;background:#f44336;color:#fff;font-size:11px;font-weight:700;' +
        'align-items:center;justify-content:center;padding:0 4px;'
      fabBadge.textContent = ''
      btn.appendChild(fabBadge)
      fabRoot.appendChild(btn)
      if (!silent && !panelOpen && !document.getElementById('ark9-fab-tip')) {
        var tip = document.createElement('div')
        tip.id = 'ark9-fab-tip'
        tip.style.cssText =
          'position:absolute;right:52px;top:50%;transform:translateY(-50%);' +
          'white-space:nowrap;background:rgba(20,24,32,0.92);color:#e8eaf0;' +
          'border:1px solid rgba(255,255,255,0.14);border-radius:999px;' +
          'padding:4px 10px;font-size:12px;pointer-events:none;'
        tip.textContent = 'Ark9 生图'
        fabRoot.appendChild(tip)
        setTimeout(function () { try { tip.remove() } catch (_) {} }, 3600)
      }
    }

    // ───────────────────────── 设置页(React) ─────────────────────────
    function SettingsPage() {
      var _c = useState(null)
      var cfg = _c[0]; var setCfg = _c[1]
      var _m = useState([])
      var models = _m[0]; var setModels = _m[1]
      var _s = useState('')
      var msg = _s[1]
      var _saving = useState(false)
      var saving = _saving[0]; var setSaving = _saving[1]
      useEffect(function () {
        apiGet(API.config).then(function (c) { setCfg(c) }).catch(function () {})
      }, [])
      if (!cfg) return h('div', { style: { padding: 20, color: MUTED } }, '加载中…')
      function upd(k, v) { setCfg(function (prev) { return Object.assign({}, prev, (function () { var o = {}; o[k] = v; return o })()) }) }
      function fieldStyle() {
        return { width: '100%', boxSizing: 'border-box', padding: '8px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.16)', background: 'rgba(255,255,255,0.06)', color: 'inherit', fontSize: 13 }
      }
      function onSave() {
        setSaving(true)
        apiPost(API.config, cfg).then(function (r) {
          setSaving(false)
          msg(r.ok ? '✓ 已保存' : '保存失败')
          setTimeout(function () { msg('') }, 2000)
        }).catch(function () { setSaving(false); msg('保存失败') })
      }
      function onFetchModels() {
        apiGet(API.models).then(function (r) {
          if (r.models && r.models.length) { setModels(r.models); msg('拉到 ' + r.models.length + ' 个模型') }
          else { msg('拉取失败: ' + (r.error || '无模型')) }
          setTimeout(function () { msg('') }, 2500)
        }).catch(function () { msg('拉取失败') })
      }
      var labelStyle = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginBottom: 14 }
      return h('div', { style: { padding: 20, maxWidth: 560, color: FG, fontFamily: 'system-ui, sans-serif' } },
        h('h2', { style: { margin: '0 0 6px', fontSize: 18 } }, 'Ark9 生图'),
        h('p', { style: { fontSize: 12, color: MUTED, margin: '0 0 16px' } }, 'OpenAI 兼容图片 API(baseURL 含 /v1)。文生图 /images/generations,图生图 /images/edits。'),
        h('label', { style: labelStyle }, 'BaseURL',
          h('input', { value: cfg.baseURL || '', onChange: function (e) { upd('baseURL', e.target.value) }, placeholder: 'https://sub.vankit.top/v1', style: fieldStyle() })),
        h('label', { style: labelStyle }, 'API Key',
          h('input', { value: cfg.apiKey || '', onChange: function (e) { upd('apiKey', e.target.value) }, placeholder: 'sk-...', type: 'password', style: fieldStyle() })),
        h('label', { style: labelStyle }, '模型',
          h('div', { style: { display: 'flex', gap: 8 } },
            h('input', { value: cfg.model || '', onChange: function (e) { upd('model', e.target.value) }, placeholder: 'gpt-image-2', style: Object.assign({ flex: 1 }, fieldStyle()) }),
            h('button', { onClick: onFetchModels, style: { padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: 'inherit', cursor: 'pointer', fontSize: 12 } }, '拉取模型'))),
        models.length ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 } },
          models.map(function (m2) {
            return h('button', {
              key: m2.id, onClick: function () { upd('model', m2.id) },
              style: { padding: '4px 10px', borderRadius: 999, border: '1px solid ' + ACCENT_SOLID, background: cfg.model === m2.id ? ACCENT_SOLID : 'transparent', color: cfg.model === m2.id ? '#0b1220' : ACCENT_SOLID, cursor: 'pointer', fontSize: 12 },
            }, m2.name || m2.id)
          })) : null,
        h('div', { style: { fontWeight: 700, fontSize: 13, margin: '6px 0 10px', paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.1)' } }, '安全(Agent 审批)'),
        h('label', { style: labelStyle }, 'Agent 生图审批',
          h('select', { value: cfg.agentApproval || 'always', onChange: function (e) { upd('agentApproval', e.target.value) }, style: fieldStyle() },
            h('option', { value: 'always' }, '每次都需要我批准(默认)'),
            h('option', { value: 'never' }, '免审批(Agent 直接生成,注意计费)'))),
        h('label', { style: labelStyle }, '审批等待超时(秒,5-600)',
          h('input', { value: String(cfg.approvalTimeoutSec != null ? cfg.approvalTimeoutSec : 120), onChange: function (e) { upd('approvalTimeoutSec', Number(e.target.value) || 120) }, style: fieldStyle() })),
        h('div', { style: { fontWeight: 700, fontSize: 13, margin: '6px 0 10px' } }, '输出'),
        h('label', { style: labelStyle }, '输出目录(留空 = ~/Pictures/ark9-canvas)',
          h('input', { value: cfg.outputDir || '', onChange: function (e) { upd('outputDir', e.target.value) }, placeholder: 'D:/my-images', style: fieldStyle() })),
        h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', marginTop: 6 } },
          h('button', { onClick: onSave, disabled: saving, style: { padding: '8px 24px', borderRadius: 8, border: '0', background: 'linear-gradient(135deg,#4f8cff,#7c5cff)', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13 } }, saving ? '保存中…' : '保存配置'),
          h('span', { style: { fontSize: 12, color: MUTED } }, msg)),
      )
    }

    // ───────────────────────── sidebar inline 包裹(React 薄壳,内容复用 vanilla 实现) ─────────────────────────
    function Ark9PanelInline(props) {
      var ref = useRef(null)
      useEffect(function () {
        if (!props.visible || !ref.current) return
        ref.current.innerHTML = ''
        var host = document.createElement('div')
        host.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:0;'
        ref.current.appendChild(host)
        var cleanup = mountPanelContent(host, { inline: true })
        return cleanup
      }, [props.visible])
      if (!props.visible) return null
      return h('div', { ref: ref, style: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' } })
    }

    // ───────────────────────── apply ─────────────────────────
    function apply(ctx) {
      var slots = ctx.slots

      // 设置页独立注册(DOM 未就绪也不丢)
      try {
        slots.inject('settings.section', function () {
          return slots.register({ name: 'settings.section', id: 'ark9-canvas-pre', order: 31, label: 'Ark9 生图' }, function () {
            return h(SettingsPage, null)
          })
        })
      } catch (e) {
        console.error('[dsh-ark9canvas] settings.section 注册失败:', e)
      }

      // ====== Better Sidebar 集成(若宿主提供 ctx.get('betterSidebar')) ======
      // 注意:动态插件 runner 的代理 ctx 对未声明属性读取会抛错(inject 门控),
      // 必须用 ctx.get() 这个不受门控的可选查找(同 dsh-cua-pre)。
      var bsRegistered = false
      try {
        var bs = (typeof ctx.get === 'function') ? ctx.get('betterSidebar') : null
        if (bs && typeof bs.registerTab === 'function') {
          ctx.effect(function () {
            return bs.registerTab({
              id: 'ark9-canvas-pre:canvas',
              title: 'Ark9 生图',
              icon: '🖼️',
              order: 41,
              single: true,
              component: function (props) { return h(Ark9PanelInline, { visible: props && props.visible !== false }) },
            })
          })
          bsRegistered = true
          console.log('[dsh-ark9canvas] Better Sidebar tab registered')
        }
      } catch (e) {
        console.error('[dsh-ark9canvas] betterSidebar 注册失败(回退 FAB):', e)
        bsRegistered = false
      }

      // ====== DOM 直挂(body 就绪后;已注册 sidebar tab 则跳过 FAB) ======
      function whenBodyReady(fn) {
        if (typeof document !== 'undefined' && document.body) { try { fn() } catch (e) { console.error('[dsh-ark9canvas] DOM mount error:', e) } return }
        if (typeof document !== 'undefined' && document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', function () { try { fn() } catch (e) { console.error('[dsh-ark9canvas] DOM mount error:', e) } })
          return
        }
        setTimeout(function () { try { fn() } catch (e) { console.error('[dsh-ark9canvas] DOM mount error:', e) } }, 150)
      }
      var domMounted = false
      function mountDom() {
        if (domMounted) return
        domMounted = true
        if (!bsRegistered) {
          ensurePanelRoot()
          setPanelVisible(panelOpen)
          ensureFAB()
        }
        console.log('[dsh-ark9canvas] client ready: ' + (bsRegistered ? 'better-sidebar tab' : 'floating FAB') + ' + settings page')
      }
      whenBodyReady(mountDom)
      setTimeout(whenBodyReady.bind(null, mountDom), 800)
    }

    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})
