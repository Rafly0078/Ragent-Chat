import 'server-only';

import { parseInline, type Block, type CalloutVariant, type Span } from './markdown';
import { css, CALLOUT_PALETTE, CALLOUT_TITLES, type DocTheme } from './theme';

/**
 * Markdown blocks to a themed, print-ready HTML document.
 *
 * This is the layout engine for the PDF path: instead of hand-drawing boxes with
 * pdf-lib, the document is expressed as HTML + CSS Paged Media (`@page`, running
 * headers, `counter(pages)`) and handed to headless Chromium's print-to-PDF.
 * That is what buys the things pdf-lib could not do at any reasonable cost — a
 * full-bleed gradient cover, coloured callouts, per-page footers with a real
 * total page count, and non-Latin text.
 *
 * Everything interpolated here is escaped. The model supplies both the content
 * and the palette, and the output is loaded into a real browser, so an
 * unescaped `</style>` inside a heading would be script injection into our own
 * renderer process.
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Only `http(s)` and `mailto` survive as clickable links.
 * `javascript:` in an href would execute inside the rendering browser, and a
 * `file:` URL would let a generated document probe the container's disk.
 */
function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (!/^(https?:|mailto:)/i.test(trimmed)) return null;
  return escapeHtml(trimmed);
}

function spanToHtml(sp: Span): string {
  let html = escapeHtml(sp.text);
  if (sp.code) html = `<code>${html}</code>`;
  if (sp.bold) html = `<strong>${html}</strong>`;
  if (sp.italic) html = `<em>${html}</em>`;
  if (sp.strike) html = `<s>${html}</s>`;
  if (sp.highlight) html = `<mark>${html}</mark>`;
  if (sp.href) {
    const href = safeHref(sp.href);
    // A rejected scheme keeps the label and drops the link, rather than losing
    // the text along with it.
    if (href) html = `<a href="${href}">${html}</a>`;
  }
  return html;
}

/** Render one line of inline Markdown. */
export function inlineHtml(text: string): string {
  return parseInline(text).map(spanToHtml).join('');
}

/** Inline SVG icons, so callouts need no network or font fallback. */
const ICONS: Record<CalloutVariant, string> = {
  note: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/>',
  tip: '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
  success: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
  warning:
    '<path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  danger: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>',
};

function calloutHtml(variant: CalloutVariant, title: string | undefined, inner: Block[]): string {
  const label = escapeHtml(title ?? CALLOUT_TITLES[variant]);
  const body = inner.map(blockToHtml).join('\n');
  return `<aside class="callout callout-${variant}">
<div class="callout-head"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[variant]}</svg><span>${label}</span></div>
<div class="callout-body">${body}</div>
</aside>`;
}

