import 'server-only';

import type { ExecutorFn } from './index';
import { stripInline, parseMarkdown, type Block } from '@/lib/documents/markdown';
import { MIME_BY_KIND, EXT_BY_KIND, textFileExt } from '../types';

/**
 * Flatten one block to plain lines.
 *
 * `prefix` indents the body of a callout so its extent is still visible without
 * any box drawing. Every block type is handled: the switch this replaced had no
 * `default`, so a callout — and everything nested inside it — was dropped from
 * the .txt export entirely.
 */
function emitBlock(b: Block, lines: string[], prefix = ''): void {
  const push = (s: string) => lines.push(s ? `${prefix}${s}` : '');
  switch (b.type) {
    case 'heading':
      push(stripInline(b.text).toUpperCase());
      push('');
      break;
    case 'paragraph':
      // Preserve source line breaks rather than emitting one long line.
      for (const line of b.text.split('\n')) push(stripInline(line));
      push('');
      break;
    case 'list':
      b.items.forEach((item, i) => {
        push(b.ordered ? `${i + 1}. ${stripInline(item)}` : `• ${stripInline(item)}`);
      });
      push('');
      break;
    case 'code':
      for (const line of b.text.split('\n')) push(line);
      push('');
      break;
    case 'quote':
      push(`> ${stripInline(b.text)}`);
      push('');
      break;
    case 'hr':
      push('---');
      push('');
      break;
    case 'pagebreak':
      // U+000C. Real form feed, which `lp`/`pr` and most editors honour as a
      // page break — closer to the intent than another rule of dashes.
      lines.push('\f');
      break;
    case 'callout': {
      const label = (b.title ?? b.variant).toUpperCase();
      push(`[${label}]`);
      for (const inner of b.blocks) emitBlock(inner, lines, `${prefix}  `);
      break;
    }
    case 'table':
      push(b.header.map((h) => stripInline(h)).join(' | '));
      push(b.header.map(() => '---').join(' | '));
      b.rows.forEach((row) => push(row.map((c) => stripInline(c)).join(' | ')));
      push('');
      break;
  }
}

const createTxt: ExecutorFn = async (req) => {
  let text = req.content ?? '';

  // A file the model named `style.css` or `script.js` is code, and code is written
  // verbatim. The markdown test below is heuristic by necessity, and on source it
  // guesses wrong in the worst way: `a || b` matches the table pattern, so a
  // JavaScript file was parsed as markdown and reflowed into prose. A recognised code
  // extension is not ambiguous, so it settles the question before the guessing starts.
  const verbatim = textFileExt(req.name) !== null;

  // Only strip markdown when the content actually has block structure. The old
  // test (`includes('#') || includes('```') || includes('**')`) fired on any
  // plain-text file that merely mentioned a CSS colour, an issue number or a
  // shell comment — and the paragraph branch joins a block's lines with spaces,
  // so "Ticket #42\nStatus: open" came back as one reflowed line.
  const looksMarkdown =
    !verbatim &&
    (/^\s{0,3}#{1,6}\s/m.test(text) ||
      /^\s*```/m.test(text) ||
      /^\s{0,3}([-*+]|\d+[.)])\s/m.test(text) ||
      /^\s{0,3}>\s/m.test(text) ||
      /\|.*\|/.test(text));

  if (looksMarkdown) {
    const blocks = parseMarkdown(text);
    const lines: string[] = [];
    for (const b of blocks) emitBlock(b, lines);
    text = lines.join('\n').trim();
  }

  const buffer = Buffer.from(text, 'utf-8');
  return {
    buffer,
    kind: 'txt',
    mime: MIME_BY_KIND.txt,
    ext: EXT_BY_KIND.txt,
  };
};

export default createTxt;
