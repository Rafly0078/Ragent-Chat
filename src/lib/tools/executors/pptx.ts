import 'server-only';

import PptxGenJS from 'pptxgenjs';
import type { ExecutorFn } from './index';
import {
  parseInline,
  parseMarkdown,
  stripInline,
  type Block,
  type Span,
} from '@/lib/documents/markdown';
import {
  resolveTheme,
  CALLOUT_PALETTE,
  CALLOUT_TITLES,
  type DocTheme,
} from '@/lib/documents/theme';
import { MIME_BY_KIND, EXT_BY_KIND, displayTitle, type SlideSpec } from '../types';

/**
 * create_pptx — a themed deck.
 *
 * PowerPoint has no layout engine: every shape needs an absolute inch position,
 * so this file carries a small vertical-flow layout instead of leaning on the
 * format. Heights are *estimated* from character counts, which is the honest
 * trade — measuring text properly needs a font rasterizer we do not have on the
 * server. The estimate errs generous, so content spills onto a "(cont.)" slide
 * rather than off the bottom edge: a slide that silently drops its last three
 * bullets is the worst failure available here.
 *
 * pptxgenjs exposes no gradient fill, so the cover is a flat `accentDark` page
 * with translucent rectangles standing in for the PDF's gradient art.
 */

/** LAYOUT_WIDE, in inches. */
const PW = 13.33;
const PH = 7.5;
const MARGIN = 0.8;
const CONTENT_W = PW - 2 * MARGIN;
const CONTENT_TOP = 1.85;
const CONTENT_BOTTOM = PH - 0.62;

const FS = {
  slideTitle: 27,
  sub: 18,
  body: 15,
  bullet: 16,
  quote: 15,
  code: 11,
  calloutLabel: 12,
  cell: 11,
} as const;

type Runs = PptxGenJS.TextProps[];
type TextOpts = PptxGenJS.TextPropsOptions;
type Slide = ReturnType<PptxGenJS['addSlide']>;

const PT = 1 / 72;

/**
 * Rough wrapped-line count.
 *
 * Average glyph width is taken as half the point size — close enough for
 * Calibri/Arial at these sizes, and biased toward *more* lines on wide text.
 */
function lineCount(text: string, fontSize: number, width: number): number {
  const perLine = Math.max(8, Math.floor((width * 144) / fontSize));
  return text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
}

function textH(text: string, fontSize: number, width: number, factor = 1.34): number {
  return lineCount(text, fontSize, width) * fontSize * factor * PT;
}

/** Inline Markdown to pptx rich-text runs. */
function spanRuns(spans: Span[], t: DocTheme, base: TextOpts): Runs {
  return spans.map((sp) => ({
    text: sp.text,
    options: {
      ...base,
      bold: sp.bold || base.bold,
      italic: sp.italic || base.italic,
      strike: sp.strike,
      // `highlight` is the only per-run background pptx offers, so the marker
      // wash and the code fill compete for it. Code wins when a span is both.
      ...(sp.highlight ? { highlight: t.highlightFill, color: t.ink } : {}),
      ...(sp.code ? { fontFace: t.officeMono, color: t.codeInk, highlight: t.codeFill } : {}),
      ...(sp.href
        ? {
            hyperlink: { url: sp.href },
            color: t.accentDark,
            underline: { style: 'sng' as const },
          }
        : {}),
    },
  }));
}

function inlineRuns(text: string, t: DocTheme, base: TextOpts): Runs {
  return spanRuns(parseInline(text), t, base);
}

/** One rendered slide: a heading plus the blocks that followed it. */
interface DeckSlide {
  title: string;
  blocks: Block[];
}

/**
 * Split parsed Markdown into slides.
 *
 * Headings h1–h3 open a slide; h4–h6 stay inside one as sub-headings, which is
 * closer to how people actually write deck outlines than the old rule that
 * flattened them into bullets. A leading h1 with nothing before it is taken as
 * the deck title rather than an empty first slide.
 */
