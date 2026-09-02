/* dsh-ark9canvas — browser half (v0.4.0).
 * Surfaces (same mechanism as dsh-cua-pre):
 *   1. floating FAB (fixed right-bottom; auto-stacks above dsh-cua FAB; badge = pending approvals)
 *   2. Better Sidebar tab via ctx.get('betterSidebar') — replaces FAB
 *   3. settings.section — channels / prompt sources / security / output / import-export
 * Panel content = one vanilla-DOM implementation shared by floating panel and sidebar tab.
 * Bilingual UI (zh/en, persisted, per-panel toggle). Stroke SVG icons throughout —
 * no emoji, matching the DeepSeek Harness visual language.
 */
console.log('[dsh-ark9canvas] client v0.4.0 loading')
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

    // ───────────────────────── 主题令牌(自动明暗适配,CSS 变量实时跟随) ─────────────────────────
    var DARK = {
      fg: '#e8eaf0', bg: 'rgba(22,26,34,0.94)', border: 'rgba(255,255,255,0.16)', borderSoft: 'rgba(255,255,255,0.1)',
      muted: 'rgba(232,234,240,0.55)', inputBg: 'rgba(255,255,255,0.06)', inputBorder: 'rgba(255,255,255,0.14)',
      btnBg: 'rgba(255,255,255,0.08)', btnBorder: 'rgba(255,255,255,0.18)', cardBg: 'rgba(255,255,255,0.04)', cardBorder: 'rgba(255,255,255,0.12)',
      accent: 'rgba(121,192,255,0.25)', accentStrong: 'rgba(121,192,255,0.92)', accentSolid: '#79c0ff',
      okBg: 'rgba(76,175,80,0.25)', okFg: '#a5d6a7', errBg: 'rgba(244,67,54,0.22)', errFg: '#ff8a80',
      warnBg: 'rgba(255,193,7,0.15)', warnBorder: 'rgba(255,193,7,0.4)', warnFg: '#ffe08a',
      imgBorder: 'rgba(255,255,255,0.18)', fabBg: 'rgba(30,34,44,0.88)', shadow: '0 16px 48px rgba(0,0,0,0.45)',
    }
    var LIGHT = {
      fg: '#1f2328', bg: 'rgba(255,255,255,0.97)', border: 'rgba(0,0,0,0.14)', borderSoft: 'rgba(0,0,0,0.08)',
      muted: 'rgba(31,35,40,0.62)', inputBg: 'rgba(0,0,0,0.03)', inputBorder: 'rgba(0,0,0,0.18)',
      btnBg: 'rgba(0,0,0,0.04)', btnBorder: 'rgba(0,0,0,0.16)', cardBg: 'rgba(0,0,0,0.02)', cardBorder: 'rgba(0,0,0,0.1)',
      accent: 'rgba(9,105,218,0.14)', accentStrong: 'rgba(9,105,218,0.85)', accentSolid: '#0969da',
      okBg: 'rgba(31,142,79,0.12)', okFg: '#1a7f37', errBg: 'rgba(207,34,46,0.1)', errFg: '#cf222e',
      warnBg: 'rgba(154,103,0,0.1)', warnBorder: 'rgba(154,103,0,0.4)', warnFg: '#7a5c00',
      imgBorder: 'rgba(0,0,0,0.15)', fabBg: 'rgba(255,255,255,0.95)', shadow: '0 16px 48px rgba(0,0,0,0.18)',
    }
    function detectDark() {
      try {
        var el = document.documentElement
        if (el.classList.contains('dark')) return true
        if (el.classList.contains('light')) return false
        var scheme = String(getComputedStyle(el).colorScheme || getComputedStyle(el).getPropertyValue('color-scheme') || '')
        if (scheme.indexOf('dark') >= 0) return true
        if (scheme.indexOf('light') >= 0) return false
        var bg = getComputedStyle(document.body || el).backgroundColor
        var m = bg.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/)
        if (m) return (0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]) / 255 < 0.5
      } catch (e) {}
      return true
    }
    var themedRoots = new Set()
    var themeListeners = new Set()
    function applyThemeVars(el) {
      var p = detectDark() ? DARK : LIGHT
      for (var k in p) { try { el.style.setProperty('--ak-' + k, p[k]) } catch (e) {} }
      themedRoots.add(el)
      watchTheme()
      return el
    }
    var themeObserver = null
    function watchTheme() {
      if (themeObserver || typeof document === 'undefined' || !document.documentElement) return
      try {
        themeObserver = new MutationObserver(function () {
          themedRoots.forEach(function (el2) { applyThemeVars(el2) })
          themeListeners.forEach(function (fn) { try { fn() } catch (e) {} })
        })
        var opts = { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'color-scheme'] }
        themeObserver.observe(document.documentElement, opts)
        if (document.body) themeObserver.observe(document.body, opts)
      } catch (e) {}
    }
    // 常量=CSS 变量引用(所有内联样式经 var() 读取,主题切换由变量更新自动生效)
    var GLASS_BG = 'var(--ak-bg)'
    var GLASS_BORDER = 'var(--ak-border)'
    var FG = 'var(--ak-fg)'
    var MUTED = 'var(--ak-muted)'
    var ACCENT = 'var(--ak-accent)'
    var ACCENT_SOLID = 'var(--ak-accent-solid)'
    var OK_BG = 'var(--ak-ok-bg)'
    var ERR_BG = 'var(--ak-err-bg)'
    var WARN_BG = 'var(--ak-warn-bg)'

    // ───────────────────────── i18n(zh/en,localStorage 持久化) ─────────────────────────
    var I18N = {
      zh: {
        tabGenerate: '生成', tabApprovals: '审批', tabPrompts: '提示词', tabHistory: '记录', tabAbout: '说明',
        pendingBadge: '{0} 待审批', langBtn: 'EN',
        noConfigWarn: '未配置渠道。请到 设置 → Ark9 生图 添加你自己的渠道(baseURL 含 /v1、API Key、模型名——可手动输入任意模型名,或拉取列表点选)。',
        modelPlaceholder: '模型名,如 gpt-image-2(可手动输入)', fetchModels: '拉取模型', fetchFail: '拉取失败: ',
        promptLabel: '提示词', promptPlaceholder: '描述画面主体、风格、构图、光线和用途…',
        refsLabel: '参考图(可选,图生图)', clipboard: '剪切板', upload: '上传', clear: '清空', removeRef: '点击移除',
        presetMode: '比例预设', manualMode: '手动 W×H', currentSize: '当前: {0}',
        align16: '16 倍数对齐',
        quality: '质量', qAuto: '自动', qLow: '低', qMedium: '中', qHigh: '高',
        background: '背景', bgOpaque: '不透明', bgTransparent: '透明', count: '张数', nImages: '{0} 张',
        generate: '开始生成', generating: '生成中…', submitting: '提交中…',
        enterPrompt: '请输入提示词', configFirst: '请先在设置页配置图片 API',
        submitFail: '提交失败: ', genFail: '生成失败', timeout: '超时',
        doneCount: '完成 {0} 张', failNote: ',失败 {0} 张',
        retry: '重试', retryFailedBatch: '重试失败批次', downloadN: '下载第 {0} 张',
        clipboardNoImage: '剪切板里没有图片', clipboardFail: '读取剪切板失败: ', clipboardUnavailable: '剪切板 API 不可用',
        approvalsDesc: 'Agent 发起的生图请求在这里等待你批准;批准后才开始生成(才会计费)。',
        noPending: '暂无待审批请求', agentReq: 'Agent 生图请求', waited: '已等待 {0}s',
        approve: '批准', deny: '拒绝', refCount: '参考图 x{0}',
        localFav: '★ 本地收藏', searchPh: '搜索提示词…', noMatch: '无匹配',
        emptyFav: '收藏为空:在提示词条目上点 ☆ 收藏', sourceGone: '来源不存在',
        pulling: '拉取中: {0}…', lastFetch: '上次拉取: ', untitled: '(无标题)',
        favAdd: '收藏到本地', favRemove: '取消收藏',
        selectAll: '全选/反选', deleteSel: '删除选中', clearLogs: '清空记录', noLogs: '暂无生成记录',
        savedAt: '保存于 {0}', pillOk: '成功', pillPartial: '部分成功', pillFail: '失败',
        noImagesInLog: '该记录没有已保存的图片',
        about1: 'Ark9 生图 — DSH 生图插件(独立实现,OpenAI 兼容图片 API)。',
        about2: '生成:比例预设/手动 W×H(16 对齐)/透明背景/批量 1-10 张/模型切换/剪切板贴参考图。',
        about3: '审批:Agent 生图默认在此等待批准(设置页可改免审批/超时)。',
        about4: '提示词:本地收藏 + 自定义 JSON 来源(设置页添加,经本机代理拉取)。',
        about5: '记录:生成历史,失败可重试,可多选删除。',
        about6: 'Agent 工具:ark9_generate_image / ark9_list_images。',
        about7: '装了 dsh-better-sidebar 时本面板注册为侧栏页签;装了 dsh-cua 时 FAB 自动堆叠其上。',
        about8: '尺寸:gpt-image 系自动吸附标准三档(1024x1024/1536x1024/1024x1536);其他模型按质量预算(低1K/中2K/高4K)+16px 对齐计算。',
        settingsTitle: 'Ark9 生图', settingsDesc: 'OpenAI 兼容图片 API。支持多渠道聚合;当前渠道供 Agent 与面板默认使用。',
        loading: '加载中…', channelsTitle: '渠道', addChannel: '+ 新增渠道', setActive: '设为当前',
        delChannel: '删除该渠道', noChannelYet: '无渠道,点「新增渠道」', setActiveMsg: '已设为当前渠道',
        channelName: '渠道名称', baseURLLabel: 'BaseURL(含 /v1)',
        baseURLPh: 'https://api.openai.com/v1 或任意 OpenAI 兼容中转(含 /v1)',
        apiKeyLabel: 'API Key', modelLabel: '默认模型(可手动输入任意模型名,或点「拉取模型」从列表选)',
        modelPh: 'gpt-image-2(支持手动填)',
        securityTitle: '安全(Agent 审批)', approvalLabel: 'Agent 生图审批',
        approvalAlways: '每次都需要我批准(默认)', approvalNever: '免审批(Agent 直接生成,注意计费)',
        timeoutLabel: '审批等待超时(秒,5-600)',
        sourcesTitle: '提示词来源(JSON 数组 [{title,prompt,tags?}])', sourceNamePh: '名称',
        sourceUrlPh: 'https://example.com/prompts.json', del: '删除', addSource: '+ 新增来源',
        outputTitle: '输出', outputDirLabel: '输出目录(留空 = ~/Pictures/ark9-canvas)', outputDirPh: 'D:/my-images',
        save: '保存配置', saving: '保存中…', saveFail: '保存失败', savedOk: '✓ 已保存',
        exportCfg: '导出配置', importCfg: '导入配置', importedMsg: '已导入,记得保存',
        importedBad: '格式不对', parseFail: '解析失败: ', modelsFetched: '拉到 {0} 个模型',
        fetchFailedMsg: '拉取失败: ', noModels: '无模型',
      },
      en: {
        tabGenerate: 'Generate', tabApprovals: 'Approvals', tabPrompts: 'Prompts', tabHistory: 'History', tabAbout: 'About',
        pendingBadge: '{0} pending', langBtn: '中',
        noConfigWarn: 'No channel yet. Go to Settings → Ark9 Canvas and add your own channel (baseURL with /v1, API key, model name — type any model manually or fetch the list).',
        modelPlaceholder: 'Model, e.g. gpt-image-2 (type to override)', fetchModels: 'Fetch models', fetchFail: 'Fetch failed: ',
        promptLabel: 'Prompt', promptPlaceholder: 'Describe subject, style, composition, lighting, and purpose…',
        refsLabel: 'References (optional, img2img)', clipboard: 'Clipboard', upload: 'Upload', clear: 'Clear', removeRef: 'Click to remove',
        presetMode: 'Presets', manualMode: 'Manual W×H', currentSize: 'Current: {0}',
        align16: '16-multiple align',
        quality: 'Quality', qAuto: 'Auto', qLow: 'Low', qMedium: 'Medium', qHigh: 'High',
        background: 'Background', bgOpaque: 'Opaque', bgTransparent: 'Transparent', count: 'Count', nImages: '{0} imgs',
        generate: 'Generate', generating: 'Generating…', submitting: 'Submitting…',
        enterPrompt: 'Enter a prompt', configFirst: 'Configure an image API in Settings first',
        submitFail: 'Submit failed: ', genFail: 'Generation failed', timeout: 'Timed out',
        doneCount: 'Done: {0} image(s)', failNote: ', {0} failed',
        retry: 'Retry', retryFailedBatch: 'Retry failed batch', downloadN: 'Download #{0}',
        clipboardNoImage: 'No image in clipboard', clipboardFail: 'Clipboard read failed: ', clipboardUnavailable: 'Clipboard API unavailable',
        approvalsDesc: 'Agent-initiated requests wait here for your approval; generation (and billing) starts only after you approve.',
        noPending: 'No pending approvals', agentReq: 'Agent image request', waited: 'waited {0}s',
        approve: 'Approve', deny: 'Deny', refCount: 'refs ×{0}',
        localFav: '★ Favorites', searchPh: 'Search prompts…', noMatch: 'No match',
        emptyFav: 'Nothing saved yet — tap ☆ on any prompt to keep it here', sourceGone: 'Source missing',
        pulling: 'Fetching: {0}…', lastFetch: 'Last fetch: ', untitled: '(untitled)',
        favAdd: 'Save locally', favRemove: 'Remove favorite',
        selectAll: 'Select all', deleteSel: 'Delete selected', clearLogs: 'Clear logs', noLogs: 'No generation history',
        savedAt: 'Saved in {0}', pillOk: 'Succeeded', pillPartial: 'Partial', pillFail: 'Failed',
        noImagesInLog: 'No saved images for this entry',
        about1: 'Ark9 Canvas — image generation plugin for DSH (independent implementation, OpenAI-compatible APIs).',
        about2: 'Generate: aspect presets / manual W×H (16-align) / transparent background / batch 1–10 / model switch / clipboard references.',
        about3: 'Approvals: agent generations wait here for your approval by default (mode & timeout in Settings).',
        about4: 'Prompts: local favorites + custom JSON sources (added in Settings, fetched via host proxy).',
        about5: 'History: generation log with retry, multi-select delete.',
        about6: 'Agent tools: ark9_generate_image / ark9_list_images.',
        about7: 'With dsh-better-sidebar this panel becomes a sidebar tab; with dsh-cua the FAB stacks above its button.',
        about8: 'Sizes: gpt-image models snap to the three native sizes (1024x1024/1536x1024/1024x1536); others use quality budget (low 1K / medium 2K / high 4K) + 16px alignment.',
        settingsTitle: 'Ark9 Canvas', settingsDesc: 'OpenAI-compatible image APIs. Multi-channel; the active channel serves both agent tools and the workbench.',
        loading: 'Loading…', channelsTitle: 'Channels', addChannel: '+ Add channel', setActive: 'Set active',
        delChannel: 'Delete channel', noChannelYet: 'No channels yet — click "Add channel"', setActiveMsg: 'Set as active',
        channelName: 'Channel name', baseURLLabel: 'BaseURL (with /v1)',
        baseURLPh: 'https://api.openai.com/v1 or any OpenAI-compatible relay (with /v1)',
        apiKeyLabel: 'API Key', modelLabel: 'Default model (type any model name, or fetch and pick from the list)',
        modelPh: 'gpt-image-2 (manual input supported)',
        securityTitle: 'Security (Agent approvals)', approvalLabel: 'Agent image approval',
        approvalAlways: 'Approve every request (default)', approvalNever: 'No approval (agent generates directly — mind billing)',
        timeoutLabel: 'Approval timeout (seconds, 5-600)',
        sourcesTitle: 'Prompt sources (JSON array [{title,prompt,tags?}])', sourceNamePh: 'Name',
        sourceUrlPh: 'https://example.com/prompts.json', del: 'Delete', addSource: '+ Add source',
        outputTitle: 'Output', outputDirLabel: 'Output directory (empty = ~/Pictures/ark9-canvas)', outputDirPh: 'D:/my-images',
        save: 'Save', saving: 'Saving…', saveFail: 'Save failed', savedOk: '✓ Saved',
        exportCfg: 'Export config', importCfg: 'Import config', importedMsg: 'Imported — remember to save',
        importedBad: 'Invalid format', parseFail: 'Parse failed: ', modelsFetched: 'Fetched {0} models',
        fetchFailedMsg: 'Fetch failed: ', noModels: 'no models',
      },
    }
    var localeListeners = new Set()
    var LOCALE_KEY = 'ark9.locale'
    var locale = 'zh'
    try {
      var savedLocale = localStorage.getItem(LOCALE_KEY)
      if (savedLocale === 'zh' || savedLocale === 'en') locale = savedLocale
      else locale = (navigator.language || 'zh').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en'
    } catch (e) {}
    function t(key) { return (I18N[locale] && I18N[locale][key]) || I18N.zh[key] || key }
    function tf(key) {
      var s = t(key)
      for (var i = 1; i < arguments.length; i++) s = s.split('{' + (i - 1) + '}').join(String(arguments[i]))
      return s
    }
    function setLocale(l) {
      if (l !== 'zh' && l !== 'en') return
      if (l === locale) return
      locale = l
      try { localStorage.setItem(LOCALE_KEY, l) } catch (e) {}
      localeListeners.forEach(function (fn) { try { fn(l) } catch (e) {} })
    }
    function onLocale(fn) { localeListeners.add(fn); return function () { localeListeners.delete(fn) } }
    function useLocale() {
      var _s = useState(locale)
      var cur = _s[0]; var force = _s[1]
      useEffect(function () {
        return onLocale(function () { force(function (x) { return x + 1 }) })
      }, [])
      return cur
    }

    // ───────────────────────── 线性 SVG 图标(替代 emoji,贴合 DSH 视觉) ─────────────────────────
    function svgIcon(name, size) {
      var s = size || 16
      var p = {
        image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
        clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
        upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
        trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
        retry: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
        x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
        check: '<polyline points="20 6 9 17 4 12"/>',
        refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
        star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
      }[name] || ''
      return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px">' + p + '</svg>'
    }
    function iconSpan(name, size) {
      var sp = document.createElement('span')
      sp.style.cssText = 'display:inline-flex;align-items:center;'
      sp.innerHTML = svgIcon(name, size)
      return sp
    }

    // ───────────────────────── 尺寸系统(canvas 同款公式) ─────────────────────────
    var QUALITY_BUDGET = { low: 1024, medium: 2048, high: 2880 }
    var ALIGN = 16
    var STANDARD = ['1024x1024', '1536x1024', '1024x1536']
    function snapAlign(v) { return Math.max(16, Math.floor(v / ALIGN) * ALIGN) }
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
      return null
    }
    function ratioName(ratio) { return ratio.replace(/\(\w+\)/, '') }
    var QUALITIES = ['auto', 'low', 'medium', 'high']

    // ───────────────────────── 面板状态 ─────────────────────────
    function buildPanelState() {
      return {
        tab: 'generate',
        prompt: '', refs: [],
        sizeMode: 'preset', size: '1536x1024', ratio: '3:2', manualW: '1024', manualH: '1024', align16: true,
        transparent: false, quality: 'high', count: 1, model: '', models: [],
        busy: false, status: '', error: '', results: [],
        logs: [], logSel: {},
        prompts: [], promptSource: '_local', promptSearch: '', promptFetchError: '',
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
      root.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:0;color:var(--ak-fg);background:var(--ak-bg);font:13px/1.6 system-ui;'
      applyThemeVars(root)
      container.appendChild(root)

      var header = document.createElement('div')
      header.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--ak-border-soft);font-weight:700;font-size:13px;flex-shrink:0;'
      header.appendChild(iconSpan('image', 16))
      var title = document.createElement('span'); title.textContent = 'Ark9'; header.appendChild(title)
      var badge = document.createElement('span')
      badge.style.cssText = 'display:none;background:' + ERR_BG + ';border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;'
      header.appendChild(badge)
      var sp = document.createElement('span'); sp.style.cssText = 'flex:1'; header.appendChild(sp)
      // 语言切换
      var langBtn = document.createElement('button')
      langBtn.style.cssText = 'background:transparent;border:1px solid var(--ak-btn-border);border-radius:999px;color:inherit;opacity:.75;cursor:pointer;font-size:11px;padding:2px 8px;'
      function syncLang() { langBtn.textContent = t('langBtn') }
      syncLang()
      langBtn.onclick = function () {
        setLocale(locale === 'zh' ? 'en' : 'zh')
        syncLang(); renderTab(); refreshBadge()
      }
      header.appendChild(langBtn)
      if (!inline) {
        var closeBtn = document.createElement('button')
        closeBtn.style.cssText = 'background:transparent;border:0;color:inherit;opacity:.7;cursor:pointer;font-size:14px;display:inline-flex;align-items:center;'
        closeBtn.innerHTML = svgIcon('x', 16)
        closeBtn.onclick = function () { setPanelOpen(false) }
        header.appendChild(closeBtn)
      }
      root.appendChild(header)

      var tabsRow = document.createElement('div')
      tabsRow.style.cssText = 'display:flex;gap:4px;padding:8px 10px 0;flex-shrink:0;flex-wrap:wrap;'
      var TABS = [['generate', 'tabGenerate'], ['approvals', 'tabApprovals'], ['prompts', 'tabPrompts'], ['history', 'tabHistory'], ['about', 'tabAbout']]
      var tabBtns = {}
      TABS.forEach(function (tp) {
        var b = document.createElement('button')
        b.style.cssText = tabBtnCss(false)
        b.onclick = function () { st.tab = tp[0]; renderTab() }
        tabBtns[tp[0]] = b
        tabsRow.appendChild(b)
      })
      function syncTabs() { TABS.forEach(function (tp) { tabBtns[tp[0]].textContent = t(tp[1]); tabBtns[tp[0]].style.cssText = tabBtnCss(st.tab === tp[0]) }) }
      root.appendChild(tabsRow)

      var body = document.createElement('div')
      body.style.cssText = 'flex:1;overflow-y:auto;padding:12px 14px 14px;min-height:0;'
      root.appendChild(body)

      function tabBtnCss(active) {
        return 'padding:6px 12px;border:0;border-radius:999px;cursor:pointer;font-size:12px;' +
          'background:' + (active ? ACCENT : 'var(--ak-btn-bg)') + ';color:' + (active ? '#fff' : MUTED) + ';'
      }
      function el(tag, cssText, text) {
        var e = document.createElement(tag)
        if (cssText) e.style.cssText = cssText
        if (text !== undefined) e.textContent = text
        return e
      }
      function inputCss() {
        return 'width:100%;box-sizing:border-box;padding:7px 9px;border-radius:8px;border:1px solid var(--ak-input-border);background:var(--ak-input-bg);color:inherit;font:inherit;font-size:12px;'
      }
      function miniBtn(text, cssExtra, onclick, iconName) {
        var b = el('button', 'display:inline-flex;align-items:center;gap:5px;justify-content:center;padding:5px 10px;border-radius:8px;border:1px solid var(--ak-btn-border);background:var(--ak-btn-bg);color:inherit;cursor:pointer;font-size:12px;' + (cssExtra || ''))
        if (iconName) b.innerHTML = svgIcon(iconName, 13) + '<span>' + text + '</span>'
        else b.textContent = text
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
        if (!st.ratio) return 'auto'
        var budget = ratioBudget(st.ratio) || st.quality
        var raw = ratioToSize(ratioName(st.ratio), budget)
        return snapForGpt(st.model || (st.cfg && st.cfg.model), raw)
      }

      // ─────── 生成页 ───────
      function renderGenerate() {
        body.innerHTML = ''
        if (!st.cfg) st.cfg = {}
        if (!st.cfg.baseURL && !(st.cfg.channels && st.cfg.channels.length)) {
          body.appendChild(el('div', 'background:' + WARN_BG + ';border:1px solid var(--ak-warn-border);color:var(--ak-warn-fg);padding:8px 10px;border-radius:8px;font-size:12px;margin-bottom:10px;', t('noConfigWarn')))
        }
        var modelRow = el('div', 'display:flex;gap:8px;align-items:center;margin-bottom:10px;')
        var modelInput = document.createElement('input')
        modelInput.setAttribute('list', 'ark9-model-list')
        modelInput.placeholder = t('modelPlaceholder')
        modelInput.style.cssText = 'flex:1;padding:7px 9px;border-radius:8px;border:1px solid var(--ak-input-border);background:var(--ak-input-bg);color:inherit;font:inherit;font-size:12px;box-sizing:border-box;'
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
        modelRow.appendChild(miniBtn(t('fetchModels'), '', function () {
          apiPost(API.models, {}).then(function (r) {
            if (r.models && r.models.length) { st.models = r.models; fillModelOptions() }
            else if (r.error) { st.error = t('fetchFail') + r.error; renderTab() }
          }).catch(function () {})
        }, 'refresh'))
        body.appendChild(modelRow)

        body.appendChild(el('div', 'font-weight:600;margin-bottom:4px;', t('promptLabel')))
        var ta = el('textarea')
        ta.value = st.prompt
        ta.placeholder = t('promptPlaceholder')
        ta.rows = 4
        ta.style.cssText = inputCss() + 'resize:vertical;font-size:13px;'
        ta.oninput = function () { st.prompt = ta.value }
        body.appendChild(ta)

        var refHead = el('div', 'display:flex;align-items:center;gap:8px;margin:10px 0 4px;')
        refHead.appendChild(el('div', 'font-weight:600;', t('refsLabel')))
        var refSp = el('span', 'flex:1'); refHead.appendChild(refSp)
        refHead.appendChild(miniBtn(t('clipboard'), '', function () {
          if (!navigator.clipboard || !navigator.clipboard.read) { st.error = t('clipboardUnavailable'); return renderTab() }
          navigator.clipboard.read().then(function (items) {
            var found = false
            items.forEach(function (it) {
              var type = it.types.find(function (tp) { return tp.indexOf('image/') === 0 })
              if (type && st.refs.length < 4) {
                found = true
                it.getType(type).then(function (blob) {
                  var rd = new FileReader()
                  rd.onload = function () { if (rd.result) { st.refs.push(rd.result); renderTab() } }
                  rd.readAsDataURL(blob)
                })
              }
            })
            if (!found) { st.status = t('clipboardNoImage'); setTimeout(function () { st.status = ''; renderTab() }, 1500) }
          }).catch(function (e) { st.error = t('clipboardFail') + e.message; renderTab() })
        }, 'clipboard'))
        refHead.appendChild(miniBtn(t('upload'), '', function () { fileInput.click() }, 'upload'))
        refHead.appendChild(miniBtn(t('clear'), '', function () { st.refs = []; renderTab() }))
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
          im.style.cssText = 'width:52px;height:52px;object-fit:cover;border-radius:6px;border:1px solid var(--ak-img-border);cursor:pointer;'
          im.title = t('removeRef')
          im.onclick = function () { st.refs.splice(i, 1); renderTab() }
          refThumbs.appendChild(im)
        })
        body.appendChild(refThumbs)

        var modeRow = el('div', 'display:flex;gap:6px;margin-bottom:6px;')
        modeRow.appendChild(miniBtn(t('presetMode'), st.sizeMode === 'preset' ? 'background:' + ACCENT + ';color:#fff;' : '', function () { st.sizeMode = 'preset'; renderTab() }))
        modeRow.appendChild(miniBtn(t('manualMode'), st.sizeMode === 'manual' ? 'background:' + ACCENT + ';color:#fff;' : '', function () { st.sizeMode = 'manual'; renderTab() }))
        var curSz = el('span', 'flex:1;text-align:right;font-size:11px;color:' + MUTED + ';align-self:center;', tf('currentSize', currentSize() || 'auto'))
        modeRow.appendChild(curSz)
        body.appendChild(modeRow)

        if (st.sizeMode === 'preset') {
          var grid = el('div', 'display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-bottom:10px;')
          var allRatios = RATIOS.concat(['auto'])
          allRatios.forEach(function (r) {
            var isActive = r === 'auto' ? st.ratio === '' : (st.ratio === r && st.sizeMode === 'preset')
            var b = el('button', 'padding:7px 0;border-radius:8px;border:1px solid ' + (isActive ? ACCENT_SOLID : 'var(--ak-input-border)') + ';background:' + (isActive ? ACCENT : 'var(--ak-input-bg)') + ';color:inherit;cursor:pointer;font-size:11px;', r)
            b.onclick = function () {
              if (r === 'auto') { st.size = 'auto'; st.ratio = '' }
              else { st.ratio = r; st.size = currentSize() }
              renderTab()
            }
            grid.appendChild(b)
          })
          body.appendChild(grid)
        } else {
          var whRow = el('div', 'display:flex;gap:8px;align-items:center;margin-bottom:6px;')
          var wIn = el('input'); wIn.value = st.manualW; wIn.placeholder = 'W'; wIn.style.cssText = inputCss() + 'width:90px;text-align:center;'
          wIn.oninput = function () { st.manualW = wIn.value; curSz.textContent = tf('currentSize', currentSize() || '?') }
          var xsp = el('span', 'color:' + MUTED + ';', '×')
          var hIn = el('input'); hIn.value = st.manualH; hIn.placeholder = 'H'; hIn.style.cssText = inputCss() + 'width:90px;text-align:center;'
          hIn.oninput = function () { st.manualH = hIn.value; curSz.textContent = tf('currentSize', currentSize() || '?') }
          whRow.appendChild(wIn); whRow.appendChild(xsp); whRow.appendChild(hIn)
          var alignLabel = el('label', 'display:flex;align-items:center;gap:5px;font-size:12px;color:' + MUTED + ';cursor:pointer;')
          var alignCb = document.createElement('input')
          alignCb.type = 'checkbox'; alignCb.checked = st.align16
          alignCb.onchange = function () { st.align16 = alignCb.checked; curSz.textContent = tf('currentSize', currentSize() || '?') }
          alignLabel.appendChild(alignCb); alignLabel.appendChild(document.createTextNode(t('align16')))
          whRow.appendChild(alignLabel)
          body.appendChild(whRow)
        }

        var paramRow = el('div', 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px;')
        function qLabel(q) { return q === 'auto' ? t('qAuto') : q === 'low' ? t('qLow') : q === 'medium' ? t('qMedium') : t('qHigh') }
        function mkSelect(label, values, cur, onchg) {
          var box = el('div')
          box.appendChild(el('div', 'font-size:11px;color:' + MUTED + ';margin-bottom:2px;', label))
          var s = document.createElement('select')
          s.style.cssText = 'width:100%;padding:5px;border-radius:6px;border:1px solid var(--ak-input-border);background:var(--ak-btn-bg);color:inherit;font-size:12px;'
          values.forEach(function (v) {
            var o = document.createElement('option'); o.value = String(v.v); o.textContent = v.label
            s.appendChild(o)
          })
          s.value = String(cur)
          s.onchange = function () { onchg(s.value) }
          box.appendChild(s)
          return box
        }
        paramRow.appendChild(mkSelect(t('quality'), QUALITIES.map(function (q) { return { v: q, label: qLabel(q) } }), st.quality, function (v) { st.quality = v; renderTab() }))
        paramRow.appendChild(mkSelect(t('background'), [{ v: 'opaque', label: t('bgOpaque') }, { v: 'transparent', label: t('bgTransparent') }], st.transparent ? 'transparent' : 'opaque', function (v) { st.transparent = v === 'transparent' }))
        paramRow.appendChild(mkSelect(t('count'), Array.from({ length: 10 }, function (_, i) { return { v: i + 1, label: tf('nImages', i + 1) } }), st.count, function (v) { st.count = Number(v) }))
        body.appendChild(paramRow)

        var genBtn = el('button', 'width:100%;padding:9px 0;border:0;border-radius:8px;cursor:pointer;font-weight:600;font-size:13px;background:linear-gradient(135deg,#4f8cff,#7c5cff);color:#fff;', st.busy ? t('generating') : t('generate'))
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
            im.style.cssText = 'width:100%;border-radius:8px;border:1px solid var(--ak-img-border);'
            resultBox.appendChild(im)
            var dl = el('a', 'font-size:12px;color:' + ACCENT_SOLID + ';text-align:center;text-decoration:none;', tf('downloadN', i + 1))
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
          genBtn.textContent = st.busy ? t('generating') : t('generate')
          genBtn.style.opacity = st.busy ? '0.7' : '1'
        }

        function doGenerate() {
          if (st.busy) return
          if (!st.prompt.trim()) { st.error = t('enterPrompt'); syncStatus(); renderTab(); return }
          if (!st.cfg || ((!st.cfg.baseURL) && !(st.cfg.channels && st.cfg.channels.length))) { st.error = t('configFirst'); syncStatus(); return }
          var sz = currentSize()
          var params = {
            prompt: st.prompt, images: st.refs, size: sz || 'auto',
            quality: st.quality, count: st.count,
            model: st.model || (st.cfg && st.cfg.model) || undefined,
            background: st.transparent ? 'transparent' : undefined,
          }
          st.error = ''; st.results = []; resultBox.innerHTML = ''
          st.busy = true; st.status = t('submitting'); syncStatus()
          apiPost(API.generate, params)
            .then(function (r) {
              if (r.error) throw new Error(r.error)
              poll(r.id, 0, Date.now())
            })
            .catch(function (e) { st.busy = false; st.status = ''; st.error = t('submitFail') + e.message; syncStatus() })
        }
        function poll(id, n, t0) {
          if (disposed) return
          apiPost(API.task, { id: id }).then(function (r) {
            if (r.status === 'succeeded' || (r.status === 'failed' && r.okCount > 0)) {
              return apiPost(API.taskResult, { id: id }).then(function (rr) {
                st.results = (rr.data || []).map(function (it) {
                  return { dataUrl: it.b64_json ? 'data:image/png;base64,' + it.b64_json : (it.url || '') }
                }).filter(function (x2) { return x2.dataUrl })
                st.busy = false
                var secs = Math.round((Date.now() - t0) / 1000)
                var failNote = rr.failCount ? tf('failNote', rr.failCount) : ''
                st.status = tf('doneCount', st.results.length) + failNote + ' (' + secs + 's)'
                syncStatus(); renderResults()
                if (rr.failCount) {
                  retryBox.innerHTML = ''
                  retryBox.appendChild(miniBtn(t('retryFailedBatch'), 'width:100%;margin-top:8px;background:' + ACCENT + ';color:#fff;border:0;', doGenerate, 'retry'))
                }
              })
            }
            if (r.status === 'failed') {
              st.busy = false; st.status = ''
              st.error = (r.error && r.error.message) || t('genFail')
              syncStatus()
              retryBox.innerHTML = ''
              retryBox.appendChild(miniBtn(t('retry'), 'width:100%;margin-top:8px;background:' + ACCENT + ';color:#fff;border:0;', doGenerate, 'retry'))
              return
            }
            if (n > 300) { st.busy = false; st.status = t('timeout'); syncStatus(); return }
            var secs2 = Math.round((Date.now() - t0) / 1000)
            st.status = t('generating') + ' ' + secs2 + 's'
            if (r.total > 1) st.status += ' (' + (r.okCount || 0) + '/' + r.total + ')'
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
        body.appendChild(el('div', 'font-size:12px;color:' + MUTED + ';margin-bottom:10px;', t('approvalsDesc')))
        var listBox = el('div', 'display:flex;flex-direction:column;gap:10px;')
        body.appendChild(listBox)
        function refresh() {
          if (disposed) return
          apiGet(API.approvals).then(function (r) {
            if (disposed) return
            listBox.innerHTML = ''
            var list = r.approvals || []
            if (!list.length) {
              listBox.appendChild(el('div', 'color:' + MUTED + ';font-size:12px;text-align:center;padding:20px 0;', t('noPending')))
              return
            }
            list.forEach(function (a) {
              var card = el('div', 'border:1px solid var(--ak-input-border);border-radius:10px;padding:10px;background:var(--ak-card-bg);')
              card.appendChild(el('div', 'font-weight:600;font-size:12px;margin-bottom:4px;', t('agentReq') + ' · ' + tf('waited', a.waitSec)))
              var p = el('div', 'font-size:12px;margin-bottom:6px;word-break:break-all;max-height:72px;overflow:auto;', a.prompt)
              card.appendChild(p)
              var pa = a.params || {}
              card.appendChild(el('div', 'font-size:11px;color:' + MUTED + ';margin-bottom:8px;',
                [pa.channel, pa.model, pa.size, pa.quality, tf('nImages', pa.count || 1), pa.refs ? tf('refCount', pa.refs) : '', pa.transparent ? t('bgTransparent') : ''].filter(Boolean).join(' · ')))
              var btnRow = el('div', 'display:flex;gap:8px;')
              btnRow.appendChild(miniBtn(t('approve'), 'flex:1;background:' + OK_BG + ';color:var(--ak-ok-fg);font-weight:600;border:0;', function () { decide(a.id, 'approve') }, 'check'))
              btnRow.appendChild(miniBtn(t('deny'), 'flex:1;background:' + ERR_BG + ';color:var(--ak-err-fg);font-weight:600;border:0;', function () { decide(a.id, 'deny') }, 'x'))
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
        var sources = [{ id: '_local', name: t('localFav') }].concat(cfg.promptSources || [])
        var srcRow = el('div', 'display:flex;gap:6px;margin-bottom:8px;')
        var srcSel = document.createElement('select')
        srcSel.style.cssText = 'flex:1;padding:6px;border-radius:8px;border:1px solid var(--ak-input-border);background:var(--ak-btn-bg);color:inherit;font-size:12px;'
        sources.forEach(function (s) {
          var o = document.createElement('option'); o.value = s.id; o.textContent = s.name
          srcSel.appendChild(o)
        })
        srcSel.value = st.promptSource
        if (!srcSel.value) srcSel.value = sources[0] && sources[0].id
        st.promptSource = srcSel.value
        srcSel.onchange = function () { st.promptSource = srcSel.value; st.prompts = []; renderTab() }
        srcRow.appendChild(srcSel)
        srcRow.appendChild(miniBtn(t('retry'), '', function () { st.prompts = []; renderTab() }, 'refresh'))
        body.appendChild(srcRow)
        var search = el('input')
        search.placeholder = t('searchPh')
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
            if (!favs.length) { listBox.appendChild(el('div', 'color:' + MUTED + ';font-size:12px;text-align:center;padding:20px 0;', t('emptyFav'))); return }
            renderItems(favs.filter(function (p) { return !kw || (p.title + p.prompt).toLowerCase().indexOf(kw) >= 0 }), true)
          } else {
            var src = (cfg.promptSources || []).find(function (s) { return s.id === st.promptSource })
            if (!src) { listBox.appendChild(el('div', 'color:' + MUTED + ';font-size:12px;text-align:center;padding:20px 0;', t('sourceGone'))); return }
            if (!st.prompts.length) {
              listBox.appendChild(el('div', 'color:' + MUTED + ';font-size:12px;', tf('pulling', src.name)))
              apiPost(API.promptFetch, { url: src.url }).then(function (r) {
                if (disposed) return
                st.prompts = r.prompts || []
                st.promptFetchError = r.error || ''
                renderTab()
              }).catch(function () { st.prompts = []; st.promptFetchError = t('genFail'); renderTab() })
              return
            }
            if (st.promptFetchError) listBox.appendChild(el('div', 'font-size:11px;color:var(--ak-err-fg);margin-bottom:4px;', t('lastFetch') + st.promptFetchError))
            renderItems(st.prompts.filter(function (p) { return !kw || (p.title + p.prompt + (p.tags || []).join()).toLowerCase().indexOf(kw) >= 0 }), false)
          }
        }
        function renderItems(items, isLocal) {
          if (!items.length) { listBox.appendChild(el('div', 'color:' + MUTED + ';font-size:12px;text-align:center;padding:12px 0;', t('noMatch'))); return }
          items.slice(0, 100).forEach(function (p) {
            var card = el('div', 'border:1px solid var(--ak-card-border);border-radius:10px;padding:8px 10px;background:var(--ak-card-bg);cursor:pointer;')
            var head = el('div', 'display:flex;align-items:center;gap:6px;margin-bottom:3px;')
            head.appendChild(el('div', 'flex:1;font-weight:600;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', p.title || t('untitled')))
            var star = document.createElement('span')
            star.style.cssText = 'cursor:pointer;font-size:13px;display:inline-flex;align-items:center;color:' + (isLocal ? ACCENT_SOLID : MUTED)
            star.innerHTML = svgIcon('star', 14)
            star.title = isLocal ? t('favRemove') : t('favAdd')
            star.onclick = function (e) {
              e.stopPropagation()
              var favs = savedPrompts()
              if (isLocal) favs = favs.filter(function (f) { return f.prompt !== p.prompt })
              else favs.unshift({ title: p.title, prompt: p.prompt, tags: p.tags })
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
        toolbar.appendChild(miniBtn(t('selectAll'), '', function () {
          var all = Object.keys(st.logSel).length && Object.keys(st.logSel).every(function (k) { return st.logSel[k] })
          st.logSel = {}
          if (!all) st.logs.forEach(function (l) { st.logSel[l.id] = true })
          renderTab()
        }))
        toolbar.appendChild(miniBtn(t('deleteSel'), 'color:var(--ak-err-fg);', function () {
          var ids = Object.keys(st.logSel).filter(function (k) { return st.logSel[k] })
          if (!ids.length) return
          apiPost(API.logs, { action: 'delete', ids: ids }).then(function () { st.logSel = {}; loadLogs() })
        }, 'trash'))
        toolbar.appendChild(miniBtn(t('clearLogs'), 'color:var(--ak-err-fg);', function () {
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
          if (!st.logs.length) { listBox.appendChild(el('div', 'color:' + MUTED + ';font-size:12px;text-align:center;padding:20px 0;', t('noLogs'))); return }
          st.logs.forEach(function (l) {
            var ok = l.ok || 0, fail = l.fail || 0
            var pill = ok && !fail ? [t('pillOk'), OK_BG] : ok ? [t('pillPartial'), WARN_BG] : [t('pillFail'), ERR_BG]
            var row = el('div', 'display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:10px;background:var(--ak-card-bg);border:1px solid var(--ak-btn-bg);')
            var cb = document.createElement('input')
            cb.type = 'checkbox'; cb.checked = !!st.logSel[l.id]
            cb.onchange = function () { st.logSel[l.id] = cb.checked }
            row.appendChild(cb)
            row.appendChild(el('span', 'background:' + pill[1] + ';border-radius:999px;padding:1px 8px;font-size:11px;white-space:nowrap;', pill[0] + (l.total > 1 ? ' ' + ok + '/' + l.total : '')))
            var mid = el('div', 'flex:1;min-width:0;cursor:pointer;')
            mid.appendChild(el('div', 'font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', l.prompt || '(—)'))
            mid.appendChild(el('div', 'font-size:11px;color:' + MUTED + ';', [l.params && l.params.size, l.params && l.params.quality, new Date(l.createdAt || Date.now()).toLocaleString()].filter(Boolean).join(' · ')))
            mid.onclick = function () { showLogPreview(l) }
            row.appendChild(mid)
            if (fail > 0 || !ok) {
              row.appendChild(miniBtn(t('retry'), '', function () { retryLog(l) }, 'retry'))
            }
            row.appendChild(miniBtn('', '', function () {
              apiPost(API.logs, { action: 'delete', ids: [l.id] }).then(loadLogs)
            }, 'trash'))
            listBox.appendChild(row)
          })
        }
        function showLogPreview(l) {
          preview.innerHTML = ''
          var imgs = (l.images || [])
          if (!imgs.length) { preview.appendChild(el('div', 'font-size:11px;color:' + MUTED + ';text-align:center;', t('noImagesInLog') + (l.error ? ' · ' + l.error : ''))); return }
          var grid = el('div', 'display:grid;grid-template-columns:1fr 1fr;gap:6px;')
          imgs.forEach(function (im) {
            if (!im.path) return
            var name = im.path.split(/[\\/]/).pop()
            var img = document.createElement('img')
            img.style.cssText = 'width:100%;border-radius:8px;border:1px solid var(--ak-img-border);'
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
              var p2 = l.params.size.split('x')
              st.sizeMode = 'manual'; st.manualW = p2[0]; st.manualH = p2[1]
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
        ;['about1', 'about2', 'about3', 'about4', 'about5', 'about6', 'about7', 'about8'].forEach(function (k, i) {
          var line = el('div', null, t(k))
          if (i === 0) line.style.fontWeight = '600'
          if (i > 0 && i < 7) { line.style.marginTop = i === 1 ? '8px' : '2px' }
          if (i === 6) line.style.marginTop = '8px'
          box.appendChild(line)
        })
        body.appendChild(box)
      }

      function renderTab() {
        syncTabs()
        if (st.pollTimer) { clearInterval(st.pollTimer); clearTimeout(st.pollTimer); st.pollTimer = null }
        if (st.tab === 'generate') renderGenerate()
        else if (st.tab === 'approvals') renderApprovals()
        else if (st.tab === 'prompts') renderPrompts()
        else if (st.tab === 'history') renderHistory()
        else renderAbout()
      }

      apiGet(API.config).then(function (c) { st.cfg = c; if (c && c.quality && st.quality === 'high') st.quality = c.quality; if (c && c.count) st.count = Math.min(10, c.count); renderTab() }).catch(function () {})
      renderTab()
      onLocale(function () { if (!disposed) renderTab() })

      function refreshBadge() {
        apiGet(API.state).then(function (s) {
          var n = s.pendingApprovals || 0
          if (n > 0) { badge.style.display = 'inline-block'; badge.textContent = tf('pendingBadge', n) }
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
        'box-shadow:var(--ak-shadow);'
      document.body.appendChild(m)
      applyThemeVars(m)
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
      applyThemeVars(mount)
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
      btn.setAttribute('aria-label', 'Ark9 Canvas')
      btn.title = 'Ark9 Canvas'
      btn.style.cssText =
        'width:44px;height:44px;border-radius:999px;cursor:pointer;position:relative;' +
        'border:1px solid var(--ak-btn-border);box-shadow:0 8px 32px rgba(0,0,0,0.35);' +
        'background:' + (panelOpen ? 'var(--ak-accent-strong)' : 'var(--ak-fab-bg)') + ';' +
        'color:' + (panelOpen ? '#0b1220' : 'var(--ak-fg)') + ';' +
        'display:flex;align-items:center;justify-content:center;'
      btn.innerHTML = svgIcon('image', 20)
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
          'white-space:nowrap;background:var(--ak-bg);color:var(--ak-fg);' +
          'border:1px solid var(--ak-input-border);border-radius:999px;' +
          'padding:4px 10px;font-size:12px;pointer-events:none;'
        tip.textContent = 'Ark9 Canvas'
        fabRoot.appendChild(tip)
        setTimeout(function () { try { tip.remove() } catch (_) {} }, 3600)
      }
    }

    // ═══════════════ 设置页(React) ═══════════════
    function SettingsPage() {
      var loc = useLocale()
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
            c.channels = [{ id: 'default', name: 'default', baseURL: c.baseURL, apiKey: c.apiKey, model: c.model }]
            c.activeChannelId = 'default'
          }
          if (!c.channels) c.channels = []
          if (!c.promptSources) c.promptSources = []
          setCfg(c)
        }).catch(function () {})
      }, [])
      if (!cfg) return h('div', { style: { padding: 20, color: MUTED } }, t('loading'))

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
          chs.push({ id: id, name: 'channel ' + (chs.length + 1), baseURL: '', apiKey: '', model: '' })
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
            msg(tf('modelsFetched', r.models.length))
          } else msg(t('fetchFailedMsg') + (r.error || t('noModels')))
          setTimeout(function () { msg('') }, 2500)
        }).catch(function () { msg(t('fetchFailedMsg')) })
      }
      function onSave() {
        setSaving(true)
        var toSave = Object.assign({}, cfg)
        var ch = toSave.channels && (toSave.channels.find(function (c) { return c.id === toSave.activeChannelId }) || toSave.channels[0])
        if (ch) { toSave.baseURL = ch.baseURL; toSave.apiKey = ch.apiKey; toSave.model = ch.model || toSave.model }
        apiPost(API.config, toSave).then(function (r) {
          setSaving(false)
          msg(r.ok ? t('savedOk') : t('saveFail'))
          setTimeout(function () { msg('') }, 2000)
        }).catch(function () { setSaving(false); msg(t('saveFail')) })
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
            if (j && typeof j === 'object') { setCfg(j); msg(t('importedMsg')) }
            else msg(t('importedBad'))
          } catch (err) { msg(t('parseFail') + err.message) }
          setTimeout(function () { msg('') }, 2500)
        }
        rd.readAsText(f)
        e.target.value = ''
      }

      var fieldStyle = { width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: 8, border: '1px solid var(--ak-border)', background: 'var(--ak-input-bg)', color: 'inherit', fontSize: 13 }
      var labelStyle = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, marginBottom: 12 }
      var sectionTitle = { fontWeight: 700, fontSize: 13, margin: '8px 0 10px', paddingTop: 10, borderTop: '1px solid var(--ak-border-soft)' }
      var smallBtn = { padding: '6px 10px', borderRadius: 8, border: '1px solid var(--ak-img-border)', background: 'var(--ak-btn-bg)', color: 'inherit', cursor: 'pointer', fontSize: 12 }

      var ch = cfg.channels && cfg.channels[chIdx]
      return h('div', { ref: function (el2) { if (el2) applyThemeVars(el2) }, style: { padding: 20, maxWidth: 620, color: 'var(--ak-fg)', fontFamily: 'system-ui, sans-serif' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
          h('h2', { style: { margin: '0 0 6px', fontSize: 18, flex: 1 } }, t('settingsTitle')),
          h('button', { onClick: function () { setLocale(loc === 'zh' ? 'en' : 'zh') }, style: { padding: '2px 10px', borderRadius: 999, border: '1px solid var(--ak-img-border)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 11 } }, t('langBtn'))),
        h('p', { style: { fontSize: 12, color: MUTED, margin: '0 0 14px' } }, t('settingsDesc')),

        h('div', { style: sectionTitle }, t('channelsTitle')),
        cfg.channels.length ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 } },
          cfg.channels.map(function (c, i) {
            return h('button', {
              key: c.id, onClick: function () { setChIdx(i) },
              style: Object.assign({}, smallBtn, {
                background: i === chIdx ? ACCENT : 'var(--ak-btn-bg)',
                borderColor: c.id === cfg.activeChannelId ? ACCENT_SOLID : 'var(--ak-img-border)',
                fontWeight: c.id === cfg.activeChannelId ? 700 : 400,
              }),
            }, (c.id === cfg.activeChannelId ? '● ' : '') + (c.name || c.id))
          })) : h('div', { style: { fontSize: 12, color: MUTED, marginBottom: 10 } }, t('noChannelYet')),
        h('div', { style: { display: 'flex', gap: 6, marginBottom: 12 } },
          h('button', { onClick: addChannel, style: smallBtn }, t('addChannel')),
          ch ? h('button', { onClick: function () { upd('activeChannelId', ch.id); msg(t('setActiveMsg')); setTimeout(function () { msg('') }, 1500) }, style: smallBtn }, t('setActive')) : null,
          (ch && cfg.channels.length > 1) ? h('button', { onClick: function () { delChannel(chIdx); setChIdx(0) }, style: Object.assign({}, smallBtn, { color: 'var(--ak-err-fg)' }) }, t('delChannel')) : null),
        ch ? h('div', null,
          h('label', { style: labelStyle }, t('channelName'),
            h('input', { value: ch.name || '', onChange: function (e) { updCh(chIdx, 'name', e.target.value) }, style: fieldStyle })),
          h('label', { style: labelStyle }, t('baseURLLabel'),
            h('input', { value: ch.baseURL || '', onChange: function (e) { updCh(chIdx, 'baseURL', e.target.value) }, placeholder: t('baseURLPh'), style: fieldStyle })),
          h('label', { style: labelStyle }, t('apiKeyLabel'),
            h('input', { value: ch.apiKey || '', onChange: function (e) { updCh(chIdx, 'apiKey', e.target.value) }, placeholder: 'sk-...', type: 'password', style: fieldStyle })),
          h('label', { style: labelStyle }, t('modelLabel'),
            h('div', { style: { display: 'flex', gap: 8 } },
              h('input', { value: ch.model || '', onChange: function (e) { updCh(chIdx, 'model', e.target.value) }, placeholder: t('modelPh'), style: Object.assign({ flex: 1 }, fieldStyle) }),
              h('button', { onClick: function () { fetchModels(chIdx) }, style: smallBtn }, t('fetchModels')))),
          (modelsMap[chIdx] && modelsMap[chIdx].length) ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 } },
            modelsMap[chIdx].map(function (m) {
              return h('button', {
                key: m.id, onClick: function () { updCh(chIdx, 'model', m.id) },
                style: { padding: '4px 10px', borderRadius: 999, border: '1px solid ' + ACCENT_SOLID, background: ch.model === m.id ? ACCENT_SOLID : 'transparent', color: ch.model === m.id ? '#0b1220' : ACCENT_SOLID, cursor: 'pointer', fontSize: 12 },
              }, m.name || m.id)
            })) : null,
        ) : null,

        h('div', { style: sectionTitle }, t('securityTitle')),
        h('label', { style: labelStyle }, t('approvalLabel'),
          h('select', { value: cfg.agentApproval || 'always', onChange: function (e) { upd('agentApproval', e.target.value) }, style: fieldStyle },
            h('option', { value: 'always' }, t('approvalAlways')),
            h('option', { value: 'never' }, t('approvalNever')))),
        h('label', { style: labelStyle }, t('timeoutLabel'),
          h('input', { value: String(cfg.approvalTimeoutSec != null ? cfg.approvalTimeoutSec : 120), onChange: function (e) { upd('approvalTimeoutSec', Number(e.target.value) || 120) }, style: fieldStyle })),

        h('div', { style: sectionTitle }, t('sourcesTitle')),
        (cfg.promptSources || []).map(function (s, i) {
          return h('div', { key: s.id || i, style: { display: 'flex', gap: 6, marginBottom: 6 } },
            h('input', { value: s.name || '', onChange: function (e) { var arr = cfg.promptSources.slice(); arr[i] = Object.assign({}, s, { name: e.target.value }); upd('promptSources', arr) }, placeholder: t('sourceNamePh'), style: Object.assign({}, fieldStyle, { width: 120, flexShrink: 0 }) }),
            h('input', { value: s.url || '', onChange: function (e) { var arr = cfg.promptSources.slice(); arr[i] = Object.assign({}, s, { url: e.target.value }); upd('promptSources', arr) }, placeholder: t('sourceUrlPh'), style: Object.assign({}, fieldStyle, { flex: 1 }) }),
            h('button', { onClick: function () { var arr = cfg.promptSources.slice(); arr.splice(i, 1); upd('promptSources', arr) }, style: Object.assign({}, smallBtn, { color: 'var(--ak-err-fg)' }) }, t('del')))
        }),
        h('button', { onClick: function () { var arr = (cfg.promptSources || []).slice(); arr.push({ id: 'ps_' + Date.now().toString(36), name: 'source ' + (arr.length + 1), url: '' }); upd('promptSources', arr) }, style: Object.assign({}, smallBtn, { marginBottom: 12 }) }, t('addSource')),

        h('div', { style: sectionTitle }, t('outputTitle')),
        h('label', { style: labelStyle }, t('outputDirLabel'),
          h('input', { value: cfg.outputDir || '', onChange: function (e) { upd('outputDir', e.target.value) }, placeholder: t('outputDirPh'), style: fieldStyle })),

        h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' } },
          h('button', { onClick: onSave, disabled: saving, style: { padding: '8px 24px', borderRadius: 8, border: '0', background: 'linear-gradient(135deg,#4f8cff,#7c5cff)', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13 } }, saving ? t('saving') : t('save')),
          h('button', { onClick: doExport, style: smallBtn }, t('exportCfg')),
          h('button', { onClick: function () { fileRef.current && fileRef.current.click() }, style: smallBtn }, t('importCfg')),
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
          return slots.register({ name: 'settings.section', id: 'ark9-canvas-pre', order: 31, label: 'Ark9 生图 / Canvas' }, function () {
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
              title: 'Ark9 生图 / Canvas',
              icon: '▣',
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
        console.log('[dsh-ark9canvas] client ready: ' + (bsRegistered ? 'better-sidebar tab' : 'floating FAB') + ' + settings page (locale=' + locale + ')')
      }
      whenBodyReady(mountDom)
      setTimeout(whenBodyReady.bind(null, mountDom), 800)
    }

    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})
