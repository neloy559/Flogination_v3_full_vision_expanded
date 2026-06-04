/**
 * Type declarations for the Electron preload bridge.
 *
 * `window.electronAPI` is injected by electron/preload.ts via contextBridge.
 * It is only available when the app runs inside Electron.
 * Always guard usage with `typeof window.electronAPI !== 'undefined'`.
 */

interface ElectronAPI {
  /** Returns the app version string from package.json, e.g. "5.0.0" */
  getVersion: () => Promise<string>;
  /** Opens a URL in the user's default system browser */
  openExternal: (url: string) => Promise<void>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