function deckFromBlocks(blocks: Block[]): { deckTitle?: string; slides: DeckSlide[] } {
  const slides: DeckSlide[] = [];
  let deckTitle: string | undefined;
  let current: DeckSlide | null = null;

  const open = (title: string) => {
    if (current) slides.push(current);
    current = { title, blocks: [] };
  };

  for (const b of blocks) {
    if (b.type === 'heading' && b.level <= 3) {
      if (!deckTitle && b.level === 1 && !current && slides.length === 0) {
        deckTitle = stripInline(b.text);
        continue;
      }
      open(stripInline(b.text));
      continue;
    }
    if (b.type === 'pagebreak') {
      // An explicit break inside a section continues it on a fresh slide.
      if (current) open(`${current.title}${current.title ? ' (cont.)' : ''}`);
      continue;
    }
    if (!current) current = { title: deckTitle ?? '', blocks: [] };
    current.blocks.push(b);
  }
  if (current) slides.push(current);
  return { deckTitle, slides };
}

/** The model may send structured slides instead of Markdown. */
function specToBlocks(sp: SlideSpec): Block[] {
  const out: Block[] = [];
  for (const para of (sp.body ?? '').split(/\n{2,}/)) {
    if (para.trim()) out.push({ type: 'paragraph', text: para.trim() });
  }
  if (sp.bullets?.length) out.push({ type: 'list', ordered: false, items: sp.bullets });
  return out;
}

/** Padding above/below a boxed block (callout, code). */
const BOX_PAD = 0.16;

function blockHeight(b: Block, width: number): number {
  switch (b.type) {
    case 'heading':
      return textH(stripInline(b.text), FS.sub, width) + 0.12;
    case 'paragraph':
      return textH(stripInline(b.text), FS.body, width) + 0.14;
    case 'list':
      return (
        b.items.reduce((h, it) => h + textH(stripInline(it), FS.bullet, width - 0.35) + 0.06, 0) +
        0.12
      );
    case 'quote':
      return textH(stripInline(b.text), FS.quote, width - 0.3) + 0.22;
    case 'code':
      // No wrap estimate: pptx will not reflow a code line, so height follows
      // the source line count and long lines are clipped by the box.
      return b.text.split('\n').length * FS.code * 1.3 * PT + 2 * BOX_PAD;
    case 'hr':
      return 0.28;
    case 'table':
      return tableRowHeights(b, width).reduce((a, h) => a + h, 0) + 0.16;
    case 'callout':
      return (
        FS.calloutLabel * 1.4 * PT +
        b.blocks.reduce((h, inner) => h + blockHeight(inner, width - 0.55), 0) +
        2 * BOX_PAD +
        0.1
      );
    default:
      return 0;
  }
}

function tableRowHeights(b: Extract<Block, { type: 'table' }>, width: number): number[] {
  const cols = b.rows.reduce((max, r) => Math.max(max, r.length), b.header.length) || 1;
  const colW = width / cols;
  const rowH = (cells: string[]) =>
    Math.max(
      0.32,
      Math.max(...cells.map((c) => lineCount(stripInline(c), FS.cell, colW - 0.16))) *
        FS.cell *
        1.35 *
        PT +
        0.16,
    );
  return [rowH(b.header), ...b.rows.map(rowH)];
}

