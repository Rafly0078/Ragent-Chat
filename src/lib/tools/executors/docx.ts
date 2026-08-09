import 'server-only';

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ExternalHyperlink,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  TableBorders,
  WidthType,
  BorderStyle,
  LevelFormat,
  ShadingType,
  Header,
  Footer,
  PageBreak,
  PageNumber,
  Bookmark,
  InternalHyperlink,
  SectionType,
  TabStopType,
  HeightRule,
  VerticalAlign,
  convertInchesToTwip,
  type IRunOptions,
} from 'docx';
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
  shouldUseCover,
  CALLOUT_PALETTE,
  CALLOUT_TITLES,
  type DocTheme,
} from '@/lib/documents/theme';
import { MIME_BY_KIND, EXT_BY_KIND, displayTitle } from '../types';

/**
 * create_docx — a themed Word document.
 *
 * Word is not a browser, so the PDF renderer's tricks do not transfer: there is
 * no gradient fill and no `@page` for a full-bleed cover. What Word *does* have
 * is real sections, so the cover is its own zero-margin section holding one
 * page-sized shaded table cell, and the body is a second section that restarts
 * page numbering at 1. Callouts are single-cell tables with a thick left border
 * — the same shape the HTML renderer draws with CSS, in the only primitive Word
 * offers that survives a page break.
 */

/** A4 in twips (1/1440 inch). Word's default is US Letter, which would not match the PDF. */
const PAGE_W = 11906;
const PAGE_H = 16838;
const BODY_MARGIN = convertInchesToTwip(1);
const BODY_WIDTH = PAGE_W - 2 * BODY_MARGIN;

/**
 * Cover cell height, a hair under the full page.
 *
 * `HeightRule.EXACT` at exactly `PAGE_H` rounds over the printable area in some
 * Word builds and spills an empty second page, which is a worse artefact than
 * the ~1.5mm white sliver this leaves at the foot.
 */
const COVER_CELL_H = PAGE_H - 80;

/** Convert a styled span into docx TextRun children (hyperlink-wrapped if needed). */
function spanToRuns(
  sp: Span,
  t: DocTheme,
  extra?: Partial<IRunOptions>,
): (TextRun | ExternalHyperlink)[] {
  const base: IRunOptions = {
    text: sp.text,
    bold: sp.bold,
    italics: sp.italic,
    strike: sp.strike,
    ...extra,
    // `shading`, not the `highlight` run property: that one only accepts ~15
    // named values (`yellow`, `cyan`, …), so a themed marker colour cannot be
    // expressed through it at all.
    ...(sp.highlight
      ? { shading: { type: ShadingType.CLEAR, fill: t.highlightFill, color: 'auto' } }
      : {}),
    ...(sp.code
      ? {
          font: t.officeMono,
          color: t.codeInk,
          shading: { type: ShadingType.CLEAR, fill: t.codeFill, color: 'auto' },
        }
      : {}),
  };
  if (sp.href) {
    return [
      new ExternalHyperlink({
        link: sp.href,
        children: [new TextRun({ ...base, style: 'Hyperlink', color: t.accentDark })],
      }),
    ];
  }
  return [new TextRun(base)];
}

function inlineRuns(text: string, t: DocTheme): (TextRun | ExternalHyperlink)[] {
  return parseInline(text).flatMap((s) => spanToRuns(s, t));
}

/**
 * Bookmark ids for the headings the contents list links to.
 *
 * A `TableOfContents` field would give real page numbers, but it renders as
 * "Right-click to update field" until Word recalculates it, and LibreOffice and
 * Google Docs frequently show it empty. A plain list of internal hyperlinks has
 * no page numbers and always works, which is the better trade for a file that
 * will be opened in an unknown viewer.
 */
const TOC_MAX_LEVEL = 2;
const TOC_MIN_ENTRIES = 3;

function tocTargets(blocks: Block[]): Map<Block, string> {
  const out = new Map<Block, string>();
  blocks.forEach((b, i) => {
    if (b.type === 'heading' && b.level <= TOC_MAX_LEVEL) out.set(b, `h${i}`);
  });
  return out.size >= TOC_MIN_ENTRIES ? out : new Map();
}