function tableHtml(b: Extract<Block, { type: 'table' }>): string {
  // Widen to the longest row instead of clipping to the header — matches the
  // DOCX renderer, which had the same bug fixed earlier.
  const cols = b.rows.reduce((max, r) => Math.max(max, r.length), b.header.length);
  const alignOf = (ci: number) => `style="text-align:${b.align?.[ci] ?? 'left'}"`;
  const head = Array.from({ length: cols }, (_, ci) => b.header[ci] ?? '')
    .map((h, ci) => `<th ${alignOf(ci)}>${inlineHtml(h)}</th>`)
    .join('');
  const body = b.rows
    .map(
      (row) =>
        `<tr>${Array.from({ length: cols }, (_, ci) => row[ci] ?? '')
          .map((c, ci) => `<td ${alignOf(ci)}>${inlineHtml(c)}</td>`)
          .join('')}</tr>`,
    )
    .join('\n');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function blockToHtml(b: Block): string {
  switch (b.type) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, b.level));
      return `<h${level}>${inlineHtml(b.text)}</h${level}>`;
    }
    case 'paragraph':
      return `<p>${inlineHtml(b.text)}</p>`;
    case 'list': {
      const items = b.items.map((it) => `<li>${inlineHtml(it)}</li>`).join('');
      return b.ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`;
    }
    case 'quote':
      return `<blockquote>${inlineHtml(b.text)}</blockquote>`;
    case 'code':
      // Not `inlineHtml` — code is literal, so emphasis markers inside a snippet
      // must survive as themselves.
      return `<pre><code>${escapeHtml(b.text)}</code></pre>`;
    case 'hr':
      return '<hr />';
    case 'pagebreak':
      return '<div class="pagebreak"></div>';
    case 'callout':
      return calloutHtml(b.variant, b.title, b.blocks);
    case 'table':
      return tableHtml(b);
    default:
      return '';
  }
}

export interface HtmlDocOptions {
  title: string;
  blocks: Block[];
  theme: DocTheme;
  /**
   * Which half to emit.
   *
   * The PDF path renders `cover` and `body` as two separate print jobs and
   * concatenates the results with pdf-lib. That looks roundabout, but Chromium's
   * print-to-PDF ignores CSS margin boxes (`@bottom-right`) entirely and draws
   * page numbers from its own `footerTemplate`, which applies uniformly to every
   * page of a job — there is no selector for "not the cover". Two jobs give the
   * cover a zero-margin, unnumbered page and start "Page 1 of N" on the first
   * page of real content, which is what a numbered report is supposed to do.
   *
   * `all` keeps both in one document for a plain .html export.
   */
  part: 'cover' | 'body' | 'all';
}

const coverSection = (title: string, theme: DocTheme): string => `<section class="cover">
  <div class="cover-art"></div>
  <div class="cover-text">
    <div class="cover-rule"></div>
    <h1 class="cover-title">${escapeHtml(title)}</h1>
    ${theme.subtitle ? `<p class="cover-subtitle">${escapeHtml(theme.subtitle)}</p>` : ''}
    ${theme.author ? `<p class="cover-author">${escapeHtml(theme.author)}</p>` : ''}
  </div>
</section>`;

/** Build a standalone, print-ready HTML document. */
export function renderHtmlDocument(opts: HtmlDocOptions): string {
  const { title, blocks, theme, part } = opts;

  let content: string;
  if (part === 'cover') {
    content = coverSection(title, theme);
  } else {
    const body = blocks.map(blockToHtml).join('\n');
    const head =
      part === 'all'
        ? coverSection(title, theme)
        : `<h1 class="doc-title">${escapeHtml(title)}</h1>`;
    content = `${head}\n<main>\n${body}\n</main>`;
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
${stylesheet(theme, part)}
</style>
</head>
<body>
${content}
</body>
</html>`;
}

