import 'server-only';

/**
 * Minimal Markdown block parser for document generation. Not a full CommonMark
 * implementation — it covers the structures the generators render: headings,
 * paragraphs, bullet/numbered lists, blockquotes, fenced code, horizontal
 * rules, and tables.
 *
 * Blocks store the RAW inline text (emphasis markers intact). Consumers pick
 * how to render it: rich targets (DOCX, HTML, PDF) call `parseInline` to get
 * styled spans; plain targets (TXT) call `stripInline` to flatten it. Keeping
 * the markers in the block instead of pre-stripping them is what lets bold,
 * italic, inline code and links survive into the generated file.
 */

/**
 * Severity/tone of a callout box. The renderers map these to a colour and an
 * icon; anything the model invents outside this set is normalized to 'note'.
 */
export type CalloutVariant = 'note' | 'info' | 'tip' | 'success' | 'warning' | 'danger';

export type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'code'; lang?: string; text: string }
  | { type: 'hr' }
  | { type: 'pagebreak' }
  | { type: 'callout'; variant: CalloutVariant; title?: string; blocks: Block[] }
  | {
      type: 'table';
      header: string[];
      rows: string[][];
      align?: Array<'left' | 'center' | 'right'>;
    };

/** A run of inline text carrying its accumulated formatting. */
export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  /** Marker-pen background (`==text==`). */
  highlight?: boolean;
  /** Destination URL when the run is (part of) a link. */
  href?: string;
}

/**
 * Strip common inline Markdown so plain renderers show clean text.
 * Link destinations are appended in parentheses — dropping `href` meant the TXT
 * export lost every hyperlink target, since it uses this for paragraphs, list
 * items, quotes, headings and table cells alike.
 */
export function stripInline(s: string): string {
  return parseInline(s)
    .map((sp) => (sp.href && sp.href !== sp.text ? `${sp.text} (${sp.href})` : sp.text))
    .join('')
    .trim();
}

type Style = Omit<Span, 'text'>;

interface Token {
  index: number;
  length: number;
  kind: 'code' | 'link' | 'image' | 'bold' | 'italic' | 'strike' | 'highlight';
  inner: string;
  href?: string;
}