function tocSection(blocks: Block[], targets: Map<Block, string>, t: DocTheme): Paragraph[] {
  const entries = blocks.filter((b) => targets.has(b));
  return [
    new Paragraph({
      children: [
        new TextRun({
          text: 'Contents',
          bold: true,
          size: 28,
          font: t.officeHeading,
          color: t.ink,
        }),
      ],
      spacing: { after: 180 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: t.accent, space: 6 } },
    }),
    ...entries.map((b) => {
      const heading = b as Extract<Block, { type: 'heading' }>;
      return new Paragraph({
        indent: { left: heading.level === 1 ? 0 : convertInchesToTwip(0.28) },
        spacing: { after: 70 },
        children: [
          new InternalHyperlink({
            anchor: targets.get(b)!,
            children: [
              new TextRun({
                text: stripInline(heading.text),
                color: heading.level === 1 ? t.accentDark : t.ink,
                bold: heading.level === 1,
                size: 21,
              }),
            ],
          }),
        ],
      });
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

function blockToDocx(b: Block, t: DocTheme, targets?: Map<Block, string>): (Paragraph | Table)[] {
  switch (b.type) {
    case 'heading': {
      const level =
        b.level === 1
          ? HeadingLevel.HEADING_1
          : b.level === 2
            ? HeadingLevel.HEADING_2
            : b.level === 3
              ? HeadingLevel.HEADING_3
              : b.level === 4
                ? HeadingLevel.HEADING_4
                : b.level === 5
                  ? HeadingLevel.HEADING_5
                  : HeadingLevel.HEADING_6;
      const anchor = targets?.get(b);
      const runs = inlineRuns(b.text, t);
      return [
        new Paragraph({
          heading: level,
          // Only bookmarked when the contents list actually links here — an
          // unreferenced bookmark on every heading is dead weight in the XML.
          children: anchor ? [new Bookmark({ id: anchor, children: runs })] : runs,
          spacing: { before: 240, after: 120 },
          ...(b.level === 2
            ? {
                border: {
                  bottom: { style: BorderStyle.SINGLE, size: 4, color: t.border, space: 6 },
                },
              }
            : {}),
        }),
      ];
    }
    case 'paragraph':
      return [
        new Paragraph({ children: inlineRuns(b.text, t), spacing: { after: 160, line: 276 } }),
      ];
    case 'list':
      return b.items.map(
        (item) =>
          new Paragraph({
            children: inlineRuns(item, t),
            numbering: b.ordered
              ? { reference: 'ordered-list', level: 0 }
              : { reference: 'bullet-list', level: 0 },
            spacing: { after: 60 },
          }),
      );
    case 'quote':
      return [
        new Paragraph({
          children: parseInline(b.text).flatMap((s) =>
            spanToRuns(s, t, { italics: true, color: t.muted }),
          ),
          indent: { left: convertInchesToTwip(0.4) },
          border: { left: { style: BorderStyle.SINGLE, size: 18, color: t.accentSoft, space: 12 } },
          spacing: { after: 160, before: 40 },
        }),
      ];
    case 'code':
      return b.text.split('\n').map(
        (line, i, arr) =>
          new Paragraph({
            children: [
              new TextRun({ text: line || ' ', font: t.officeMono, size: 18, color: t.codeInk }),
            ],
            shading: { type: ShadingType.CLEAR, fill: t.codeFill, color: 'auto' },
            border: {
              left: { style: BorderStyle.SINGLE, size: 12, color: t.accent, space: 6 },
            },
            spacing: { after: i === arr.length - 1 ? 160 : 0, before: i === 0 ? 80 : 0 },
          }),
      );
    case 'hr':
      return [
        new Paragraph({
          children: [],
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: t.border } },
          spacing: { after: 200, before: 200 },
        }),
      ];
    case 'pagebreak':
      return [new Paragraph({ children: [new PageBreak()] })];
    case 'callout': {
      const c = CALLOUT_PALETTE[b.variant];
      const label = b.title ?? CALLOUT_TITLES[b.variant];
      // One cell, thick coloured left edge. A floating shape or a text box would
      // look closer to the CSS version but neither reflows across a page break,
      // and a callout that silently loses its tail is worse than a plain box.
      return [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: TableBorders.NONE,
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  shading: { type: ShadingType.CLEAR, fill: c.fill, color: 'auto' },
                  borders: {
                    left: { style: BorderStyle.SINGLE, size: 18, color: c.line },
                    top: { style: BorderStyle.NIL, size: 0, color: c.fill },
                    bottom: { style: BorderStyle.NIL, size: 0, color: c.fill },
                    right: { style: BorderStyle.NIL, size: 0, color: c.fill },
                  },
                  margins: { top: 120, bottom: 60, left: 180, right: 160 },
                  children: [
                    new Paragraph({
                      children: [new TextRun({ text: label, bold: true, color: c.ink, size: 19 })],
                      spacing: { after: 80 },
                    }),
                    ...b.blocks.flatMap((inner) => blockToDocx(inner, t)),
                  ],
                }),
              ],
            }),
          ],
        }),
        new Paragraph({ children: [], spacing: { after: 140 } }),
      ];
    }
    case 'table': {
      const alignFor = (ci: number) =>
        b.align?.[ci] === 'right'
          ? AlignmentType.RIGHT
          : b.align?.[ci] === 'center'
            ? AlignmentType.CENTER
            : AlignmentType.LEFT;
      // Widen to the longest row instead of clipping to the header. A table whose
      // data rows carry more cells than the header (common when the model forgets
      // a header column) silently lost the extras here, while the PDF executor
      // kept them — so PDF and DOCX exports of the same markdown disagreed.
      const cols = b.rows.reduce((max, r) => Math.max(max, r.length), b.header.length);
      const headerRow = new TableRow({
        tableHeader: true,
        children: Array.from({ length: cols }, (_, ci) => b.header[ci] ?? '').map(
          (h, ci) =>
            new TableCell({
              children: [
                new Paragraph({
                  alignment: alignFor(ci),
                  children: parseInline(h).flatMap((s) =>
                    spanToRuns(s, t, { bold: true, color: t.accentFg }),
                  ),
                }),
              ],
              shading: { type: ShadingType.CLEAR, fill: t.accent, color: 'auto' },
              margins: { top: 60, bottom: 60, left: 100, right: 100 },
            }),
        ),
      });
      const dataRows = b.rows.map(
        (row, ri) =>
          new TableRow({
            children: Array.from({ length: cols }, (_, ci) => row[ci] ?? '').map(
              (cell, ci) =>
                new TableCell({
                  children: [
                    new Paragraph({ alignment: alignFor(ci), children: inlineRuns(cell, t) }),
                  ],
                  shading:
                    ri % 2 === 1
                      ? { type: ShadingType.CLEAR, fill: t.accentSoft, color: 'auto' }
                      : undefined,
                  margins: { top: 60, bottom: 60, left: 100, right: 100 },
                }),
            ),
          }),
      );
      const edge = { style: BorderStyle.SINGLE, size: 4, color: t.border };
      return [
        new Table({
          rows: [headerRow, ...dataRows],
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: edge,
            bottom: edge,
            left: edge,
            right: edge,
            insideHorizontal: edge,
            insideVertical: edge,
          },
        }),
        new Paragraph({ children: [], spacing: { after: 160 } }),
      ];
    }
    default:
      return [];
  }
}

