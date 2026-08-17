import type { Message } from '@/types';
import type { ApiChatMessage } from '@/lib/api/types';

/**
 * Agentic web-search planning. Before searching, the model decides WHAT to
 * search for: the concrete keyword queries and the underlying goal. This turns
 * a raw user message ("kenapa build-ku lambat?") into targeted queries
 * ("next.js slow build cache", "webpack build performance 2026") instead of
 * dumping the whole sentence at the search provider.
 *
 * Pure module — no network, no React. The caller runs the actual chat/search.
 */

/** A search plan produced by the model (or the fallback). */
export interface SearchPlan {
  /** Why we're searching — kept for display and to steer the final answer. */
  goal: string;
  /** Concrete queries to run against the search provider, in priority order. */
  queries: string[];
  /**
   * Auto mode only: the model's own verdict on whether the web is needed at
   * all. `false` means answer from the model's own knowledge — the caller skips
   * the search entirely. Undefined when the caller forced a search.
   */
  needsSearch?: boolean;
  /** One line explaining the verdict, shown in the search indicator. */
  reason?: string;
}

/** Cap on planned queries — more than this wastes provider calls + context. */
const MAX_QUERIES = 3;

/**
 * Build the message list for the planning turn. We ask for a strict JSON
 * object; recent conversation turns are included as light context so the plan
 * can resolve pronouns / follow-ups ("and the second one?").
 *
 * In `auto` mode the same turn also decides IF the web is needed, so deciding
 * and planning cost one round-trip rather than two.
 */
export function buildPlanMessages(
  userText: string,
  history: Message[],
  mode: 'auto' | 'always' = 'always',
): ApiChatMessage[] {
  // A few recent turns for context — enough to disambiguate, not the whole log.
  const recent = history
    .filter((m) => m.role !== 'system' && !m.error && m.content.trim())
    .slice(-4)
    .map<ApiChatMessage>((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const shape =
    mode === 'auto'
      ? `{"needs_search": <true|false>, "reason": "<one short sentence>", "goal": "<one sentence: what we're trying to find out>", "queries": ["<search query 1>", "<search query 2>"]}`
      : `{"goal": "<one sentence: what we're trying to find out>", "queries": ["<search query 1>", "<search query 2>"]}`;

  const decisionRules =
    mode === 'auto'
      ? `\nDeciding "needs_search":\n` +
        `- true when the answer depends on information that changes or that you cannot know: current events, prices, release versions, schedules, weather, live status, anything dated after your training cutoff, or specific facts about a named person, product, company or repository you are not confident about.\n` +
        `- true when the user explicitly asks you to look something up, cite sources, or check what is current.\n` +
        `- false for things you can answer from your own knowledge: explanations of stable concepts, math, translation, summarizing or rewriting text the user supplied, writing or debugging code, and reasoning about the conversation itself.\n` +
        `- false for greetings, small talk, and follow-ups that only refer back to what was already said.\n` +
        `- When it is genuinely borderline, prefer true — a wasted search costs less than a confidently outdated answer.\n` +
        `- When "needs_search" is false, return an empty "queries" array.\n`
      : '';

  const system: ApiChatMessage = {
    role: 'system',
    content:
      `You are a search-planning assistant. Given the user's request, decide what to look up on the web to answer it well.\n\n` +
      `Respond with ONLY a JSON object, no prose, no code fence:\n` +
      `${shape}\n` +
      decisionRules +
      `\nRules:\n` +
      `- "queries" are the actual keyword strings to type into a search engine — concise, specific, no full sentences.\n` +
      `- Give 1 to ${MAX_QUERIES} queries. Use more than one only when the request has distinct parts worth searching separately.\n` +
      `- Prefer recent, specific terms. Add a year only when recency matters.\n` +
      `- Do not answer the question. Only plan the search.`,
  };

  return [system, ...recent, { role: 'user', content: userText }];
}

/**
 * Parse the model's planning output into a SearchPlan. Tolerant of the ways
 * weaker local models wrap JSON: leading prose, ```json fences, trailing text.
 * Returns null when nothing usable is found so the caller can fall back.
 *
 * A plan that says `needs_search: false` is valid and returned with zero
 * queries — that is a decision, not a parse failure, and the caller must be
 * able to tell the two apart (one skips the search, the other falls back).
 */
export function parsePlan(raw: string): SearchPlan | null {
  const obj = extractJsonObject(raw);
  if (!obj) return null;

  const cleaned = Array.isArray(obj.queries)
    ? obj.queries
        .filter((q): q is string => typeof q === 'string')
        .map((q) => q.trim())
        .filter(Boolean)
    : [];

  // Dedupe case-insensitively (preserving order) BEFORE capping, so duplicate
  // queries don't eat into the cap and leave us with fewer distinct searches.
  const seen = new Set<string>();
  const queries = cleaned
    .filter((q) => {
      const key = q.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_QUERIES);

  const goal = typeof obj.goal === 'string' ? obj.goal.trim() : '';
  const reason = typeof obj.reason === 'string' ? obj.reason.trim() : '';
  const needsSearch = parseBool(obj.needs_search);

  // An explicit "no" is a complete answer even with no queries.
  if (needsSearch === false) return { goal, queries: [], needsSearch: false, reason };
  // A "yes" with no queries is a half-parse; the caller searches the raw text.
  if (queries.length === 0) return null;

  return {
    goal,
    queries,
    ...(needsSearch === undefined ? {} : { needsSearch }),
    ...(reason ? { reason } : {}),
  };
}

/** Accept the several ways a model spells a boolean in loosely-typed JSON. */
function parseBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true' || v === 'yes') return true;
    if (v === 'false' || v === 'no') return false;
  }
  return undefined;
}

/**
 * Build a plan without the model — used as a fallback when planning fails or
 * thinking is unavailable. Searching the raw user text is exactly the old
 * (pre-agentic) behavior, so this never regresses.
 */
export function fallbackPlan(userText: string): SearchPlan {
  return { goal: '', queries: [userText.trim()].filter(Boolean) };
}

/** Find and JSON-parse the first balanced `{…}` object that parses. */
function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        try {
          const parsed = JSON.parse(slice);
          return typeof parsed === 'object' && parsed !== null
            ? (parsed as Record<string, unknown>)
            : null;
        } catch {
          // Resume at the next `{` rather than giving up. A balanced-but-invalid
          // brace pair in the model's preamble ("I'll look up {next.js} build
          // times") used to defeat the tolerance this function exists for, and
          // in `auto` mode an unparseable plan reads as "no consent to search" —
          // so a stray pair of braces silently cancelled a search the planner
          // had just asked for. Advancing brace-to-brace keeps the recursion
          // depth at the number of `{` in the output, not its length.
          const next = text.indexOf('{', start + 1);
          return next < 0 ? null : extractJsonObject(text.slice(next));
        }
      }
    }
  }
  return null;
}
