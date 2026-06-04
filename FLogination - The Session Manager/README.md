# Flogination v5 — Facebook Session Manager

> See the [root README](../README.md) for full documentation.

## Quick Start

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env — set ENCRYPTION_KEY at minimum

# Development (API + dashboard concurrently)
npm run dev
```

| Service | Port |
|---|---|
| Next.js Dashboard | 3000 |
| Express API | 3001 |
| Agent Bridge | 3002 (configurable) |

## Build Commands

```bash
npm run build          # Build everything
npm run build:server   # Server only → dist/
npm run build:client   # Next.js client only
npm start              # Production (requires build)
npm run lint           # ESLint
```

## Key Directories

```
src/server/       Express API + all business logic
src/store/        Zustand client state
src/types/        Shared TypeScript interfaces
electron/         Electron main + preload
Flogination/      Next.js 14 dashboard
scripts/          Utility scripts (backup, seed, test)
```
