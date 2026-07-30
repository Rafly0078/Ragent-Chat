import 'server-only';

import type { ExecutorFn } from './index';
import { MIME_BY_KIND, EXT_BY_KIND, displayTitle } from '../types';

/**
 * create_html — persist the model's HTML as a standalone .html file.
 *
 * The model may hand us either a complete document (with <html>/<!doctype>) or
 * a bare body fragment. A fragment is wrapped in a minimal, valid HTML5 shell
 * so the downloaded/previewed file always opens correctly on its own.
 */
const createHtml: ExecutorFn = async (req) => {
  const raw = (req.content ?? '').trim();
  const isFullDocument = /<\s*html[\s>]/i.test(raw) || /<!doctype/i.test(raw);

  const title = displayTitle(req);
  // A full document that omits <meta charset> is UTF-8 on disk but decoded as
  // windows-1252 when opened over file:// — "Ringkasan — Q3" renders as "â€”".
  // The wrapped-fragment branch already declares it; do the same here.
  const withCharset = /<meta[^>]+charset/i.test(raw)
    ? raw
    : /<head[^>]*>/i.test(raw)
      ? raw.replace(/<head[^>]*>/i, (m) => `${m}\n<meta charset="utf-8" />`)
      : `﻿${raw}`; // no <head> to inject into — a BOM still pins the encoding
  const html = isFullDocument
    ? withCharset
    : `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
</head>
<body>
${raw}
</body>
</html>`;

  const buffer = Buffer.from(html, 'utf-8');
  return {
    buffer,
    kind: 'html',
    mime: MIME_BY_KIND.html,
    ext: EXT_BY_KIND.html,
  };
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default createHtml;