/**
 * The cover: one page-tall table cell filled with the accent.
 *
 * Word has no gradient fill reachable through this library and no `@page`
 * background, so the PDF's full-bleed art degrades to a flat brand-coloured
 * page. That is the honest limit of the format, not a shortcut — a shaded
 * paragraph would only cover the text it holds and leave three-quarters of the
 * sheet white.
 */
function coverSection(title: string, t: DocTheme): (Paragraph | Table)[] {
  const line = (text: string, opts: { size: number; bold?: boolean; spacing?: number }) =>
    new Paragraph({
      children: [
        new TextRun({
          text,
          bold: opts.bold,
          size: opts.size,
          color: t.accentFg,
          font: t.officeHeading,
        }),
      ],
      spacing: { after: opts.spacing ?? 0 },
    });

  return [
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TableBorders.NONE,
      rows: [
        new TableRow({
          height: { value: COVER_CELL_H, rule: HeightRule.EXACT },
          children: [
            new TableCell({
              shading: { type: ShadingType.CLEAR, fill: t.accentDark, color: 'auto' },
              borders: TableBorders.NONE,
              verticalAlign: VerticalAlign.BOTTOM,
              margins: { top: 0, bottom: 2200, left: 1200, right: 1200 },
              children: [
                // Stands in for the CSS `.cover-rule` bar above the title.
                new Paragraph({
                  children: [
                    new TextRun({ text: '▬▬▬▬▬', size: 28, color: t.accentFg, bold: true }),
                  ],
                  spacing: { after: 400 },
                }),
                line(title, { size: 64, bold: true, spacing: t.subtitle ? 260 : 500 }),
                ...(t.subtitle ? [line(t.subtitle, { size: 26, spacing: 500 })] : []),
                ...(t.author ? [line(t.author.toUpperCase(), { size: 19 })] : []),
              ],
            }),
          ],
        }),
      ],
    }),
  ];
}

