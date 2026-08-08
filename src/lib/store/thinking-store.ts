import { create } from 'zustand';

/**
 * Tracks which provider/protocol/model tuples returned an error when thinking
 * was requested, so
 * the UI can disable the thinking toggle for them and show a tooltip.
 *
 * Non-persistent: this is a per-session cache. A model might gain thinking
 * support after an Ollama update; a page refresh clears the blocklist so it
 * can be re-tried.
 */
interface ThinkingState {
  /** Provider/protocol/model keys known to not support thinking. */
  unsupported: Set<string>;

  /** Mark a provider/protocol/model tuple as not supporting thinking. */
  markUnsupported: (key: string) => void;
  /** Clear the unsupported flag (e.g. after an upstream update). */
  clearUnsupported: (key: string) => void;
  /** Check if a provider/protocol/model tuple is known to not support thinking. */
  isUnsupported: (key: string) => boolean;
}

export const useThinkingStore = create<ThinkingState>((set, get) => ({
  unsupported: new Set<string>(),

  markUnsupported: (key) =>
    set((s) => {
      if (s.unsupported.has(key)) return s;
      const next = new Set(s.unsupported);
      next.add(key);
      return { unsupported: next };
    }),

  clearUnsupported: (key) =>
    set((s) => {
      if (!s.unsupported.has(key)) return s;
      const next = new Set(s.unsupported);
      next.delete(key);
      return { unsupported: next };
    }),

  isUnsupported: (key) => get().unsupported.has(key),
}));
