import 'server-only';

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import type { ExecutorFn } from './index';
import { parseInline, parseMarkdown, type Block, type Span } from '@/lib/documents/markdown';
import { MIME_BY_KIND, EXT_BY_KIND, displayTitle } from '../types';

/**
 * PDF generation with real font metrics. Text is wrapped by measuring glyph
 * widths (not by guessing characters-per-line); inline bold, italic, code and
 * links render as styled runs, and non-Latin-1 characters are transliterated
 * to their closest WinAnsi equivalent rather than silently dropped — the
 * StandardFonts only speak WinAnsi, so an em-dash or smart quote would
 * otherwise crash drawText or vanish.
 */

const PUNCT: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': ',',
  '‛': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '–': '-',
  '—': '-',
  '―': '-',
  '−': '-',
  '…': '...',
  '•': '-',
  '·': '-',
  '‣': '-',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  '​': '',
  '→': '->',
  '←': '<-',
  '↔': '<->',
  '⇒': '=>',
  '≤': '<=',
  '≥': '>=',
  '≠': '!=',
  '×': 'x',
  '÷': '/',
  '™': '(TM)',
  '®': '(R)',
  '©': '(C)',
  '€': 'EUR',
  '☑': '[x]',
  '☐': '[ ]',
  '✓': 'v',
  '✗': 'x',
};

/** Fold text into the Latin-1 range the standard PDF fonts can render. */
function toWinAnsi(s: string): string {
  const mapped = Array.from(s)
    .map((ch) => PUNCT[ch] ?? ch)
    .join('');
  // Decompose accents (é → e +  ́) then drop the combining marks, so accented
  // Latin text degrades to readable base letters instead of being deleted.
  const deaccented = mapped.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  // Keep only what WinAnsi can actually encode. 0x7F–0x9F look "Latin-1" but
  // pdf-lib throws on them ("WinAnsi cannot encode ..."), which failed the whole
  // document; they used to slip through the old \x20-\xFF range.
  return deaccented.replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');
}

/** Hard cap on a single code line before it's even measured (see the `code` case). */
const MAX_CODE_LINE_CHARS = 4000;

/**
 * The StandardFonts speak WinAnsi only, so CJK / Cyrillic / Arabic / Thai / emoji
 * cannot be rendered at all — `toWinAnsi` deletes them. Silently shipping a
 * correctly-paginated PDF with an empty body is the worst possible outcome, so
 * refuse instead and point the user at a format that can represent the text.
 */
function assertRenderable(content: string, title: string): void {
  const source = `${title}\n${content}`;
  const meaningful = Array.from(source).filter((ch) => !/\s/.test(ch));
  if (meaningful.length === 0) return;
  const dropped =
    meaningful.length - Array.from(toWinAnsi(source)).filter((ch) => !/\s/.test(ch)).length;
  if (dropped / meaningful.length > 0.2) {
    throw new Error(
      'This text uses characters the PDF generator cannot render (the built-in PDF fonts ' +
        'only cover Latin-1). Ask for a .docx, .html or .md file instead.',
    );
  }
}

const INK = rgb(0.12, 0.12, 0.12);
const MUTED = rgb(0.45, 0.45, 0.45);
const LINK = rgb(0.13, 0.4, 0.75);
const CODE_INK = rgb(0.15, 0.2, 0.28);
const RULE = rgb(0.82, 0.82, 0.82);
const CODE_BG = rgb(0.96, 0.965, 0.97);
const TABLE_HEAD_BG = rgb(0.93, 0.94, 0.95);

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
  mono: PDFFont;
  monoBold: PDFFont;
}

/** One measured word ready to place, carrying the font/color it renders with. */
interface Word {
  text: string;
  font: PDFFont;
  size: number;
  color: RGB;
  width: number;
  spaceBefore: boolean;
}

/**
 * Longest prefix of `text` that fits `maxW`. Binary-searched: walking back one
 * character at a time re-measures the whole string on every step, which is what
 * made a single minified line cost seconds of CPU in the `code` case below.
 */
