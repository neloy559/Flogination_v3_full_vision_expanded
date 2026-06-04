# Flogination - Elite Facebook Session Manager

A high-performance, 24/7 standalone Facebook session management system with Agent Bridge for remote AI monitoring and control.

## Features

- **Session Management**: Manage 1000+ Facebook accounts with cookie-based authentication
- **Stealth Browser**: Playwright-based browser with CDP patching, Bezier mouse movements, WebRTC blocking
- **Universal AI Gateway**: Support for OpenRouter, DeepSeek, OpenAI, and GLM models
- **Agent Bridge**: API layer for external remote control via agents
- **Window Grid Management**: Tiled grid view (3x4) for mass monitoring
- **Health Monitoring**: Real-time checkpoint, restriction, and dead account detection
- **Hibernation**: Save RAM by hibernating idle sessions

## Quick Start

```bash
# Install dependencies
cd "FLogination - The Session Manager"
npm install

# Run development mode
npm run dev
```

This starts both the API server (port 3000) and Next.js dashboard (port 3001).

## API Endpoints

- `GET /api/sessions` - List all sessions
- `POST /api/sessions` - Create new session
- `POST /api/sessions/:id/launch` - Launch browser for session
- `POST /api/sessions/:id/check-health` - Check account health
- `GET /api/settings` - Get app settings
- `POST /api/settings` - Update settings

## Agent Bridge (Optional)

When enabled, runs on separate port with endpoints:
- `GET /health` - Bridge health check
- `GET /sessions` - List sessions
- `POST /sessions/:id/action` - Trigger actions
- `POST /sessions/:id/create-bm` - Create Business Manager

## Tech Stack

- **Dashboard**: Next.js 14+
- **Engine**: Node.js + Playwright
- **Database**: SQLite (better-sqlite3)
- **State Management**: Zustand

## License

Proprietary - For authorized use only
