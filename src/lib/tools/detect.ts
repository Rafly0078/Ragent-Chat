/**
 * Artifact directive detection.
 *
 * Preferred shape (see ./prompt.ts for what the model is instructed to
 * emit) — a few "key: value" header lines, a line containing only "---",
 * then the raw file content with no escaping required:
 *
 *   ```artifact
 *   tool: create_pdf
 *   name: report.pdf
 *   title: Report Title
 *   ---
 *   # Full markdown content, written naturally — no quote/newline escaping.
 *   ```
 *
 * Legacy shape (kept for backward compatibility — some models naturally
 * produce clean JSON and this still works fine for short payloads):
 *
 *   ```artifact
 *   { "tool": "create_pdf", "name": "report.pdf", "content": "# ..." }
 *   ```
 *
 * We extract those, validate the tool name, and return the requests plus the
 * message text with the raw blocks removed (the UI renders an ArtifactCard in
 * their place). A block that fails to parse under BOTH shapes is left inline
 * as a code block — MarkdownRenderer shows a clear "failed to generate"
 * notice for it instead of silently pretending nothing happened.
 */

import type { GenerateRequest, SheetSpec, SlideSpec, FileSpec, ThemeSpec } from './types';
import { getTool, isToolName } from './registry';
import { findFences, hasFenceTag, type FenceMatch } from './fences';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function isSheetSpecArray(v: unknown): v is SheetSpec[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((s) => isRecord(s) && Array.isArray(s.rows) && s.rows.every(Array.isArray))
  );
}

function isSlideSpecArray(v: unknown): v is SlideSpec[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every(
      (s) =>
        isRecord(s) &&
        (s.title === undefined || typeof s.title === 'string') &&
        (s.body === undefined || typeof s.body === 'string') &&
        (s.bullets === undefined ||
          (Array.isArray(s.bullets) && s.bullets.every((b) => typeof b === 'string'))),
    )
  );
}

function isFileSpecArray(v: unknown): v is FileSpec[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((f) => isRecord(f) && typeof f.path === 'string' && f.path.trim() !== '')
  );
}

/** Header keys that feed the theme rather than the request itself. */
const THEME_KEYS = ['accent', 'ink', 'font', 'cover', 'subtitle', 'author'] as const;

/**
 * Read a truthy flag out of a header value.
 *
 * `cover: true`, `cover: yes` and a bare `cover:` all mean "yes" — the last one
 * because a model that writes the key at all is asking for the feature, and
 * treating an empty value as `false` would silently ignore the request.
 */
function flag(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined;
  const s = v.trim().toLowerCase();
  if (s === '' || s === 'true' || s === 'yes' || s === 'on' || s === '1') return true;
  if (s === 'false' || s === 'no' || s === 'off' || s === '0' || s === 'none') return false;
  return undefined;
}

/**
 * Length caps per theme field. `accent`/`ink`/`font` end up in a stylesheet and
 * a `font-family`, and `subtitle`/`author` in a cover heading — none has any
 * business being long, and a cap keeps a runaway model from stuffing a
 * paragraph into a CSS declaration.
 */
const FIELD_MAX: Record<string, number> = {
  accent: 32,
  ink: 32,
  font: 48,
  subtitle: 200,
  author: 120,
};

function capped(key: string, raw: string): string {
  return raw.trim().slice(0, FIELD_MAX[key] ?? 120);
}

/** Pull the theme fields out of parsed header lines, or undefined if none. */
function themeFromFields(fields: Record<string, string>): ThemeSpec | undefined {
  const theme: ThemeSpec = {};
  let any = false;
  for (const key of THEME_KEYS) {
    const raw = fields[key];
    if (raw === undefined) continue;
    if (key === 'cover') {
      const on = flag(raw);
      if (on === undefined) continue;
      theme.cover = on;
    } else {
      const value = capped(key, raw);
      if (!value) continue;
      theme[key] = value;
    }
    any = true;
  }
  return any ? theme : undefined;
}