function fitChars(text: string, font: PDFFont, size: number, maxW: number): number {
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (font.widthOfTextAtSize(text.slice(0, mid), size) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const createPdf: ExecutorFn = async (req) => {
  const pdfDoc = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    italic: await pdfDoc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique),
    mono: await pdfDoc.embedFont(StandardFonts.Courier),
    monoBold: await pdfDoc.embedFont(StandardFonts.CourierBold),
  };

  const blocks = parseMarkdown(req.content ?? '');
  let title = toWinAnsi(displayTitle(req));
  if (!title) title = 'Document';
  assertRenderable(req.content ?? '', req.title ?? '');

  const marginX = 64;
  const marginTop = 72;
  const marginBot = 64;
  const bodySize = 11;
  const bodyLead = 15;

  // Title header on the first page (no separate cover page — wastes paper for
  // the short documents these tools usually produce).
  let page = pdfDoc.addPage();
  let { width, height } = page.getSize();
  const contentW = width - 2 * marginX;
  let y = height - marginTop;

  const newPage = () => {
    page = pdfDoc.addPage();
    ({ width, height } = page.getSize());
    y = height - marginTop;
  };
  const ensure = (need: number) => {
    if (y - need < marginBot) newPage();
  };

  const fontFor = (sp: Span, mono = false): PDFFont => {
    if (sp.code || mono) return sp.bold ? fonts.monoBold : fonts.mono;
    if (sp.bold && sp.italic) return fonts.boldItalic;
    if (sp.bold) return fonts.bold;
    if (sp.italic) return fonts.italic;
    return fonts.regular;
  };

  /** Break styled spans into measured words with spacing preserved. */
  const toWords = (spans: Span[], size: number, forceColor?: RGB): Word[] => {
    const words: Word[] = [];
    let pendingSpace = false;
    for (const sp of spans) {
      const font = fontFor(sp);
      const color = forceColor ?? (sp.href ? LINK : sp.code ? CODE_INK : INK);
      const parts = toWinAnsi(sp.text).split(/(\s+)/);
      for (const part of parts) {
        if (part === '') continue;
        if (/^\s+$/.test(part)) {
          pendingSpace = true;
          continue;
        }
        words.push({
          text: part,
          font,
          size,
          color,
          width: font.widthOfTextAtSize(part, size),
          spaceBefore: pendingSpace,
        });
        pendingSpace = false;
      }
    }
    return words;
  };

  /** Greedy line-break measured words to fit `maxW`. */
  const layout = (words: Word[], maxW: number): Word[][] => {
    const lines: Word[][] = [];
    let line: Word[] = [];
    let lineW = 0;
    for (const word of words) {
      let w = word;
      // Hard-wrap a single word longer than the whole line so it can't overflow.
      // Nothing here used to split `w.text` — the oversized word was simply pushed
      // onto the empty line — so a 150-character signed URL or a base64 blob was
      // drawn from the left margin past the right one and clipped by the page edge.
      while (w.width > maxW) {
        if (line.length) {
          lines.push(line);
          line = [];
          lineW = 0;
        }
        const cut = fitChars(w.text, w.font, w.size, maxW);
        if (cut === 0) break; // not even one glyph fits: let it overflow, as before
        const head = w.text.slice(0, cut);
        const tail = w.text.slice(cut);
        lines.push([
          { ...w, text: head, width: w.font.widthOfTextAtSize(head, w.size), spaceBefore: false },
        ]);
        w = { ...w, text: tail, width: w.font.widthOfTextAtSize(tail, w.size), spaceBefore: false };
      }
      const spaceW = w.spaceBefore && line.length ? w.font.widthOfTextAtSize(' ', w.size) : 0;
      if (line.length && lineW + spaceW + w.width > maxW) {
        lines.push(line);
        line = [];
        lineW = 0;
      }
      const lead = line.length ? spaceW : 0;
      line.push({ ...w, spaceBefore: lead > 0 });
      lineW += lead + w.width;
    }
    if (line.length) lines.push(line);
    return lines.length ? lines : [[]];
  };

  const drawLine = (line: Word[], x0: number, size: number) => {
    let x = x0;
    for (const w of line) {
      if (w.spaceBefore) x += w.font.widthOfTextAtSize(' ', size);
      page.drawText(w.text, { x, y, size, font: w.font, color: w.color });
      x += w.width;
    }
  };

  /** Render styled spans as a wrapped paragraph at the current cursor. */
  const flowSpans = (
    spans: Span[],
    opts?: { size?: number; indent?: number; color?: RGB; lead?: number },
  ) => {
    const size = opts?.size ?? bodySize;
    const indent = opts?.indent ?? 0;
    const lead = opts?.lead ?? bodyLead;
    const words = toWords(spans, size, opts?.color);
    for (const line of layout(words, contentW - indent)) {
      ensure(lead);
      drawLine(line, marginX + indent, size);
      y -= lead;
    }
  };

  const renderBlock = (b: Block) => {
    switch (b.type) {
      case 'heading': {
        const size = b.level === 1 ? 19 : b.level === 2 ? 15 : b.level === 3 ? 13 : 12;
        y -= b.level <= 2 ? 10 : 6;
        ensure(size + 6);
        flowSpans(
          parseInline(b.text).map((s) => ({ ...s, bold: true })),
          { size, lead: size + 4 },
        );
        if (b.level === 1) {
          y -= 2;
          ensure(6);
          page.drawLine({
            start: { x: marginX, y: y + 4 },
            end: { x: width - marginX, y: y + 4 },
            thickness: 0.75,
            color: RULE,
          });
          y -= 6;
        }
        y -= 4;
        break;
      }
      case 'paragraph':
        flowSpans(parseInline(b.text));
        y -= 6;
        break;
      case 'list':
        b.items.forEach((item, idx) => {
          const marker = b.ordered ? `${idx + 1}.` : '-';
          const markerW = fonts.regular.widthOfTextAtSize(`${marker} `, bodySize);
          ensure(bodyLead);
          page.drawText(`${marker}`, {
            x: marginX + 6,
            y,
            size: bodySize,
            font: fonts.regular,
            color: INK,
          });
          const words = toWords(parseInline(item), bodySize);
          const lines = layout(words, contentW - markerW - 12);
          lines.forEach((line, li) => {
            if (li > 0) ensure(bodyLead);
            drawLine(line, marginX + 12 + markerW, bodySize);
            y -= bodyLead;
          });
        });
        y -= 6;
        break;
      case 'quote': {
        const words = toWords(parseInline(b.text), bodySize, MUTED);
        const lines = layout(words, contentW - 24);
        lines.forEach((line) => {
          ensure(bodyLead);
          drawLine(line, marginX + 20, bodySize);
          // A segment per line, on the page that line landed on. Sizing the rule
          // from a cursor captured before the loop gave it a NEGATIVE height once
          // the quote broke across a page — pdf-lib happily drew a 3pt bar down
          // most of the new page's left margin — and left it short otherwise.
          page.drawRectangle({
            x: marginX + 6,
            y: y - 2,
            width: 3,
            height: bodyLead,
            color: RULE,
          });
          y -= bodyLead;
        });
        y -= 6;
        break;
      }
      case 'code': {
        const size = 9.5;
        const lead = 13;
        const lines = b.text.split('\n');
        for (const raw of lines) {
          ensure(lead);
          page.drawRectangle({
            x: marginX,
            y: y - 3,
            width: contentW,
            height: lead,
            color: CODE_BG,
          });
          // Clip overly long code lines by measured width. Binary-search the cut
          // point: walking back one character at a time re-measured the whole
          // string on every step, so a single minified/base64 line (20k chars)
          // burned ~13s of CPU and blocked the event loop for every other
          // request. Also hard-cap the length before measuring at all.
          let text = toWinAnsi(raw.replace(/\t/g, '  ')).slice(0, MAX_CODE_LINE_CHARS);
          const maxW = contentW - 16;
          if (text && fonts.mono.widthOfTextAtSize(text, size) > maxW) {
            let lo = 0;
            let hi = text.length;
            while (lo < hi) {
              const mid = (lo + hi + 1) >> 1;
              if (fonts.mono.widthOfTextAtSize(text.slice(0, mid), size) <= maxW) lo = mid;
              else hi = mid - 1;
            }
            text = text.slice(0, lo);
          }
          page.drawText(text, { x: marginX + 8, y, size, font: fonts.mono, color: CODE_INK });
          y -= lead;
        }
        y -= 8;
        break;
      }
      case 'hr':
        ensure(16);
        y -= 6;
        page.drawLine({
          start: { x: marginX, y },
          end: { x: width - marginX, y },
          thickness: 0.75,
          color: RULE,
        });
        y -= 12;
        break;
      case 'pagebreak':
        newPage();
        break;
      case 'callout': {
        // No box drawing here — this renderer is the degraded fallback, and a
        // hand-drawn frame that has to survive a page break is exactly the kind
        // of code the Chromium path exists to avoid. The label and a left rule
        // keep the content and its severity legible; anything prettier is what
        // the primary renderer is for. Dropping the block entirely (which the
        // old `switch` would do for an unknown type) is the only unacceptable
        // outcome.
        y -= 6;
        ensure(bodyLead + 6);
        flowSpans([{ text: b.title ?? b.variant.toUpperCase(), bold: true }], {
          size: 10,
          lead: 14,
        });
        b.blocks.forEach(renderBlock);
        y -= 4;
        break;
      }
      case 'table':
        renderTable(b);
        break;
    }
  };

  const renderTable = (b: Extract<Block, { type: 'table' }>) => {
    // reduce, not `Math.max(...spread)`: one argument per row blows the call
    // stack (RangeError) on a large table.
    const cols = b.rows.reduce((max, r) => Math.max(max, r.length), Math.max(b.header.length, 1));
    const colW = contentW / cols;
    const size = 9.5;
    const cellPad = 5;
    const lineH = 12;

    const drawRow = (cells: string[], isHeader: boolean) => {
      // Pre-wrap every cell to know the row height before drawing.
      const wrapped = Array.from({ length: cols }, (_, ci) => {
        const spans = parseInline(cells[ci] ?? '');
        const words = toWords(isHeader ? spans.map((s) => ({ ...s, bold: true })) : spans, size);
        return layout(words, colW - 2 * cellPad);
      });
      const rowH = Math.max(1, ...wrapped.map((w) => w.length)) * lineH + cellPad;
      ensure(rowH);
      const rowTop = y;
      if (isHeader) {
        page.drawRectangle({
          x: marginX,
          y: rowTop - rowH + lineH - 1,
          width: contentW,
          height: rowH,
          color: TABLE_HEAD_BG,
        });
      }
      wrapped.forEach((lines, ci) => {
        const align = b.align?.[ci] ?? 'left';
        let ly = rowTop;
        lines.forEach((line) => {
          const lineW = line.reduce(
            (acc, w) => acc + w.width + (w.spaceBefore ? w.font.widthOfTextAtSize(' ', size) : 0),
            0,
          );
          let x = marginX + ci * colW + cellPad;
          if (align === 'right') x = marginX + (ci + 1) * colW - cellPad - lineW;
          else if (align === 'center') x = marginX + ci * colW + (colW - lineW) / 2;
          let cx = x;
          for (const w of line) {
            if (w.spaceBefore) cx += w.font.widthOfTextAtSize(' ', size);
            page.drawText(w.text, { x: cx, y: ly, size, font: w.font, color: INK });
            cx += w.width;
          }
          ly -= lineH;
        });
      });
      y = rowTop - rowH;
      page.drawLine({
        start: { x: marginX, y: y + lineH - 2 },
        end: { x: width - marginX, y: y + lineH - 2 },
        thickness: 0.5,
        color: RULE,
      });
    };

    y -= 4;
    ensure(lineH * 2);
    drawRow(b.header, true);
    for (const row of b.rows) drawRow(row, false);
    // Vertical column separators across the table's drawn height are skipped to
    // keep the renderer simple; horizontal rules already delimit rows clearly.
    y -= 10;
  };

  // ---- Title, then body ----
  ensure(40);
  flowSpans([{ text: title, bold: true }], { size: 24, lead: 30 });
  y -= 2;
  flowSpans([{ text: `Generated ${new Date().toLocaleDateString()}`, italic: true }], {
    size: 10,
    color: MUTED,
    lead: 16,
  });
  page.drawLine({
    start: { x: marginX, y: y + 4 },
    end: { x: width - marginX, y: y + 4 },
    thickness: 1,
    color: RULE,
  });
  y -= 16;

  for (const b of blocks) renderBlock(b);

  // Footer page numbers, added last so the total count is known.
  const pages = pdfDoc.getPages();
  pages.forEach((p: PDFPage, idx) => {
    const label = `${idx + 1} / ${pages.length}`;
    const w = fonts.regular.widthOfTextAtSize(label, 9);
    p.drawText(label, {
      x: p.getSize().width / 2 - w / 2,
      y: 32,
      size: 9,
      font: fonts.regular,
      color: MUTED,
    });
  });

  const buffer = Buffer.from(await pdfDoc.save());
  return { buffer, kind: 'pdf', mime: MIME_BY_KIND.pdf, ext: EXT_BY_KIND.pdf };
};

export default createPdf;
