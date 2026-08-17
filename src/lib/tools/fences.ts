/**
 * Line-based scanner for a keyword-tagged fenced block, tolerant of nested
 * fences inside the body.
 *
 * A single lazy regex — `/(`{3,})codepatch[ \t]*\n([\s\S]*?)\1/` — cannot do
 * this: the first ``` inside the body closes the match, so a patch whose
 * REPLACE section contains a markdown fence truncated mid-hunk, and a generated
 * document containing a code block lost everything after it. `detect.ts` grew a
 * depth-tracking scanner for `artifact`; `patch.ts` never got one. This is that
 * scanner, shared, so the two can't drift again.
 *
 * Matching is deliberately loose about the fence line: case-insensitive, and
 * anything may follow the keyword. Every strictness here converts a recoverable
 * response into a total loss, and the parse that follows still has to succeed.
 */

export interface FenceMatch {
  /** The block's contents, exclusive of the fence lines. */
  body: string;
  /** Line index of the opening fence. */
  from: number;
  /** Line index of the closing fence, or the last line when unterminated. */
  to: number;
  /** True when no closing fence was found and the rest of the text was taken. */
  unterminated: boolean;
}

const FENCE_LINE_RE = /^[ \t]*(`{3,})[ \t]*(\S.*)?$/;

/** Cheap pre-filter: is this keyword plausibly present as a fence tag at all? */
export function hasFenceTag(text: string, keyword: string): boolean {
  return new RegExp('```[ \\t]*' + keyword + '\\b', 'i').test(text);
}

export function findFences(
  text: string,
  keyword: string,
): { lines: string[]; matches: FenceMatch[] } {
  const openRe = new RegExp('^[ \\t]*(`{3,})[ \\t]*' + keyword + '\\b.*$', 'i');
  // `\r?\n`, because both fence patterns end at `$` and `.` excludes `\r`: a CRLF
  // response passed `hasFenceTag` (unanchored) and then matched zero fences, so the
  // directive never ran and the renderer replaced its whole body with a "file
  // wasn't created" notice. Callers rejoin with `\n`, so this normalizes.
  const lines = text.split(/\r?\n/);
  const matches: FenceMatch[] = [];

  for (let i = 0; i < lines.length; i++) {
    const open = openRe.exec(lines[i]!);
    if (!open) continue;
    const openTicks = open[1]!.length;

    // A fence line WITH an info string opens a nested block; a bare fence line
    // closes the innermost open block, or — at depth 0 and long enough — this one.
    let depth = 0;
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const f = FENCE_LINE_RE.exec(lines[j]!);
      if (!f) continue;
      if (f[2]) depth++;
      else if (depth > 0) depth--;
      else if (f[1]!.length >= openTicks) {
        close = j;
        break;
      }
    }

    if (close === -1) {
      // Unterminated. Usually a fence opened inside the body and never closed,
      // which left `depth` above zero forever — and used to discard the entire
      // block. Hand back the rest of the text and let the caller's parse decide.
      if (i + 1 >= lines.length) continue;
      matches.push({
        body: lines.slice(i + 1).join('\n'),
        from: i,
        to: lines.length - 1,
        unterminated: true,
      });
      break;
    }

    matches.push({
      body: lines.slice(i + 1, close).join('\n'),
      from: i,
      to: close,
      unterminated: false,
    });
    i = close;
  }

  return { lines, matches };
}

/**
 * Rebuild `text` with each matched block replaced by whatever `render` returns
 * for it (null keeps the block verbatim — used when a body fails to parse, so
 * nothing is silently lost).
 */
export function replaceFences(
  text: string,
  keyword: string,
  render: (match: FenceMatch) => string | null,
): { out: string; found: boolean } {
  const { lines, matches } = findFences(text, keyword);
  if (matches.length === 0) return { out: text, found: false };

  const out: string[] = [];
  let cursor = 0;
  for (const match of matches) {
    out.push(...lines.slice(cursor, match.from));
    const replacement = render(match);
    if (replacement === null) out.push(...lines.slice(match.from, match.to + 1));
    else if (replacement !== '') out.push(replacement);
    cursor = match.to + 1;
  }
  out.push(...lines.slice(cursor));
  return { out: out.join('\n'), found: true };
}
