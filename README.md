# dsh-ark9canvas — Image Generation Workbench & Agent Tool for DeepSeek Harness

<p align="center">
  <a href="README.zh-CN.md">中文</a> · <b>English</b> · License BSD-3-Clause · <code>pnpm add @a9i5k4/dsh-ark9canvas</code>
</p>

> **v0.3.0 MAJOR UPDATE** — The image workbench is now feature-complete against the reference design: aspect-ratio grid with the same quality-budget + 16px-alignment formula, transparent background, batch generation up to 10 images (independent sub-tasks, partial success still returns what finished), a prompt library with custom JSON sources, multi-channel aggregation, persistent generation logs with retry, and config import/export.

An **image-generation plugin** for the DeepSeek Harness Web GUI: the agent paints on request via one tool, you paint on demand in a floating workbench — and every agent-initiated generation **waits for your approval** by default, so nothing bills without a human nod.

**The problem it solves**: image APIs bill per call, yet agent-initiated generation usually runs blind — a bad prompt retries itself, a loop burns your balance. This plugin puts a human gate in the loop: the tool blocks until you approve in the panel (or denies/timeouts with a clear message and zero cost), while the workbench itself stays one click away for your own un-gated use.

---

## Highlights in 30 seconds

| | |
|---|---|
| **Approval gate by default** | Every agent generation waits in the panel's Approvals tab — approve, deny, or let it time out; denial and timeout never bill |
| **One workbench, two homes** | Floating FAB + glass panel out of the box; auto-registers as a Better Sidebar tab when `dsh-better-sidebar` is installed; stacks above `dsh-cua`'s FAB when both exist |
| **Full size system** | Aspect-ratio grid (12 presets + auto) computed with the quality-budget + 16px-alignment formula; manual W×H with 16-multiple snapping; gpt-image models auto-snap to the three native sizes |
| **Batch up to 10** | Each image runs as an independent sub-task aggregated into one batch — partial success still returns what finished, with per-batch ok/fail counts |
| **Transparent background** | One toggle sends `background:"transparent"` (supported by gpt-image family) |
| **Prompt library** | Local favorites (☆) + custom JSON sources fetched through a host-side proxy — no CORS, no bundled third-party content |
| **Multi-channel aggregation** | Keep several OpenAI-compatible relays (baseURL + key + model each), switch the active one, fetch model lists per channel |
| **Persistent generation logs** | Every batch is recorded with params and outcomes; failed batches retry with one click; multi-select delete |
| **AI-friendly by design** | Tool results return saved file paths + dimensions — never base64 blobs — unless you explicitly ask for them; references accept dataURLs *or* previous output paths for iterative editing |

---

## Feature tour

### Approval gate — human in the loop, by default

When the agent calls `ark9_generate_image`, the request appears in the panel's **Approvals** tab with the prompt, parameters, and elapsed wait time. Approve → generation starts and bills; Deny → the tool returns a clear "user denied" message and the agent asks what to change instead of retrying; Timeout (configurable, 5–600 s) → cancelled, nothing billed. Set **Settings → Ark9 生图 → 安全** to `never` if you want unattended auto-generation.

### Workbench — five tabs

- **生成 Generate**: prompt, reference images (upload or clipboard paste), model dropdown with per-channel fetch, aspect-ratio grid / manual W×H, quality, transparent toggle, 1–10 count
- **审批 Approvals**: pending agent requests with one-click approve/deny
- **提示词 Prompts**: search, click to apply, ☆ to favorite locally; custom JSON sources (`[{title, prompt, tags?}]`) proxied through the host to bypass browser CSP/CORS
- **记录 Logs**: every generation with status pills (成功 / 部分成功 / 失败), retry, multi-select delete, click-to-preview
- **说明 About**: quick reference

### Size system — faithful to the reference formula

Ratios compute their pixel dimensions from a quality budget (low 1K² / medium 2K² / high 4K²) with 16-pixel alignment, exactly like the reference workbench. Because the gpt-image family only accepts three native sizes (1024×1024, 1536×1024, 1024×1536), gpt-image models automatically snap the computed size to the nearest native one; other models send the raw computed size. Manual W×H with a 16-multiple alignment toggle is always available.

### Iterative editing — paths, not blobs

`ark9_generate_image` returns saved file paths with dimensions. Pass any previous output path back via `images` and the plugin reads the file and runs an `/images/edits` multipart call — multi-turn "make the robot red" works without ever stuffing base64 into the conversation. `returnDataUrl: true` opts into inline base64 when a client truly needs it.

### Channels — aggregate your relays

Configure multiple OpenAI-compatible channels (name + baseURL + key + default model), mark one active, fetch each channel's model list from its own `/models`. The active channel serves both the agent tools and the workbench; single-channel setups from older versions migrate automatically.

---

## Engineering core (restraint by design)

