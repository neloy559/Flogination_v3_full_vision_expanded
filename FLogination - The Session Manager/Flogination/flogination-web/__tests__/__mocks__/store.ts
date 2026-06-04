/**
 * Mock for src/store — used in Jest tests to avoid importing Zustand/fetch in pure function tests.
 */
export const useStore = jest.fn();
export const startPolling = jest.fn();
