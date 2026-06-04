# Changelog

All notable changes to Flogination are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [0.1.0-demo] — 2026-06-04

### This Release
First public demo release of Flogination v5. Focused on the core account
management workflow — import, enrich, and monitor Facebook sessions at scale.

### What's Included

#### Account Management
- **Single import** — paste a Facebook cookie to add one account
- **Bulk import** — upload `.xlsx` or `.csv` files, or paste multiple cookies
- **Auto UID extraction** — automatically parses `c_user` from the cookie string
- **Duplicate detection** — blocks duplicate cookies and UIDs on import
- **Profile auto-scraper** — automatically harvests Facebook profile data after import:
  BM count, owned pages, joined groups, ad account IDs, friend count,
  professional mode, monetization status, scraping status

#### Session Dashboard
- Full accounts list with health status badges (`live`, `checkpoint`, `restricted`, `dead`)
- Per-account metadata: UID, country, BM count, proxy assignment, last check timestamp
- Country grouping view with session bank stats
- Manual health check trigger per session

#### Browser Automation
- Launch a stealth Chromium browser per session (Playwright + CDP patching)
- Bézier mouse movement, WebRTC blocking, fingerprint injection
- Session hibernation — suspend idle browsers to conserve RAM
- Wake on demand

#### Proxy Management
- Add proxies manually or bulk import (host:port or protocol://user:pass@host:port)
- Test proxy connectivity with auto country detection
- Assign proxies to sessions individually or in bulk (round-robin)
- Proxy kill-switch — hibernates session immediately if proxy disconnects

#### Infrastructure
- Auto-updater — checks GitHub Releases on startup, one-click update from dashboard
- Version gate — remote kill-switch via GitHub Gist if a version needs to be retired
- SQLite database with WAL mode — handles 1,000+ accounts without performance degradation
- Portable `.exe` — no installation required, data stored next to the executable

### Known Limitations
- Campaign tools (Page Factory, BM Factory, Group Hunter, Comment Engine, Content Amplifier) are not available in this release
- Inbox / CRM features are not available in this release
- Account warm-up engine is not available in this release
- Agent Bridge is present but disabled by default — enable in Settings

### Upgrade Path
Future releases will unlock automation tools progressively.
Update notifications will appear in the dashboard when a new version is available.

---

*More versions coming. Follow the [GitHub Releases](https://github.com/neloy559/Flogination_v3_full_vision_expanded/releases) page for updates.*
