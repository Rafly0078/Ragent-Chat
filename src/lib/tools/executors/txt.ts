import 'server-only';

import type { ExecutorFn } from './index';
import { stripInline, parseMarkdown } from '@/lib/documents/markdown';
import { MIME_BY_KIND, EXT_BY_KIND } from '../types';

const createTxt: ExecutorFn = async (req) => {
  let text = req.content ?? '';

  // Only strip markdown when the content actually has block structure. The old
  // test (`includes('#') || includes('```') || includes('**')`) fired on any
  // plain-text file that merely mentioned a CSS colour, an issue number or a
  // shell comment — and the paragraph branch joins a block's lines with spaces,
  // so "Ticket #42\nStatus: open" came back as one reflowed line.
  const looksMarkdown =
    /^\s{0,3}#{1,6}\s/m.test(text) ||
    /^\s*```/m.test(text) ||
    /^\s{0,3}([-*+]|\d+[.)])\s/m.test(text) ||
    /^\s{0,3}>\s/m.test(text) ||
    /\|.*\|/.test(text);

  if (looksMarkdown) {
    const blocks = parseMarkdown(text);
    const lines: string[] = [];
    for (const b of blocks) {
      switch (b.type) {
        case 'heading':
          lines.push(stripInline(b.text).toUpperCase());
          lines.push('');
          break;
        case 'paragraph':
          // Preserve source line breaks rather than emitting one long line.
          for (const line of b.text.split('\n')) lines.push(stripInline(line));
          lines.push('');
          break;
        case 'list':
          b.items.forEach((item, i) => {
            lines.push(b.ordered ? `${i + 1}. ${stripInline(item)}` : `• ${stripInline(item)}`);
          });
          lines.push('');
          break;
        case 'code':
          lines.push(b.text);
          lines.push('');
          break;
        case 'quote':
          lines.push(`> ${stripInline(b.text)}`);
          lines.push('');
          break;
        case 'hr':
          lines.push('---');
          lines.push('');
          break;
        case 'table':
          lines.push(b.header.map((h) => stripInline(h)).join(' | '));
          lines.push(b.header.map(() => '---').join(' | '));
          b.rows.forEach((row) => lines.push(row.map((c) => stripInline(c)).join(' | ')));
          lines.push('');
          break;
      }
    }
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
