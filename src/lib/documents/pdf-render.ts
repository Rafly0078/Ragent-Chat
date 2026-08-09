import 'server-only';

import type { Block } from './markdown';
import type { DocTheme } from './theme';
import { css } from './theme';
import { renderHtmlDocument } from './html-doc';
import { BrowserUnavailableError, launchBrowser } from './browser';

/**
 * HTML to PDF via headless Chromium.
 *
 * The cover and the body are two separate print jobs, merged with pdf-lib. See
 * `HtmlDocOptions.part` for why: Chromium ignores CSS margin boxes and takes
 * page numbers from `footerTemplate`, which cannot be suppressed for a single
 * page, so a one-job document would print "Page 1 of 12" across the cover.
 */

export interface PdfRenderOptions {
  title: string;
  blocks: Block[];
  theme: DocTheme;
  cover: boolean;
  /** Small print on the left of every footer. */
  footerNote?: string;
}

/** Chromium hard-caps a print job; a runaway document should fail loudly, not hang the function. */
const NAV_TIMEOUT_MS = 20_000;
const PDF_TIMEOUT_MS = 45_000;

function footerTemplate(theme: DocTheme, note: string): string {
  // Chromium renders header/footer templates in a separate document with its own
  // (tiny) default font size and NO access to the page's stylesheet, so every
  // rule has to be inline and the size stated explicitly.
  return `<div style="width:100%;font-size:8px;font-family:Helvetica,Arial,sans-serif;color:${css(
    theme.muted,
  )};padding:0 14mm;display:flex;justify-content:space-between;align-items:center;">
<span>${escapeAttr(note)}</span>
<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
</div>`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(0, 120);
}

/** An empty header, or Chromium prints its own default (the document title and URL). */
const EMPTY_TEMPLATE = '<div></div>';

export async function renderPdf(opts: PdfRenderOptions): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT_MS);

    // Local-only rendering: the document is model-authored, so a stray
    // <img src="http://…"> or a webfont @import must not turn a PDF job into an
    // outbound request from our server. Everything the template needs (icons,
    // colours) is inline.
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (url.startsWith('data:') || url.startsWith('about:')) void req.continue();
      else void req.abort();
    });

    const body = await printOne(page, {
      html: renderHtmlDocument({ ...opts, part: 'body' }),
      footer: footerTemplate(opts.theme, opts.footerNote ?? opts.title),
      margin: { top: '22mm', bottom: '20mm', left: '18mm', right: '18mm' },
    });

    if (!opts.cover) return body;

    const cover = await printOne(page, {
      html: renderHtmlDocument({ ...opts, part: 'cover' }),
      footer: EMPTY_TEMPLATE,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });

    return await concat(cover, body);
  } finally {
    // A leaked browser process pins a whole container's memory until the
    // sandbox is reaped, so this close is not optional.
    await browser.close().catch(() => {});
  }
}

interface PrintJob {
  html: string;
  footer: string;
  margin: { top: string; bottom: string; left: string; right: string };
}

async function printOne(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof launchBrowser>>['newPage']>>,
  job: PrintJob,
): Promise<Buffer> {
  // `domcontentloaded`, not `networkidle0`: every external request is aborted
  // above, and waiting for network idle on a page that will never make a request
  // just burns the timeout.
  await page.setContent(job.html, { waitUntil: 'domcontentloaded' });
  const bytes = await page.pdf({
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: EMPTY_TEMPLATE,
    footerTemplate: job.footer,
    margin: job.margin,
    timeout: PDF_TIMEOUT_MS,
  });
  return Buffer.from(bytes);
}

/** Merge the cover in front of the body. */
async function concat(cover: Buffer, body: Buffer): Promise<Buffer> {
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  for (const part of [cover, body]) {
    const src = await PDFDocument.load(part);
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) out.addPage(p);
  }
  return Buffer.from(await out.save());
}

export { BrowserUnavailableError };
