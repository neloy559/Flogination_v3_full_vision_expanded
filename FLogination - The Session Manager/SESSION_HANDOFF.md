# Flogination V5 — Session Handoff Document
> Read this FIRST before doing anything. This is the complete state of the project.

---

## 🎯 THE GOAL

Build **Flogination** — an elite Facebook session management and automation tool.
Think: MetaMax + MaxCare + CRM + Inbox — but better, faster, and owned by us.

**Target market:** Facebook marketers, ad operators, account farmers who manage 10–1000+ FB accounts.

**Business model:** Sell as a portable Windows .exe (one-time or subscription). Future: SaaS.

**Competitor reference:** MetaMax (metamax.vn), MIN Software MaxCare (minsoftglobal.io)

---

## 📁 PROJECT LOCATION

```
D:\1 My Dev Creations\Session Manager (FB)\FLogination - The Session Manager\
```

**Run the app:**
```bash
# Terminal 1 — API server
cd "D:\1 My Dev Creations\Session Manager (FB)\FLogination - The Session Manager"
npx tsx src/server/index.ts

# Terminal 2 — Next.js UI
npx next dev Flogination/flogination-web
```

**URLs:** API → http://localhost:3001 | UI → http://localhost:3000

---

## 🏗️ TECH STACK

| Layer | Tech |
|---|---|
| Frontend | Next.js 14, React 18, Tailwind CSS, Zustand |
| Backend | Express 4, TypeScript, Node.js |
| Database | SQLite (better-sqlite3) + optional MongoDB |
| Browser | CloakBrowser (C++ level stealth Chromium) |
| Automation | Playwright via CloakBrowser |
| AI | OpenRouter/DeepSeek/OpenAI/GLM (optional) |
| Packaging | Electron (portable .exe) |

**Key packages:** `cloakbrowser`, `otplib`, `xlsx`, `p-limit`, `express-rate-limit`, `mongoose`, `bcrypt`, `jsonwebtoken`, `electron`, `electron-builder`

---

## 📊 CURRENT STATUS

### ✅ FULLY BUILT (Backend)
- `src/types/index.ts` — All V5 TypeScript interfaces
- `src/server/database.ts` — SQLite with WAL, all tables, full CRUD
- `src/server/utils/spin-parser.ts` — Spin syntax `{a|b|c}` resolver
- `src/server/utils/totp-generator.ts` — RFC 6238 TOTP (Node.js crypto)
- `src/server/utils/webhook-service.ts` — n8n webhook integration
- `src/server/utils/mongo-client.ts` — Optional MongoDB layer
- `src/server/utils/ai-gateway.ts` — Multi-provider AI (OpenRouter/DeepSeek/OpenAI/GLM)
- `src/server/utils/import-parser.ts` — CSV/XLSX/paste bulk import
- `src/server/utils/auth.ts` — bcrypt + JWT scaffold (disabled, future SaaS)
- `src/server/utils/encryption.ts` — AES-256-GCM cookie encryption
- `src/server/automation/stealth-browser.ts` — CloakBrowser wrapper
- `src/server/automation/session-manager.ts` — Browser lifecycle management
- `src/server/automation/auto-scraper.ts` — Background profile harvester
- `src/server/automation/proxy-monitor.ts` — Proxy kill-switch
- `src/server/automation/self-healing.ts` — AI-powered selector healing
- `src/server/campaigns/campaign-engine.ts` — Campaign lifecycle
- `src/server/tools/page-factory.ts` — FB Page creation + parking
- `src/server/tools/bm-factory.ts` — BM creation + parking
- `src/server/tools/group-hunter.ts` — Mass group join + post + DM
- `src/server/tools/comment-engine.ts` — Comment marketing (3 stances)
- `src/server/tools/content-amplifier.ts` — Post seeder + video watch farm
- `src/server/inbox/contact-manager.ts` — CRM contacts
- `src/server/inbox/inbox-manager.ts` — Unified inbox polling
- `src/server/inbox/warmup-engine.ts` — Inbox warm-up
- `src/server/index.ts` — All API routes with rate limiting
- `scripts/backup-db.ts` — DB backup script

