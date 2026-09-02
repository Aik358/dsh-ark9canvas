/* dsh-ark9canvas — browser half (v0.3.0).
 * Surfaces (same mechanism as dsh-cua-pre):
 *   1. floating FAB (fixed right-bottom; auto-stacks above dsh-cua FAB; badge = pending approvals)
 *   2. Better Sidebar tab via ctx.get('betterSidebar') — replaces FAB
 *   3. settings.section — 渠道(多渠道聚合) / 提示词来源 / 安全(审批) / 输出 / 导入导出
 * Panel content = one vanilla-DOM implementation shared by floating panel and sidebar tab.
 * 生图工作台功能对齐 WorldCodes Canvas(独立实现,无其版权):
 *   比例网格/手动WxH+16对齐/透明背景/批量1-10/模型选择/剪切板/生成记录(重试删除)/提示词库。
 */
console.log('[dsh-ark9canvas] client v0.3.0 loading')
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
      logs: '/api/ark9-canvas-pre/logs',
      promptFetch: '/api/ark9-canvas-pre/prompt-fetch',
      models: '/api/ark9-canvas-pre/models',
    }
    function apiGet(path) {
      return fetch(path).then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json() })
    }
    function apiPost(path, body) {
      return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
        .then(function (r) { return r.json() })
    }

    var GLASS_BG = 'rgba(22,26,34,0.94)'
    var GLASS_BORDER = 'rgba(255,255,255,0.16)'
    var FG = '#e8eaf0'
    var MUTED = 'rgba(232,234,240,0.55)'
    var ACCENT = 'rgba(121,192,255,0.25)'
    var ACCENT_SOLID = '#79c0ff'
    var OK_BG = 'rgba(76,175,80,0.25)'
    var ERR_BG = 'rgba(244,67,54,0.22)'
    var WARN_BG = 'rgba(255,193,7,0.15)'

    // ── canvas 同款尺寸计算:质量预算 + 16px 对齐(Pge/Tf/zxt) ──
    var QUALITY_BUDGET = { low: 1024, medium: 2048, high: 2880 }
    var ALIGN = 16
    var STANDARD = ['1024x1024', '1536x1024', '1024x1536']
    function snapAlign(v) { return Math.max(16, Math.floor(v / ALIGN) * ALIGN) }
    /** 比例字符串 → "WxH"(canvas Wxt 逻辑)。quality: low/medium/high/其他。 */
    function ratioToSize(ratio, quality) {
      var parts = ratio.split(':')
      var rw = Number(parts[0]), rh = Number(parts[1])
      if (!rw || !rh) return ''
      var a = rw / rh
      var budget = QUALITY_BUDGET[quality]
      var w, h
      if (budget) {
        var f = Math.sqrt(budget * budget * a)
        w = Math.floor(f / ALIGN) * ALIGN
        h = Math.round(w / a / ALIGN) * ALIGN
      } else {
        var base = 1024
        w = Math.round(base * a / ALIGN) * ALIGN
        h = 1024
      }
      return a >= 1 ? w + 'x' + h : h + 'x' + w
    }
    /** gpt-image 系模型只认标准三档 → 吸附最近标准尺寸。 */
    function snapForGpt(model, size) {
      if (!model || !/^gpt-image/i.test(model)) return size
      if (STANDARD.indexOf(size) >= 0) return size
      var p = size.split('x')
      var a = Number(p[0]) / Number(p[1])
      var best = null, bestDiff = 1e9
      STANDARD.forEach(function (s) {
        var q = s.split('x')
        var d = Math.abs(Number(q[0]) / Number(q[1]) - a)
        if (d < bestDiff) { bestDiff = d; best = s }
      })
      return best
    }

    var RATIOS = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '1:1(2k)', '16:9(2k)', '9:16(2k)', '16:9(4k)', '9:16(4k)']
    function ratioBudget(ratio) {
      if (/\(2k\)/.test(ratio)) return 'medium'
      if (/\(4k\)/.test(ratio)) return 'high'
      return null // 用当前质量
    }
    function ratioName(ratio) { return ratio.replace(/\(\w+\)/, '') }

    // ── 面板状态 ──
    function buildPanelState() {
      return {
        tab: 'generate',
        prompt: '', refs: [],
        sizeMode: 'preset', // preset | manual
        size: '1536x1024', ratio: '3:2', manualW: '1024', manualH: '1024', align16: true,
        transparent: false, quality: 'high', count: 1, model: '', models: [],
        busy: false, status: '', error: '', results: [], lastParams: null,
        logs: [], logSel: {}, logPreview: [],
        prompts: [], promptSource: '_local', promptSearch: '',
        cfg: null, pollTimer: null,
      }
    }

    function savedPrompts() {
      try { return JSON.parse(localStorage.getItem('ark9.savedPrompts') || '[]') } catch (e) { return [] }
    }
    function saveSavedPrompts(list) {
      try { localStorage.setItem('ark9.savedPrompts', JSON.stringify(list.slice(0, 200))) } catch (e) {}
    }

    // ═══════════════ 面板主体(vanilla DOM;浮窗与 sidebar tab 共用) ═══════════════
    function mountPanelContent(container, opts) {
      var inline = !!(opts && opts.inline)
      var st = buildPanelState()
      var disposed = false
      var root = document.createElement('div')
      root.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:0;color:' + FG + ';font:13px/1.6 system-ui;'
      container.appendChild(root)

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

      var tabsRow = document.createElement('div')
      tabsRow.style.cssText = 'display:flex;gap:4px;padding:8px 10px 0;flex-shrink:0;flex-wrap:wrap;'
      var TABS = [['generate', '生成'], ['approvals', '审批'], ['prompts', '提示词'], ['history', '记录'], ['about', '说明']]
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

      var body = document.createElement('div')
      body.style.cssText = 'flex:1;overflow-y:auto;padding:12px 14px 14px;min-height:0;'
      root.appendChild(body)

      function tabBtnCss(active) {
        return 'padding:6px 12px;border:0;border-radius:999px;cursor:pointer;font-size:12px;' +
          'background:' + (active ? ACCENT : 'rgba(255,255,255,0.08)') + ';color:' + (active ? '#fff' : MUTED) + ';'
      }
      function el(tag, cssText, text) {
        var e = document.createElement(tag)
        if (cssText) e.style.cssText = cssText
        if (text !== undefined) e.textContent = text
        return e
      }
      function inputCss() {
        return 'width:100%;box-sizing:border-box;padding:7px 9px;border-radius:8px;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.06);color:inherit;font:inherit;font-size:12px;'
      }
      function miniBtn(text, cssExtra, onclick) {
        var b = el('button', 'padding:5px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.08);color:inherit;cursor:pointer;font-size:12px;' + (cssExtra || ''), text)
        b.onclick = onclick
        return b
      }
      function currentSize() {
        if (st.sizeMode === 'manual') {
          var w = parseInt(st.manualW, 10), hgt = parseInt(st.manualH, 10)
          if (!w || !hgt) return ''
          if (st.align16) { w = snapAlign(w); hgt = snapAlign(hgt) }
          return w + 'x' + hgt
        }
        var r = st.ratio
        var budget = ratioBudget(r) || st.quality
        var raw = ratioToSize(ratioName(r), budget)
        return snapForGpt(st.model || (st.cfg && st.cfg.model), raw)
      }

      // ─────── 生成页 ───────
      function renderGenerate() {
        body.innerHTML = ''
        if (!st.cfg) st.cfg = {}
        if (!st.cfg.baseURL && !(st.cfg.channels && st.cfg.channels.length)) {
          body.appendChild(el('div', 'background:' + WARN_BG + ';border:1px solid rgba(255,193,7,0.4);color:#ffe08a;padding:8px 10px;border-radius:8px;font-size:12px;margin-bottom:10px;',
            '未配置渠道。请到 设置 → Ark9 生图 添加你自己的渠道(baseURL 含 /v1、API Key、模型名——可手动输入任意模型名,或拉取列表点选)。'))
        }
        // 模型行:可输入模型名(手动填任意模型) + 从拉取列表点选
        var modelRow = el('div', 'display:flex;gap:8px;align-items:center;margin-bottom:10px;')
        var modelInput = document.createElement('input')
        modelInput.setAttribute('list', 'ark9-model-list')
        modelInput.placeholder = '模型名,如 gpt-image-2(可手动输入)'
        modelInput.style.cssText = 'flex:1;padding:7px 9px;border-radius:8px;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.06);color:inherit;font:inherit;font-size:12px;box-sizing:border-box;'
        modelInput.value = st.model || (st.cfg && st.cfg.model) || ''
        modelInput.oninput = function () { st.model = modelInput.value.trim() }
        var datalist = document.createElement('datalist')
        datalist.id = 'ark9-model-list'
        function fillModelOptions() {
          datalist.innerHTML = ''
          var list = st.models.length ? st.models : (st.cfg && st.cfg.model ? [{ id: st.cfg.model, name: st.cfg.model }] : [])
          list.forEach(function (m) {
            var o = document.createElement('option')
            o.value = m.id
            o.textContent = m.name || m.id
            datalist.appendChild(o)
          })
        }
        fillModelOptions()
        modelRow.appendChild(modelInput)
        modelRow.appendChild(datalist)
        modelRow.appendChild(miniBtn('拉取模型', '', function () {
          apiPost(API.models, {}).then(function (r) {
            if (r.models && r.models.length) { st.models = r.models; fillModelOptions() }
            else if (r.error) { st.error = '拉取失败: ' + r.error; renderTab() }
          }).catch(function () {})
        }))
        body.appendChild(modelRow)

        // 提示词
        body.appendChild(el('div', 'font-weight:600;margin-bottom:4px;', '提示词'))
        var ta = el('textarea')
        ta.value = st.prompt
        ta.placeholder = '描述画面主体、风格、构图、光线和用途…'
        ta.rows = 4
        ta.style.cssText = inputCss() + 'resize:vertical;font-size:13px;'
        ta.oninput = function () { st.prompt = ta.value }
        body.appendChild(ta)

        // 参考图
        var refHead = el('div', 'display:flex;align-items:center;gap:8px;margin:10px 0 4px;')
        refHead.appendChild(el('div', 'font-weight:600;', '参考图(可选,图生图)'))
        var refSp = el('span', 'flex:1'); refHead.appendChild(refSp)
        refHead.appendChild(miniBtn('📋 剪切板', '', function () {
          if (!navigator.clipboard || !navigator.clipboard.read) { st.error = '剪切板 API 不可用'; return renderTab() }
          navigator.clipboard.read().then(function (items) {
            var found = false
            items.forEach(function (it) {
              var type = it.types.find(function (t) { return t.indexOf('image/') === 0 })
              if (type && st.refs.length < 4) {
                found = true
                it.getType(type).then(function (blob) {
                  var rd = new FileReader()
                  rd.onload = function () { st.refs.push(rd.result); renderTab() }
                  rd.readAsDataURL(blob)
                })
              }
            })
            if (!found) { st.status = '剪切板里没有图片'; setTimeout(function () { st.status = ''; renderTab() }, 1500) }
          }).catch(function (e) { st.error = '读取剪切板失败: ' + e.message; renderTab() })
        }))
        refHead.appendChild(miniBtn('上传', '', function () { fileInput.click() }))
        var clearRef = miniBtn('清空', '', function () { st.refs = []; renderTab() })
        refHead.appendChild(clearRef)
        body.appendChild(refHead)
        var file = document.createElement('input')
        file.type = 'file'; file.accept = 'image/*'; file.multiple = true
        file.style.display = 'none'
        file.onchange = function () {
          var files = Array.prototype.slice.call(file.files || [])
          var left = 4 - st.refs.length
          files.slice(0, Math.max(0, left)).forEach(function (f) {
            var rd = new FileReader()
            rd.onload = function () { if (rd.result) { st.refs.push(rd.result); renderTab() } }
            rd.readAsDataURL(f)
          })
          file.value = ''
        }
        body.appendChild(file)
        var refThumbs = el('div', 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;min-height:' + (st.refs.length ? '54px' : '0') + ';')
        st.refs.forEach(function (d, i) {
          var im = document.createElement('img')
          im.src = d
          im.style.cssText = 'width:52px;height:52px;object-fit:cover;border-radius:6px;border:1px solid rgba(255,255,255,0.2);cursor:pointer;'
          im.title = '点击移除'
          im.onclick = function () { st.refs.splice(i, 1); renderTab() }
          refThumbs.appendChild(im)
        })
        body.appendChild(refThumbs)

        // 尺寸模式切换
        var modeRow = el('div', 'display:flex;gap:6px;margin-bottom:6px;')
        modeRow.appendChild(miniBtn('比例预设', st.sizeMode === 'preset' ? 'background:' + ACCENT + ';color:#fff;' : '', function () { st.sizeMode = 'preset'; renderTab() }))
        modeRow.appendChild(miniBtn('手动 W×H', st.sizeMode === 'manual' ? 'background:' + ACCENT + ';color:#fff;' : '', function () { st.sizeMode = 'manual'; renderTab() }))
        var curSz = el('span', 'flex:1;text-align:right;font-size:11px;color:' + MUTED + ';align-self:center;', '当前: ' + (currentSize() || 'auto'))
        modeRow.appendChild(curSz)
        body.appendChild(modeRow)

        if (st.sizeMode === 'preset') {
          var grid = el('div', 'display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-bottom:10px;')
          var allRatios = RATIOS.concat(['auto'])
          allRatios.forEach(function (r) {
            var isActive = r === 'auto' ? false : (st.ratio === r && st.sizeMode === 'preset')
            var b = el('button', 'padding:7px 0;border-radius:8px;border:1px solid ' + (isActive ? ACCENT_SOLID : 'rgba(255,255,255,0.14)') + ';background:' + (isActive ? ACCENT : 'rgba(255,255,255,0.06)') + ';color:inherit;cursor:pointer;font-size:11px;', r)
            b.onclick = function () {
              if (r === 'auto') { st.size = 'auto'; st.ratio = ''; }
              else { st.ratio = r; st.size = currentSize() }
              renderTab()
            }
            grid.appendChild(b)
          })
          body.appendChild(grid)
        } else {
          var whRow = el('div', 'display:flex;gap:8px;align-items:center;margin-bottom:6px;')
          var wIn = el('input'); wIn.value = st.manualW; wIn.placeholder = 'W'; wIn.style.cssText = inputCss() + 'width:90px;text-align:center;'
          wIn.oninput = function () { st.manualW = wIn.value; curSz.textContent = '当前: ' + (currentSize() || '?') }
          var x = el('span', 'color:' + MUTED + ';', '×')
          var hIn = el('input'); hIn.value = st.manualH; hIn.placeholder = 'H'; hIn.style.cssText = inputCss() + 'width:90px;text-align:center;'
          hIn.oninput = function () { st.manualH = hIn.value; curSz.textContent = '当前: ' + (currentSize() || '?') }
          whRow.appendChild(wIn); whRow.appendChild(x); whRow.appendChild(hIn)
          var alignLabel = el('label', 'display:flex;align-items:center;gap:5px;font-size:12px;color:' + MUTED + ';cursor:pointer;')
          var alignCb = document.createElement('input')
          alignCb.type = 'checkbox'; alignCb.checked = st.align16
          alignCb.onchange = function () { st.align16 = alignCb.checked; curSz.textContent = '当前: ' + (currentSize() || '?') }
          alignLabel.appendChild(alignCb); alignLabel.appendChild(document.createTextNode('16 倍数对齐'))
          whRow.appendChild(alignLabel)
          body.appendChild(whRow)
        }

        // 参数行:质量 / 透明背景 / 张数
        var paramRow = el('div', 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px;')
        function mkSelect(label, values, cur, onchg) {
          var box = el('div')
          box.appendChild(el('div', 'font-size:11px;color:' + MUTED + ';margin-bottom:2px;', label))
          var s = document.createElement('select')
          s.style.cssText = 'width:100%;padding:5px;border-radius:6px;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.08);color:inherit;font-size:12px;'
          values.forEach(function (v) {
            var o = document.createElement('option'); o.value = String(v.v); o.textContent = v.label
            s.appendChild(o)
          })
          s.value = String(cur)
          s.onchange = function () { onchg(s.value) }
          box.appendChild(s)
          return box
        }
        paramRow.appendChild(mkSelect('质量', QUALITIES.map(function (q) { return { v: q, label: q === 'auto' ? '自动' : q === 'low' ? '低' : q === 'medium' ? '中' : '高' } }), st.quality, function (v) { st.quality = v; renderTab() }))
        paramRow.appendChild(mkSelect('背景', [{ v: 'opaque', label: '不透明' }, { v: 'transparent', label: '透明' }], st.transparent ? 'transparent' : 'opaque', function (v) { st.transparent = v === 'transparent' }))
        paramRow.appendChild(mkSelect('张数', Array.from({ length: 10 }, function (_, i) { return { v: i + 1, label: (i + 1) + ' 张' } }), st.count, function (v) { st.count = Number(v) }))
        body.appendChild(paramRow)

        // 生成按钮
        var genBtn = el('button', 'width:100%;padding:9px 0;border:0;border-radius:8px;cursor:pointer;font-weight:600;font-size:13px;background:linear-gradient(135deg,#4f8cff,#7c5cff);color:#fff;', st.busy ? '生成中…' : '开始生成')
        genBtn.onclick = doGenerate
        body.appendChild(genBtn)

        var statusLine = el('div', 'font-size:12px;color:' + MUTED + ';text-align:center;margin-top:8px;min-height:16px;', st.status || '')
        body.appendChild(statusLine)
        var errBox = el('div', 'display:' + (st.error ? 'block' : 'none') + ';background:' + ERR_BG + ';padding:8px 10px;border-radius:8px;font-size:12px;margin-top:8px;word-break:break-all;', st.error || '')
        body.appendChild(errBox)
        var retryBox = el('div', '')
        body.appendChild(retryBox)
        var resultBox = el('div', 'display:flex;flex-direction:column;gap:10px;margin-top:10px;')
        body.appendChild(resultBox)

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
        function syncStatus() {
          statusLine.textContent = st.status || ''
          errBox.style.display = st.error ? 'block' : 'none'
          errBox.textContent = st.error
          genBtn.textContent = st.busy ? '生成中…' : '开始生成'
          genBtn.style.opacity = st.busy ? '0.7' : '1'
        }

        function doGenerate() {
          if (st.busy) return
          if (!st.prompt.trim()) { st.error = '请输入提示词'; syncStatus(); renderTab(); return }
          var sz = currentSize()
          var params = {
            prompt: st.prompt, images: st.refs, size: sz || 'auto',
            quality: st.quality, count: st.count,
            model: st.model || (st.cfg && st.cfg.model) || undefined,
            background: st.transparent ? 'transparent' : undefined,
          }
          st.lastParams = JSON.parse(JSON.stringify(params))
          st.error = ''; st.results = []; resultBox.innerHTML = ''
          st.busy = true; st.status = '提交中…'; syncStatus()
          apiPost(API.generate, params)
            .then(function (r) {
              if (r.error) throw new Error(r.error)
              poll(r.id, 0, Date.now())
            })
            .catch(function (e) { st.busy = false; st.status = ''; st.error = '提交失败: ' + e.message; syncStatus() })
        }
        function poll(id, n, t0) {
          if (disposed) return
          apiPost(API.task, { id: id }).then(function (r) {
            if (r.status === 'succeeded' || (r.status === 'failed' && r.okCount > 0)) {
              return apiPost(API.taskResult, { id: id }).then(function (rr) {
                st.results = (rr.data || []).map(function (it) {
                  return { dataUrl: it.b64_json ? 'data:image/png;base64,' + it.b64_json : (it.url || '') }
                }).filter(function (x) { return x.dataUrl })
                st.busy = false
                var secs = Math.round((Date.now() - t0) / 1000)
                var failNote = rr.failCount ? ',失败 ' + rr.failCount + ' 张' : ''
                st.status = '完成 ' + st.results.length + ' 张' + failNote + '(' + secs + 's)'
                syncStatus(); renderResults()
                if (rr.failCount) {
                  retryBox.innerHTML = ''
                  retryBox.appendChild(miniBtn('↻ 重试失败批次', 'width:100%;margin-top:8px;background:' + ACCENT + ';color:#fff;', doGenerate))
                }
              })
            }
            if (r.status === 'failed') {
              st.busy = false; st.status = ''
              st.error = (r.error && r.error.message) || '生成失败'
              syncStatus()
              retryBox.innerHTML = ''
              retryBox.appendChild(miniBtn('↻ 重试', 'width:100%;margin-top:8px;background:' + ACCENT + ';color:#fff;', doGenerate))
              return
            }
            if (n > 300) { st.busy = false; st.status = '超时'; syncStatus(); return }
            var secs = Math.round((Date.now() - t0) / 1000)
            st.status = '生成中… ' + secs + 's'
            if (r.total > 1) st.status += ' (' + (r.okCount || 0) + '/' + r.total + ' 完成)'
            syncStatus()
            st.pollTimer = setTimeout(function () { poll(id, n + 1, t0) }, 2000)
          }).catch(function () {
            st.pollTimer = setTimeout(function () { poll(id, n + 1, t0) }, 2500)
          })
        }
      }

      // ─────── 审批页 ───────
      function renderApprovals() {
        body.innerHTML = ''
        body.appendChild(el('div', 'font-size:12px;color:' + MUTED + ';margin-bottom:10px;', 'Agent 发起的生图请求在这里等待你批准;批准后才开始生成(才会计费)。'))
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
              card.appendChild(el('div', 'font-weight:600;font-size:12px;margin-bottom:4px;', 'Agent 生图请求 · 已等待 ' + a.waitSec + 's'))
              var p = el('div', 'font-size:12px;margin-bottom:6px;word-break:break-all;max-height:72px;overflow:auto;', a.prompt)
              card.appendChild(p)
              var pa = a.params || {}
              card.appendChild(el('div', 'font-size:11px;color:' + MUTED + ';margin-bottom:8px;',
                [pa.channel, pa.model, pa.size, pa.quality, pa.count + ' 张', pa.refs ? '参考图 x' + pa.refs : '', pa.transparent ? '透明背景' : ''].filter(Boolean).join(' · ')))
              var btnRow = el('div', 'display:flex;gap:8px;')
              btnRow.appendChild(miniBtn('✓ 批准', 'flex:1;background:' + OK_BG + ';color:#a5d6a7;font-weight:600;border:0;', function () { decide(a.id, 'approve') }))
              btnRow.appendChild(miniBtn('✕ 拒绝', 'flex:1;background:' + ERR_BG + ';color:#ff8a80;font-weight:600;border:0;', function () { decide(a.id, 'deny') }))
              card.appendChild(btnRow)
              listBox.appendChild(card)
            })
          }).catch(function () {})
        }
        function decide(id, decision) {
          apiPost(API.approvals, { id: id, decision: decision }).then(function () { refresh(); refreshBadge() })
        }
        refresh()
        st.pollTimer = setInterval(refresh, 2500)
      }

      // ─────── 提示词页 ───────
      function renderPrompts() {
        body.innerHTML = ''
        var cfg = st.cfg || {}
        var sources = [{ id: '_local', name: '★ 本地收藏' }].concat(cfg.promptSources || [])
        var srcRow = el('div', 'display:flex;gap:6px;margin-bottom:8px;')
        var srcSel = document.createElement('select')
        srcSel.style.cssText = 'flex:1;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.08);color:inherit;font-size:12px;'
        sources.forEach(function (s) {
          var o = document.createElement('option'); o.value = s.id; o.textContent = s.name
          srcSel.appendChild(o)
        })
        srcSel.value = st.promptSource
        if (!srcSel.value) srcSel.value = sources[0] && sources[0].id
        st.promptSource = srcSel.value
        srcSel.onchange = function () { st.promptSource = srcSel.value; st.prompts = []; renderTab() }
        srcRow.appendChild(srcSel)
        srcRow.appendChild(miniBtn('↻ 刷新', '', function () { st.prompts = []; renderTab() }))
        body.appendChild(srcRow)
        var search = el('input')
        search.placeholder = '搜索提示词…'
        search.value = st.promptSearch
        search.style.cssText = inputCss() + 'margin-bottom:8px;'
        search.oninput = function () { st.promptSearch = search.value; renderList() }
        body.appendChild(search)
        var listBox = el('div', 'display:flex;flex-direction:column;gap:6px;')
        body.appendChild(listBox)

        function renderList() {
          listBox.innerHTML = ''
          var kw = st.promptSearch.trim().toLowerCase()
          if (st.promptSource === '_local') {
            var favs = savedPrompts()
            if (!favs.length) { listBox.appendChild(el('div', 'color:' + MUTED + ';font-size:12px;text-align:center;padding:20px 0;', '收藏为空:在提示词条目上点 ☆ 收藏')); return }
            renderItems(favs.filter(function (p) { return !kw || (p.title + p.prompt).toLowerCase().indexOf(kw) >= 0 }), true)
          } else {
            var src = (cfg.promptSources || []).find(function (s) { return s.id === st.promptSource })
            if (!src) { listBox.appendChild(el('div', 'color:' + MUTED + ';font-size:12px;text-align:center;padding:20px 0;', '来源不存在')); return }
            if (!st.prompts.length) {
              listBox.appendChild(el('div', 'color:' + MUTED + ';font-size:12px;', '拉取中: ' + src.name + '…'))
              apiPost(API.promptFetch, { url: src.url }).then(function (r) {
                if (disposed) return
                st.prompts = r.prompts || []
                st.promptFetchError = r.error || ''
                renderTab()
              }).catch(function () { st.prompts = []; st.promptFetchError = '拉取失败'; renderTab() })
              return
            }
            if (st.promptFetchError) listBox.appendChild(el('div', 'font-size:11px;color:#ff8a80;margin-bottom:4px;', '上次拉取: ' + st.promptFetchError))
            renderItems(st.prompts.filter(function (p) { return !kw || (p.title + p.prompt + (p.tags || []).join()).toLowerCase().indexOf(kw) >= 0 }), false)
          }
        }
        function renderItems(items, isLocal) {
          if (!items.length) { listBox.appendChild(el('div', 'color:' + MUTED + ';font-size:12px;text-align:center;padding:12px 0;', '无匹配')); return }
          items.slice(0, 100).forEach(function (p) {
            var card = el('div', 'border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:8px 10px;background:rgba(255,255,255,0.04);cursor:pointer;')
            var head = el('div', 'display:flex;align-items:center;gap:6px;margin-bottom:3px;')
            head.appendChild(el('div', 'flex:1;font-weight:600;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', p.title || '(无标题)'))
            var star = el('span', 'cursor:pointer;font-size:13px;', isLocal ? '★' : '☆')
            star.title = isLocal ? '取消收藏' : '收藏到本地'
            star.onclick = function (e) {
              e.stopPropagation()
              var favs = savedPrompts()
              if (isLocal) {
                favs = favs.filter(function (f) { return f.prompt !== p.prompt })
              } else {
                favs.unshift({ title: p.title, prompt: p.prompt, tags: p.tags })
              }
              saveSavedPrompts(favs)
              renderList()
            }
            head.appendChild(star)
            card.appendChild(head)
            var prev = p.prompt.slice(0, 110)
            card.appendChild(el('div', 'font-size:11px;color:' + MUTED + ';word-break:break-all;', prev + (p.prompt.length > 110 ? '…' : '')))
            card.onclick = function () {
              st.prompt = p.prompt
              st.tab = 'generate'
              renderTab()
            }
            listBox.appendChild(card)
          })
        }
        renderList()
      }

      // ─────── 记录页 ───────
      function renderHistory() {
        body.innerHTML = ''
        var toolbar = el('div', 'display:flex;gap:6px;margin-bottom:8px;')
        toolbar.appendChild(miniBtn('全选/反选', '', function () {
          var all = Object.keys(st.logSel).length && Object.keys(st.logSel).every(function (k) { return st.logSel[k] })
          st.logSel = {}
          if (!all) st.logs.forEach(function (l) { st.logSel[l.id] = true })
          renderTab()
        }))
        toolbar.appendChild(miniBtn('删除选中', 'color:#ff8a80;', function () {
          var ids = Object.keys(st.logSel).filter(function (k) { return st.logSel[k] })
          if (!ids.length) return
          apiPost(API.logs, { action: 'delete', ids: ids }).then(function () { st.logSel = {}; loadLogs() })
        }))
        toolbar.appendChild(miniBtn('清空记录', 'color:#ff8a80;', function () {
          apiPost(API.logs, { action: 'clear' }).then(function () { st.logSel = {}; st.logs = []; renderTab() })
        }))
        body.appendChild(toolbar)
        var listBox = el('div', 'display:flex;flex-direction:column;gap:6px;')
        body.appendChild(listBox)
        var preview = el('div', 'margin-top:10px;')
        body.appendChild(preview)

        function loadLogs() {
          apiGet(API.logs).then(function (r) {
            if (disposed) return
            st.logs = r.logs || []
            renderList()
          }).catch(function () {})
        }
        function renderList() {
          listBox.innerHTML = ''
          if (!st.logs.length) { listBox.appendChild(el('div', 'color:' + MUTED + ';font-size:12px;text-align:center;padding:20px 0;', '暂无生成记录')); return }
          st.logs.forEach(function (l) {
            var ok = l.ok || 0, fail = l.fail || 0
            var pill = ok && !fail ? ['成功', OK_BG] : ok ? ['部分成功', WARN_BG] : ['失败', ERR_BG]
            var row = el('div', 'display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);')
            var cb = document.createElement('input')
            cb.type = 'checkbox'; cb.checked = !!st.logSel[l.id]
            cb.onchange = function () { st.logSel[l.id] = cb.checked }
            row.appendChild(cb)
            row.appendChild(el('span', 'background:' + pill[1] + ';border-radius:999px;padding:1px 8px;font-size:11px;white-space:nowrap;', pill[0] + (l.total > 1 ? ' ' + ok + '/' + l.total : '')))
            var mid = el('div', 'flex:1;min-width:0;cursor:pointer;')
            mid.appendChild(el('div', 'font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', l.prompt || '(无提示词)'))
            mid.appendChild(el('div', 'font-size:11px;color:' + MUTED + ';', [l.params && l.params.size, l.params && l.params.quality, new Date(l.createdAt || Date.now()).toLocaleString()].filter(Boolean).join(' · ')))
            mid.onclick = function () { showLogPreview(l) }
            row.appendChild(mid)
            if (fail > 0 || !ok) {
              row.appendChild(miniBtn('↻ 重试', '', function () { retryLog(l) }))
            }
            row.appendChild(miniBtn('🗑', '', function () {
              apiPost(API.logs, { action: 'delete', ids: [l.id] }).then(loadLogs)
            }))
            listBox.appendChild(row)
          })
        }
        function showLogPreview(l) {
          preview.innerHTML = ''
          var imgs = (l.images || [])
          if (!imgs.length) { preview.appendChild(el('div', 'font-size:11px;color:' + MUTED + ';text-align:center;', '该记录没有已保存的图片' + (l.error ? ' · ' + l.error : ''))); return }
          var grid = el('div', 'display:grid;grid-template-columns:1fr 1fr;gap:6px;')
          imgs.forEach(function (im) {
            if (!im.path) return
            var name = im.path.split(/[\\/]/).pop()
            var img = document.createElement('img')
            img.style.cssText = 'width:100%;border-radius:8px;border:1px solid rgba(255,255,255,0.15);'
            img.alt = name
            grid.appendChild(img)
            apiPost(API.imageFile, { name: name }).then(function (r) { if (r.dataUrl) img.src = r.dataUrl })
          })
          preview.appendChild(grid)
        }
        function retryLog(l) {
          st.prompt = l.prompt
          st.refs = []
          if (l.params) {
            if (l.params.size && /^\d+x\d+$/.test(l.params.size)) {
              var p = l.params.size.split('x')
              st.sizeMode = 'manual'; st.manualW = p[0]; st.manualH = p[1]
            }
            if (l.params.quality) st.quality = l.params.quality
            if (l.params.count) st.count = Math.min(10, l.params.count)
            if (l.params.model) st.model = l.params.model
            if (l.params.transparent) st.transparent = true
          }
          st.tab = 'generate'
          renderTab()
        }
        loadLogs()
      }

      // ─────── 说明页 ───────
      function renderAbout() {
        body.innerHTML = ''
        var box = el('div', 'font-size:12px;line-height:1.8;color:' + MUTED + ';')
        box.appendChild(el('div', null, 'Ark9 生图 — DSH 生图插件(独立实现,OpenAI 兼容图片 API)。'))
        box.appendChild(el('div', { style: { marginTop: '8px' } }, '· 生成:比例预设/手动 W×H(16 对齐)/透明背景/批量 1-10 张/模型切换/剪切板贴参考图。'))
        box.appendChild(el('div', null, '· 审批:Agent 生图默认在此等待批准(设置页可改免审批/超时)。'))
        box.appendChild(el('div', null, '· 提示词:本地收藏 + 自定义 JSON 来源(设置页添加,经本机代理拉取)。'))
        box.appendChild(el('div', null, '· 记录:生成历史,失败可重试,可多选删除。'))
        box.appendChild(el('div', null, '· Agent 工具:ark9_generate_image / ark9_list_images。'))
        box.appendChild(el('div', { style: { marginTop: '8px' } }, '· 装了 dsh-better-sidebar 时本面板注册为侧栏页签;装了 dsh-cua 时 FAB 自动堆叠其上。'))
        box.appendChild(el('div', null, '· 尺寸说明:gpt-image 系模型自动吸附标准三档(1024x1024/1536x1024/1024x1536);其他模型按质量预算(低1K/中2K/高4K)+16px 对齐计算。'))
        body.appendChild(box)
      }

      function renderTab() {
        TABS.forEach(function (t) { tabBtns[t[0]].style.cssText = tabBtnCss(st.tab === t[0]) })
        if (st.pollTimer) { clearInterval(st.pollTimer); clearTimeout(st.pollTimer); st.pollTimer = null }
        if (st.tab === 'generate') renderGenerate()
        else if (st.tab === 'approvals') renderApprovals()
        else if (st.tab === 'prompts') renderPrompts()
        else if (st.tab === 'history') renderHistory()
        else renderAbout()
      }

      apiGet(API.config).then(function (c) { st.cfg = c; if (c && c.quality && st.quality === 'high') st.quality = c.quality; if (c && c.count) st.count = Math.min(10, c.count); renderTab() }).catch(function () {})
      renderTab()

      function refreshBadge() {
        apiGet(API.state).then(function (s) {
          var n = s.pendingApprovals || 0
          if (n > 0) { badge.style.display = 'inline-block'; badge.textContent = n + ' 待审批' }
          else badge.style.display = 'none'
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

    var QUALITIES = ['auto', 'low', 'medium', 'high']

    // ═══════════════ 浮窗 ═══════════════
    var panelRoot = null
    var panelMounted = false
    var panelOpen = false
    var panelCleanup = null
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
        'width:440px;max-width:calc(100vw - 32px);height:min(76vh,680px);' +
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
    }

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
      setInterval(function () {
        apiGet(API.state).then(function (s) {
          var n = (s && s.pendingApprovals) || 0
          if (fabBadge) { fabBadge.style.display = n > 0 ? 'flex' : 'none'; fabBadge.textContent = String(n) }
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

    // ═══════════════ 设置页(React):渠道 / 提示词来源 / 安全 / 输出 / 导入导出 ═══════════════
    function SettingsPage() {
      var _c = useState(null)
      var cfg = _c[0]; var setCfg = _c[1]
      var _s = useState('')
      var msg = _s[1]
      var _saving = useState(false)
      var saving = _saving[0]; var setSaving = _saving[1]
      var _ch = useState(0)
      var chIdx = _ch[0]; var setChIdx = _ch[1]
      var _models = useState({})
      var modelsMap = _models[0]; var setModels = _models[1]
      var fileRef = useRef(null)

      useEffect(function () {
        apiGet(API.config).then(function (c) {
          if ((!c.channels || !c.channels.length) && c.baseURL) {
            c.channels = [{ id: 'default', name: '默认渠道', baseURL: c.baseURL, apiKey: c.apiKey, model: c.model }]
            c.activeChannelId = 'default'
          }
          if (!c.channels) c.channels = []
          if (!c.promptSources) c.promptSources = []
          setCfg(c)
        }).catch(function () {})
      }, [])
      if (!cfg) return h('div', { style: { padding: 20, color: MUTED } }, '加载中…')

      function upd(k, v) { setCfg(function (prev) { var o = Object.assign({}, prev); o[k] = v; return o }) }
      function updCh(i, k, v) {
        setCfg(function (prev) {
          var o = Object.assign({}, prev)
          var chs = o.channels.slice()
          chs[i] = Object.assign({}, chs[i]); chs[i][k] = v
          o.channels = chs
          return o
        })
      }
      function addChannel() {
        setCfg(function (prev) {
          var o = Object.assign({}, prev)
          var chs = o.channels.slice()
          var id = 'ch_' + Date.now().toString(36)
          chs.push({ id: id, name: '渠道 ' + (chs.length + 1), baseURL: '', apiKey: '', model: '' })
          o.channels = chs
          if (!o.activeChannelId) o.activeChannelId = id
          return o
        })
        setChIdx(cfg.channels.length)
      }
      function delChannel(i) {
        setCfg(function (prev) {
          var o = Object.assign({}, prev)
          var chs = o.channels.slice()
          var removed = chs.splice(i, 1)[0]
          o.channels = chs
          if (o.activeChannelId === removed.id) o.activeChannelId = chs.length ? chs[0].id : ''
          return o
        })
      }
      function fetchModels(i) {
        var ch = cfg.channels[i]
        apiPost(API.models, { baseURL: ch.baseURL, apiKey: ch.apiKey }).then(function (r) {
          if (r.models && r.models.length) {
            var m = Object.assign({}, modelsMap); m[i] = r.models; setModels(m)
            msg('拉到 ' + r.models.length + ' 个模型')
          } else msg('拉取失败: ' + (r.error || '无模型'))
          setTimeout(function () { msg('') }, 2500)
        }).catch(function () { msg('拉取失败') })
      }
      function onSave() {
        setSaving(true)
        var toSave = Object.assign({}, cfg)
        // 同步当前渠道到主字段(工具/向后兼容)
        var ch = toSave.channels && (toSave.channels.find(function (c) { return c.id === toSave.activeChannelId }) || toSave.channels[0])
        if (ch) { toSave.baseURL = ch.baseURL; toSave.apiKey = ch.apiKey; toSave.model = ch.model || toSave.model }
        apiPost(API.config, toSave).then(function (r) {
          setSaving(false)
          msg(r.ok ? '✓ 已保存' : '保存失败')
          setTimeout(function () { msg('') }, 2000)
        }).catch(function () { setSaving(false); msg('保存失败') })
      }
      function doExport() {
        var blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' })
        var a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = 'ark9-canvas-config.json'
        a.click()
        URL.revokeObjectURL(a.href)
      }
      function doImport(e) {
        var f = e.target.files && e.target.files[0]
        if (!f) return
        var rd = new FileReader()
        rd.onload = function () {
          try {
            var j = JSON.parse(rd.result)
            if (j && typeof j === 'object') { setCfg(j); msg('已导入,记得保存') }
            else msg('格式不对')
          } catch (err) { msg('解析失败: ' + err.message) }
          setTimeout(function () { msg('') }, 2500)
        }
        rd.readAsText(f)
        e.target.value = ''
      }

      var fieldStyle = { width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.16)', background: 'rgba(255,255,255,0.06)', color: 'inherit', fontSize: 13 }
      var labelStyle = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginBottom: 12 }
      var sectionTitle = { fontWeight: 700, fontSize: 13, margin: '8px 0 10px', paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.1)' }
      var smallBtn = { padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: 'inherit', cursor: 'pointer', fontSize: 12 }

      var ch = cfg.channels && cfg.channels[chIdx]
      return h('div', { style: { padding: 20, maxWidth: 620, color: FG, fontFamily: 'system-ui, sans-serif' } },
        h('h2', { style: { margin: '0 0 6px', fontSize: 18 } }, 'Ark9 生图'),
        h('p', { style: { fontSize: 12, color: MUTED, margin: '0 0 14px' } }, 'OpenAI 兼容图片 API。支持多渠道聚合;当前渠道供 Agent 与面板默认使用。'),

        // ── 渠道 ──
        h('div', { style: sectionTitle }, '渠道'),
        cfg.channels.length ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 } },
          cfg.channels.map(function (c, i) {
            return h('button', {
              key: c.id, onClick: function () { setChIdx(i) },
              style: Object.assign({}, smallBtn, {
                background: i === chIdx ? ACCENT : 'rgba(255,255,255,0.08)',
                borderColor: c.id === cfg.activeChannelId ? ACCENT_SOLID : 'rgba(255,255,255,0.2)',
                fontWeight: c.id === cfg.activeChannelId ? 700 : 400,
              }),
            }, (c.id === cfg.activeChannelId ? '● ' : '') + (c.name || c.id))
          })) : h('div', { style: { fontSize: 12, color: MUTED, marginBottom: 10 } }, '无渠道,点「新增渠道」'),
        h('div', { style: { display: 'flex', gap: 6, marginBottom: 12 } },
          h('button', { onClick: addChannel, style: smallBtn }, '+ 新增渠道'),
          ch ? h('button', { onClick: function () { upd('activeChannelId', ch.id); msg('已设为当前渠道'); setTimeout(function () { msg('') }, 1500) }, style: smallBtn }, '设为当前') : null,
          (ch && cfg.channels.length > 1) ? h('button', { onClick: function () { delChannel(chIdx); setChIdx(0) }, style: Object.assign({}, smallBtn, { color: '#ff8a80' }) }, '删除该渠道') : null),
        ch ? h('div', null,
          h('label', { style: labelStyle }, '渠道名称',
            h('input', { value: ch.name || '', onChange: function (e) { updCh(chIdx, 'name', e.target.value) }, style: fieldStyle })),
          h('label', { style: labelStyle }, 'BaseURL(含 /v1)',
            h('input', { value: ch.baseURL || '', onChange: function (e) { updCh(chIdx, 'baseURL', e.target.value) }, placeholder: 'https://api.openai.com/v1 或任意 OpenAI 兼容中转(含 /v1)', style: fieldStyle })),
          h('label', { style: labelStyle }, 'API Key',
            h('input', { value: ch.apiKey || '', onChange: function (e) { updCh(chIdx, 'apiKey', e.target.value) }, placeholder: 'sk-...', type: 'password', style: fieldStyle })),
          h('label', { style: labelStyle }, '默认模型(可手动输入任意模型名,或点「拉取模型」从列表选)',
            h('div', { style: { display: 'flex', gap: 8 } },
              h('input', { value: ch.model || '', onChange: function (e) { updCh(chIdx, 'model', e.target.value) }, placeholder: 'gpt-image-2（支持手动填）', style: Object.assign({ flex: 1 }, fieldStyle) }),
              h('button', { onClick: function () { fetchModels(chIdx) }, style: smallBtn }, '拉取模型'))),
          (modelsMap[chIdx] && modelsMap[chIdx].length) ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 } },
            modelsMap[chIdx].map(function (m) {
              return h('button', {
                key: m.id, onClick: function () { updCh(chIdx, 'model', m.id) },
                style: { padding: '4px 10px', borderRadius: 999, border: '1px solid ' + ACCENT_SOLID, background: ch.model === m.id ? ACCENT_SOLID : 'transparent', color: ch.model === m.id ? '#0b1220' : ACCENT_SOLID, cursor: 'pointer', fontSize: 12 },
              }, m.name || m.id)
            })) : null,
        ) : null,

        // ── 安全 ──
        h('div', { style: sectionTitle }, '安全(Agent 审批)'),
        h('label', { style: labelStyle }, 'Agent 生图审批',
          h('select', { value: cfg.agentApproval || 'always', onChange: function (e) { upd('agentApproval', e.target.value) }, style: fieldStyle },
            h('option', { value: 'always' }, '每次都需要我批准(默认)'),
            h('option', { value: 'never' }, '免审批(Agent 直接生成,注意计费)'))),
        h('label', { style: labelStyle }, '审批等待超时(秒,5-600)',
          h('input', { value: String(cfg.approvalTimeoutSec != null ? cfg.approvalTimeoutSec : 120), onChange: function (e) { upd('approvalTimeoutSec', Number(e.target.value) || 120) }, style: fieldStyle })),

        // ── 提示词来源 ──
        h('div', { style: sectionTitle }, '提示词来源(JSON 数组 [{title,prompt,tags?}])'),
        (cfg.promptSources || []).map(function (s, i) {
          return h('div', { key: s.id || i, style: { display: 'flex', gap: 6, marginBottom: 6 } },
            h('input', { value: s.name || '', onChange: function (e) { var arr = cfg.promptSources.slice(); arr[i] = Object.assign({}, s, { name: e.target.value }); upd('promptSources', arr) }, placeholder: '名称', style: Object.assign({}, fieldStyle, { width: 120, flexShrink: 0 }) }),
            h('input', { value: s.url || '', onChange: function (e) { var arr = cfg.promptSources.slice(); arr[i] = Object.assign({}, s, { url: e.target.value }); upd('promptSources', arr) }, placeholder: 'https://.../prompts.json', style: Object.assign({}, fieldStyle, { flex: 1 }) }),
            h('button', { onClick: function () { var arr = cfg.promptSources.slice(); arr.splice(i, 1); upd('promptSources', arr) }, style: Object.assign({}, smallBtn, { color: '#ff8a80' }) }, '删除'))
        }),
        h('button', { onClick: function () { var arr = (cfg.promptSources || []).slice(); arr.push({ id: 'ps_' + Date.now().toString(36), name: '来源 ' + (arr.length + 1), url: '' }); upd('promptSources', arr) }, style: Object.assign({}, smallBtn, { marginBottom: 12 }) }, '+ 新增来源'),

        // ── 输出 ──
        h('div', { style: sectionTitle }, '输出'),
        h('label', { style: labelStyle }, '输出目录(留空 = ~/Pictures/ark9-canvas)',
          h('input', { value: cfg.outputDir || '', onChange: function (e) { upd('outputDir', e.target.value) }, placeholder: 'D:/my-images', style: fieldStyle })),

        // ── 保存/导入导出 ──
        h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' } },
          h('button', { onClick: onSave, disabled: saving, style: { padding: '8px 24px', borderRadius: 8, border: '0', background: 'linear-gradient(135deg,#4f8cff,#7c5cff)', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13 } }, saving ? '保存中…' : '保存配置'),
          h('button', { onClick: doExport, style: smallBtn }, '导出配置'),
          h('button', { onClick: function () { fileRef.current && fileRef.current.click() }, style: smallBtn }, '导入配置'),
          h('input', { ref: fileRef, type: 'file', accept: 'application/json', style: { display: 'none' }, onChange: doImport }),
          h('span', { style: { fontSize: 12, color: MUTED } }, msg)),
      )
    }

    // ═══════════════ sidebar inline 包裹 ═══════════════
    function Ark9PanelInline(props) {
      var ref = useRef(null)
      useEffect(function () {
        if (!props.visible || !ref.current) return
        ref.current.innerHTML = ''
        var host = document.createElement('div')
        host.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:0;'
        ref.current.appendChild(host)
        return mountPanelContent(host, { inline: true })
      }, [props.visible])
      if (!props.visible) return null
      return h('div', { ref: ref, style: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' } })
    }

    // ═══════════════ apply ═══════════════
    function apply(ctx) {
      var slots = ctx.slots
      try {
        slots.inject('settings.section', function () {
          return slots.register({ name: 'settings.section', id: 'ark9-canvas-pre', order: 31, label: 'Ark9 生图' }, function () {
            return h(SettingsPage, null)
          })
        })
      } catch (e) {
        console.error('[dsh-ark9canvas] settings.section 注册失败:', e)
      }

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
