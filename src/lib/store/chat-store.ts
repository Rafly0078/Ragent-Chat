import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import type {
  Conversation,
  ConversationSummary,
  GenerationParams,
  Message,
  MessagePart,
  SearchMode,
  ThinkingConfig,
  ThinkingEffort,
} from '@/types';
import { SEARCH_MODES } from '@/types';
import { uid } from '@/lib/utils/id';
import { notify } from '@/components/ui/toast';
import { browserStorage } from './storage';
import { sealed, seedParts, withParts, type PartDelta } from './message-parts';
export type { PartDelta } from './message-parts';
import {
  DEFAULT_PARAMS,
  DEFAULT_SEARCH_MODE,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_THINKING,
} from './defaults';

interface ChatState {
  conversations: Conversation[];
  activeId: string | null;
  /** Conversation id currently generating (null when idle). */
  generatingId: string | null;
  searchQuery: string;
  recentModels: string[];

  // selectors are derived in components; these are the mutations
  createConversation: (
    opts?: Partial<Pick<Conversation, 'model' | 'systemPrompt' | 'params' | 'searchMode'>>,
  ) => string;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  togglePin: (id: string) => void;
  setActive: (id: string | null) => void;
  clearMessages: (id: string) => void;
  duplicateConversation: (id: string) => void;

  setConversationModel: (id: string, model: string) => void;
  setConversationSystemPrompt: (id: string, prompt: string) => void;
  setConversationParams: (id: string, patch: Partial<GenerationParams>) => void;
  setConversationThinking: (id: string, patch: Partial<ThinkingConfig>) => void;
  setConversationSearchMode: (id: string, mode: SearchMode) => void;
  /** Store/replace the running context summary (compaction). Pass null to clear. */
  setConversationSummary: (id: string, summary: ConversationSummary | null) => void;

  addMessage: (convoId: string, msg: Message) => void;
  appendToMessage: (convoId: string, msgId: string, delta: string) => void;
  /** Append a reasoning delta to a message's `reasoning` field. */
  appendReasoning: (convoId: string, msgId: string, delta: string) => void;
  /**
   * Append ordered stream segments to a message, preserving interleaving.
   *
   * Each entry either extends the currently-open part with a matching
   * `(kind, index)` or opens a new one after it, and `content`/`reasoning` are
   * re-derived so every existing reader keeps working. Batched as an array
   * because the stream consumer flushes a whole frame's worth at once.
   */
  appendParts: (convoId: string, msgId: string, incoming: PartDelta[]) => void;
  /** Close any still-open thinking part — stream ended, aborted or errored. */
  sealParts: (convoId: string, msgId: string, interrupted?: boolean) => void;
  updateMessage: (convoId: string, msgId: string, patch: Partial<Message>) => void;
  deleteMessage: (convoId: string, msgId: string) => void;
  /** Remove a message and everything after it (used by regenerate/edit). */
  truncateFrom: (convoId: string, msgId: string, inclusive: boolean) => void;

  setGenerating: (id: string | null) => void;
  setSearchQuery: (q: string) => void;
  pushRecentModel: (model: string) => void;

  /**
   * Import conversations from untrusted JSON (a user-picked export file).
   * Accepts `unknown` on purpose — the payload is validated and coerced here,
   * not by the caller. Returns how many survived validation.
   */
  importConversations: (data: unknown, replace?: boolean) => number;
}

function touch(convo: Conversation): Conversation {
  return { ...convo, updatedAt: Date.now() };
}

/**
 * Strip the heavy, reconstructable parts of a persisted snapshot so the part the
 * user can't get back — the conversation text — still fits in localStorage.
 *
 * The bytes that blow the ~5MB quota are always the same two things: base64
 * image attachments, and `data:` URLs for artifacts generated in guest mode.
 * Both are dropped here; message content, titles and params are untouched.
 */
function slimSnapshot(json: string): string | null {
  try {
    const parsed = JSON.parse(json) as {
      state?: { conversations?: Conversation[] };
    };
    const conversations = parsed.state?.conversations;
    if (!Array.isArray(conversations)) return null;

    for (const convo of conversations) {
      for (const msg of convo.messages ?? []) {
        if (msg.attachments) {
          msg.attachments = msg.attachments.map((att) => ({
            ...att,
            base64: undefined,
            previewUrl: undefined,
          }));
        }
        const artifacts = msg.metadata?.artifacts;
        if (Array.isArray(artifacts)) {
          msg.metadata = {
            ...msg.metadata,
            artifacts: artifacts.map((a) => {
              const art = a as { url?: string };
              return typeof art.url === 'string' && art.url.startsWith('data:')
                ? { ...art, url: undefined }
                : art;
            }),
          };
        }
      }
    }
    return JSON.stringify(parsed);
  } catch {
    return null;
  }
}

