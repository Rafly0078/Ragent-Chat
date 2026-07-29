import 'server-only';

import type { ExecutorFn } from './index';
import { MIME_BY_KIND, EXT_BY_KIND } from '../types';
import { parseCsvBody } from '../detect';

/** Characters that make Excel/LibreOffice/Sheets evaluate a cell as a formula. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function escapeCsvField(val: string | number | boolean | null): string {
  if (val === null || val === undefined) return '';
  let s = String(val);
  // CSV injection: quoting does NOT stop a spreadsheet from evaluating the cell —
  // quotes are a transport construct that the parser strips before evaluation, so
  // `"=cmd|' /C calc'!A0"` still fires. Neutralize by prefixing an apostrophe,
  // which spreadsheets treat as "the rest is literal text".
  if (FORMULA_LEAD.test(s)) s = `'${s}`;
  // RFC 4180: quote fields containing comma, quote, or CR/LF; double embedded quotes.
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const createCsv: ExecutorFn = async (req) => {
  // `rows` is only populated for the header+body directive shape. Models that
  // emit the legacy JSON shape put the whole CSV in `content`, which used to be
  // ignored — producing a "successful" download containing just the BOM.
  const rows = req.rows?.length ? req.rows : parseCsvBody(req.content ?? '');
  // RFC 4180 uses CRLF row terminators; a UTF-8 BOM makes Excel read accented
  // text correctly instead of mangling it as Latin-1.
  const body = rows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n');
  const buffer = Buffer.from(`﻿${body}`, 'utf-8');
  return { buffer, kind: 'csv', mime: MIME_BY_KIND.csv, ext: EXT_BY_KIND.csv };
};

export default createCsv;
