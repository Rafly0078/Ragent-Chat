/**
 * Targeted code-patch detection & application.
 *
 * Instead of regenerating a whole file when the user reports a bug, the model
 * emits one or more SEARCH/REPLACE hunks inside a ```codepatch fence. This is
 * the same content-anchored approach used by Aider/Cline — anchoring on the
 * actual code text (not line numbers) is far more robust for local/quantized
 * models, which reliably miscount lines.
 *
 * Wire shape the model is taught to emit (see ./patch-prompt.ts):
 *
 *   ```codepatch
 *   lang: html
 *   <<<<<<< SEARCH
 *   <old code exactly as it appears>
 *   =======
 *   <new code to replace it with>
 *   >>>>>>> REPLACE
 *   ```
 *
 * Multiple SEARCH/REPLACE pairs may appear in a single fence. An optional
 * `lang:` header line hints which language the patch targets (used to pick the
 * right prior code block and to label the rendered diff).
 *
 * This module is pure and browser-safe — no server-only imports.
 */

const FENCE = /(`{3,})codepatch[ \t]*\n([\s\S]*?)\1/g;

/** Fence long enough to hold `body` — a patched file containing ``` used to close it early. */
function fenceFor(body: string): string {
  const longest = [...body.matchAll(/`+/g)].reduce((max, m) => Math.max(max, m[0].length), 2);
  return '`'.repeat(longest + 1);
}

/** A single search→replace hunk. */
export interface PatchHunk {
  search: string;
  replace: string;
}

/** A parsed codepatch directive: its hunks plus an optional language hint. */
export interface PatchDirective {
  lang?: string;
  hunks: PatchHunk[];
}

export interface DetectPatchResult {
  patches: PatchDirective[];
  /** Text with recognized codepatch blocks stripped. */
  cleaned: string;
  /** True if any codepatch fence (valid or not) was present. */
  found: boolean;
}

const HUNK = /<<<<<<<\s*SEARCH\s*\n([\s\S]*?)\n?=======\s*\n([\s\S]*?)\n?>>>>>>>\s*REPLACE/g;

/** Parse the body of one ```codepatch fence into a directive, or null if it has no valid hunk. */
function parseDirective(rawBody: string): PatchDirective | null {
  const body = rawBody.replace(/^\s*\n/, '');

  // Optional leading `lang:` header line, consumed before hunk scanning so a
  // `lang:` inside replacement code (unlikely, but possible) isn't stolen.
  let lang: string | undefined;
  let scanFrom = body;
  const header = body.match(/^[ \t]*lang[ \t]*:[ \t]*([^\n]*)\n/i);
  if (header) {
    lang = header[1]!.trim() || undefined;
    scanFrom = body.slice(header[0].length);
  }

  const hunks: PatchHunk[] = [];
  HUNK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HUNK.exec(scanFrom)) !== null) {
    hunks.push({ search: m[1] ?? '', replace: m[2] ?? '' });
  }

  if (hunks.length === 0) return null;
  return { lang, hunks };
}

export function detectPatches(text: string): DetectPatchResult {
  if (!text || !text.includes('```codepatch')) {
    return { patches: [], cleaned: text, found: false };
  }

  const patches: PatchDirective[] = [];
  let found = false;

  const cleaned = text.replace(FENCE, (whole, _fence: string, rawBody: string) => {
    found = true;
    const parsed = parseDirective(rawBody);
    if (parsed) {
      patches.push(parsed);
      return ''; // strip recognized directive; the UI renders a PatchBlock instead
    }
    return whole; // malformed — leave visible so nothing is silently lost
  });

  return { patches, cleaned: cleaned.trim(), found };
}

/** True when a (possibly still-streaming) text contains a complete codepatch fence. */
export function hasCompletePatch(text: string): boolean {
  FENCE.lastIndex = 0;
  return FENCE.test(text);
}

/**
 * Marker separating the SEARCH/REPLACE hunks from the fully-patched source in
 * an *enriched* codepatch fence. After a patch is applied client-side (which
 * needs conversation context the renderer doesn't have), processPatches writes
 * the resulting full code back into the fence body below this marker, so the
 * PatchBlock can offer a "copy corrected code" affordance and the whole thing
 * survives a reload (message content is persisted; metadata is not).
 */
export const RESULT_MARKER = '@@@ PATCHED_RESULT @@@';

export interface ParsedPatchBlock {
  lang?: string;
  hunks: PatchHunk[];
  /** Full corrected source, present once a patch has been applied. */
  result?: string;
  /** True when the fence carried hunks but no located source (couldn't apply). */
  unresolved: boolean;
}

/**
 * Parse an (optionally enriched) codepatch fence body for rendering. Splits off
 * the RESULT section first, then reuses the directive parser for lang + hunks.
 */
export function parsePatchBlock(rawBody: string): ParsedPatchBlock | null {
  const markerIdx = rawBody.indexOf(RESULT_MARKER);
  let result: string | undefined;
  let head = rawBody;
  if (markerIdx !== -1) {
    head = rawBody.slice(0, markerIdx);
    result = rawBody.slice(markerIdx + RESULT_MARKER.length).replace(/^\n/, '').replace(/\n$/, '');
  }
  const directive = parseDirective(head);
  if (!directive) return null;
  return { lang: directive.lang, hunks: directive.hunks, result, unresolved: result === undefined };
}

/** Build an enriched codepatch fence body carrying hunks + the patched result. */
export function buildEnrichedBody(directive: PatchDirective, result: string): string {
  const lines: string[] = [];
  if (directive.lang) lines.push(`lang: ${directive.lang}`);
  for (const h of directive.hunks) {
    lines.push('<<<<<<< SEARCH', h.search, '=======', h.replace, '>>>>>>> REPLACE');
  }
  lines.push(RESULT_MARKER, result);
  return lines.join('\n');
}

export interface CodeBlock {
  lang?: string;
  code: string;
}

// Fenced code blocks. Longer opening fences are matched with a backreference so a
// block containing ``` inside it round-trips.
const CODE_FENCE = /(`{3,})([a-zA-Z0-9+#._-]*)[ \t]*\n([\s\S]*?)\1/g;

/**
 * Extract fenced code blocks from a markdown message.
 *
 * `artifact` fences are always skipped (a directive is not a source file). A
 * `codepatch` fence contributes its *patched result* when it has one: after
 * `enrichPatches` runs, the corrected code exists only inside that fence, so
 * skipping it entirely meant a follow-up patch anchored on code that no longer
 * existed (every subsequent patch reported "couldn't auto-apply") and the
 * sandbox preview kept rendering the pre-patch version.
 */
export function extractCodeBlocks(text: string): CodeBlock[] {
  if (!text) return [];
  const blocks: CodeBlock[] = [];
  CODE_FENCE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CODE_FENCE.exec(text)) !== null) {
    const lang = (m[2] ?? '').toLowerCase();
    const body = (m[3] ?? '').replace(/\n$/, '');
    if (lang === 'artifact') continue;
    if (lang === 'codepatch') {
      const parsed = parsePatchBlock(m[3] ?? '');
      if (parsed?.result) blocks.push({ lang: parsed.lang, code: parsed.result });
      continue;
    }
    blocks.push({ lang: lang || undefined, code: body });
  }
  return blocks;
}

/**
 * Locate the code block a set of hunks applies to, searching newest-first
 * across candidate source texts (e.g. earlier assistant messages). Returns the
 * chosen block's code and the apply result, or null if no candidate matches.
 * A candidate qualifies only if at least one hunk's SEARCH text is found in it.
 */
export function locateAndApply(candidates: string[], hunks: PatchHunk[]): (ApplyResult & { source: string }) | null {
  for (const source of candidates) {
    const res = applyPatch(source, hunks);
    if (res.applied.length > 0) return { ...res, source };
  }
  return null;
}

export interface EnrichResult {
  /** Message content with each codepatch fence rewritten to enriched form. */
  content: string;
  /** True if at least one codepatch fence was present. */
  found: boolean;
  /** True if at least one fence was successfully applied against a candidate. */
  applied: boolean;
}

/**
 * Rewrite every ```codepatch fence in `content` into an *enriched* fence that
 * embeds the fully-patched source, by locating the target among `priorCode`
 * blocks (raw code strings, ordered newest-first). Fences whose SEARCH text
 * can't be found anywhere are left as plain hunk fences — the PatchBlock then
 * shows the intended change with an "couldn't auto-apply" note. Leaves the
 * fence in place either way so the renderer can show the diff.
 */
export function enrichPatches(content: string, priorCode: string[]): EnrichResult {
  if (!content || !content.includes('```codepatch')) {
    return { content, found: false, applied: false };
  }
  let found = false;
  let applied = false;

  const next = content.replace(FENCE, (whole, _fence: string, rawBody: string) => {
    const directive = parseDirective(rawBody);
    if (!directive) return whole; // malformed — leave as-is
    found = true;
    // Skip fences already enriched (idempotent — guards double runs).
    if (rawBody.includes(RESULT_MARKER)) {
      applied = true;
      return whole;
    }
    const located = locateAndApply(priorCode, directive.hunks);
    if (!located) return whole; // couldn't find source; keep bare hunks
    applied = true;
    const body = buildEnrichedBody(directive, located.result);
    const fence = fenceFor(body);
    return `${fence}codepatch\n${body}\n${fence}`;
  });

  return { content: next, found, applied };
}

/** Collapse runs of whitespace and trim each line — used for fuzzy matching. */
function normalize(s: string): string {
  return s
    .split('\n')
    .map((l) => l.trim().replace(/\s+/g, ' '))
    .join('\n')
    .trim();
}

export interface ApplyResult {
  /** The full source with every applicable hunk applied. */
  result: string;
  /** Hunks that were located and applied. */
  applied: PatchHunk[];
  /** Hunks whose SEARCH text could not be found in the source. */
  failed: PatchHunk[];
}

/**
 * Apply a directive's hunks to `source`. Tries an exact substring match first,
 * then falls back to a whitespace-normalized line match so trivial indentation
 * differences don't defeat an otherwise-correct hunk. Returns the patched
 * source plus which hunks applied vs. failed to locate.
 */
export function applyPatch(source: string, hunks: PatchHunk[]): ApplyResult {
  let result = source;
  const applied: PatchHunk[] = [];
  const failed: PatchHunk[] = [];

  for (const hunk of hunks) {
    if (!hunk.search) {
      failed.push(hunk);
      continue;
    }

    // 1. Exact substring match — but only when it is UNIQUE. A non-unique SEARCH
    //    ("}", "</div>", a repeated useState line) silently rewrote the first
    //    occurrence even when the model meant a later one, and the rendered diff
    //    is derived from the hunk rather than the source, so it looked correct
    //    while the emitted code was wrong. Ambiguity is a failure: the UI then
    //    tells the user to apply it manually.
    const exactIdx = result.indexOf(hunk.search);
    if (exactIdx !== -1) {
      if (result.indexOf(hunk.search, exactIdx + 1) !== -1) {
        failed.push(hunk);
        continue;
      }
      result = result.slice(0, exactIdx) + hunk.replace + result.slice(exactIdx + hunk.search.length);
      applied.push(hunk);
      continue;
    }

    // 2. Whitespace-tolerant match over consecutive lines. Slide a window the
    //    size of the SEARCH block across the source and compare normalized.
    //    Same uniqueness rule applies.
    const srcLines = result.split('\n');
    const searchLines = hunk.search.split('\n');
    const wantNorm = normalize(hunk.search);
    let matchedAt = -1;
    let matchCount = 0;
    for (let i = 0; i + searchLines.length <= srcLines.length; i++) {
      const window = srcLines.slice(i, i + searchLines.length).join('\n');
      if (normalize(window) === wantNorm) {
        matchCount++;
        if (matchCount > 1) break;
        matchedAt = i;
      }
    }
    if (matchedAt !== -1 && matchCount === 1) {
      const before = srcLines.slice(0, matchedAt).join('\n');
      const after = srcLines.slice(matchedAt + searchLines.length).join('\n');
      const joinBefore = before ? before + '\n' : '';
      const joinAfter = after ? '\n' + after : '';
      result = joinBefore + hunk.replace + joinAfter;
      applied.push(hunk);
      continue;
    }

    failed.push(hunk);
  }

  return { result, applied, failed };
}

export type DiffLineKind = 'add' | 'remove' | 'context';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

/**
 * Minimal line-level diff (LCS-based) for rendering a hunk as red/green rows.
 * Not a full Myers diff — sufficient for the small hunks a code patch touches.
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const mm = b.length;

  // LCS length table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(mm + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = mm - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < mm) {
    if (a[i] === b[j]) {
      out.push({ kind: 'context', text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: 'remove', text: a[i]! });
      i++;
    } else {
      out.push({ kind: 'add', text: b[j]! });
      j++;
    }
  }
  while (i < n) out.push({ kind: 'remove', text: a[i++]! });
  while (j < mm) out.push({ kind: 'add', text: b[j++]! });
  return out;
}
