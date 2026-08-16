/**
 * Formatting helpers for sizes, durations, dates and token estimates.
 */

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(ms?: number): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

export function formatNumber(n?: number): string {
  if (n == null) return '—';
  return new Intl.NumberFormat().format(n);
}

/** Compact number for tight spaces: 950, 12.4K, 1.2M. */
export function formatCompact(n: number): string {
  if (n < 1000) return `${Math.round(n)}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * Cheap, dependency-free token estimate. Not exact (real count comes from the
 * API's eval_count), but good enough for a live counter while typing.
 * Heuristic: ~4 chars per token, with a floor on word count.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const byChars = Math.ceil(text.length / 4);
  const byWords = Math.ceil(text.trim().split(/\s+/).filter(Boolean).length * 1.3);
  return Math.max(byChars, byWords);
}

/**
 * Estimate the token cost of a single message the way it will be sent to the
 * model: its text content plus any inlined attachment text. Image attachments
 * are counted with a flat allowance since their real cost is model-specific.
 * Used to decide when a conversation should be compacted.
 */
export function estimateMessageTokens(msg: {
  content: string;
  attachments?: { text?: string; base64?: string }[];
}): number {
  let total = estimateTokens(msg.content);
  for (const att of msg.attachments ?? []) {
    if (att.text) total += estimateTokens(att.text);
    else if (att.base64) total += 768; // flat allowance for a vision image
  }
  return total;
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ts).toLocaleDateString();
}

/**
 * Wall-clock time for a message's rail: `14:02`.
 *
 * 24-hour and zero-padded whatever the locale, because the rail is a fixed-width
 * mono column — `2:02 PM` is three glyphs wider than `14:02`, which would give
 * every turn's hairline a different length.
 */
export function clockTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Group conversations into human date buckets for the sidebar. */
export function dateBucket(ts: number): string {
  const now = new Date();
  const d = new Date(ts);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 86_400_000;
  if (ts >= startOfToday) return 'Today';
  if (ts >= startOfToday - dayMs) return 'Yesterday';
  if (ts >= startOfToday - 7 * dayMs) return 'Previous 7 days';
  if (ts >= startOfToday - 30 * dayMs) return 'Previous 30 days';
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