### ✅ FULLY BUILT (Frontend)
- `Flogination/flogination-web/app/page.tsx` — Main app shell
- `app/components/TopBar.tsx` — Header
- `app/components/Sidebar.tsx` — Navigation
- `app/components/views/Dashboard.tsx` — Stats, session bank, campaigns, logs
- `app/components/views/AccountsView.tsx` — Session table + Add Session modal + Delete
- `app/components/views/InboxView.tsx` — Unified inbox + AI reply
- `app/components/views/CampaignsView.tsx` — Campaign tracker
- `app/components/views/ProxiesView.tsx` — Proxy management
- `app/components/views/SettingsView.tsx` — All settings wired to API
- `app/components/views/tools/PageFactoryView.tsx`
- `app/components/views/tools/GroupHunterView.tsx`
- `app/components/views/tools/CommentMarketingView.tsx`
- `app/components/views/tools/ContentAmplifierView.tsx`

### ✅ BUILT (Config/Security)
- `tailwind.config.js` — Full Stitch design system tokens
- `electron/main.ts` — Electron main process
- `electron/preload.ts` — Electron preload
- `tsconfig.electron.json` — Electron TypeScript config
- `.env.example` — Environment variables template
- `package.json` — Updated with all scripts + electron-builder config

### ⚠️ KNOWN BUGS (Active)
1. **Scraping fails** — `launchPersistentContext` API changed in CloakBrowser v0.3.30
   - Old: `launchPersistentContext(userDataDir, options)`
   - New: `launchPersistentContext({ userDataDir, ...options })`
   - **Fix needed in:** `src/server/automation/stealth-browser.ts` line ~258
   - Status: Fix was applied but needs verification after server restart

2. **activity_logs FK constraint** — Fixed via migration in database.ts
   - Should auto-migrate on server start

### ⬜ NOT YET BUILT
- `BM Factory View` (UI) — backend done, UI is placeholder
- `Logs View` (UI) — placeholder
- `Grid View` (UI) — placeholder
- `Contacts View` (UI) — placeholder (inside Inbox)
- **Tool 6 — Browser Recorder** (NEW IDEA — see below)
- Electron EXE build (config done, not tested)

---

## 🆕 NEXT FEATURE TO BUILD: Browser Recorder (Tool 6)

**The idea:** A live browser screen inside the Tools section where the operator can manually browse Facebook. The tool records every click/action with its CSS selector, then uses those recordings to improve automation selectors.

**How it works:**
1. Launch a CloakBrowser session with `--remote-debugging-port=9222`
2. Stream the browser screen into the dashboard (CDP screenshot polling or noVNC)
3. Inject a click recorder script that captures: element selector, text, position, action type
4. Save recordings to `selector_cache` table
5. AI analyzes recordings to generate automation steps
6. Automation tools use recorded selectors instead of hardcoded ones

**Why it's powerful:**
- Self-improving automation — human shows it once, it learns
- Fixes broken selectors by watching human do it correctly
- Trains the tool on new Facebook UI changes without code changes

**Spec location:** Add as Requirement 31 + Task 45 in `.kiro/specs/flogination-v5-core/`

---

## 🗄️ DATABASE SCHEMA (Key Tables)

```sql
sessions          -- FB accounts (cookie, uid, health, scraping status, all profile data)
proxies           -- Proxy pool (per-country)
campaigns         -- Automation jobs
campaign_tasks    -- Individual task per session per campaign
parked_assets     -- Pages/BMs transferred to parking accounts
selector_cache    -- AI-healed CSS selectors (elementKey → cssSelector)
contacts          -- CRM (buyers, sellers, leads)
contact_interactions -- Message/comment history per contact
warmup_jobs       -- Inbox warm-up jobs
activity_logs     -- System event log (NO FK on sessionId — was fixed)
settings          -- Single JSON blob (key: 'app_settings')
```

---

## 🎨 UI DESIGN SYSTEM (Stitch)

