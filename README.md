# Flogination v5

> High-performance, 24/7 Facebook session management system built for scale.

Flogination manages 1,000+ Facebook accounts simultaneously — with stealth browser automation, real-time health monitoring, an AI interaction layer, and a remote control API for external agents.

---

## What it does

Managing Facebook accounts at scale is not a browser automation problem — it's a detection evasion problem. Facebook runs one of the most aggressive bot-detection systems on the web, combining browser fingerprinting, behavioral analysis, mouse heuristics, WebRTC leak detection, and network-level signals. Flogination is built around that constraint.

### Session Management
Stores and manages Facebook sessions by cookie rather than credentials. Each session carries full profile metadata — BM count, ad accounts, owned pages, groups, health status, and scraping state. Supports 1,000+ accounts in a single SQLite database with WAL mode for concurrent read/write during mass operations.

### Stealth Browser
The single most important component. Playwright launches Chromium but the vanilla browser is trivially detectable. Flogination patches it at the CDP (Chrome DevTools Protocol) layer to:
- Spoof `navigator.webdriver` and automation-related JS properties
- Inject randomized canvas, WebGL, and audio fingerprints per session
- Replace linear mouse movement with Bézier curves that mimic human hand tremor
- Block WebRTC to prevent IP leaks through the browser even when a proxy is assigned
- Set per-session user-agent, viewport, timezone, and language to match the account's declared country

### Health Monitoring
Facebook marks accounts as `checkpoint` (identity verification required), `restricted` (limited posting/messaging), or `dead` (disabled). Flogination detects these states in real time by reading DOM indicators during automated browsing, not by making separate API calls — which would themselves be detectable.

### Window Grid
Renders all active browser windows in a tiled 3×4 grid inside the Electron shell. At scale, you need visual confirmation that sessions are alive and not stuck on checkpoint screens. The grid makes that possible without switching between windows.

### Hibernation
Each active Playwright browser context consumes ~150–300 MB of RAM. Running 50 sessions simultaneously without hibernation requires 8–15 GB of memory. Hibernation suspends idle browser contexts to disk-like state and wakes them on demand, letting a single machine manage hundreds of sessions within a normal memory budget.

### AI Gateway
Integrates with OpenRouter, DeepSeek, OpenAI, and GLM through a unified OpenAI-compatible interface. Used to generate human-like message responses, post comments, and decide next actions — all with provider fallback so a single model outage doesn't stop operations.

### Agent Bridge
A secondary Express API running on its own port. Lets external scripts, n8n workflows, or other AI agents control Flogination programmatically — trigger health checks, queue BM creation, read logs — without touching the main dashboard. All endpoints require an API key.

### Inbox / CRM
Monitors Facebook Messenger across all active sessions simultaneously. Messages are surfaced in a unified inbox with contact tagging, interaction history, and a warm-up engine that builds account trust scores by maintaining consistent low-volume conversation patterns — a key factor in avoiding restrictions on new accounts.

### Campaigns
Defines reusable action sequences (comment, post, join group, etc.) and distributes them across a pool of sessions with configurable concurrency and delay. Tracks per-task status so partial failures can be retried without re-running the whole campaign.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Dashboard | Next.js 14 (App Router) + React 18 + Tailwind CSS |
| State | Zustand 4.5 |
| Backend | Express 4 on port 3001 |
| Database | SQLite via better-sqlite3 (synchronous, WAL mode) |
| Automation | Playwright 1.42 with CDP session access |
| AI | Axios to OpenAI-compatible `/chat/completions` endpoints |
| Language | TypeScript 5.3+ throughout |

---

## Project Structure

```
flogination-app/
├── src/
│   ├── server/
│   │   ├── index.ts              # Express entry point — all REST routes
│   │   ├── database.ts           # SQLite layer (db_ object)
│   │   ├── session-manager.ts    # In-memory active session map
│   │   ├── stealth-browser.ts    # Playwright launch + stealth injection
│   │   ├── ai-gateway.ts         # Multi-provider AI client
│   │   ├── agent-bridge.ts       # Secondary API for external agents
│   │   ├── automation/           # Auto-scraper, proxy monitor, self-healing
│   │   ├── tools/                # Page factory, BM factory, group hunter, etc.
│   │   ├── inbox/                # Inbox manager, contact manager, warmup engine
│   │   ├── campaigns/            # Campaign lifecycle engine
│   │   └── utils/                # Spin parser, TOTP, webhook, encryption
│   ├── store/
│   │   └── index.ts              # Zustand client store
│   └── types/
│       └── index.ts              # Shared TypeScript interfaces
│
└── Flogination/flogination-web/  # Next.js 14 dashboard
    └── app/
        ├── layout.tsx
        ├── page.tsx              # Single-page dashboard
        └── components/           # All UI views and components
```

---

## Getting Started

```bash
# 1. Clone and enter the project folder
cd flogination-app

# 2. Install dependencies
npm install

# 3. Copy environment config
cp .env.example .env
# Edit .env and set ENCRYPTION_KEY (generate with the command in the file)

# 4. Start development (API server + Next.js dashboard concurrently)
npm run dev
```

| Service | URL |
|---|---|
| Next.js Dashboard | http://localhost:3000 |
| Express API | http://localhost:3001 |

---

## Environment Variables

See [`.env.example`](flogination-app/.env.example) for the full list. Key variables:

| Variable | Description |
|---|---|
| `PORT` | API server port (default: 3001) |
| `ENCRYPTION_KEY` | 32-byte hex key for AES-256-GCM cookie encryption |
| `AUTH_ENABLED` | Enable JWT auth on all API routes (default: false) |
| `JWT_SECRET` | Secret for JWT signing (required if AUTH_ENABLED=true) |
| `MONGO_URI` | Optional MongoDB connection (leave empty for SQLite-only) |

---

## API Overview

### Sessions
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/sessions` | List all sessions with live state |
| POST | `/api/sessions` | Import a session by cookie |
| PATCH | `/api/sessions/:id` | Update session fields |
| DELETE | `/api/sessions/:id` | Remove a session |
| POST | `/api/sessions/:id/launch` | Open browser for session |
| POST | `/api/sessions/:id/check-health` | Check account health |
| POST | `/api/sessions/:id/scrape` | Enqueue profile scrape |
| POST | `/api/sessions/bulk-import` | Bulk import via file or pasted text |

### Proxies
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/proxies` | List active proxies |
| POST | `/api/proxies` | Add a proxy |
| POST | `/api/proxies/test` | Test + auto-detect country |
| PATCH | `/api/sessions/:id/assign-proxy` | Assign proxy to session |

### Agent Bridge (optional)
Runs on a separate port when enabled in Settings. Requires `X-Agent-Key` header.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Bridge health (public) |
| GET | `/sessions` | List sessions |
| POST | `/sessions/:id/action` | Trigger an action |
| GET | `/logs` | Activity logs |

---

## Building

```bash
# Build everything
npm run build

# Build server only (outputs to dist/)
npm run build:server

# Build client only
npm run build:client

# Production start (requires build first)
npm start
```

---

## License

Proprietary — for authorized use only.
