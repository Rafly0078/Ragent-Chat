# Ragent — AI WebUI

A premium AI workspace for **Ollama and cloud model providers**, built with Next.js App Router and React 19.

It runs as a full Next.js app: the chat UI is client-rendered, and Route Handlers provide Ollama bridging,
secure cloud-provider adapters, web search, and document generation. Optional Supabase integration adds
sign-in, cloud sync and file storage; without it the app runs guest-only on `localStorage`.

![Next.js 16](https://img.shields.io/badge/Next.js-16-black) ![React 19](https://img.shields.io/badge/React-19-149eca) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6) ![Tailwind](https://img.shields.io/badge/Tailwind-3-38bdf8)

---

## ✨ Features

**Chat**

- Real token **streaming** with `AbortController` (stop / regenerate / continue) and an idle watchdog
- **Extended thinking** for Ollama, OpenAI, and Anthropic with a low/medium/high/max effort selector and a collapsible reasoning panel
- **Markdown**, syntax-highlighted code, **LaTeX** (KaTeX), tables, and **Mermaid** diagrams
- **Vision** support (upload / paste / drag & drop images) and text extraction from PDF / DOCX / XLSX / PPTX
- **Context compaction** — older turns are condensed into a running summary once the prompt nears `num_ctx`
- Live token counter, response time, tok/s, and a context-window meter

**Agentic web search** — the model plans queries, they run through a server-side Tavily proxy, and the answer
cites its sources inline. Requires `TAVILY_API_KEY`.

**Document generation** — the model emits an ` ```artifact ` directive and the server renders a real file:
PDF, DOCX, PPTX, XLSX, CSV, MD, HTML, JSON, XML, TXT, or a ZIP bundle. Files are saved to Supabase Storage when
signed in, or embedded in the message as a `data:` URL for guests.

**Targeted code patches** — the model emits a SEARCH/REPLACE hunk, the app anchors it against code from earlier
in the conversation and renders a diff plus the corrected source.

**Code sandbox** — runnable HTML/CSS/JS in an answer gets a locked-down `sandbox="allow-scripts"` iframe with an
optional audit-and-fix loop: run it, collect the real runtime errors, ask the model to fix them, re-run.

**Conversations** — create, rename, delete, search (title + content), pin, duplicate, export as `.md` / `.json`.

**Auth & sync** (optional, Supabase) — email + password, magic link, Google/GitHub OAuth, or an anonymous guest
session. Conversations sync across devices; generated files live in private Storage buckets behind RLS.

**Design** — dark/light/system themes, nine accent colours, glassmorphism used sparingly, mobile-first,
installable as a PWA, `prefers-reduced-motion` respected globally.

**Shortcuts** — `Ctrl/⌘+K` command palette · `Ctrl/⌘+B` sidebar · `Ctrl/⌘+Shift+O` new chat · `Ctrl/⌘+Enter` send · `Esc` stop.

---

## 🏗️ Architecture

Provider and connection mode are switchable in **Settings → Connection**:

```
bridge (default for hosted deploys)
  Browser ──► /api/bridge/*  ──►  OLLAMA_API_URL  ──►  Ollama
             (same origin,        (server-only env var,
              no CORS)             never sent to the client)

direct
  Browser ──────────────────────► NEXT_PUBLIC_API_URL ──► Ollama
             (needs CORS/OLLAMA_ORIGINS, but no function
              duration limit on a long generation)

cloud
  Browser ──► /api/providers/* ──► OpenAI / Anthropic / OpenRouter / Groq /
             (same origin)         DeepSeek / custom HTTPS endpoint
```

Cloud keys live in browser `localStorage`, are excluded from settings exports, and are sent to the same-origin
proxy only for provider requests. Known providers use fixed endpoints. Custom endpoints must use public HTTPS;
localhost, private/reserved IPs, private DNS targets, URL credentials, and redirects are blocked.

Server routes:

| Route                              | Purpose                                                             |
| ---------------------------------- | ------------------------------------------------------------------- |
| `POST /api/bridge/chat`            | Proxy a chat completion (streams straight through)                  |
| `GET  /api/bridge/models`          | Proxy the model list                                                |
| `POST /api/bridge/show`            | Proxy `/api/show` for model details                                 |
| `POST /api/providers/chat`         | Normalize OpenAI-compatible or Anthropic chat responses and streams |
| `POST /api/providers/models`       | Fetch and normalize cloud model lists                               |
| `POST /api/search`                 | Web search via Tavily (key stays server-side)                       |
| `POST /api/tools/execute`          | Render a document and (optionally) persist it                       |
| `POST /api/artifacts/refresh`      | Re-sign an expired Storage URL                                      |
| `GET/PUT/DELETE /api/model-labels` | Owner-curated model display names                                   |
| `GET  /auth/callback`              | PKCE / magic-link exchange                                          |

**Every one of these is gated.** When Supabase is configured, a request without a valid session gets a 401 —
matching the sign-in wall the UI shows — and all of them are rate limited per user/IP. When Supabase is _not_
configured the deployment is guest-only by design, so only the rate limit applies. See `src/lib/server/guard.ts`.

The streaming parser accepts both Ollama-native NDJSON and SSE (`data: {…}` / `data: [DONE]`), so most proxies
work unchanged.

### Folder structure

```
src/
├── app/                  # App Router: layout, page, settings, providers, API routes
├── components/           # ui/ primitives, markdown/ renderer, chrome (background, banners)
├── features/
│   ├── chat/             # ChatView, MessageList, MessageBubble, ChatInput, panels, useChat
│   ├── sidebar/ command/ models/
│   ├── auth/             # AuthProvider, AuthGate, AuthDialog, useChatSync
│   ├── artifacts/ downloads/ documents/ sandbox/
├── lib/
│   ├── api/              # config, types, client, stream  (the only place the endpoint is read)
│   ├── bridge/           # server-only Ollama fetchers
│   ├── server/           # guard (auth + rate limit), body size caps
│   ├── tools/            # directive detection, registry, patch engine, executors/
│   ├── sandbox/          # compose, bootstrap, run, heal prompt
│   ├── search/ context/ documents/ services/ supabase/ store/ hooks/ utils/
└── types/
```

State lives in **Zustand + persist** (localStorage), chosen over Context to keep streaming updates from
re-rendering the tree. Selectors keep components subscribed only to the slices they use.

---

## 🚀 Getting started

```bash
npm install
cp .env.example .env.local     # then edit it
npm run dev                    # http://localhost:3000
```

```bash
npm run build      # production build
npm run start      # serve the production build
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
```

### Environment

Ollama needs one reachable endpoint. Cloud providers are configured per browser in Settings and need no provider
environment variables. Everything else unlocks an optional feature.

| Variable                        | Scope      | Purpose                                                                              |
| ------------------------------- | ---------- | ------------------------------------------------------------------------------------ |
| `OLLAMA_API_URL`                | server     | Upstream Ollama endpoint for bridge mode. **Preferred** — never reaches the browser. |
| `NEXT_PUBLIC_API_URL`           | public     | Legacy/direct-mode endpoint. Ships in the client bundle.                             |
| `NEXT_PUBLIC_DISABLE_BRIDGE`    | public     | `true` hides chat (static/demo deploy with no model backend).                        |
| `NEXT_PUBLIC_SUPABASE_URL`      | public     | Supabase project URL. Leave blank for guest-only mode.                               |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public     | Anon key — safe in the browser under RLS.                                            |
| `SUPABASE_SERVICE_ROLE_KEY`     | **secret** | Bypasses RLS. Server-only, used behind the owner check.                              |
| `OWNER_EMAIL`                   | server     | Comma-separated emails allowed to curate model display names.                        |
| `TAVILY_API_KEY`                | server     | Enables web search. Unset → `/api/search` returns 501.                               |

`.env.local` is gitignored. Never commit it.

### Database

```bash
supabase link --project-ref <ref>
supabase db push
```

`supabase/migrations/0005_audit_hardening.sql` is **written but intentionally not applied** — it tightens child-table
RLS, makes the profile trigger unable to block sign-in, and adds columns the sync layer currently drops. Review it
before pushing; the header explains each change.

---

## ☁️ Deploying

Import the repo in Vercel (or any Node host) and set the environment variables above. Bridge mode needs no CORS
setup, but a single request is capped by the platform's function duration (300s on Vercel Hobby) — for very long
generations, use direct mode and allow your origin in `OLLAMA_ORIGINS` on the Ollama server.

To expose a local Ollama over HTTPS: `cloudflared tunnel --url http://localhost:11434` or `ngrok http 11434`, then
point `OLLAMA_API_URL` at the tunnel. The bridge sends `ngrok-skip-browser-warning` server-side, so ngrok's
interstitial doesn't corrupt the stream.

Path mapping most proxies need:

| This app calls | Forward to Ollama |
| -------------- | ----------------- |
| `/api/models`  | `/api/tags`       |
| `/api/chat`    | `/api/chat`       |
| `/api/show`    | `/api/show`       |

---

## ⚡ Performance notes

- The **markdown pipeline** (react-markdown + remark/rehype + KaTeX + highlight.js and their CSS) is code-split
  behind `React.lazy`; **Mermaid** and **pdf.js** are dynamically imported. Homepage First Load JS is ~183 kB.
- **Streaming writes are coalesced to one store update per animation frame**, and localStorage writes are
  throttled — otherwise `persist` would serialize the whole conversation set on every token.
- The sidebar subscribes to a **shallow-compared projection** of the conversation list, so streaming tokens don't
  re-render or re-sort it.
- **Native virtualization** via CSS `content-visibility: auto`; the live streaming message stays fully rendered.
- Memoized message rendering, static background (no rAF loop), transform/opacity-only animations.

## ♿ Accessibility

ARIA roles and labels on interactive controls, focus-visible rings, focus trap + focus restore in dialogs and the
command palette, keyboard-navigable menus, `aria-live` message log and download status, and full reduced-motion
support.

---

## 📝 License

MIT. Built as a privacy-respecting UI: select local Ollama or a cloud provider that fits your data policy.