Design files: `D:\1 My Dev Creations\Session Manager (FB)\stitch_flogination_dashboard_ui\`

**Color tokens (Tailwind):**
- Background: `surface-container-lowest` (#0c0e11)
- Surface: `surface` (#111317)
- Primary: `primary` (#a2c9ff) / `primary-container` (#58a6ff)
- Error: `error` (#ffb4ab)
- Tertiary: `tertiary` (#ffba42)
- Secondary: `secondary` (#d8baff)

**Typography:** Inter (UI) + JetBrains Mono (data/code)
**Icons:** Material Symbols Outlined

---

## 📋 FEATURE LIST (38 features confirmed)

### Core
1. Session Import Manager (cookie + optional creds)
2. Deep Profile Auto-Scraper (name, friends, groups, BMs, pages, monetization)
3. Isolated Session Management (per-account browser process)
4. Health Monitor (live/checkpoint/restricted/dead)
5. Hibernation System

### Stealth
6. CloakBrowser (C++ level, reCAPTCHA 0.9 score)
7. Per-Session Fingerprint (Canvas/WebGL/AudioContext/UA)
8. Proxy Kill-Switch
9. TOTP Auto-Generator
10. Bezier Mouse + Human Typing

### Country/Proxy
11. Proxy-Country Lock
12. Session Bank by Country (Dashboard widget)
13. Bulk Proxy Assignment

### Automation Tools
14. Page Factory + Parking
15. BM Factory + Parking
16. Group Hunter (join + post + DM)
17. Comment Marketing (URL promo / Reels / Page review)
18. Content Amplifier (Post Seeder + Video Watch Farm)
19. **Browser Recorder** (NEW — to be built)

### Inbox & CRM
20. Unified Inbox (all accounts in one view)
21. Reply from Dashboard
22. AI Reply Suggestion
23. Contact CRM (tags, notes, interaction history)
24. Cross-Account Messaging
25. Inbox Warm-Up Engine

### Dashboard
26. Accounts View (dense table)
27. Campaign Tracker
28. Grid View (live browser tiles)
29. Proxy Manager
30. Activity Logs

### Integrations
31. n8n Webhook Integration
32. MongoDB Optional Layer
33. Agent Bridge (external API control)
34. Self-Healing Selectors
35. Multi-Provider AI Gateway

### Security
36. API Rate Limiting
37. AES-256-GCM Cookie Encryption
38. Auth Scaffold (bcrypt + JWT, disabled)

### Distribution
39. Portable Windows EXE (Electron)

---

## 🔑 KEY ARCHITECTURAL DECISIONS

1. **CloakBrowser over Playwright-stealth** — C++ patches, not JS injection. reCAPTCHA 0.9 score.
2. **AI is enhancement only** — All automation runs on pure Playwright. AI never blocks execution.
3. **SQLite + optional MongoDB** — SQLite for sessions/settings, MongoDB for high-volume logs.
4. **Campaign Engine pattern** — All tools create campaigns → tasks → drain loop. Consistent.
5. **Self-healing selectors** — When FB DOM changes, AI fixes selectors automatically.
6. **Spin syntax** — `{a|b|c}` for unique content per session. Pure function, no AI needed.
7. **Portable EXE** — Electron wraps Express + Next.js. No install required.

---

## 📝 CODE STYLE (MANDATORY)

See `.kiro/steering/codestyle.md` for full rules. Key points:
- Single responsibility per file
- Dependency injection (no direct imports in business logic)
- Zero `any` TypeScript
- Named exports only (no default exports)
- JSDoc on every exported function
- Named constants (no magic numbers)
- Feature-based folder structure

---

## 🚨 IMMEDIATE NEXT STEPS

1. **Fix scraping bug** — Verify `launchPersistentContext({ userDataDir, ... })` fix works
2. **Build Browser Recorder** (Tool 6) — Add to spec + implement
3. **Build remaining UI views** — BM Factory, Logs, Grid View, Contacts
4. **Test Electron EXE build** — `npm run electron:build`
5. **Real account testing** — Test all tools with actual FB accounts

---

## 💬 CONVERSATION CONTEXT

- We planned everything together from scratch
- The operator (you) is building this as a commercial product
- Target: sell to FB marketers in BD/VN/PH/IN markets
- Future: SaaS subscription model (auth scaffold already in place)
- The UI design came from Google Stitch (screenshots in stitch folder)
- We researched competitors: MetaMax, MIN Software MaxCare
- We found CloakBrowser on GitHub (19.8k stars) — best stealth solution
- All 44 tasks from the spec are implemented (some need bug fixes)

---

## 🗂️ SPEC FILES

```
.kiro/specs/flogination-v5-core/
  requirements.md  — 30 requirements, 200+ acceptance criteria
  design.md        — Full architecture, DB schema, API map
  tasks.md         — 44 tasks, 10 waves, dependency graph

.kiro/steering/
  codestyle.md     — Code standards (auto-loaded)
  tech.md          — Tech stack rules
  structure.md     — Project structure rules
  product.md       — Product overview
```

---

*Last updated: May 26, 2026 — Session handoff point*