const createDocx: ExecutorFn = async (req) => {
  const blocks = parseMarkdown(req.content ?? '');
  const theme = resolveTheme(req.theme);
  const title = displayTitle(req);
  const cover = shouldUseCover(theme, blocks.length);
  const targets = tocTargets(blocks);

  const footer = new Footer({
    children: [
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: BODY_WIDTH }],
        children: [
          new TextRun({ text: title.slice(0, 90), size: 16, color: theme.muted }),
          new TextRun({ text: '\t', size: 16 }),
          new TextRun({ text: 'Page ', size: 16, color: theme.muted }),
          new TextRun({ children: [PageNumber.CURRENT], size: 16, color: theme.muted }),
          new TextRun({ text: ' of ', size: 16, color: theme.muted }),
          // SECTIONPAGES, not NUMPAGES, when there is a cover: the cover is its
          // own section, so counting the whole document would print "Page 1 of 9"
          // on the first page of an eight-page body.
          new TextRun({
            children: [cover ? PageNumber.TOTAL_PAGES_IN_SECTION : PageNumber.TOTAL_PAGES],
            size: 16,
            color: theme.muted,
          }),
        ],
      }),
    ],
  });

  const bodyChildren: (Paragraph | Table)[] = [
    // Without a cover the document still needs a title block; with one it would
    // be the same words twice on consecutive pages.
    ...(cover
      ? []
      : [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            children: [new TextRun({ text: title, font: theme.officeHeading })],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: `Generated ${new Date().toLocaleDateString()}`,
                color: theme.muted,
                size: 20,
                italics: true,
              }),
            ],
            spacing: { after: 360 },
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 6, color: theme.accent, space: 8 },
            },
          }),
        ]),
    ...(targets.size ? tocSection(blocks, targets, theme) : []),
    ...blocks.flatMap((b) => blockToDocx(b, theme, targets)),
  ];

  const doc = new Document({
    creator: 'AI Workspace',
    title,
    ...(theme.subtitle ? { description: theme.subtitle } : {}),
    styles: {
      default: {
        document: { run: { font: theme.officeBody, size: 22, color: theme.ink } },
        title: {
          run: { font: theme.officeHeading, size: 52, bold: true, color: theme.ink },
        },
        heading1: {
          run: { font: theme.officeHeading, size: 34, bold: true, color: theme.accentDark },
        },
        heading2: { run: { font: theme.officeHeading, size: 27, bold: true, color: theme.ink } },
        heading3: {
          run: { font: theme.officeHeading, size: 23, bold: true, color: theme.accentDark },
        },
        heading4: { run: { font: theme.officeHeading, size: 22, bold: true, color: theme.ink } },
        heading5: { run: { font: theme.officeHeading, size: 21, bold: true, color: theme.muted } },
        heading6: { run: { font: theme.officeHeading, size: 20, bold: true, color: theme.muted } },
      },
    },
    numbering: {
      config: [
        {
          reference: 'ordered-list',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 360, hanging: 260 } } },
            },
          ],
        },
        {
          reference: 'bullet-list',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 360, hanging: 260 } } },
            },
          ],
        },
      ],
    },
    sections: [
      // The cover is its own section so it can be edge-to-edge and unnumbered
      // while the body keeps normal margins and restarts at page 1.
      ...(cover
        ? [
            {
              properties: {
                page: {
                  size: { width: PAGE_W, height: PAGE_H },
                  margin: { top: 0, right: 0, bottom: 0, left: 0, header: 0, footer: 0 },
                },
              },
              children: coverSection(title, theme),
            },
          ]
        : []),
      {
        properties: {
          type: SectionType.NEXT_PAGE,
          page: {
            size: { width: PAGE_W, height: PAGE_H },
            margin: {
              top: BODY_MARGIN,
              right: BODY_MARGIN,
              bottom: BODY_MARGIN,
              left: BODY_MARGIN,
            },
            ...(cover ? { pageNumbers: { start: 1 } } : {}),
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ text: title.slice(0, 90), size: 16, color: theme.muted })],
                border: {
                  bottom: { style: BorderStyle.SINGLE, size: 4, color: theme.border, space: 4 },
                },
              }),
            ],
          }),
        },
        footers: { default: footer },
        children: bodyChildren,
      },
    ],
  });

  const buffer = Buffer.from(await Packer.toBuffer(doc));
  return { buffer, kind: 'docx', mime: MIME_BY_KIND.docx, ext: EXT_BY_KIND.docx };
};

export default createDocx;