/**
 * A localStorage wrapper that coalesces writes. During streaming the store is
 * updated once per animation frame; without this, `persist` would write the
 * entire conversation set to localStorage ~60 times a second, driving RAM and
 * GC pressure through the roof (and hanging the tab) on long chats. Writes are
 * deferred and only the latest value is flushed, at most once per `delayMs`.
 *
 * This is a `PersistStorage`, NOT a `StateStorage` behind `createJSONStorage`,
 * and that distinction is the whole point. `createJSONStorage` runs
 * `JSON.stringify` in its own `setItem` — i.e. BEFORE handing the value down
 * here — so wrapping it only ever deferred the `localStorage.setItem` call. The
 * serialization itself (a full clone of state plus a stringify of every
 * conversation, every message, and every base64 image still in memory) still
 * happened on every frame; one 500 KB attachment in history was 20-40 ms of
 * main-thread work per frame on a phone, by itself. Taking the raw object here
 * and stringifying inside `flush` is what actually moves that cost off the hot
 * path: once per second instead of once per frame.
 *
 * The flush runs inside a timer, i.e. outside any caller's try/catch, so a
 * `QuotaExceededError` used to escape as an unhandled exception AND leave
 * `timer` pinned non-null — after which the `if (timer) return` guard turned
 * every later write into a silent no-op and the whole session stopped
 * persisting. Now a failed write degrades to a slimmed snapshot and tells the
 * user, and the timer state is always reset.
 *
 * `pagehide` (not `beforeunload`) does the final flush: mobile browsers freeze
 * or discard a backgrounded tab without ever firing `beforeunload`, which meant
 * losing up to `delayMs` of the conversation.
 */
/**
 * Typed against `unknown` rather than the persisted slice on purpose: this
 * wrapper never inspects the value, it only defers serializing it, and the
 * `persist` middleware's own PersistedState generic widens to `unknown` here
 * anyway (the `migrate` below can return the raw persisted blob).
 */
