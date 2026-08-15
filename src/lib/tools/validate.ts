/**
 * Shape validation for a GenerateRequest crossing the HTTP boundary.
 *
 * The route used to check only that `body.tool` was truthy and mapped to an
 * executor; every other field went straight into the executor untouched. That is
 * reachable from any client, and the executors trust their inputs:
 * `{"tool":"create_csv","rows":"oops"}` passes a `rows.length` truthiness check
 * (strings have `.length`), then `rows.map` throws and the request 500s. Same for
 * a non-string `content` into `zip_project`.
 *
 * Deliberately coercive rather than rejecting: this is also the shape a MODEL
 * produces, so where a wrong-but-recoverable type arrives (a single row instead
 * of a row array, a number where a string belongs) it is repaired. Only
 * genuinely unusable input is rejected, with a message the model can act on when
 * this is fed back to it.
 *
 * Kept separate from `detect.ts`'s parsing so a request arriving over HTTP —
 * from the document dialog, a retry, or eventually a native tool call — gets the
 * same treatment as one scraped out of a message.
 */

import type { FileSpec, GenerateRequest, SheetSpec, SlideSpec, ToolName } from '@/lib/tools/types';
import { isToolName, getTool } from '@/lib/tools/registry';

/** Longest single string field we'll accept, before the executor sees it. */
const MAX_TEXT = 2_000_000;
const MAX_ROWS = 50_000;
const MAX_COLS = 1_000;
const MAX_SHEETS = 50;
const MAX_SLIDES = 200;
const MAX_FILES = 500;

const str = (v: unknown): string | undefined => {
  if (typeof v === 'string') return v.slice(0, MAX_TEXT);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
};

/** One row of cells. Anything non-array becomes a single-cell row. */
const toRow = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [v]).slice(0, MAX_COLS).map((c) => str(c) ?? '');

const toRows = (v: unknown): string[][] | undefined => {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  return v.slice(0, MAX_ROWS).map(toRow);
};

function toSheets(v: unknown): SheetSpec[] | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  const out: SheetSpec[] = [];
  for (const [i, raw] of v.slice(0, MAX_SHEETS).entries()) {
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as Record<string, unknown>;
    const rows = toRows(s.rows);
    if (!rows) continue;
    // `name` is required on SheetSpec, so an unnamed sheet gets Excel's own
    // default rather than being dropped.
    out.push({ name: str(s.name)?.trim() || `Sheet${i + 1}`, rows });
  }
  return out.length > 0 ? out : undefined;
}

function toSlides(v: unknown): SlideSpec[] | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  const out: SlideSpec[] = [];
  for (const raw of v.slice(0, MAX_SLIDES)) {
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as Record<string, unknown>;
    const bullets = Array.isArray(s.bullets)
      ? s.bullets.map((b) => str(b) ?? '').filter(Boolean)
      : undefined;
    const slide: SlideSpec = {
      ...(str(s.title) ? { title: str(s.title)! } : {}),
      ...(str(s.body) ? { body: str(s.body)! } : {}),
      ...(bullets?.length ? { bullets } : {}),
    };
    if (slide.title || slide.body || slide.bullets) out.push(slide);
  }
  return out.length > 0 ? out : undefined;
}

function toFiles(v: unknown): FileSpec[] | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  const out: FileSpec[] = [];
  for (const raw of v.slice(0, MAX_FILES)) {
    if (!raw || typeof raw !== 'object') continue;
    const f = raw as Record<string, unknown>;
    const path = str(f.path)?.trim();
    if (!path) continue;
    out.push({ path, content: str(f.content) ?? '' });
  }
  return out.length > 0 ? out : undefined;
}

export type ValidationResult =
  { ok: true; request: GenerateRequest } | { ok: false; error: string };

/** Which tools can work from nothing but a `title`. */
const NEEDS_PAYLOAD = new Set<ToolName>([
  'create_pdf',
  'create_docx',
  'create_md',
  'create_html',
  'create_txt',
  'create_json',
  'create_xml',
]);

export function validateGenerateRequest(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Body must be a JSON object.' };
  }
  const b = raw as Record<string, unknown>;

  const tool = typeof b.tool === 'string' ? b.tool : '';
  if (!tool) return { ok: false, error: 'Missing "tool" field.' };
  if (!isToolName(tool)) return { ok: false, error: `Unknown tool: ${tool}` };
  const meta = getTool(tool);
  if (meta?.future) {
    return { ok: false, error: `"${tool}" isn't available yet.` };
  }

  const request: GenerateRequest = { tool };
  const content = str(b.content);
  if (content !== undefined) request.content = content;
  if (str(b.name)) request.name = str(b.name);
  if (str(b.title)) request.title = str(b.title);
  if (str(b.url)) request.url = str(b.url);
  if (typeof b.maxChars === 'number' && Number.isFinite(b.maxChars)) {
    request.maxChars = Math.max(1, Math.floor(b.maxChars));
  }
  if (str(b.conversationId)) request.conversationId = str(b.conversationId);
  if (str(b.messageId)) request.messageId = str(b.messageId);
  if (b.data !== undefined) request.data = b.data;
  if (b.theme && typeof b.theme === 'object' && !Array.isArray(b.theme)) {
    request.theme = b.theme as GenerateRequest['theme'];
  }

  const rows = toRows(b.rows);
  if (rows) request.rows = rows;
  const sheets = toSheets(b.sheets);
  if (sheets) request.sheets = sheets;
  const slides = toSlides(b.slides);
  if (slides) request.slides = slides;
  const files = toFiles(b.files);
  if (files) request.files = files;

  // Per-tool minimum payload. Without this the executors threw their own,
  // less useful errors — or produced an empty document.
  switch (tool) {
    case 'create_csv':
      if (!rows && !content) {
        return { ok: false, error: 'create_csv needs "rows" (an array of arrays) or "content".' };
      }
      break;
    case 'create_xlsx':
      if (!sheets && !rows && !content) {
        return { ok: false, error: 'create_xlsx needs "sheets", "rows", or "content".' };
      }
      break;
    case 'create_pptx':
      if (!slides && !content) {
        return { ok: false, error: 'create_pptx needs "slides" or "content".' };
      }
      break;
    case 'zip_project':
      if (!files && !content) {
        return { ok: false, error: 'zip_project needs "files" (path + content) or "content".' };
      }
      break;
    case 'fetch_url':
      if (!request.url) {
        return { ok: false, error: 'fetch_url needs an absolute http(s) "url".' };
      }
      break;
    case 'run_js':
      if (!content?.trim()) {
        return { ok: false, error: 'run_js needs JavaScript in "content".' };
      }
      break;
    default:
      if (NEEDS_PAYLOAD.has(tool) && !content && b.data === undefined && !request.title) {
        return { ok: false, error: `${tool} needs "content".` };
      }
  }

  return { ok: true, request };
}
