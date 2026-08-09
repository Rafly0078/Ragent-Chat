/**
 * Screenshot the themed HTML that the PDF renderer prints, for visual review.
 *
 * The PDF itself needs poppler to rasterize; this goes at the same layout from
 * the other side — same `renderHtmlDocument` output, same Chromium — and writes
 * PNGs instead. Run with:  node scripts/shot-doc.mjs
 */
import { registerHooks } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function withExt(base) {
  const isFile = (p) => existsSync(p) && statSync(p).isFile();
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) if (isFile(c)) return c;
  return base;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: 'data:text/javascript,', shortCircuit: true };
    if (specifier.startsWith('@/')) {
      return nextResolve(pathToFileURL(withExt(path.join(root, 'src', specifier.slice(2)))).href, context);
    }
    if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts')) {
      const abs = withExt(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier));
      return nextResolve(pathToFileURL(abs).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { parseMarkdown } = await import(pathToFileURL(path.join(root, 'src/lib/documents/markdown.ts')).href);
const { resolveTheme } = await import(pathToFileURL(path.join(root, 'src/lib/documents/theme.ts')).href);
const { renderHtmlDocument } = await import(pathToFileURL(path.join(root, 'src/lib/documents/html-doc.ts')).href);
const { launchBrowser } = await import(pathToFileURL(path.join(root, 'src/lib/documents/browser.ts')).href);

const { readFile } = await import('node:fs/promises');
const MD = (await readFile(path.join(root, 'scripts', 'sample.md'), 'utf8'));

const theme = resolveTheme({
  accent: '#0F766E',
  font: 'editorial',
  subtitle: 'Q3 2025 · Prepared for the board',
  author: 'Acme Analytics',
  cover: true,
});
const blocks = parseMarkdown(MD);
const outDir = path.join(root, 'tmp-samples');
await mkdir(outDir, { recursive: true });

const browser = await launchBrowser();
try {
  for (const part of ['cover', 'body']) {
    const page = await browser.newPage();
    // A4 at 96dpi.
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1.4 });
    await page.setContent(renderHtmlDocument({ title: 'Quarterly Platform Review', blocks, theme, part }), {
      waitUntil: 'domcontentloaded',
    });
    const file = path.join(outDir, `${part}.png`);
    await page.screenshot({ path: file, fullPage: part === 'body' });
    console.log(`${part} -> ${file}`);
    await page.close();
  }
} finally {
  await browser.close();
}