function drawBlock(s: Slide, b: Block, t: DocTheme, x: number, y: number, w: number, h: number) {
  switch (b.type) {
    case 'heading':
      s.addText(
        inlineRuns(b.text, t, {
          fontSize: FS.sub,
          color: t.accentDark,
          fontFace: t.officeHeading,
          bold: true,
        }),
        { x, y, w, h, valign: 'top' },
      );
      return;
    case 'paragraph':
      s.addText(
        inlineRuns(b.text, t, { fontSize: FS.body, color: t.ink, fontFace: t.officeBody }),
        {
          x,
          y,
          w,
          h,
          valign: 'top',
          lineSpacingMultiple: 1.15,
        },
      );
      return;
    case 'list':
      s.addText(
        b.items.flatMap((item) => {
          const r = inlineRuns(item, t, {
            fontSize: FS.bullet,
            color: t.ink,
            fontFace: t.officeBody,
          });
          // Bullet glyph and the paragraph break belong to the first and last
          // run of each item; anything else gives one bullet per styled span.
          return r.map((run, j) => ({
            ...run,
            options: {
              ...run.options,
              bullet: j === 0 ? { indent: 18 } : false,
              breakLine: j === r.length - 1,
              paraSpaceAfter: j === r.length - 1 ? 6 : 0,
            },
          }));
        }),
        { x, y, w, h, valign: 'top' },
      );
      return;
    case 'quote':
      s.addShape('rect', { x, y, w: 0.05, h, fill: { color: t.accentSoft } });
      s.addText(
        inlineRuns(b.text, t, {
          fontSize: FS.quote,
          color: t.muted,
          fontFace: t.officeBody,
          italic: true,
        }),
        { x: x + 0.22, y, w: w - 0.3, h, valign: 'top' },
      );
      return;
    case 'code':
      s.addShape('rect', { x, y, w, h, fill: { color: t.codeFill } });
      s.addShape('rect', { x, y, w: 0.05, h, fill: { color: t.accent } });
      s.addText(b.text, {
        x: x + 0.2,
        y: y + BOX_PAD / 2,
        w: w - 0.35,
        h: h - BOX_PAD,
        fontSize: FS.code,
        fontFace: t.officeMono,
        color: t.codeInk,
        valign: 'top',
      });
      return;
    case 'hr':
      s.addShape('rect', { x, y: y + 0.13, w, h: 0.012, fill: { color: t.border } });
      return;
    case 'callout': {
      const c = CALLOUT_PALETTE[b.variant];
      s.addShape('rect', { x, y, w, h, fill: { color: c.fill } });
      s.addShape('rect', { x, y, w: 0.06, h, fill: { color: c.line } });
      const labelH = FS.calloutLabel * 1.4 * PT;
      s.addText(b.title ?? CALLOUT_TITLES[b.variant], {
        x: x + 0.26,
        y: y + BOX_PAD / 2,
        w: w - 0.5,
        h: labelH,
        fontSize: FS.calloutLabel,
        color: c.ink,
        fontFace: t.officeHeading,
        bold: true,
        valign: 'top',
      });
      let iy = y + BOX_PAD / 2 + labelH + 0.04;
      const iw = w - 0.55;
      for (const inner of b.blocks) {
        const ih = blockHeight(inner, iw);
        drawBlock(s, inner, t, x + 0.28, iy, iw, ih);
        iy += ih;
      }
      return;
    }
    case 'table': {
      const cols = b.rows.reduce((max, r) => Math.max(max, r.length), b.header.length) || 1;
      const cell = (text: string, ri: number): PptxGenJS.TableCell => ({
        text: stripInline(text),
        options: {
          fontSize: FS.cell,
          fontFace: t.officeBody,
          color: ri < 0 ? t.accentFg : t.ink,
          bold: ri < 0,
          fill: ri < 0 ? { color: t.accent } : ri % 2 === 1 ? { color: t.accentSoft } : undefined,
          align: b.align?.[0] ?? 'left',
          valign: 'top',
          margin: 4,
        },
      });
      const rows: PptxGenJS.TableRow[] = [
        Array.from({ length: cols }, (_, ci) => cell(b.header[ci] ?? '', -1)),
        ...b.rows.map((row, ri) =>
          Array.from({ length: cols }, (_, ci) => cell(row[ci] ?? '', ri)),
        ),
      ];
      s.addTable(rows, {
        x,
        y,
        w,
        colW: Array.from({ length: cols }, () => w / cols),
        border: { type: 'solid', pt: 0.5, color: t.border },
      });
      return;
    }
    default:
      return;
  }
}

function contentSlide(pptx: PptxGenJS, title: string, t: DocTheme): Slide {
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  if (title) {
    s.addText(
      inlineRuns(title, t, {
        fontSize: FS.slideTitle,
        color: t.ink,
        fontFace: t.officeHeading,
        bold: true,
      }),
      { x: MARGIN, y: 0.52, w: CONTENT_W, h: 0.82, valign: 'middle', fit: 'shrink' },
    );
    s.addShape('rect', { x: MARGIN, y: 1.5, w: 2.6, h: 0.045, fill: { color: t.accent } });
  }
  return s;
}

