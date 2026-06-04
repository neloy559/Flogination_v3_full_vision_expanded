# Flogination v5

> High-performance, 24/7 Facebook session management system built for scale.

Flogination manages 1,000+ Facebook accounts simultaneously — with stealth browser automation, real-time health monitoring, an AI interaction layer, and a remote control API for external agents.

---

## What it does

| Capability | Detail |
|---|---|
| **Session Management** | Cookie-based Facebook account management with full profile metadata |
| **Stealth Browser** | Playwright + Chromium with CDP patching, Bézier mouse movement, WebRTC blocking, fingerprint injection |
| **Health Monitoring** | Real-time status tracking — `live`, `checkpoint`, `restricted`, `dead` |
| **Window Grid** | Tiled grid view (default 3×4) for mass visual monitoring |
| **Hibernation** | Suspends idle browser contexts to conserve RAM; wakes on demand |
| **AI Gateway** | LLM integration (OpenRouter, DeepSeek, OpenAI, GLM) for human-like interactions |
| **Agent Bridge** | Secondary Express API for external remote control by scripts or AI agents |
| **Inbox / CRM** | Message monitoring, contact management, and warm-up engine |
| **Campaigns** | Automated action sequences across sessions |

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
