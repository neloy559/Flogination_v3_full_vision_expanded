# Flogination v5

> High-performance, 24/7 Facebook session management system built for scale.

Flogination manages 1,000+ Facebook accounts simultaneously — with stealth browser automation, real-time health monitoring, an AI interaction layer, and a remote control API for external agents.

---

## What it does

Managing Facebook accounts at scale is not a browser automation problem — it's a detection evasion problem. Facebook runs one of the most aggressive bot-detection systems on the web, combining browser fingerprinting, behavioral analysis, mouse heuristics, WebRTC leak detection, and network-level signals. Flogination is built around that constraint.

---

### Core Infrastructure

#### Session Management
Stores and manages Facebook sessions by cookie rather than credentials. Each session carries full profile metadata — BM count, ad accounts, owned pages, groups, health status, and scraping state. Supports 1,000+ accounts in a single SQLite database with WAL mode for concurrent read/write during mass operations.

#### Stealth Browser
The single most important component. Playwright launches Chromium but the vanilla browser is trivially detectable. Flogination patches it at the CDP (Chrome DevTools Protocol) layer to:
- Spoof `navigator.webdriver` and automation-related JS properties
- Inject randomized canvas, WebGL, and audio fingerprints per session
- Replace linear mouse movement with Bézier curves that mimic human hand tremor
- Block WebRTC to prevent IP leaks through the browser even when a proxy is assigned
- Set per-session user-agent, viewport, timezone, and language to match the account's declared country

#### Health Monitoring
Facebook marks accounts as `checkpoint` (identity verification required), `restricted` (limited posting/messaging), or `dead` (disabled). Flogination detects these states in real time by reading DOM indicators during automated browsing — not by making separate API calls, which would themselves be detectable.

#### Window Grid
Renders all active browser windows in a tiled 3×4 grid inside the Electron shell. At scale, you need visual confirmation that sessions are alive and not stuck on checkpoint screens. The grid makes that possible without switching between windows.

#### Hibernation
Each active Playwright browser context consumes ~150–300 MB of RAM. Running 50 sessions simultaneously without hibernation requires 8–15 GB of memory. Hibernation suspends idle browser contexts to disk-like state and wakes them on demand, letting a single machine manage hundreds of sessions within a normal memory budget.

#### Proxy Kill-Switch Monitor
When a proxy disconnects, the browser context is immediately hibernated to prevent the server's real IP from being exposed to Facebook. Polls assigned proxies every 30 seconds via a HEAD request through the proxy. On failure, the session is hibernated, its status is set to `restricted`, and a webhook is fired. Sessions without a proxy are never affected.

---

### Automation Tools

#### Auto-Scraper
After a session is imported, the auto-scraper runs in the background and harvests the full Facebook profile — BM count, owned pages, joined groups, ad account IDs, friend count, professional mode, monetization status, and more. It uses a selector cache fed by the Browser Recorder so recorded human interactions become reusable scraping blueprints. Processes up to 3 sessions in parallel with automatic retry on failure.

#### Page Factory
Automates Facebook Page creation across multiple worker accounts and immediately transfers admin ownership to a designated "parking" account. Worker accounts are expendable — if one gets banned during the job, the pages it created already belong to the stronger parking account and survive. Each page creation uses stealth typing, optional profile/cover image upload, and polls the admin list every 15 seconds until the transfer is confirmed.

#### BM Factory
Same pattern as Page Factory but for Business Managers. Navigates to `business.facebook.com`, creates a BM, extracts the BM ID, invites a parking account as Admin, and polls for acceptance. Critical for ad operations because BMs created by worker accounts and transferred to strong accounts are treated as legitimate assets even after the worker is banned.

#### Group Hunter
Three-phase group operation tool:
1. **Join phase** — Mass-joins target Facebook groups across sessions with randomized 15–90 second delays between requests from the same account to avoid rate limiting.
2. **Post campaign** — After group membership is confirmed, posts spin-syntax content to those groups with 5–30 minute delays between posts.
3. **DM outreach** — Scrapes member UIDs from target groups, filters by activity/keywords/recency, and sends DMs to filtered members via the inbox manager. Daily DM limit is configurable per session (1–50).

#### Comment Marketing Engine
Three operational modes:
- **URL Promotion** — Finds viral posts by keyword with configurable engagement thresholds, then drops unique comments embedding a promo URL (spin syntax ensures each account posts unique text).
- **Reels Commenting** — Comments on reels by keyword or direct URL, with optional thread hijacking by replying to the top-liked comment.
- **Page/Product Review** — AI generates a unique review per session; falls back to spin syntax if the AI provider is unavailable. Rate-limit cooldowns (30 min–24 h) are handled per session so other accounts continue unaffected.

#### Content Amplifier
Two modes:
- **Post Seeder** — Boosts a target post with likes, reacts, comments, shares, and saves from multiple sessions to simulate organic engagement and improve algorithmic reach.
- **Video Watch Farm** — Multiple sessions watch a video for a configured duration to accumulate watch time toward Facebook's monetization threshold (4,000 hours in 365 days). Sessions are filtered by warm-up score so only trusted accounts contribute.

#### Browser Recorder
Always-on capture of every action the operator takes inside the browser — keystrokes, clicks with CSS selectors, navigation, form inputs, network requests, and auto-screenshots. No toggle needed — recording starts with the browser. The recorded selectors are fed into the selector cache, which the auto-scraper and all automation tools use for future runs. What the operator does once becomes the blueprint for mass automation.

---

### Inbox & Account Trust

#### Unified Inbox
Monitors Facebook Messenger across all active sessions simultaneously in a single view. Messages are grouped by conversation with unread counts, sender info, and quick-reply from the dashboard. Supports filtering by session, tag, or unread status.

#### Contact CRM
Every person who messages any managed account is captured as a contact with their Facebook UID, profile URL, message history, custom tags, and notes. Provides a unified view of all outreach targets across all sessions — who's been contacted, from which account, and when.

#### Account Warm-Up Engine
New Facebook accounts with little message history are flagged by Facebook's trust system, leading to faster restriction. The warm-up engine builds inbox activity to counter this:
- **Internal mode** — Selected sessions message each other in a round-robin pattern with 5–60 minute randomized delays. No external contacts needed.
- **External mode** — Monitors incoming messages and sends AI-generated replies with 2–30 minute response delays to simulate real human response times.

Each session gets a **warm-up score (0–100)** based on messages sent in the last 7 days, replies sent, and account age. Tools like the Content Amplifier use this score to filter which sessions can safely participate in campaigns.

---

### Campaigns
Defines reusable action sequences and distributes them across a pool of sessions with configurable concurrency and delay windows. Tracks per-task status so partial failures can be retried without re-running the whole campaign. All tools above (Page Factory, BM Factory, Group Hunter, Comment Engine, Content Amplifier) run as campaigns under this unified engine.

---

### AI Gateway
Integrates with OpenRouter, DeepSeek, OpenAI, and GLM through a unified OpenAI-compatible interface. Used across warm-up replies, comment generation, and review writing — with automatic provider fallback so a single model outage doesn't stop operations.

---

### Agent Bridge
A secondary Express API running on its own port with API key authentication. Lets external scripts, n8n workflows, or other AI agents control Flogination programmatically — trigger health checks, queue BM creation, read activity logs — without touching the main dashboard.

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
