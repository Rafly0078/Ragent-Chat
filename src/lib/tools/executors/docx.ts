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
  WidthType,
  BorderStyle,
  LevelFormat,
  ShadingType,
  convertInchesToTwip,
  type IRunOptions,
} from 'docx';
import type { ExecutorFn } from './index';
import { parseInline, parseMarkdown, type Block, type Span } from '@/lib/documents/markdown';
import { MIME_BY_KIND, EXT_BY_KIND, displayTitle } from '../types';

const ACCENT = '2563EB';
const INK = '1A1A16';
const MUTED = '6B7280';
const CODE_FILL = 'F3F4F6';
const CODE_INK = '1F2937';
const BORDER = 'D1D5DB';

/** Convert a styled span into docx TextRun children (hyperlink-wrapped if needed). */
function spanToRuns(sp: Span): (TextRun | ExternalHyperlink)[] {
  const base: IRunOptions = {
    text: sp.text,
    bold: sp.bold,
    italics: sp.italic,
    strike: sp.strike,
    ...(sp.code
      ? {
          font: 'Consolas',
          color: CODE_INK,
          shading: { type: ShadingType.CLEAR, fill: CODE_FILL, color: 'auto' },
        }
      : {}),
  };
  if (sp.href) {
    return [
      new ExternalHyperlink({
        link: sp.href,
        children: [new TextRun({ ...base, style: 'Hyperlink', color: ACCENT })],
      }),
    ];
  }
  return [new TextRun(base)];
}

function inlineRuns(text: string): (TextRun | ExternalHyperlink)[] {
  return parseInline(text).flatMap(spanToRuns);
}

function blockToDocx(b: Block): (Paragraph | Table)[] {
  switch (b.type) {
    case 'heading': {
      const level =
        b.level === 1 ? HeadingLevel.HEADING_1 :
        b.level === 2 ? HeadingLevel.HEADING_2 :
        b.level === 3 ? HeadingLevel.HEADING_3 :
        b.level === 4 ? HeadingLevel.HEADING_4 :
        b.level === 5 ? HeadingLevel.HEADING_5 :
        HeadingLevel.HEADING_6;
      return [new Paragraph({ heading: level, children: inlineRuns(b.text), spacing: { before: 240, after: 120 } })];
    }
    case 'paragraph':
      return [new Paragraph({ children: inlineRuns(b.text), spacing: { after: 160, line: 276 } })];
    case 'list':
      return b.items.map(
        (item) =>
          new Paragraph({
            children: inlineRuns(item),
            numbering: b.ordered
              ? { reference: 'ordered-list', level: 0 }
              : { reference: 'bullet-list', level: 0 },
            spacing: { after: 60 },
          }),
      );
    case 'quote':
      return [
        new Paragraph({
          children: parseInline(b.text).flatMap((s) => spanToRuns({ ...s, italic: true })),
          indent: { left: convertInchesToTwip(0.4) },
          border: { left: { style: BorderStyle.SINGLE, size: 18, color: BORDER, space: 12 } },
          spacing: { after: 160, before: 40 },
        }),
      ];
    case 'code':
      return b.text.split('\n').map(
        (line, i, arr) =>
          new Paragraph({
            children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 18, color: CODE_INK })],
            shading: { type: ShadingType.CLEAR, fill: CODE_FILL, color: 'auto' },
            spacing: { after: i === arr.length - 1 ? 160 : 0, before: i === 0 ? 80 : 0 },
          }),
      );
    case 'hr':
      return [
        new Paragraph({
          children: [],
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BORDER } },
          spacing: { after: 200, before: 200 },
        }),
      ];
    case 'table': {
      const alignFor = (ci: number) =>
        b.align?.[ci] === 'right' ? AlignmentType.RIGHT :
        b.align?.[ci] === 'center' ? AlignmentType.CENTER :
        AlignmentType.LEFT;
      const headerRow = new TableRow({
        tableHeader: true,
        children: b.header.map(
          (h, ci) =>
            new TableCell({
              children: [new Paragraph({ alignment: alignFor(ci), children: parseInline(h).flatMap((s) => spanToRuns({ ...s, bold: true })) })],
              shading: { type: ShadingType.CLEAR, fill: 'EEF1F5', color: 'auto' },
              margins: { top: 60, bottom: 60, left: 100, right: 100 },
            }),
        ),
      });
      const dataRows = b.rows.map(
        (row, ri) =>
          new TableRow({
            children: Array.from({ length: b.header.length }, (_, ci) => row[ci] ?? '').map(
              (cell, ci) =>
                new TableCell({
                  children: [new Paragraph({ alignment: alignFor(ci), children: inlineRuns(cell) })],
                  shading: ri % 2 === 1 ? { type: ShadingType.CLEAR, fill: 'F9FAFB', color: 'auto' } : undefined,
                  margins: { top: 60, bottom: 60, left: 100, right: 100 },
                }),
            ),
          }),
      );
      const edge = { style: BorderStyle.SINGLE, size: 4, color: BORDER };
      return [
        new Table({
          rows: [headerRow, ...dataRows],
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: { top: edge, bottom: edge, left: edge, right: edge, insideHorizontal: edge, insideVertical: edge },
        }),
        new Paragraph({ children: [], spacing: { after: 160 } }),
      ];
    }
    default:
      return [];
  }
}

const createDocx: ExecutorFn = async (req) => {
  const blocks = parseMarkdown(req.content ?? '');
  const title = displayTitle(req);

  const doc = new Document({
    creator: 'AI Workspace',
    title,
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22, color: INK } },
      },
    },
    numbering: {
      config: [
        {
          reference: 'ordered-list',
          levels: [
            { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 360, hanging: 260 } } } },
          ],
        },
        {
          reference: 'bullet-list',
          levels: [
            { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 360, hanging: 260 } } } },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: title })] }),
          new Paragraph({
            children: [new TextRun({ text: `Generated ${new Date().toLocaleDateString()}`, color: MUTED, size: 20, italics: true })],
            spacing: { after: 360 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BORDER, space: 8 } },
          }),
          ...blocks.flatMap(blockToDocx),
        ],
      },
    ],
  });

  const buffer = Buffer.from(await Packer.toBuffer(doc));
  return { buffer, kind: 'docx', mime: MIME_BY_KIND.docx, ext: EXT_BY_KIND.docx };
};

export default createDocx;
