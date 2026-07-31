import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  Conversation,
  ConversationSummary,
  GenerationParams,
  Message,
  ThinkingConfig,
  ThinkingEffort,
} from '@/types';
import { uid } from '@/lib/utils/id';
import { notify } from '@/components/ui/toast';
import { DEFAULT_PARAMS, DEFAULT_SYSTEM_PROMPT, DEFAULT_THINKING } from './defaults';

interface ChatState {
  conversations: Conversation[];
  activeId: string | null;
  /** Conversation id currently generating (null when idle). */
  generatingId: string | null;
  searchQuery: string;
  recentModels: string[];

  // selectors are derived in components; these are the mutations
  createConversation: (
    opts?: Partial<Pick<Conversation, 'model' | 'systemPrompt' | 'params'>>,
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
  /** Store/replace the running context summary (compaction). Pass null to clear. */
  setConversationSummary: (id: string, summary: ConversationSummary | null) => void;

  addMessage: (convoId: string, msg: Message) => void;
  appendToMessage: (convoId: string, msgId: string, delta: string) => void;
  /** Append a reasoning delta to a message's `reasoning` field. */
  appendReasoning: (convoId: string, msgId: string, delta: string) => void;
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
 * updated once per token; without this, `persist` would `JSON.stringify` the
 * entire conversation set on every token, driving RAM and GC pressure through
 * the roof (and hanging the tab) on long chats. Writes are deferred and only
 * the latest value is flushed, at most once per `delayMs`.
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
function throttledStorage(delayMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingKey: string | null = null;
  let pendingValue: string | null = null;
  /** Set once a full write has failed — keep writing the slim form after that. */
  let degraded = false;
  let warned = false;

  const tryWrite = (key: string, value: string): boolean => {
    try {
      localStorage.setItem(key, value);
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

    if (!degraded && tryWrite(key, value)) return;

    const slim = slimSnapshot(value);
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
    getItem: (key: string) => localStorage.getItem(key),
    setItem: (key: string, value: string) => {
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
      localStorage.removeItem(key);
    },
  };
}

export function makeConversation(
  opts?: Partial<Pick<Conversation, 'model' | 'systemPrompt' | 'params'>>,
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
  } as Message;
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
      storage: createJSONStorage(() => throttledStorage(1000)),
      version: 3,
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
