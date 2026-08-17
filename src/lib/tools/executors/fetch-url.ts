import 'server-only';

import { assertPublicUrl, BlockedUrlError } from '@/lib/server/public-url';
import type { GenerateRequest } from '../types';

/**
 * Read a web page and hand its text back to the model.
 *
 * The first tool here that RETURNS something rather than producing a file. Web
 * search existed already, but only as a fixed pre-pass: a planner decided the
 * queries before the answer started, and the model could never say "fetch this
 * specific page". Tavily already returns cleaned page text, so the capability was
 * present and simply unreachable.
 *
 * Every URL is vetted by `assertPublicUrl` first, and again after each redirect.
 * A tool that fetches a model-chosen URL from inside the deployment is the
 * textbook SSRF surface — cloud metadata at 169.254.169.254 being the first
 * target — and a public hostname that redirects to a private address is the
 * standard way around a single up-front check.
 */

/** Per-hop and total budgets. A tool call must not be able to hang a request. */
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 4;
const MAX_BYTES = 3 * 1024 * 1024;
const DEFAULT_MAX_CHARS = 40_000;
const HARD_MAX_CHARS = 200_000;

/** Content types worth converting to text. Anything else is reported, not parsed. */
const TEXTUAL = /^(?:text\/|application\/(?:json|xml|xhtml\+xml|javascript|x-ndjson))/i;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
  '#x27': "'",
  mdash: '—',
  ndash: '–',
  hellip: '…',
};

/**
 * `Number.isFinite` also says yes to `&#xFFFFFFFF;`, and the RangeError out of
 * `fromCodePoint` escaped htmlToText as a 500: one malformed entity anywhere on
 * the page failed the whole fetch with "Invalid code point 4294967295".
 */
const isCodePoint = (n: number): boolean => Number.isInteger(n) && n >= 0 && n <= 0x10ffff;

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    const key = code.toLowerCase();
    if (ENTITIES[key] !== undefined) return ENTITIES[key];
    if (key.startsWith('#x')) {
      const n = Number.parseInt(key.slice(2), 16);
      return isCodePoint(n) ? String.fromCodePoint(n) : whole;
    }
    if (key.startsWith('#')) {
      const n = Number.parseInt(key.slice(1), 10);
      return isCodePoint(n) ? String.fromCodePoint(n) : whole;
    }
    return whole;
  });
}

/**
 * Everything below scans forward instead of matching. The passes it replaces used
 * a lazy `[\s\S]*?` before a closing tag, which is quadratic on a page that never
 * closes one: every `<script` position rescans to end-of-input. Measured here, 128KB
 * of `'<script>'` took 367ms and quadrupled per doubling, so a body at the 3MB cap
 * pinned the event loop — and every other request on the instance — for minutes. The
 * AbortController below is no protection: it cannot interrupt a synchronous regex.
 */

/**
 * Lowercase the ASCII only. `toLowerCase()` is not length-preserving (U+0130
 * becomes two code units), and offsets found in this copy slice the original.
 */
function lowerAscii(s: string): string {
  return s.replace(/[A-Z]+/g, (run) => run.toLowerCase());
}

/** Drop `<tag>…</tag>` and everything between, tags included. */
function dropElements(html: string, tags: readonly string[]): string {
  const open = new RegExp(`<(${tags.join('|')})\\b`, 'g');
  const lower = lowerAscii(html);
  // A close tag that isn't ahead of this match isn't ahead of any later one
  // either, so a failed search costs one scan per tag, not one per occurrence.
  const unclosed = new Set<string>();
  let out = '';
  let cursor = 0;
  for (let m = open.exec(lower); m; m = open.exec(lower)) {
    const tag = m[1]!;
    if (unclosed.has(tag)) continue;
    const close = lower.indexOf(`</${tag}>`, open.lastIndex);
    if (close === -1) {
      unclosed.add(tag);
      continue;
    }
    out += `${html.slice(cursor, m.index)} `;
    cursor = close + tag.length + 3;
    open.lastIndex = cursor;
  }
  return cursor === 0 ? html : out + html.slice(cursor);
}

/** The same for `<!--…-->`, which was the worst: 787ms on 128KB of `'<!--x'`. */
function dropComments(html: string): string {
  let out = '';
  let cursor = 0;
  for (;;) {
    const start = html.indexOf('<!--', cursor);
    if (start === -1) break;
    const end = html.indexOf('-->', start + 4);
    // Unterminated, so no later comment closes either: the rest stays as text.
    if (end === -1) break;
    out += `${html.slice(cursor, start)} `;
    cursor = end + 3;
  }
  return cursor === 0 ? html : out + html.slice(cursor);
}

const BLOCK_CLOSE = /^\/(?:p|div|section|article|li|tr|h[1-6]|blockquote|pre)$/i;
const BR_TAG = /^br\b/i;
const LI_TAG = /^li\b/i;

/**
 * Replace every `<…>` with what the text needs in its place. Four passes did this,
 * and three (`<br\b[^>]*\/?>`, `<li\b[^>]*>`, `<[^>]+>`) backtracked across the
 * remainder at every `<` with no `>` after it — 1.8s on 128KB of `'<li '` in one
 * pass alone. A tag is classified by its own text, so one scan does all four.
 */
