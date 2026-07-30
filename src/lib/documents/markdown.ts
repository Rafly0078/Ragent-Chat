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

export type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'code'; lang?: string; text: string }
  | { type: 'hr' }
  | { type: 'table'; header: string[]; rows: string[][]; align?: Array<'left' | 'center' | 'right'> };

/** A run of inline text carrying its accumulated formatting. */
export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
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
  kind: 'code' | 'link' | 'image' | 'bold' | 'italic' | 'strike';
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
  { kind: 'italic', re: /\*(\S(?:.*?\S)?)\*/ },
  { kind: 'italic', re: /_(\S(?:.*?\S)?)_/, underscore: true },
];

const WORD = /[A-Za-z0-9]/;

/** Find the earliest inline construct in `s`, or null if it is all plain text. */
function nextToken(s: string): Token | null {
  let best: Token | null = null;
  for (const { kind, re, underscore } of INLINE_PATTERNS) {
    const m = re.exec(s);
    if (!m || m.index === undefined) continue;
    // Underscore emphasis inside a word (file_name, __dunder__ identifiers)
    // is almost always not emphasis — require a non-word boundary on both
    // outer sides before honoring it.
    if (underscore) {
      const before = s[m.index - 1];
      const after = s[m.index + m[0].length];
      if ((before && WORD.test(before)) || (after && WORD.test(after))) continue;
    }
    if (best === null || m.index < best.index) {
      best = {
        index: m.index,
        length: m[0].length,
        kind,
        // For a link/image with empty text, fall back to the destination —
        // `[](url)` used to emit nothing at all, losing both label and URL.
        inner: kind === 'link' || kind === 'image' ? (m[1] || m[2] || '') : (m[1] ?? ''),
        href: kind === 'link' || kind === 'image' ? m[2] : undefined,
      };
      if (m.index === 0) break; // can't beat index 0
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
    last.href === style.href
  ) {
    last.text += text;
    return;
  }
  out.push({ text, ...style });
}

function walk(input: string, style: Style, out: Span[]): void {
  let rest = input;
  while (rest.length > 0) {
    const tok = nextToken(rest);
    if (!tok) {
      emit(out, rest, style);
      return;
    }
    if (tok.index > 0) emit(out, rest.slice(0, tok.index), style);
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
    }
    rest = rest.slice(tok.index + tok.length);
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

export function parseMarkdown(md: string): Block[] {
  const lines = (md ?? '').replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    let line = lines[i] ?? '';

    // Blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code
    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      const lang = fence[1];
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? '')) {
        buf.push(lines[i] ?? '');
        i++;
      }
      i++; // closing fence
      blocks.push({ type: 'code', lang, text: buf.join('\n') });
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
      if (
        !line.trim() ||
        /^(#{1,6})\s+/.test(line) ||
        /^```/.test(line) ||
        /^>\s?/.test(line) ||
        /^\s*[-*+]\s+/.test(line) ||
        /^\s*\d+[.)]\s+/.test(line) ||
        /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)
      ) {
        break;
      }
      buf.push(line.trim());
      i++;
    }
    if (buf.length) blocks.push({ type: 'paragraph', text: buf.join(' ') });
  }

  return blocks;
}
