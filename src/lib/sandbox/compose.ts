/**
 * Turn a model message (or raw code) into a single runnable HTML document for
 * the sandbox iframe, and detect whether a message even contains runnable web
 * code in the first place.
 *
 * Pure and browser-safe — no DOM access, no server-only imports.
 */

import { extractCodeBlocks } from '@/lib/tools/patch';
import type { WebSource } from './types';

const HTML_LANGS = new Set(['html', 'htm', 'xhtml']);
const CSS_LANGS = new Set(['css']);
const JS_LANGS = new Set(['js', 'javascript', 'jsx', 'mjs']);

/**
 * Extract the runnable web parts from a message's code blocks. Multiple CSS/JS
 * blocks are concatenated in document order. Returns null when there is nothing
 * runnable (no HTML and no JS — CSS alone can't render anything meaningful).
 */
export function extractWebSource(message: string): WebSource | null {
  const blocks = extractCodeBlocks(message);
  if (blocks.length === 0) return null;

  const htmlParts: string[] = [];
  const cssParts: string[] = [];
  const jsParts: string[] = [];

  for (const b of blocks) {
    const lang = (b.lang ?? '').toLowerCase();
    if (HTML_LANGS.has(lang)) htmlParts.push(b.code);
    else if (CSS_LANGS.has(lang)) cssParts.push(b.code);
    else if (JS_LANGS.has(lang)) jsParts.push(b.code);
    else if (!lang && looksLikeHtml(b.code)) htmlParts.push(b.code);
  }

  const html = htmlParts.join('\n');
  const css = cssParts.join('\n\n');
  const js = jsParts.join('\n\n');

  // Runnable only if there's markup to render or a script to execute. A page
  // that is CSS-only has nothing to audit against.
  if (!html && !js) return null;

  return { html, css, js };
}

/** True if the message contains at least one runnable web code block. */
export function hasRunnableWeb(message: string): boolean {
  return extractWebSource(message) !== null;
}

/** Heuristic: does this untagged block look like HTML markup? */
function looksLikeHtml(code: string): boolean {
  return /<\s*(!doctype|html|body|div|section|main|h[1-6]|p|span|ul|table|canvas|svg)\b/i.test(
    code,
  );
}

/** True when the HTML is already a complete document we should not re-wrap. */
function isFullDocument(html: string): boolean {
  return /<\s*html[\s>]/i.test(html) || /<!doctype/i.test(html);
}

/**
 * `<style>` / `<script>` are raw-text elements: the HTML parser ends them at the
 * first `</style` / `</script`, regardless of JavaScript string context. Model
 * code very often contains `el.innerHTML = '<script>…</script>'`, which used to
 * cut the injected tag short and dump the remainder into the page as visible
 * text — after which the heal loop chased syntax errors that weren't in the
 * model's source and could never converge. `<\/` is a valid escape inside JS
 * strings and regexes, and inside CSS `</style` only appears in a string anyway.
 */
function escapeRawText(code: string): string {
  return code.replace(/<\/(script|style)/gi, '<\\/$1');
}

/**
 * Compose a single self-contained HTML document from a WebSource. When the HTML
 * is already a full document, CSS/JS are injected before </head> and </body>
 * respectively; otherwise the fragment is wrapped in a minimal shell. The
 * `bootstrap` script (error-capture wiring) is injected as the FIRST thing in
 * <head> so it catches errors thrown by the page's own scripts.
 *
 * Every injection goes through a *replacer function*, never a replacement
 * string. `String.replace` interprets `$$`, `$&`, `` $` `` and `$'` in the
 * replacement, so a page whose JS contained `` `$${price}` `` or `'$&'` (both
 * routine) came out silently corrupted — `` $` `` even spliced the entire
 * preceding document into the middle of the script.
 */
export function composeDocument(src: WebSource, bootstrap: string): string {
  const styleTag = src.css ? `<style>\n${escapeRawText(src.css)}\n</style>` : '';
  // `/* --> */` is the counterpart to escapeRawText's `<\/`. Escaping `</script`
  // also removes the only exit from the tokenizer's script-data-double-escaped
  // state, which page JS holding an unbalanced `<!--` before a `<script` token puts
  // us in — so the injected `</script>` was swallowed as script text and the
  // element closed at EOF already "started". The page then rendered its markup and
  // ran none of its JavaScript, which raises no error and isn't blank, so the audit
  // reported "Ran clean, no errors" and the heal loop stopped there. `-->` puts the
  // tokenizer back in script data, and a JS comment executes nothing. Built once, so
  // both the full-document and the wrapped-fragment path get it; `<style>` has no
  // escaped states, so CSS needs no equivalent.
  const scriptTag = src.js ? `<script>\n${escapeRawText(src.js)}\n/* --> */\n</script>` : '';
  const bootstrapTag = `<script>\n${bootstrap}\n</script>`;

  if (isFullDocument(src.html)) {
    let doc = src.html;
    // Bootstrap first, right after <head> (or after <html>, or prepended).
    if (/<\s*head[\s>]/i.test(doc)) {
      doc = doc.replace(/<\s*head[^>]*>/i, (m) => `${m}\n${bootstrapTag}`);
    } else if (/<\s*html[^>]*>/i.test(doc)) {
      doc = doc.replace(/<\s*html[^>]*>/i, (m) => `${m}\n<head>${bootstrapTag}</head>`);
    } else {
      doc = `${bootstrapTag}\n${doc}`;
    }
    if (styleTag) {
      doc = /<\/\s*head\s*>/i.test(doc)
        ? doc.replace(/<\/\s*head\s*>/i, () => `${styleTag}\n</head>`)
        : `${styleTag}\n${doc}`;
    }
    if (scriptTag) {
      doc = /<\/\s*body\s*>/i.test(doc)
        ? doc.replace(/<\/\s*body\s*>/i, () => `${scriptTag}\n</body>`)
        : `${doc}\n${scriptTag}`;
    }
    return doc;
  }

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
${bootstrapTag}
${styleTag}
</head>
<body>
${src.html}
${scriptTag}
</body>
</html>`;
}

/**
 * Fence long enough to contain `code` — a generated page that displays a code
 * sample (or uses a template literal holding ```) closed a plain 3-backtick
 * fence early, truncating the code sent to the model and the code parsed back.
 */
function fenceFor(...code: string[]): string {
  const longest = code
    .flatMap((c) => [...c.matchAll(/`+/g)].map((m) => m[0].length))
    .reduce((max, n) => Math.max(max, n), 2);
  return '`'.repeat(longest + 1);
}

/** Serialize a WebSource back into fenced code blocks for a model prompt. */
export function sourceToBlocks(src: WebSource): string {
  const parts: string[] = [];
  if (src.html) parts.push(`${fenceFor(src.html)}html\n${src.html}\n${fenceFor(src.html)}`);
  if (src.css) parts.push(`${fenceFor(src.css)}css\n${src.css}\n${fenceFor(src.css)}`);
  if (src.js) parts.push(`${fenceFor(src.js)}js\n${src.js}\n${fenceFor(src.js)}`);
  return parts.join('\n\n');
}
