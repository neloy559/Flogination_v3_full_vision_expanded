/**
 * Flogination V5 — Electron Preload Script
 *
 * Runs in the renderer process with a restricted Node.js bridge.
 * Exposes a safe, typed API to the renderer via contextBridge.
 *
 * The dashboard communicates with the Express API via HTTP fetch for all
 * business logic. This bridge only handles Electron-specific concerns:
 * app version, external URLs, update notifications, and version gate.
 */

import { contextBridge, ipcRenderer } from 'electron';

/**
 * Electron API surface exposed to the renderer.
 * Accessible as `window.electronAPI` in the Next.js dashboard.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Returns the app version string from package.json.
   * @example
   * const version = await window.electronAPI.getVersion(); // "0.1.0"
   */
  getVersion: (): Promise<string> => ipcRenderer.invoke('get-version'),

  /**
   * Opens a URL in the user's default system browser.
   * Only http/https URLs are allowed.
   */
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),

  /**
   * Manually triggers an update check against GitHub Releases.
   */
  checkForUpdates: (): Promise<void> => ipcRenderer.invoke('check-for-updates'),

  /**
   * Registers a callback for when an update is available.
   * Payload: { version: string, releaseNotes: string }
   */
  onUpdateAvailable: (callback: (info: { version: string; releaseNotes: string }) => void): void => {
    ipcRenderer.on('update-available', (_event, info) => callback(info));
  },

  /**
   * Registers a callback for when an update has been downloaded and is
   * ready to install on next restart.
   */
  onUpdateDownloaded: (callback: () => void): void => {
    ipcRenderer.on('update-downloaded', () => callback());
  },

  /**
   * Registers a callback for when the version gate blocks this version.
   * Payload: { message: string }
   */
  onVersionBlocked: (callback: (info: { message: string }) => void): void => {
    ipcRenderer.on('version-blocked', (_event, info) => callback(info));
  },
});
