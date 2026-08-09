import 'server-only';

import type { ExecutorFn } from './index';
import { parseMarkdown } from '@/lib/documents/markdown';
import { resolveTheme, shouldUseCover } from '@/lib/documents/theme';
import { renderPdf, BrowserUnavailableError } from '@/lib/documents/pdf-render';
import { MIME_BY_KIND, EXT_BY_KIND, displayTitle } from '../types';

/**
 * create_pdf — themed HTML printed by headless Chromium.
 *
 * The pdf-lib renderer that used to live here still exists as `./pdf-legacy`
 * and runs when no browser can be launched (a missing local Chrome, a Lambda
 * layer that failed to unpack). It produces a plainer document and cannot
 * render non-Latin-1 text at all, so it is a fallback and never the target:
 * the failure is logged loudly rather than silently downgrading quality.
 */

const createPdf: ExecutorFn = async (req, ctx) => {
  const blocks = parseMarkdown(req.content ?? '');
  const theme = resolveTheme(req.theme);
  const title = displayTitle(req);

  try {
    const buffer = await renderPdf({
      title,
      blocks,
      theme,
      cover: shouldUseCover(theme, blocks.length),
      footerNote: title,
    });
    return { buffer, kind: 'pdf', mime: MIME_BY_KIND.pdf, ext: EXT_BY_KIND.pdf };
  } catch (err) {
    if (!(err instanceof BrowserUnavailableError)) throw err;
    // Visible on purpose. A silent fallback means the deployment renders every
    // PDF with the degraded engine for weeks and nobody notices until a
    // document with CJK text throws.
    console.error('[create_pdf] Chromium unavailable, using pdf-lib fallback:', err.message);
    const legacy = (await import('./pdf-legacy')).default;
    return legacy(req, ctx);
  }
};

export default createPdf;
