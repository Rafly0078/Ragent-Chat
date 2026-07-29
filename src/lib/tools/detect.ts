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

import type { GenerateRequest, SheetSpec, SlideSpec, FileSpec } from './types';
import { isToolName } from './registry';

const FENCE = /```artifact\s*\n([\s\S]*?)```/g;

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
      if (parsed && typeof parsed.tool === 'string' && isToolName(parsed.tool)) {
        return parsed;
      }
    } catch {
      /* not valid JSON — fall through and try the header+body shape */
    }
  }

  // Preferred shape: header lines, a line with only "---", then raw body.
  const sep = body.match(/\n[ \t]*---[ \t]*\n/);
  if (!sep || sep.index === undefined) return null;

  const header = body.slice(0, sep.index);
  const content = body.slice(sep.index + sep[0].length).trim();

  const fields: Record<string, string> = {};
  for (const line of header.split('\n')) {
    const m = line.match(/^\s*([a-zA-Z_]+)\s*:\s*(.*)$/);
    if (m) fields[m[1]!.toLowerCase()] = m[2]!.trim();
  }

  const tool = fields.tool;
  if (!tool || !isToolName(tool)) return null;

  const req: GenerateRequest = { tool };
  if (fields.name) req.name = fields.name;
  if (fields.title) req.title = fields.title;

  if (tool === 'create_csv') {
    req.rows = parseCsvBody(content);
  } else if (tool === 'create_xlsx' || tool === 'create_pptx' || tool === 'zip_project') {
    // These *can* take structured JSON (sheets/slides/files) in the body.
    // If it's not JSON, fall back to plain content — create_pptx derives
    // slides from Markdown headings/bullets, create_xlsx/zip_project fall
    // back to a single sheet / README respectively.
    try {
      const parsedBody = JSON.parse(content) as unknown;
      if (tool === 'create_xlsx' && Array.isArray(parsedBody)) req.sheets = parsedBody as SheetSpec[];
      else if (tool === 'create_pptx' && Array.isArray(parsedBody)) req.slides = parsedBody as SlideSpec[];
      else if (tool === 'zip_project' && Array.isArray(parsedBody)) req.files = parsedBody as FileSpec[];
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
  if (!text || !text.includes('```artifact')) {
    return { requests: [], cleaned: text, found: false };
  }

  const requests: GenerateRequest[] = [];
  let found = false;

  const cleaned = text.replace(FENCE, (whole, rawBody: string) => {
    found = true;
    const parsed = parseDirective(rawBody);
    if (parsed) {
      requests.push(parsed);
      return ''; // strip recognized directive from display
    }
    return whole; // malformed — keep visible so nothing is silently lost
  });

  return { requests, cleaned: cleaned.trim(), found };
}

/** True when a (possibly still-streaming) text contains a complete directive. */
export function hasCompleteDirective(text: string): boolean {
  FENCE.lastIndex = 0;
  return FENCE.test(text);
}