function stripTags(html: string): string {
  let out = '';
  let cursor = 0;
  let at = 0;
  for (;;) {
    const lt = html.indexOf('<', at);
    if (lt === -1) break;
    const gt = html.indexOf('>', lt + 1);
    if (gt === -1) break; // never closed: left as text, as `<[^>]+>` also left it
    if (gt === lt + 1) {
      // `<>` is not a tag — `[^>]+` needed something in between.
      at = lt + 1;
      continue;
    }
    const tag = html.slice(lt + 1, gt);
    // Structure the reader depends on, kept as the tag itself goes.
    let sep = ' ';
    if (BLOCK_CLOSE.test(tag) || BR_TAG.test(tag)) sep = '\n';
    else if (LI_TAG.test(tag)) sep = '- ';
    out += html.slice(cursor, lt) + sep;
    cursor = gt + 1;
    at = cursor;
  }
  return cursor === 0 ? html : out + html.slice(cursor);
}

/** `<title[^>]*>([\s\S]*?)<\/title>` was quadratic the same way: 1.0s at 128KB. */
function titleOf(html: string): string {
  const lower = lowerAscii(html);
  const open = lower.indexOf('<title');
  if (open === -1) return '';
  const gt = lower.indexOf('>', open + 6);
  if (gt === -1) return '';
  const close = lower.indexOf('</title>', gt + 1);
  return close === -1 ? '' : html.slice(gt + 1, close);
}

/**
 * HTML → readable text. Not a parser: script/style/nav chrome is dropped, block
 * boundaries become newlines, everything else is stripped. Good enough to answer
 * questions from, and it can't execute anything.
 *
 * Exported so it can be checked against fixtures — asserting on the live copy of
 * a remote page is a test that breaks when someone else edits their website.
 */
export function htmlToText(html: string): { title?: string; text: string } {
  const title = decodeEntities(titleOf(html)).trim();
  // Chrome that is never the content the model asked for.
  let body = dropElements(html, ['script', 'style', 'noscript', 'template', 'svg', 'iframe']);
  body = dropComments(body);
  body = dropElements(body, ['nav', 'header', 'footer', 'aside']);
  const text = decodeEntities(stripTags(body))
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { ...(title ? { title } : {}), text };
}

/** Read at most `MAX_BYTES`, so a huge file can't be buffered whole. */
async function readCapped(res: Response): Promise<{ body: string; truncated: boolean }> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BYTES * 4) {
    throw new Error(`That resource is too large (${Math.round(declared / 1024)} KB).`);
  }
  if (!res.body) return { body: '', truncated: false };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  let bytes = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) {
        out += decoder.decode(value.slice(0, Math.max(0, value.byteLength - (bytes - MAX_BYTES))));
        truncated = true;
        break;
      }
      out += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return { body: out, truncated };
}

/**
 * Follow redirects by hand, vetting every hop. `redirect: 'follow'` would let a
 * public URL land on 127.0.0.1 without the guard ever seeing it.
 */
async function fetchVetted(start: URL, signal: AbortSignal): Promise<{ res: Response; url: URL }> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(url, {
      redirect: 'manual',
      signal,
      headers: {
        // Identify honestly, and ask for text.
        'User-Agent': 'Mozilla/5.0 (compatible; RagentBot/1.0; +https://github.com/Rafly0078)',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en,*;q=0.5',
      },
    });
    if (res.status < 300 || res.status >= 400) return { res, url };

    const location = res.headers.get('location');
    if (!location) return { res, url };
    let next: URL;
    try {
      next = new URL(location, url);
    } catch {
      throw new Error('The server redirected to an invalid URL.');
    }
    // Re-vet: this is the hop a single up-front check would have missed.
    url = await assertPublicUrl(next.toString(), { allowQuery: true, allowHttp: true });
  }
  throw new Error(`Too many redirects (more than ${MAX_REDIRECTS}).`);
}

export default async function fetchUrl(req: GenerateRequest): Promise<{ text: string }> {
  const raw = typeof req.url === 'string' ? req.url.trim() : '';
  if (!raw) throw new Error('fetch_url needs a "url".');

  const cap = Math.min(
    typeof req.maxChars === 'number' && req.maxChars > 0 ? req.maxChars : DEFAULT_MAX_CHARS,
    HARD_MAX_CHARS,
  );

  let url: URL;
  try {
    url = await assertPublicUrl(raw, { allowQuery: true, allowHttp: true });
  } catch (err) {
    // Surfaced to the MODEL as a tool result, so it reads as an instruction it
    // can act on rather than a stack trace.
    if (err instanceof BlockedUrlError) throw new Error(`Cannot fetch that URL: ${err.message}`);
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const { res, url: finalUrl } = await fetchVetted(url, controller.signal);
    if (!res.ok) {
      throw new Error(`The server returned ${res.status} ${res.statusText || ''}`.trim() + '.');
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (!TEXTUAL.test(contentType)) {
      throw new Error(
        `That URL is ${contentType || 'an unknown type'}, not a document this tool can read.`,
      );
    }

    const { body, truncated: bodyTruncated } = await readCapped(res);
    const isHtml = /html/i.test(contentType);
    const parsed = isHtml ? htmlToText(body) : { text: body.trim() };

    let text = parsed.text;
    let clipped = bodyTruncated;
    if (text.length > cap) {
      text = text.slice(0, cap);
      clipped = true;
    }
    if (!text) throw new Error('That page had no readable text.');

    const header = [
      `Fetched: ${finalUrl.toString()}`,
      ...(finalUrl.toString() !== url.toString() ? [`(redirected from ${url.toString()})`] : []),
      ...(parsed.title ? [`Title: ${parsed.title}`] : []),
      ...(clipped ? [`Note: truncated at ${cap} characters.`] : []),
    ].join('\n');

    return { text: `${header}\n\n${text}` };
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`That URL did not respond within ${FETCH_TIMEOUT_MS / 1000}s.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
