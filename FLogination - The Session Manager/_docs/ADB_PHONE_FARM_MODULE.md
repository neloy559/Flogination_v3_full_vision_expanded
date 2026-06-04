# ADB Phone Farm Module — Future Roadmap

**Status:** Deferred — post demo-release  
**Priority:** v6 or separate module  
**Date noted:** 2026-06-02

---

## Concept

Extend Flogination beyond browser-based (Playwright/Chromium) automation by adding a native Android device control layer via **ADB (Android Debug Bridge)**.

This unlocks:
- Physical phone farming setups
- Android emulator farms (LDPlayer, MuMu, BlueStacks etc.)
- Native Facebook app automation instead of browser
- Real device fingerprints (IMEI, Android ID, hardware identifiers)
- Significantly harder to detect than browser-based automation

---

## Use Cases

- Unlimited account marketing at scale — replace Facebook Ads
- Organic promotion, brand whispering, content monetization
- Market manipulation via coordinated engagement
- Warm accounts from real Android hardware signatures
- Each device = fully isolated Facebook session with unique fingerprint

---

## Architecture

```
Physical Phones / Emulators
         ↓
   ADB Connection (USB / TCP)
         ↓
   Flogination ADB Bridge
         ↓
   Appium / UIAutomator2 Server
         ↓
   Facebook Native Android App
         ↓
   Existing Campaign Engine / Tools
```

---

## Technical Stack Needed

| Component | Technology |
|-----------|-----------|
| Device discovery | `adb devices` CLI + node `adbkit` |
| App automation | Appium + `uiautomator2` driver |
| Device management | Per-device session map (like existing session-manager.ts) |
| Fingerprint | Real IMEI, Android ID, screen res from device |
| Proxy per device | `adb shell` proxy settings or VPN app |
| Screenshot stream | `adb exec-out screencap` → base64 → Grid View |

---

## Key Advantages Over Browser

| | Browser (Current) | ADB (Future) |
|--|--|--|
| Fingerprint | Chrome CDP fingerprint injection | Real hardware fingerprint |
| Detection risk | Medium (browser signals) | Low (native app) |
| RAM per session | 175–350 MB | ~50–80 MB (emulator overhead separate) |
| Setup complexity | Low | Medium-High |
| Scalability | Limited by RAM | Limited by USB hubs / emulator slots |

---

## Implementation Plan (when ready)

1. **Phase 1 — Device Manager**
   - `src/server/adb/device-manager.ts` — discover, connect, list ADB devices
   - Map devices to Flogination sessions
   - Show in Accounts view with "Android" badge

2. **Phase 2 — App Automation Bridge**
   - Appium server spawn on localhost
   - `adb-session.ts` — launch FB app, inject actions via UIAutomator2
   - Wrap same `selfHealing` pattern for element lookup

3. **Phase 3 — Unified Session Layer**
   - Abstract `SessionDriver` interface — both Playwright and ADB implement same interface
   - Campaign engine works with both drivers transparently

4. **Phase 4 — Grid View for Phones**
   - Screenshot stream from `adb exec-out screencap -p`
   - Show phone screens in Grid View alongside browser sessions

---

## Notes

- Start with emulator support first (easier to test — no physical hardware needed)
- LDPlayer 9 / MuMu Player 12 support ADB on localhost TCP ports
- Each emulator instance = 1 virtual device on a different port (5554, 5556, 5558...)
- Connection: `adb connect 127.0.0.1:5554`
- Physical farm: USB hub → multiple phones → `adb devices` sees all

---

## Dependencies to Add (when implementing)

```json
"adbkit": "^3.x",
"appium": "^2.x",
"@appium/uiautomator2-driver": "latest"
```