function stylesheet(t: DocTheme, part: 'cover' | 'body' | 'all'): string {
  const accent = css(t.accent);
  const accentDark = css(t.accentDark);
  const accentSoft = css(t.accentSoft);
  const accentFg = css(t.accentFg);
  const ink = css(t.ink);
  const muted = css(t.muted);
  const border = css(t.border);

  const callouts = (Object.keys(CALLOUT_PALETTE) as CalloutVariant[])
    .map((v) => {
      const c = CALLOUT_PALETTE[v];
      return `.callout-${v} { background: ${css(c.fill)}; border-left-color: ${css(c.line)}; }
.callout-${v} .callout-head { color: ${css(c.ink)}; }
.callout-${v} .callout-head svg { stroke: ${css(c.line)}; }`;
    })
    .join('\n');

  // Page margins come from Chromium's own print settings for the body job (so
  // the header/footer templates have room), but the cover is its own job printed
  // edge to edge.
  const page =
    part === 'cover'
      ? '@page { size: A4; margin: 0; }'
      : '@page { size: A4; margin: 22mm 18mm 20mm; }';

  return `
${page}

* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  margin: 0;
  font-family: ${t.bodyFont};
  font-size: 10.5pt;
  line-height: 1.62;
  color: ${ink};
}

.cover {
  position: relative;
  height: 297mm;
  width: 210mm;
  overflow: hidden;
  color: ${accentFg};
  background: ${accentDark};
  ${part === 'all' ? 'break-after: page;' : ''}
}
.cover-art {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse farthest-side at 18% 8%, rgba(255,255,255,0.30), transparent 70%),
    radial-gradient(ellipse farthest-side at 88% 92%, rgba(0,0,0,0.34), transparent 72%),
    linear-gradient(148deg, ${accent} 0%, ${accentDark} 62%, ${accentDark} 100%);
}
.cover-text { position: absolute; left: 24mm; right: 24mm; bottom: 46mm; }
.cover-rule { width: 46mm; height: 3.2mm; background: ${accentFg}; opacity: 0.92; margin-bottom: 12mm; }
.cover-title {
  font-family: ${t.headingFont};
  font-size: 34pt;
  line-height: 1.14;
  font-weight: 700;
  letter-spacing: -0.015em;
  margin: 0;
  color: ${accentFg};
}
.cover-subtitle { font-size: 13pt; margin: 7mm 0 0; opacity: 0.88; font-weight: 400; }
.cover-author { font-size: 10.5pt; margin: 12mm 0 0; opacity: 0.75; letter-spacing: 0.06em; text-transform: uppercase; }

main { counter-reset: h2; }
.doc-title {
  font-family: ${t.headingFont};
  font-size: 24pt;
  margin: 0 0 2mm;
  color: ${ink};
  border-bottom: 2.4pt solid ${accent};
  padding-bottom: 3mm;
}

h1, h2, h3, h4, h5, h6 {
  font-family: ${t.headingFont};
  color: ${ink};
  line-height: 1.25;
  /* A heading stranded at the foot of a page is the single most visible flaw in
     a generated report, so headings never break away from what follows. */
  break-after: avoid;
  break-inside: avoid;
}
main h1 { font-size: 21pt; margin: 12mm 0 4mm; color: ${accentDark}; }
main h2 {
  font-size: 15.5pt;
  margin: 9mm 0 3mm;
  padding-bottom: 2mm;
  border-bottom: 0.8pt solid ${border};
}
main h3 { font-size: 12.5pt; margin: 7mm 0 2mm; color: ${accentDark}; }
main h4 { font-size: 11pt; margin: 6mm 0 2mm; }
main h5, main h6 { font-size: 10.5pt; margin: 5mm 0 1.5mm; color: ${muted}; text-transform: uppercase; letter-spacing: 0.05em; }

p { margin: 0 0 3.4mm; orphans: 2; widows: 2; }
a { color: ${accentDark}; text-decoration: none; border-bottom: 0.6pt solid ${accentSoft}; }
strong { font-weight: 650; }
mark { background: ${css(t.highlightFill)}; color: ${ink}; padding: 0 0.6mm; border-radius: 0.6mm; }
s { color: ${muted}; }

ul, ol { margin: 0 0 3.6mm; padding-left: 6mm; }
li { margin-bottom: 1.2mm; }
li::marker { color: ${accent}; }

blockquote {
  margin: 0 0 4mm;
  padding: 1mm 0 1mm 5mm;
  border-left: 1.2mm solid ${accentSoft};
  color: ${muted};
  font-style: italic;
  break-inside: avoid;
}

code {
  font-family: ${t.monoFont};
  font-size: 0.88em;
  background: ${css(t.codeFill)};
  color: ${css(t.codeInk)};
  padding: 0.4mm 1.1mm;
  border-radius: 0.8mm;
}
pre {
  margin: 0 0 4.5mm;
  padding: 3.6mm 4mm;
  background: ${css(t.codeFill)};
  border: 0.5pt solid ${border};
  border-left: 1.2mm solid ${accent};
  border-radius: 1.2mm;
  /* Long lines wrap instead of running off the sheet — a PDF has no scrollbar,
     so an unwrapped 300-char line is simply gone. */
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}
pre code { background: none; padding: 0; font-size: 8.6pt; line-height: 1.5; }

hr { border: none; border-top: 0.8pt solid ${border}; margin: 7mm 0; }
.pagebreak { break-after: page; }

table {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 5mm;
  font-size: 9.5pt;
  break-inside: auto;
}
thead { display: table-header-group; }
tr { break-inside: avoid; }
th {
  background: ${accent};
  color: ${accentFg};
  font-weight: 600;
  text-align: left;
  padding: 2.2mm 2.6mm;
  border: 0.5pt solid ${accent};
}
td { padding: 2mm 2.6mm; border: 0.5pt solid ${border}; vertical-align: top; }
tbody tr:nth-child(even) td { background: ${accentSoft}; }

.callout {
  break-inside: avoid;
  margin: 0 0 4.5mm;
  padding: 3.2mm 4mm 1.4mm;
  border-left: 1.4mm solid;
  border-radius: 0 1.4mm 1.4mm 0;
}
.callout-head {
  display: flex;
  align-items: center;
  gap: 2mm;
  font-weight: 650;
  font-size: 9.5pt;
  letter-spacing: 0.02em;
  margin-bottom: 2mm;
}
.callout-head svg { width: 4.2mm; height: 4.2mm; fill: none; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
.callout-body > :last-child { margin-bottom: 2mm; }
.callout-body p { margin-bottom: 2mm; }
.callout-body pre, .callout-body table { margin-bottom: 2.5mm; }
${callouts}
`;
}