function drawCover(pptx: PptxGenJS, title: string, t: DocTheme): void {
  const s = pptx.addSlide();
  s.background = { color: t.accentDark };
  // Stand-ins for the PDF cover's gradient: pptxgenjs fills are flat, so depth
  // has to come from overlapping translucent planes.
  s.addShape('rect', {
    x: 0,
    y: 0,
    w: PW,
    h: PH * 0.55,
    fill: { color: t.accent, transparency: 60 },
  });
  s.addShape('rect', {
    x: 0,
    y: 0,
    w: PW * 0.4,
    h: PH,
    fill: { color: t.accent, transparency: 78 },
  });
  s.addShape('rect', { x: MARGIN, y: 2.5, w: 1.6, h: 0.09, fill: { color: t.accentFg } });

  s.addText(title, {
    x: MARGIN,
    y: 2.9,
    w: PW - 2 * MARGIN,
    h: 1.5,
    fontSize: 38,
    bold: true,
    color: t.accentFg,
    fontFace: t.officeHeading,
    valign: 'top',
    fit: 'shrink',
  });
  if (t.subtitle) {
    s.addText(t.subtitle, {
      x: MARGIN,
      y: 4.5,
      w: PW - 2 * MARGIN,
      h: 0.6,
      fontSize: 17,
      color: t.accentFg,
      fontFace: t.officeBody,
      transparency: 12,
      valign: 'top',
    });
  }
  s.addText(t.author ? t.author.toUpperCase() : `Generated ${new Date().toLocaleDateString()}`, {
    x: MARGIN,
    y: 5.5,
    w: PW - 2 * MARGIN,
    h: 0.5,
    fontSize: 11,
    color: t.accentFg,
    fontFace: t.officeBody,
    charSpacing: 1.4,
    transparency: 28,
    valign: 'top',
  });
}

const createPptx: ExecutorFn = async (req) => {
  const theme = resolveTheme(req.theme);
  const pptx = new PptxGenJS();
  pptx.author = 'AI Workspace';
  pptx.layout = 'LAYOUT_WIDE';

  pptx.defineSlideMaster({
    title: 'CONTENT',
    background: { color: 'FFFFFF' },
    objects: [{ rect: { x: 0, y: 0, w: PW, h: 0.12, fill: { color: theme.accent } } }],
    slideNumber: {
      x: PW - 0.9,
      y: PH - 0.45,
      color: theme.muted,
      fontSize: 10,
      fontFace: theme.officeBody,
    },
  });

  let deckTitle = req.title?.trim() || (req.name ? displayTitle(req) : '');
  let slides: DeckSlide[] = (req.slides ?? []).map((sp) => ({
    title: sp.title?.trim() ?? '',
    blocks: specToBlocks(sp),
  }));

  if (slides.length === 0 && req.content) {
    const parsed = deckFromBlocks(parseMarkdown(req.content));
    slides = parsed.slides;
    if (!deckTitle && parsed.deckTitle) deckTitle = parsed.deckTitle;
  }
  if (!deckTitle) deckTitle = 'Presentation';
  if (slides.length === 0) {
    slides = [{ title: 'Overview', blocks: specToBlocks({ body: req.content ?? '' }) }];
  }

  drawCover(pptx, deckTitle, theme);

  for (const ds of slides) {
    let s = contentSlide(pptx, ds.title, theme);
    let y = CONTENT_TOP;
    let placed = 0;
    for (const b of ds.blocks) {
      const h = blockHeight(b, CONTENT_W);
      // `placed > 0` guards the case of a single block taller than the slide:
      // it gets drawn and clipped rather than looping onto empty slides.
      if (placed > 0 && y + h > CONTENT_BOTTOM) {
        s = contentSlide(pptx, ds.title ? `${ds.title} (cont.)` : '', theme);
        y = CONTENT_TOP;
        placed = 0;
      }
      drawBlock(s, b, theme, MARGIN, y, CONTENT_W, h);
      y += h;
      placed++;
    }
  }

  const blob = await pptx.write({ outputType: 'nodebuffer' });
  const buffer = Buffer.isBuffer(blob) ? blob : Buffer.from(blob as ArrayBuffer);
  return { buffer, kind: 'pptx', mime: MIME_BY_KIND.pptx, ext: EXT_BY_KIND.pptx };
};

export default createPptx;
