/**
 * Flogination V5 — Electron Preload Script
 *
 * Runs in the renderer process with a restricted Node.js bridge.
 * Exposes a safe, typed API to the renderer via contextBridge.
 *
 * The dashboard communicates with the Express API via HTTP fetch for all
 * business logic. This bridge only handles Electron-specific concerns:
 * app version and opening external URLs in the system browser.
 */

import { contextBridge, ipcRenderer } from 'electron';

/**
 * Minimal Electron API surface exposed to the renderer.
 * Accessible as `window.electronAPI` in the Next.js dashboard.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Returns the app version string from package.json.
   *
   * @returns Promise resolving to the version string, e.g. "5.0.0"
   *
   * @example
   * const version = await window.electronAPI.getVersion(); // "5.0.0"
   */
  getVersion: (): Promise<string> => ipcRenderer.invoke('get-version'),

  /**
   * Opens a URL in the user's default system browser.
   * Only http/https URLs are allowed.
   *
   * @param url - The URL to open externally
   *
   * @example
   * await window.electronAPI.openExternal('https://facebook.com');
   */
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),
});
