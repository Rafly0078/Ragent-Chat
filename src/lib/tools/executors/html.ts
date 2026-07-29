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
  const html = isFullDocument
    ? raw
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