// Ordered by precedence: code and links bind tightest (their contents are not
// re-parsed for emphasis the way bold/italic are), then bold before italic so
// `**x**` isn't mis-read as italic `*` + `*x*`.
const INLINE_PATTERNS: Array<{ kind: Token['kind']; re: RegExp; underscore?: boolean }> = [
  { kind: 'code', re: /`([^`]+)`/ },
  // Images before links: the link pattern matches `![alt](url)` from index 1, so
  // without this the `!` was emitted as stray text and the image vanished.
  { kind: 'image', re: /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/ },
  { kind: 'link', re: /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/ },
  { kind: 'bold', re: /\*\*(\S(?:.*?\S)?)\*\*/ },
  { kind: 'bold', re: /__(\S(?:.*?\S)?)__/, underscore: true },
  { kind: 'strike', re: /~~(\S(?:.*?\S)?)~~/ },
  // The `(?!=)` keeps a run of three-or-more `=` (a setext-style rule someone
  // typed by hand) from being read as a highlight around a lone `=`.
  { kind: 'highlight', re: /==(?!=)(\S(?:.*?\S)?)==/ },
  { kind: 'italic', re: /\*(\S(?:.*?\S)?)\*/ },
  { kind: 'italic', re: /_(\S(?:.*?\S)?)_/, underscore: true },
];

const WORD = /[A-Za-z0-9]/;

/**
 * `g`-flagged twins of the patterns above, so a scan can resume from a cursor
 * instead of re-slicing the string. Built once; `lastIndex` is set explicitly
 * before every exec, so sharing them across recursive walks is safe.
 */
const INLINE_SCANNERS = INLINE_PATTERNS.map(({ re }) => new RegExp(re.source, 'g'));

interface Hit {
  index: number;
  length: number;
  one: string;
  two?: string;
}

/** `undefined` = this pattern has not been scanned yet; `null` = it matches nowhere. */
type HitCache = Array<Hit | null | undefined>;

function scanFrom(pattern: number, s: string, from: number): Hit | null {
  const re = INLINE_SCANNERS[pattern]!;
  re.lastIndex = from;
  const m = re.exec(s);
  if (!m) return null;
  return { index: m.index, length: m[0].length, one: m[1] ?? '', two: m[2] };
}

/**
 * Find the earliest inline construct at or after `from`, or null if the rest is
 * plain text.
 *
 * `cache` is what keeps this linear. It used to take the remaining string and
 * re-exec all nine patterns over the whole of it for every single token, so a
 * pattern that matched nowhere (`~~`, `==`, `__` in ordinary prose) was scanned
 * to the end once per token: 24 KB of one paragraph cost 0.1s, 96 KB cost 1.5s,
 * 192 KB cost 10s — and `validate.ts` accepts a 2 MB text field, all of which
 * `parseBlocks` will join into a single paragraph. That was minutes of
 * unbreakable synchronous CPU inside the tool route. Now a pattern is only
 * re-scanned once the cursor passes its cached hit, and "matches nowhere" is
 * remembered for good.
 */
function nextToken(s: string, from: number, cache: HitCache): Token | null {
  let best: Token | null = null;
  for (let p = 0; p < INLINE_PATTERNS.length; p++) {
    const { kind, underscore } = INLINE_PATTERNS[p]!;
    let hit = cache[p];
    if (hit === undefined || (hit !== null && hit.index < from)) {
      hit = scanFrom(p, s, from);
      cache[p] = hit;
    }
    if (!hit) continue;
    // Underscore emphasis inside a word (file_name, __dunder__ identifiers)
    // is almost always not emphasis — require a non-word boundary on both
    // outer sides before honoring it.
    if (underscore) {
      const before = hit.index > from ? s[hit.index - 1] : undefined;
      const after = s[hit.index + hit.length];
      if ((before && WORD.test(before)) || (after && WORD.test(after))) continue;
    }
    if (best === null || hit.index < best.index) {
      best = {
        index: hit.index,
        length: hit.length,
        kind,
        // For a link/image with empty text, fall back to the destination —
        // `[](url)` used to emit nothing at all, losing both label and URL.
        inner: kind === 'link' || kind === 'image' ? hit.one || hit.two || '' : hit.one,
        href: kind === 'link' || kind === 'image' ? hit.two : undefined,
      };
      if (hit.index === from) break; // can't beat the cursor
    }
  }
  return best;
}

function emit(out: Span[], text: string, style: Style): void {
  if (!text) return;
  const last = out[out.length - 1];
  // Coalesce adjacent runs with identical styling to keep run counts low.
  if (
    last &&
    !!last.bold === !!style.bold &&
    !!last.italic === !!style.italic &&
    !!last.code === !!style.code &&
    !!last.strike === !!style.strike &&
    !!last.highlight === !!style.highlight &&
    last.href === style.href
  ) {
    last.text += text;
    return;
  }
  out.push({ text, ...style });
}

function walk(input: string, style: Style, out: Span[]): void {
  const cache: HitCache = new Array(INLINE_PATTERNS.length);
  let cursor = 0;
  while (cursor < input.length) {
    const tok = nextToken(input, cursor, cache);
    if (!tok) {
      emit(out, input.slice(cursor), style);
      return;
    }
    if (tok.index > cursor) emit(out, input.slice(cursor, tok.index), style);
    switch (tok.kind) {
      case 'code':
        // Code spans are literal — no further inline parsing inside them.
        emit(out, tok.inner, { ...style, code: true });
        break;
      case 'link':
        walk(tok.inner, { ...style, href: tok.href }, out);
        break;
      case 'image':
        // The generators have no image support, so render the alt text as a link
        // to the source rather than dropping the whole construct.
        emit(out, tok.inner, { ...style, href: tok.href });
        break;
      case 'bold':
        walk(tok.inner, { ...style, bold: true }, out);
        break;
      case 'italic':
        walk(tok.inner, { ...style, italic: true }, out);
        break;
      case 'strike':
        walk(tok.inner, { ...style, strike: true }, out);
        break;
      case 'highlight':
        walk(tok.inner, { ...style, highlight: true }, out);
        break;
    }
    cursor = tok.index + tok.length;
  }
}

/** Parse a line of inline Markdown into styled runs. */
export function parseInline(input: string): Span[] {
  const out: Span[] = [];
  walk(input ?? '', {}, out);
  return out;
}

function splitTableRow(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

/** Read a `|:---|:--:|---:|` separator row into per-column alignment. */
function parseAlignRow(line: string): Array<'left' | 'center' | 'right'> {
  return splitTableRow(line).map((c) => {
    const left = c.startsWith(':');
    const right = c.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });
}

const CALLOUT_ALIASES: Record<string, CalloutVariant> = {
  note: 'note',
  callout: 'note',
  info: 'info',
  information: 'info',
  abstract: 'info',
  summary: 'info',
  tip: 'tip',
  hint: 'tip',
  idea: 'tip',
  important: 'tip',
  success: 'success',
  check: 'success',
  done: 'success',
  ok: 'success',
  warning: 'warning',
  warn: 'warning',
  caution: 'warning',
  attention: 'warning',
  danger: 'danger',
  error: 'danger',
  critical: 'danger',
  bug: 'danger',
  fail: 'danger',
};

/** Alias lookup that ignores inherited keys — `:::constructor` is a title, not a variant. */
function calloutVariant(word: string): CalloutVariant | undefined {
  return Object.hasOwn(CALLOUT_ALIASES, word) ? CALLOUT_ALIASES[word] : undefined;
}

/**
 * Read a `:::warning Optional title` opener.
 *
 * Both `:::warning` and `:::callout warning` are accepted, because models
 * produce each about equally often, and an unknown word is kept as the *title*
 * rather than dropped — `:::budget Q3 numbers` renders as a plain note titled
 * "budget Q3 numbers" instead of silently losing the label.
 */
function parseCalloutOpen(line: string): { variant: CalloutVariant; title?: string } | null {
  const m = line.match(/^\s*:{3,}\s*(.*)$/);
  if (!m) return null;
  const words = m[1]!.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null; // a bare ":::" is the closer, not an opener
  let variant: CalloutVariant = 'note';
  let rest = words;
  const first = words[0]!.toLowerCase();
  if (first === 'callout' && words.length > 1) {
    const second = calloutVariant(words[1]!.toLowerCase());
    if (second) {
      variant = second;
      rest = words.slice(2);
    } else {
      rest = words.slice(1);
    }
  } else {
    const known = calloutVariant(first);
    if (known) {
      variant = known;
      rest = words.slice(1);
    }
  }
  const title = rest.join(' ').trim();
  return { variant, title: title || undefined };
}

const CLOSE_RE = /^\s*:{3,}\s*$/;
const PAGEBREAK_RE = /^\s*(?:<!--\s*pagebreak\s*-->|\\pagebreak|\[pagebreak\])\s*$/i;

export function parseMarkdown(md: string): Block[] {
  return parseBlocks((md ?? '').replace(/\r\n/g, '\n').split('\n'));
}

/**
 * Deepest callout nesting we will build. Any real document is 1 or 2 deep.
 *
 * The cap is a cost ceiling, not a style rule: an *unterminated* `:::x` opener
 * swallows every remaining line and then re-parses it, so N consecutive opener
 * lines nested N deep and re-scanned the buffer below them at every level.
 * 2.5 KB of that cost 0.1s, 20 KB cost 4s, and 40 KB cost 20s before dying with
 * a stack overflow — all of it synchronous, inside the tool route, on input a
 * model can produce by accident.
 */
const MAX_CALLOUT_DEPTH = 6;

function parseBlocks(lines: string[], depth = 0): Block[] {
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    let line = lines[i] ?? '';

    // Blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code.
    //
    // The info string is whatever the model felt like writing — `c#`, `c++`,
    // `objective-c`, `js copy` — so it is captured loosely. This used to be
    // `/^```(\w+)?\s*$/`, which does not match ```` ```c# ````: the line then fell
    // through to every branch below, and the paragraph branch breaks on /^```/
    // *without consuming the line*, so `parseBlocks` spun forever. Any document
    // that merely contained C# was enough to pin a CPU until the platform
    // killed the request. The marker length is tracked so a nested ``` inside a
    // ```` fence no longer closes it early.
    const fence = line.match(/^(`{3,})[ \t]*([^`\s]*)[^`]*$/);
    if (fence) {
      const marker = fence[1]!;
      const lang = fence[2] || undefined;
      const closes = new RegExp(`^\\s*\`{${marker.length},}\\s*$`);
      const buf: string[] = [];
      i++;
      while (i < lines.length && !closes.test(lines[i] ?? '')) {
        buf.push(lines[i] ?? '');
        i++;
      }
      i++; // closing fence
      blocks.push({ type: 'code', lang, text: buf.join('\n') });
      continue;
    }

    // Explicit page break
    if (PAGEBREAK_RE.test(line)) {
      blocks.push({ type: 'pagebreak' });
      i++;
      continue;
    }

    // Callout — ":::warning Title" … ":::". Nesting is tracked so a callout
    // containing another callout closes at the right line.
    const open = parseCalloutOpen(line);
    if (open) {
      // Past the cap the opener is kept as text. It has to be consumed HERE:
      // falling through to the paragraph branch would hit its /^\s*:{3,}/ break
      // with an empty buffer and hang the outer loop.
      if (depth >= MAX_CALLOUT_DEPTH) {
        blocks.push({ type: 'paragraph', text: line.trim() });
        i++;
        continue;
      }
      const buf: string[] = [];
      let nested = 0;
      i++;
      let closed = false;
      while (i < lines.length) {
        const l = lines[i] ?? '';
        if (CLOSE_RE.test(l)) {
          if (nested === 0) {
            i++;
            closed = true;
            break;
          }
          nested--;
        } else if (parseCalloutOpen(l)) {
          nested++;
        }
        buf.push(l);
        i++;
      }
      // An unterminated callout still renders — the model ran out of tokens or
      // forgot the closer, and dropping the box would drop its content with it.
      void closed;
      blocks.push({
        type: 'callout',
        variant: open.variant,
        title: open.title,
        blocks: parseBlocks(buf, depth + 1),
      });
      continue;
    }

    // A stray closing ":::" with no opener. Skipped rather than left to the
    // paragraph branch: that branch breaks on ":::" without consuming the line,
    // which would spin the outer loop forever.
    if (CLOSE_RE.test(line)) {
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // Heading
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1]!.length,
        text: heading[2]!.replace(/\s+#+\s*$/, '').trim(),
      });
      i++;
      continue;
    }

    // Table (header row followed by a separator row of dashes)
    if (line.includes('|') && /^\s*\|?.*\|.*$/.test(line)) {
      const sep = lines[i + 1] ?? '';
      if (/^\s*\|?[\s:|-]*-[\s:|-]*$/.test(sep) && sep.includes('-')) {
        const header = splitTableRow(line);
        const align = parseAlignRow(sep);
        i += 2;
        const rows: string[][] = [];
        while (i < lines.length && (lines[i] ?? '').includes('|') && (lines[i] ?? '').trim()) {
          rows.push(splitTableRow(lines[i] ?? ''));
          i++;
        }
        blocks.push({ type: 'table', header, rows, align });
        continue;
      }
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i] ?? '')) {
        buf.push((lines[i] ?? '').replace(/^>\s?/, ''));
        i++;
      }
      // GitHub alert syntax ("> [!WARNING]") is the other spelling models reach
      // for, and it means exactly the same thing as a ":::warning" block.
      const alert = buf[0]?.match(/^\s*\[!(\w+)\]\s*(.*)$/);
      const variant = alert ? calloutVariant(alert[1]!.toLowerCase()) : undefined;
      if (alert && variant) {
        const title = alert[2]!.trim();
        blocks.push({
          type: 'callout',
          variant,
          title: title || undefined,
          blocks: parseBlocks(buf.slice(1), depth + 1),
        });
        continue;
      }
      blocks.push({ type: 'quote', text: buf.join(' ') });
      continue;
    }

    // Lists (bullet or ordered)
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || ordered) {
      const isOrdered = Boolean(ordered);
      const items: string[] = [];
      while (i < lines.length) {
        const l = lines[i] ?? '';
        const b = l.match(/^\s*[-*+]\s+(.*)$/);
        const o = l.match(/^\s*\d+[.)]\s+(.*)$/);
        if (isOrdered && o) items.push(o[1]!.trim());
        else if (!isOrdered && b) items.push(b[1]!.trim());
        else if (/^\s{2,}\S/.test(l) && items.length) {
          // Continuation line of the previous item (indented wrap).
          items[items.length - 1] += ` ${l.trim()}`;
        } else break;
        i++;
      }
      blocks.push({ type: 'list', ordered: isOrdered, items });
      continue;
    }

    // Paragraph — gather consecutive non-blank, non-structural lines
    const buf: string[] = [];
    while (i < lines.length) {
      line = lines[i] ?? '';
      const structural =
        !line.trim() ||
        /^(#{1,6})\s+/.test(line) ||
        /^```/.test(line) ||
        /^>\s?/.test(line) ||
        /^\s*[-*+]\s+/.test(line) ||
        /^\s*\d+[.)]\s+/.test(line) ||
        /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
        /^\s*:{3,}/.test(line) ||
        PAGEBREAK_RE.test(line);
      // The first line is taken unconditionally. Every structural shape has a
      // branch above, so a line that still looks structural *here* is one none
      // of them accepted, and reading it as prose is the only option left — as
      // well as the thing that guarantees the outer loop advances. Breaking on
      // an empty buffer is precisely how a ```c# line used to hang the parser.
      if (structural && buf.length) break;
      buf.push(line.trim());
      i++;
    }
    if (buf.length) blocks.push({ type: 'paragraph', text: buf.join(' ') });
  }

  return blocks;
}
