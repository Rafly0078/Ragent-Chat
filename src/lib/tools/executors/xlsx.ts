import 'server-only';

import ExcelJS from 'exceljs';
import type { ExecutorFn } from './index';
import { MIME_BY_KIND, EXT_BY_KIND, type SheetSpec } from '../types';

type Cell = string | number | boolean | null;

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F2937' },
};
const THIN: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
  left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
  bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
  right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
};

/**
 * Coerce model-produced string cells to real numbers so Excel can sum/sort
 * them. A cell like "1,234.5" or "42%" arrives as a string; leaving it as text
 * is the most common reason a generated sheet "looks right but won't add up".
 *
 * Identifier-shaped values are left alone: coercing them was silent, unrecoverable
 * data corruption — a SKU "00123" became 123, a zip "07030" became 7030, and an
 * order id longer than 15 digits was rounded by float64.
 */
function coerce(value: Cell): Cell {
  if (typeof value !== 'string') return value;
  const s = value.trim();
  if (s === '') return '';
  const pct = /%$/.test(s);
  const num = s.replace(/[,$€£\s]/g, '').replace(/%$/, '');
  if (/^0\d/.test(num)) return value; // leading zero → identifier, not a quantity
  if (num.replace(/[-.]/g, '').length > 15) return value; // beyond float64 precision
  if (/^-?\d+(\.\d+)?$/.test(num)) {
    const n = Number(num);
    return pct ? n / 100 : n;
  }
  return value;
}

function fillSheet(ws: ExcelJS.Worksheet, rows: Cell[][]): void {
  if (rows.length === 0) return;
  // reduce, not `Math.max(...spread)`: one argument per row overflows the call
  // stack (RangeError) somewhere north of ~100k rows.
  const width = rows.reduce((max, r) => Math.max(max, r.length), 0);
  if (width === 0) return;
  /** Per data column: how many numeric cells, and how many of those were "42%". */
  const numericByCol = new Map<number, number>();
  const pctByCol = new Map<number, number>();

  rows.forEach((row, ri) => {
    const cells = Array.from({ length: width }, (_, ci) => {
      const raw = row[ci] ?? null;
      if (ri === 0) return raw; // header stays as-is (labels)
      const c = coerce(raw);
      if (typeof c === 'number') {
        const col = ci + 1;
        numericByCol.set(col, (numericByCol.get(col) ?? 0) + 1);
        if (typeof raw === 'string' && /%$/.test(raw.trim())) {
          pctByCol.set(col, (pctByCol.get(col) ?? 0) + 1);
        }
      }
      return c;
    });
    const added = ws.addRow(cells);
    added.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = THIN;
      cell.alignment = { vertical: 'top', wrapText: true };
      if (typeof cell.value === 'number') cell.alignment = { ...cell.alignment, horizontal: 'right' };
    });
  });

  // Header styling.
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = HEADER_FILL;
  header.alignment = { vertical: 'middle', wrapText: true };
  header.height = 20;

  // Percent format only when EVERY numeric cell in the column was a percentage.
  // A mixed "Growth" column ("12%" in one row, a raw count of 20 in another)
  // used to render the 20 as 2000.0%.
  pctByCol.forEach((pctCount, col) => {
    if (pctCount === numericByCol.get(col)) ws.getColumn(col).numFmt = '0.0%';
  });

  // Freeze the header row and enable an autofilter over the data extent.
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length, column: width } };

  // Auto-size columns from content length (capped so one long cell can't blow
  // the layout out).
  for (let col = 1; col <= width; col++) {
    let max = 10;
    ws.getColumn(col).eachCell({ includeEmpty: false }, (cell) => {
      const len = String(cell.value ?? '').length;
      if (len > max) max = len;
    });
    ws.getColumn(col).width = Math.min(max + 2, 48);
  }
}

const createXlsx: ExecutorFn = async (req) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AI Workspace';
  workbook.created = new Date();

  const sheets: SheetSpec[] = req.sheets ?? [];
  if (sheets.length > 0) {
    // Sheet names must be unique in the OOXML package — exceljs doesn't check,
    // so two sheets called "Data" produced a workbook Excel offers to "repair".
    const used = new Set<string>();
    sheets.forEach((spec, i) => {
      const cleaned = (spec.name || `Sheet ${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim();
      let name = cleaned || `Sheet ${i + 1}`;
      const base = name.slice(0, 27);
      let n = 2;
      while (used.has(name.toLowerCase())) name = `${base} (${n++})`;
      used.add(name.toLowerCase());
      fillSheet(workbook.addWorksheet(name), Array.isArray(spec.rows) ? spec.rows : []);
    });
  } else if ((req.rows ?? []).length > 0) {
    fillSheet(workbook.addWorksheet('Sheet 1'), req.rows!);
  } else {
    workbook.addWorksheet('Sheet 1');
  }

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { buffer, kind: 'xlsx', mime: MIME_BY_KIND.xlsx, ext: EXT_BY_KIND.xlsx };
};

export default createXlsx;