/** Validate a `theme` object arriving through the legacy JSON shape. */
function sanitizeTheme(v: unknown): ThemeSpec | undefined {
  if (!isRecord(v)) return undefined;
  const out: ThemeSpec = {};
  let any = false;
  for (const key of THEME_KEYS) {
    const raw = v[key];
    if (key === 'cover') {
      if (typeof raw === 'boolean') {
        out.cover = raw;
        any = true;
      } else if (typeof raw === 'string') {
        const on = flag(raw);
        if (on !== undefined) {
          out.cover = on;
          any = true;
        }
      }
    } else if (typeof raw === 'string' && raw.trim()) {
      out[key] = capped(key, raw);
      any = true;
    }
  }
  return any ? out : undefined;
}

/**
 * Locate ```artifact blocks.
 *
 * Not a single regex, because the interesting case is a document that itself
 * contains code fences. CommonMark says a bare ``` closes an outer 3-backtick
 * block, so `/```artifact\s*\n([\s\S]*?)```/` stopped at the first nested
 * closing fence and silently truncated the file (asking for a Markdown or PDF
 * doc that documents code is routine). The prompt tells the model to use a longer
 * outer fence, and the scanner additionally tracks nested fences so the common
 * 3-backtick mistake still parses.
 *
 * A thin wrapper over the shared scanner in ./fences — this logic used to live
 * here as a private copy, which is how `codepatch` ended up with a lazy regex and
 * none of the nesting handling.
 */
function findArtifactFences(text: string): { lines: string[]; matches: FenceMatch[] } {
  return findFences(text, 'artifact');
}

export interface DetectResult {
  /** Valid generation requests found in the text. */
  requests: GenerateRequest[];
  /** Text with recognized artifact blocks stripped. */
  cleaned: string;
  /** True if any directive (valid or not) was present. */
  found: boolean;
}

/**
 * Parse a plain-text CSV body (one row per line) into rows of strings.
 * Exported so the CSV executor can use it for the legacy `content` shape —
 * this module is browser-safe (no server imports).
 */
