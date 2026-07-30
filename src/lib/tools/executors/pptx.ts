import 'server-only';

import PptxGenJS from 'pptxgenjs';
import type { ExecutorFn } from './index';
import { parseInline } from '@/lib/documents/markdown';
import { MIME_BY_KIND, EXT_BY_KIND, displayTitle, type SlideSpec } from '../types';

const ACCENT = '2563EB';
const INK = '1A1A16';
const BODY = '3A3A3A';
const MUTED = '8A8A8A';
const BG = 'FFFFFF';

/** Convert one line of inline Markdown into pptx rich-text runs. */
function runs(text: string, base: { fontSize: number; color: string }) {
  return parseInline(text).map((sp) => ({
    text: sp.text,
    options: {
      bold: sp.bold,
      italic: sp.italic,
      strike: sp.strike,
      fontFace: sp.code ? 'Consolas' : 'Arial',
      ...base,
    },
  }));
}

/** Split Markdown content into slides on headings, bullets under each. */
function slidesFromMarkdown(md: string): { deckTitle?: string; slides: SlideSpec[] } {
  const lines = md.split('\n');
  const slides: SlideSpec[] = [];
  let deckTitle: string | undefined;
  let current: SlideSpec | null = null;
  let bodyBuf: string[] = [];

  // Body prose is kept even when the slide also has bullets. The old guard
  // (`!(current.bullets && current.bullets.length)`) discarded it as soon as one
  // bullet was collected, so "Revenue grew 12% YoY." vanished from a slide whose
  // next line happened to be "- APAC +18%".
  const flushBody = () => {
    if (current && bodyBuf.length) current.body = bodyBuf.join('\n').trim();
    bodyBuf = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    // Match all six heading levels; h4-h6 used to fall through to the body
    // branch and render literally as "#### Detail".
    const heading = line.match(/^(#{1,6})\s+(.+)/);
    const level = heading ? heading[1]!.length : 0;
    const bullet = line.match(/^\s*[-*+]\s+(.+)/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)/);

    if (level === 1 && !deckTitle && slides.length === 0 && !current) {
      deckTitle = heading![2]!.trim();
      continue;
    }
    if (level > 0 && level <= 3) {
      flushBody();
      if (current) slides.push(current);
      current = { title: heading![2]!.trim(), bullets: [] };
    } else if (level > 3 && current) {
      // Deeper headings become bullets on the current slide rather than prose.
      current.bullets!.push(heading![2]!.trim());
    } else if (bullet || numbered) {
      // Open an implicit slide rather than dropping content that precedes the
      // first heading.
      if (!current) current = { title: deckTitle ?? '', bullets: [] };
      current.bullets!.push((bullet?.[1] ?? numbered?.[1] ?? '').trim());
    } else if (line.trim()) {
      if (!current) current = { title: deckTitle ?? '', bullets: [] };
      bodyBuf.push(line.trim());
    }
  }
  flushBody();
  if (current) slides.push(current);
  return { deckTitle, slides };
}

const createPptx: ExecutorFn = async (req) => {
  const pptx = new PptxGenJS();
  pptx.author = 'AI Workspace';
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
  const PW = 13.33;
  const PH = 7.5;

  // A master with a thin accent bar and a slide-number placeholder in the
  // footer, applied to every content slide for a consistent look.
  pptx.defineSlideMaster({
    title: 'CONTENT',
    background: { color: BG },
    objects: [
      { rect: { x: 0, y: 0, w: PW, h: 0.12, fill: { color: ACCENT } } },
      { line: { x: 0.8, y: 1.55, w: 5.0, h: 0, line: { color: ACCENT, width: 2 } } },
    ],
    slideNumber: { x: PW - 0.9, y: PH - 0.45, color: MUTED, fontSize: 10, fontFace: 'Arial' },
  });

  let deckTitle = req.title?.trim() || (req.name ? displayTitle(req) : '');
  let slides: SlideSpec[] = req.slides ?? [];

  if (slides.length === 0 && req.content) {
    const parsed = slidesFromMarkdown(req.content);
    slides = parsed.slides;
    if (!deckTitle && parsed.deckTitle) deckTitle = parsed.deckTitle;
  }
  if (!deckTitle) deckTitle = 'Presentation';

  // Cover slide.
  const cover = pptx.addSlide();
  cover.background = { color: BG };
  cover.addShape('rect', { x: 0, y: 0, w: PW, h: 0.25, fill: { color: ACCENT } });
  cover.addShape('rect', { x: 0, y: PH - 0.25, w: PW, h: 0.25, fill: { color: ACCENT } });
  cover.addText(runs(deckTitle, { fontSize: 40, color: INK }), {
    x: 0.9, y: 2.6, w: PW - 1.8, h: 1.6, bold: true, align: 'left', valign: 'middle', fontFace: 'Arial',
  });
  cover.addText(`Generated ${new Date().toLocaleDateString()}`, {
    x: 0.95, y: 4.3, w: PW - 1.8, h: 0.5, fontSize: 14, color: MUTED, italic: true, fontFace: 'Arial',
  });

  if (slides.length === 0) {
    slides.push({ title: 'Overview', body: req.content ?? '' });
  }

  for (const slide of slides) {
    const s = pptx.addSlide({ masterName: 'CONTENT' });
    if (slide.title) {
      s.addText(runs(slide.title, { fontSize: 28, color: INK }), {
        x: 0.8, y: 0.5, w: PW - 1.6, h: 0.9, bold: true, valign: 'middle', fontFace: 'Arial',
      });
    }
    const hasBullets = Boolean(slide.bullets?.length);
    // Render body AND bullets when both exist (body above, bullets below) — the
    // old `else if` dropped the prose entirely.
    if (slide.body) {
      s.addText(runs(slide.body, { fontSize: 16, color: BODY }), {
        x: 0.8,
        y: 1.8,
        w: PW - 1.6,
        h: hasBullets ? 1.1 : PH - 2.6,
        valign: 'top',
        fontFace: 'Arial',
        lineSpacingMultiple: 1.2,
      });
    }
    if (hasBullets) {
      const bulletsY = slide.body ? 3.0 : 1.8;
      s.addText(
        slide.bullets!.flatMap((b) => {
          const r = runs(b, { fontSize: 18, color: BODY });
          // First run of each bullet carries the bullet + paragraph break.
          return r.map((run, j) => ({
            ...run,
            options: {
              ...run.options,
              bullet: j === 0 ? { indent: 18 } : false,
              breakLine: j === r.length - 1,
              paraSpaceAfter: j === r.length - 1 ? 10 : 0,
              indentLevel: 0,
            },
          }));
        }),
        { x: 0.8, y: bulletsY, w: PW - 1.6, h: PH - bulletsY - 0.8, valign: 'top', fontFace: 'Arial' },
      );
    }
  }

  const blob = await pptx.write({ outputType: 'nodebuffer' });
  const buffer = Buffer.isBuffer(blob) ? blob : Buffer.from(blob as ArrayBuffer);
  return { buffer, kind: 'pptx', mime: MIME_BY_KIND.pptx, ext: EXT_BY_KIND.pptx };
};

export default createPptx;