- **Zero runtime dependencies** beyond Node built-ins
- **Batch aggregation**: count N → N independent sub-tasks (n:1 each), merged into one batch view with ok/fail counts — one slow image never blocks the others
- **Durable state**: tasks and logs persist to `~/.dsh/ark9-canvas-*.json`; a server restart never orphans a poll
- **Loopback-only routes**: every API route rejects non-localhost callers; file routes are name-sanitized against path traversal
- **No third-party prompt content bundled**: sources are user-provided URLs

---

## Install (one command)

> Prerequisite: install [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and start `dsh web` at least once.

Run in the **profile directory** (`~/.dsh/profiles/web`):

```bash
cd ~/.dsh/profiles/web
pnpm add @a9i5k4/dsh-ark9canvas
```

Then edit `package.json` in that directory and append to the `dsh.profile.bundles` array:

```json
"@a9i5k4/dsh-ark9canvas"
```

Restart **dsh web** — the 🖼️ floating button appears (or a sidebar tab, with Better Sidebar installed). Open **Settings → Ark9 生图** once to add a channel (baseURL with `/v1`, API key, model such as `gpt-image-2`).

> No pnpm? `npm install @a9i5k4/dsh-ark9canvas` works the same.
> pnpm v11 blocks packages published <1 day ago: set `minimumReleaseAge: 0` in pnpm-workspace.yaml or pin an explicit version for same-day updates.

### AI-era installation

Copy this to the AI assistant you're already using:

```text
Install the npm package @a9i5k4/dsh-ark9canvas in the DeepSeek Harness web profile
directory ~/.dsh/profiles/web (pnpm add or npm install),
append "@a9i5k4/dsh-ark9canvas" to the dsh.profile.bundles array in package.json,
then restart dsh web. After that, open Settings → Ark9 生图 and add an
OpenAI-compatible image channel (baseURL with /v1, API key, model).
```

### Updating

```bash
cd ~/.dsh/profiles/web && pnpm up @a9i5k4/dsh-ark9canvas
```

---

## Configuration

Config file `~/.dsh/ark9-canvas.json` (everything adjustable in the Settings GUI):

```json
{
  "baseURL": "https://your-relay.example/v1",
  "apiKey": "sk-...",
  "model": "gpt-image-2",
  "quality": "high",
  "size": "1536x1024",
  "count": 1,
  "agentApproval": "always",
  "approvalTimeoutSec": 120,
  "channels": [
    { "id": "c1", "name": "relay-a", "baseURL": "https://your-relay.example/v1", "apiKey": "sk-...", "model": "gpt-image-2" }
  ],
  "activeChannelId": "c1",
  "promptSources": [
    { "id": "ps1", "name": "my prompts", "url": "https://example.com/prompts.json" }
  ],
  "outputDir": ""
}
```

| Key | Meaning |
|---|---|
| `agentApproval` | `always` (default) — agent generations need panel approval; `never` — unattended |
| `approvalTimeoutSec` | 5–600 s; timeout cancels without billing |
| `channels` / `activeChannelId` | Multi-channel aggregation; falls back to the top-level `baseURL`/`apiKey`/`model` when empty |
| `outputDir` | Where images are saved; empty = `~/Pictures/ark9-canvas` |

Tasks persist to `~/.dsh/ark9-canvas-tasks.json`, generation logs to `~/.dsh/ark9-canvas-logs.json`.

---

## Structure

- `lib/index.js` — Host half: two agent tools, eleven routes, OpenAI-compatible image proxy (async task protocol + batch aggregation), approval queue, persistent logs (zero runtime deps, Node built-ins only)
- `lib/client.js` — Browser half: floating FAB + glass workbench (shared vanilla-DOM implementation for floating panel and sidebar tab), settings page
- `cordis.patch.yml` — plugin registration row
- `smoke-test.mjs` — offline integration test (tools / routes / approval paths, no API calls)
- `e2e-approval-test.mjs` — real end-to-end generation test (bills!)

## Known limitations

- Video generation, mask/inpainting painting UI, Gemini-format calls, the infinite-canvas node editor, and WebDAV sync are out of scope (backend has no video model; config import/export stands in for sync).
- The prompt library ships without any third-party content — add your own sources.
- Panel-initiated (manual) generations are never approval-gated: pressing the button **is** the approval, and it bills.
- Plugin-set changes require a dsh restart.

---

## Credits

This project is built human-machine collaboratively:

- **Aik358** — project owner: product direction and engineering.
- **ZCode (GLM, Z.ai)** — autonomous engineering agent: plugin implementation, protocol reverse-engineering of the async-task/media-upload relay protocol, test suites.

---

## Release

- GitHub: https://github.com/Aik358/dsh-ark9canvas
- npm: `@a9i5k4/dsh-ark9canvas`
- License: BSD-3-Clause · Independent implementation, contains no WorldCodes Canvas code or branding