export function parseCsvBody(text: string): string[][] {
  const rows: string[][] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.trim() === '') continue;
    const row: string[] = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < rawLine.length; i++) {
      const ch = rawLine[i];
      if (inQuotes) {
        if (ch === '"') {
          if (rawLine[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else {
        field += ch;
      }
    }
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Whether this tool is usable through a text directive at all.
 *
 * Two exclusions:
 *  - `future` tools have no executor. Accepting one strips the block from the
 *    message and then 400s, so the user loses the content and gets an error.
 *  - READ tools (no `produces`, e.g. `fetch_url`) return text for the MODEL, and
 *    this path has no way to feed anything back into the generation — the result
 *    would be executed and then silently discarded. They are reachable only
 *    through native function calling, which does have a return channel.
 */
function emitsFile(tool: string): boolean {
  const meta = getTool(tool);
  return meta !== undefined && !meta.future && meta.produces !== undefined;
}

/** Parse the body of a single ```artifact fence into a GenerateRequest, or null if neither supported shape matches. */
function parseDirective(rawBody: string): GenerateRequest | null {
  const body = rawBody.trim();
  if (!body) return null;

  // Legacy shape: a bare JSON object. Only attempted when the block actually
  // looks like one, so a stray "{" inside a header-shaped block below still
  // falls through correctly.
  if (body.startsWith('{')) {
    try {
      const parsed = JSON.parse(body) as GenerateRequest;
      if (
        parsed &&
        typeof parsed.tool === 'string' &&
        isToolName(parsed.tool) &&
        emitsFile(parsed.tool)
      ) {
        // Re-validate the theme rather than passing the model's object through:
        // these values reach a stylesheet, so an unchecked string here would be
        // the one place raw model output lands in CSS.
        const theme = sanitizeTheme(parsed.theme);
        if (theme) parsed.theme = theme;
        else delete parsed.theme;
        return parsed;
      }
    } catch {
      /* not valid JSON — fall through and try the header+body shape */
    }
  }

  // Preferred shape: header lines, a line with only "---", then raw body.
  // Header lines are consumed from the top and the separator must be the first
  // line that isn't `key: value` (or blank). Taking the *first* "---" anywhere in
  // the body meant a document with a horizontal rule and a forgotten separator
  // had its real opening content silently parsed as headers and discarded.
  const lines = body.split('\n');
  const fields: Record<string, string> = {};
  let sepAt = -1;
  /** First line that couldn't be a header — where the body starts if `---` is absent. */
  let bodyAt = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') continue;
    if (/^[ \t]*---[ \t]*$/.test(line)) {
      sepAt = i;
      break;
    }
    // `[a-zA-Z_]` was too narrow: a `2024: notes` line, or any key with a digit
    // or dash, aborted header parsing and lost the whole directive.
    const m = line.match(/^\s*([a-zA-Z][\w-]*)\s*:\s*(.*)$/);
    if (!m) {
      bodyAt = i;
      break;
    }
    fields[m[1]!.toLowerCase()] = m[2]!.trim();
  }
  // A missing `---` is the most common malformation a small model produces, and
  // it used to mean total loss. If we parsed a `tool:` header and then hit real
  // content, treat that content as the body — the tool-name check below still
  // has to pass, so this can't invent a directive out of prose.
  if (sepAt === -1) {
    if (bodyAt === -1 || !fields.tool) return null;
    sepAt = bodyAt - 1;
  }

  const content = lines
    .slice(sepAt + 1)
    .join('\n')
    .trim();

  const tool = fields.tool;
  if (!tool || !isToolName(tool)) return null;
  if (!emitsFile(tool)) return null;

  const req: GenerateRequest = { tool };
  if (fields.name) req.name = fields.name;
  if (fields.title) req.title = fields.title;
  const theme = themeFromFields(fields);
  if (theme) req.theme = theme;

  if (tool === 'create_csv') {
    req.rows = parseCsvBody(content);
  } else if (tool === 'create_xlsx' || tool === 'create_pptx' || tool === 'zip_project') {
    // These *can* take structured JSON (sheets/slides/files) in the body.
    // If it's not JSON — or the shape is wrong — fall back to plain content.
    // Casting unvalidated JSON straight through meant a malformed array
    // (`rows` as an object, a file entry with no `path`) reached the executor
    // and surfaced as a 500 with a message like "rows.map is not a function".
    try {
      const parsedBody = JSON.parse(content) as unknown;
      if (tool === 'create_xlsx' && isSheetSpecArray(parsedBody)) req.sheets = parsedBody;
      else if (tool === 'create_pptx' && isSlideSpecArray(parsedBody)) req.slides = parsedBody;
      else if (tool === 'zip_project' && isFileSpecArray(parsedBody)) req.files = parsedBody;
      else req.content = content;
    } catch {
      req.content = content;
    }
  } else {
    req.content = content;
  }

  return req;
}

export function detectArtifacts(text: string): DetectResult {
  // `hasFenceTag` is the cheap pre-filter, and it is case-INSENSITIVE. The
  // literal `text.includes('```artifact')` that used to guard this rejected
  // `Artifact` outright, no matter how tolerant the scanner behind it became.
  if (!text || !hasFenceTag(text, 'artifact')) {
    return { requests: [], cleaned: text, found: false };
  }

  const requests: GenerateRequest[] = [];
  const { lines, matches } = findArtifactFences(text);
  if (matches.length === 0) {
    return { requests: [], cleaned: text, found: false };
  }

  // Rebuild the message, dropping the blocks we recognized and keeping the ones
  // we couldn't parse visible so nothing is silently lost.
  const out: string[] = [];
  let cursor = 0;
  for (const match of matches) {
    out.push(...lines.slice(cursor, match.from));
    const parsed = parseDirective(match.body);
    if (parsed) requests.push(parsed);
    else out.push(...lines.slice(match.from, match.to + 1));
    cursor = match.to + 1;
  }
  out.push(...lines.slice(cursor));

  return { requests, cleaned: out.join('\n').trim(), found: true };
}

/**
 * True when a (possibly still-streaming, or truncated) text contains a directive
 * the parser can act on. Used by the abort path, so a file the model finished
 * emitting before the user pressed Stop isn't thrown away.
 */
export function hasCompleteDirective(text: string): boolean {
  if (!hasFenceTag(text, 'artifact')) return false;
  return findArtifactFences(text).matches.length > 0;
}