function throttledStorage(delayMs: number): PersistStorage<unknown> {
  const storage = browserStorage();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingKey: string | null = null;
  let pendingValue: StorageValue<unknown> | null = null;
  /** Set once a full write has failed — keep writing the slim form after that. */
  let degraded = false;
  let warned = false;

  const tryWrite = (key: string, value: string): boolean => {
    try {
      storage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  };

  const flush = () => {
    const key = pendingKey;
    const value = pendingValue;
    // Reset first: whatever happens below, the next setItem must be able to
    // schedule a fresh flush.
    pendingKey = null;
    pendingValue = null;
    timer = null;
    if (key === null || value === null) return;

    // The one stringify, once per flush window rather than once per frame.
    let json: string;
    try {
      json = JSON.stringify(value);
    } catch {
      return;
    }

    if (!degraded && tryWrite(key, json)) return;

    const slim = slimSnapshot(json);
    if (slim && tryWrite(key, slim)) {
      if (!degraded) {
        degraded = true;
        console.warn(
          '[chat-store] localStorage quota exceeded — persisting without image ' +
            'attachments and inline file data. Message text is unaffected.',
        );
        notify(
          'Local storage is full. Chats are still saved, but attached images and ' +
            'generated files are no longer kept across reloads — delete some old chats to free space.',
          'error',
        );
      }
      return;
    }

    if (!warned) {
      warned = true;
      console.error('[chat-store] Could not persist chats to localStorage.');
      notify('Could not save chats locally — storage is full. Delete some old chats.', 'error');
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  }

  return {
    getItem: (key: string) => {
      const raw = storage.getItem(key);
      if (typeof raw !== 'string') return null;
      try {
        return JSON.parse(raw) as StorageValue<unknown>;
      } catch {
        return null;
      }
    },
    setItem: (key: string, value: StorageValue<unknown>) => {
      pendingKey = key;
      pendingValue = value;
      if (timer) return;
      timer = setTimeout(flush, delayMs);
    },
    removeItem: (key: string) => {
      pendingKey = null;
      pendingValue = null;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      storage.removeItem(key);
    },
  };
}

export function makeConversation(
  opts?: Partial<Pick<Conversation, 'model' | 'systemPrompt' | 'params' | 'searchMode'>>,
): Conversation {
  const now = Date.now();
  return {
    id: uid(),
    title: 'New chat',
    messages: [],
    model: opts?.model ?? '',
    systemPrompt: opts?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    params: opts?.params ?? { ...DEFAULT_PARAMS },
    thinking: { ...DEFAULT_THINKING },
    searchMode: opts?.searchMode ?? DEFAULT_SEARCH_MODE,
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
}

const ROLES = new Set(['system', 'user', 'assistant']);

function sanitizeMessage(raw: unknown): Message | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Partial<Message>;
  if (typeof m.content !== 'string') return null;
  if (typeof m.role !== 'string' || !ROLES.has(m.role)) return null;
  return {
    ...m,
    id: typeof m.id === 'string' && m.id ? m.id : uid(),
    role: m.role,
    content: m.content,
    createdAt: typeof m.createdAt === 'number' ? m.createdAt : Date.now(),
    // Never restore a "still streaming" flag from a file — nothing is streaming.
    streaming: false,
    attachments: Array.isArray(m.attachments) ? m.attachments : undefined,
    // Ordered segments arrive from an untrusted export file, and the renderer
    // switches on `kind` and does arithmetic on `endedAt - startedAt`. A bad
    // `kind` renders nothing; a string `startedAt` prints NaN as the duration.
    parts: sanitizeParts(m.parts),
  } as Message;
}

/** Element-by-element validation of imported `parts`. Mirrors safeThinkingBlocks. */
function sanitizeParts(raw: unknown): MessagePart[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const out: MessagePart[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const p = entry as Record<string, unknown>;
    const text = typeof p.text === 'string' ? p.text : '';
    const index = num(p.index, -1);
    if (p.kind === 'text') {
      out.push({ kind: 'text', index, text });
      continue;
    }
    if (p.kind !== 'thinking') continue;
    const startedAt = num(p.startedAt, 0);
    const ended =
      typeof p.endedAt === 'number' && Number.isFinite(p.endedAt)
        ? Math.max(p.endedAt, startedAt)
        : undefined;
    out.push({
      kind: 'thinking',
      index,
      text,
      startedAt,
      ...(ended !== undefined ? { endedAt: ended } : {}),
      ...(typeof p.signature === 'string' ? { signature: p.signature } : {}),
      ...(p.redacted === true ? { redacted: true } : {}),
      // An import is never mid-stream, so an unclosed block was interrupted.
      ...(ended === undefined ? { interrupted: true, endedAt: startedAt } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Coerce untrusted JSON (a user-picked export file) into well-formed
 * conversations. Anything unusable is dropped rather than written to the store:
 * a single conversation missing `title` or `messages` used to be persisted as-is
 * and then crash the sidebar on every render — including after a reload, since
 * the bad data was already in localStorage, leaving no way back into the app.
 */
export function sanitizeConversations(raw: unknown): Conversation[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Conversation[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Partial<Conversation>;
    const messages = Array.isArray(c.messages)
      ? c.messages.map(sanitizeMessage).filter((m): m is Message => m !== null)
      : [];

    // Fresh id on collision so importing a file twice can't produce two
    // conversations that respond to the same id.
    let id = typeof c.id === 'string' && c.id ? c.id : uid();
    if (seen.has(id)) id = uid();
    seen.add(id);

    const base = makeConversation();
    out.push({
      ...base,
      id,
      title: typeof c.title === 'string' && c.title.trim() ? c.title : 'Imported chat',
      messages,
      model: typeof c.model === 'string' ? c.model : '',
      systemPrompt: typeof c.systemPrompt === 'string' ? c.systemPrompt : base.systemPrompt,
      params: { ...DEFAULT_PARAMS, ...(typeof c.params === 'object' && c.params ? c.params : {}) },
      thinking: {
        ...DEFAULT_THINKING,
        ...(typeof c.thinking === 'object' && c.thinking ? c.thinking : {}),
      },
      searchMode: SEARCH_MODES.includes(c.searchMode as SearchMode)
        ? (c.searchMode as SearchMode)
        : DEFAULT_SEARCH_MODE,
      summary:
        c.summary && typeof c.summary === 'object' && typeof c.summary.text === 'string'
          ? c.summary
          : undefined,
      pinned: c.pinned === true,
      createdAt: typeof c.createdAt === 'number' ? c.createdAt : base.createdAt,
      updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : base.updatedAt,
    });
  }

  return out;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      conversations: [],
      activeId: null,
      generatingId: null,
      searchQuery: '',
      recentModels: [],

      createConversation: (opts) => {
        const convo = makeConversation(opts);
        set((s) => ({ conversations: [convo, ...s.conversations], activeId: convo.id }));
        return convo.id;
      },

      deleteConversation: (id) =>
        set((s) => {
          const conversations = s.conversations.filter((c) => c.id !== id);
          const activeId = s.activeId === id ? (conversations[0]?.id ?? null) : s.activeId;
          return { conversations, activeId };
        }),

      renameConversation: (id, title) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? touch({ ...c, title: title.trim() || 'Untitled' }) : c,
          ),
        })),

      togglePin: (id) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            // `touch` matters: the sync layer diffs on `updatedAt`, so without it
            // a pin was written to localStorage but never to Supabase, and was
            // lost on the next hydrate or on another device.
            c.id === id ? touch({ ...c, pinned: !c.pinned }) : c,
          ),
        })),

      setActive: (activeId) => set({ activeId }),

      clearMessages: (id) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? touch({ ...c, messages: [], summary: undefined }) : c,
          ),
        })),

      duplicateConversation: (id) =>
        set((s) => {
          const src = s.conversations.find((c) => c.id === id);
          if (!src) return s;
          const copy: Conversation = {
            ...src,
            id: uid(),
            title: `${src.title} (copy)`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            pinned: false,
            messages: src.messages.map((m) => ({ ...m, id: uid() })),
          };
          return { conversations: [copy, ...s.conversations], activeId: copy.id };
        }),

      setConversationModel: (id, model) =>
        set((s) => ({
          conversations: s.conversations.map((c) => (c.id === id ? touch({ ...c, model }) : c)),
        })),

      setConversationSystemPrompt: (id, systemPrompt) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? touch({ ...c, systemPrompt }) : c,
          ),
        })),

      setConversationParams: (id, patch) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? touch({ ...c, params: { ...c.params, ...patch } }) : c,
          ),
        })),

      setConversationThinking: (id, patch) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? touch({ ...c, thinking: { ...c.thinking, ...patch } }) : c,
          ),
        })),

      setConversationSearchMode: (id, searchMode) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? touch({ ...c, searchMode }) : c,
          ),
        })),

      setConversationSummary: (id, summary) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            // Touched so the new summary actually syncs — the diff is on
            // `updatedAt`, so a fresh compaction was otherwise never persisted
            // remotely and the whole history got re-summarized after every reload.
            c.id === id ? touch({ ...c, summary: summary ?? undefined }) : c,
          ),
        })),

      addMessage: (convoId, msg) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convoId ? touch({ ...c, messages: [...c.messages, msg] }) : c,
          ),
        })),

      appendToMessage: (convoId, msgId, delta) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convoId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === msgId ? { ...m, content: m.content + delta } : m,
                  ),
                }
              : c,
          ),
        })),

      appendReasoning: (convoId, msgId, delta) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convoId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === msgId ? { ...m, reasoning: (m.reasoning ?? '') + delta } : m,
                  ),
                }
              : c,
          ),
        })),

      appendParts: (convoId, msgId, incoming) => {
        if (incoming.length === 0) return;
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convoId
              ? {
                  ...c,
                  messages: c.messages.map((m) => (m.id === msgId ? withParts(m, incoming) : m)),
                }
              : c,
          ),
        }));
      },

      sealParts: (convoId, msgId, interrupted) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convoId
              ? {
                  ...c,
                  messages: c.messages.map((m) => (m.id === msgId ? sealed(m, interrupted) : m)),
                }
              : c,
          ),
        })),

      updateMessage: (convoId, msgId, patch) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convoId
              ? touch({
                  ...c,
                  messages: c.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m)),
                })
              : c,
          ),
        })),

      deleteMessage: (convoId, msgId) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convoId
              ? touch({ ...c, messages: c.messages.filter((m) => m.id !== msgId) })
              : c,
          ),
        })),

      truncateFrom: (convoId, msgId, inclusive) =>
        set((s) => ({
          conversations: s.conversations.map((c) => {
            if (c.id !== convoId) return c;
            const idx = c.messages.findIndex((m) => m.id === msgId);
            if (idx === -1) return c;
            const end = inclusive ? idx : idx + 1;
            return touch({ ...c, messages: c.messages.slice(0, end) });
          }),
        })),

      setGenerating: (generatingId) => set({ generatingId }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),

      pushRecentModel: (model) =>
        set((s) => ({
          recentModels: [model, ...s.recentModels.filter((m) => m !== model)].slice(0, 6),
        })),

      importConversations: (data, replace) => {
        const incoming = sanitizeConversations(data);
        if (incoming.length === 0) return 0;
        set((s) => ({
          conversations: replace ? incoming : [...incoming, ...s.conversations],
          activeId: incoming[0]?.id ?? s.activeId,
        }));
        return incoming.length;
      },
    }),
    {
      name: 'ollama-webui:chats',
      storage: throttledStorage(1000),
      version: 6,
      migrate: (persisted: unknown, version: number) => {
        if (!persisted || typeof persisted !== 'object') return persisted;
        const state = persisted as { conversations?: Conversation[] };
        // v1 → v2: pre-thinking conversations get the default thinking config.
        if (version < 2 && state.conversations) {
          state.conversations = state.conversations.map((c) => ({
            ...c,
            thinking: c.thinking ?? { ...DEFAULT_THINKING },
          }));
        }
        // v2 → v3: effort values became Ollama's `think` levels. The old labels
        // are no longer valid values (sending them yields HTTP 400), so remap.
        if (version < 3 && state.conversations) {
          const remap: Record<string, ThinkingEffort> = {
            minimal: 'low',
            default: 'medium',
            extended: 'high',
          };
          state.conversations = state.conversations.map((c) => {
            const effort = c.thinking?.effort as string | undefined;
            if (effort && effort in remap) {
              return { ...c, thinking: { ...c.thinking, effort: remap[effort]! } };
            }
            return c;
          });
        }
        // v3 → v4: the default context window moved from 8192 to 131072. Each
        // conversation snapshots its own params at creation, so without this an
        // old chat stays capped at the old default and keeps getting compacted
        // early. A window the user chose themselves is left alone.
        if (version < 4 && state.conversations) {
          state.conversations = state.conversations.map((c) =>
            c.params?.contextLength === 8192
              ? { ...c, params: { ...c.params, contextLength: 131072 } }
              : c,
          );
        }
        // v4 → v5: context/max-tokens can now follow the model's own limits, and
        // search gained an `auto` mode. Auto is turned on only where the value is
        // still the default one — a window someone deliberately typed keeps
        // winning, exactly as `resolveLimits` treats an explicit `false`.
        if (version < 5 && state.conversations) {
          state.conversations = state.conversations.map((c) => ({
            ...c,
            params: {
              ...c.params,
              ...(c.params?.contextLength === 131072 || c.params?.contextLength == null
                ? { contextAuto: true }
                : { contextAuto: false }),
              ...(c.params?.maxTokens === -1 || c.params?.maxTokens == null
                ? { maxTokensAuto: true }
                : { maxTokensAuto: false }),
            },
            searchMode: c.searchMode ?? DEFAULT_SEARCH_MODE,
          }));
        }
        // v5 → v6: reasoning became an ordered `parts` array. Existing messages
        // are seeded from the flat pair, which reproduces the only ordering the
        // old model could express — all thinking, then all text. Doing it here
        // rather than lazily means a `continue` on an old message appends after
        // its blocks instead of silently discarding them.
        if (version < 6 && state.conversations) {
          state.conversations = state.conversations.map((c) => ({
            ...c,
            messages: (c.messages ?? []).map((m) =>
              m.role === 'assistant' && !m.parts && (m.reasoning || m.content)
                ? { ...m, parts: seedParts(m) }
                : m,
            ),
          }));
        }
        return state;
      },
      // Don't persist transient generation state.
      partialize: (s) => ({
        conversations: s.conversations,
        activeId: s.activeId,
        recentModels: s.recentModels,
      }),
    },
  ),
);
