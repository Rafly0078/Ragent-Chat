import type { StateStorage } from 'zustand/middleware';

/** SSR-safe storage used while Client Components are rendered on the server. */
const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

export function browserStorage(): StateStorage {
  return typeof window === 'undefined' ? noopStorage : window.localStorage;
}
