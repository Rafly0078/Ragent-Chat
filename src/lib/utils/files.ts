import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Attachment } from '@/types';
import { uid } from './id';

const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // 12MB
const MAX_TEXT_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_OFFICE_BYTES = 25 * 1024 * 1024; // 25MB (zipped Office docs)
const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25MB — parsed page-by-page on the main thread
/** Stop accumulating extracted PDF text past this — protects RAM and the prompt. */
const MAX_PDF_CHARS = 400_000;
const MAX_PDF_PAGES = 300;

/**
 * Data URL for previewing an attachment, derived from `base64` rather than
 * stored alongside it. Keeping a separate `previewUrl` copy meant every image
 * was held twice (a 12MB photo → ~32MB of strings, all of it persisted), which
 * is the fastest way to blow the localStorage quota.
 */
export function attachmentPreview(att: Attachment): string | undefined {
  if (att.previewUrl) return att.previewUrl; // legacy attachments already stored one
  if (att.base64) return `data:${att.type || 'image/png'};base64,${att.base64}`;
  return undefined;
}

export function isImage(file: File): boolean {
  return file.type.startsWith('image/');
}
export function isText(file: File): boolean {
  return (
    file.type.startsWith('text/') ||
    /^application\/(json|xml|x-yaml|x-sh|javascript|typescript)$/.test(file.type) ||
    /\.(txt|md|markdown|csv|tsv|json|jsonl|log|ya?ml|toml|ini|env|xml|html?|css|scss|svg|ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|c|h|cpp|hpp|cs|rb|php|swift|sql|sh|bash|zsh|ps1|bat|dockerfile|gitignore|conf)$/i.test(
      file.name,
    )
  );
}
export function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}
function isDocx(file: File): boolean {
  return /\.docx$/i.test(file.name) || file.type.includes('wordprocessingml');
}
function isPptx(file: File): boolean {
  return /\.pptx$/i.test(file.name) || file.type.includes('presentationml');
}
function isXlsx(file: File): boolean {
  return /\.xlsx$/i.test(file.name) || file.type.includes('spreadsheetml');
}
export function isOffice(file: File): boolean {
  return isDocx(file) || isPptx(file) || isXlsx(file);
}

/**
 * Read a document's text with the browser, for any caller that needs the words
 * rather than the bytes. Returns '' when nothing could be read — callers that
 * want to fail loudly should check for that and throw their own message.
 *
 * This is the one implementation. `use-document-edit` used to carry its own
 * ~155-line copy with weaker parsers (a bare `<w:t>` regex against the
 * paragraph-boundary-aware `xmlToText` here, and — for .xlsx alone — a full
 * `exceljs` workbook *writer*, 930 KB of async chunk, to read some cell values
 * out of a zip this file already opens with jszip).
 */
export async function extractDocumentText(file: File): Promise<string> {
  if (isPdf(file)) return extractPdfText(file);
  if (isOffice(file)) return extractOffice(file);
  return file.text();
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Convert a File into an Attachment. Every file is accepted — nothing throws
 * an "unsupported type" error anymore:
 *   - images → base64 for vision models
 *   - text/code/pdf/office docs → extracted text inlined into the prompt
 *   - anything else (binary) → a short descriptive note so the model at least
 *     knows a file was attached
 * Extraction is best-effort and lazily loads heavy parsers only when needed.
 */
export async function fileToAttachment(file: File): Promise<Attachment> {
  const base: Attachment = {
    id: uid(),
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: file.size,
  };

  // SVG is checked out of the raster path deliberately: it is markup, and the
  // `svg` entry in `isText`'s extension list was unreachable while `isImage`
  // won first. The file was base64'd as a vision image, `inferImageMediaType`
  // found no PNG/JPEG magic bytes and labelled the XML `image/png`, and the
  // provider was handed a data URL whose bytes are not an image at all.
  if (isImage(file) && file.type !== 'image/svg+xml') {
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`Image "${file.name}" exceeds 12MB.`);
    const dataUrl = await readAsDataUrl(file);
    // Only the base64 payload is kept; the preview is derived from it on render
    // (see `attachmentPreview`) instead of stored as a second full copy.
    return { ...base, base64: dataUrl.split(',')[1] ?? '' };
  }

  if (isText(file)) {
    if (file.size > MAX_TEXT_BYTES) throw new Error(`File "${file.name}" exceeds 2MB.`);
    return { ...base, text: await readAsText(file) };
  }

  if (isPdf(file)) {
    // Previously unbounded: a 300MB scanned PDF was read fully into memory and
    // parsed on the main thread, hanging the tab with no error.
    if (file.size > MAX_PDF_BYTES) {
      return { ...base, text: noteFor(file, 'too large to read (over 25MB)') };
    }
    const text = await extractPdfText(file).catch(() => '');
    return { ...base, text: text || noteFor(file, 'text could not be extracted') };
  }

  if ((isDocx(file) || isPptx(file) || isXlsx(file)) && file.size <= MAX_OFFICE_BYTES) {
    const text = await extractOffice(file).catch(() => '');
    return { ...base, text: text || noteFor(file, 'content could not be extracted') };
  }

  // Unknown / binary — attach a note instead of failing the whole send.
  return { ...base, text: noteFor(file) };
}

/** A stand-in body for files whose bytes can't be turned into useful text. */
function noteFor(file: File, reason?: string): string {
  const kind = file.type || 'unknown type';
  const why = reason ? ` — ${reason}` : ' — binary content, not readable as text';
  return `[Attached file: ${file.name} (${kind}, ${humanSize(file.size)})${why}]`;
}

async function extractPdfText(file: File): Promise<string> {
  // Lazy import — pdfjs only downloads (as a separate chunk) when a PDF is added.
  let doc: PDFDocumentProxy | null = null;
  try {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
    const buf = await file.arrayBuffer();
    doc = await pdfjs.getDocument({ data: buf }).promise;
    let out = '';
    const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      out += content.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n\n';
      // Release the page's operator list / font data as we go, or pdf.js keeps
      // every parsed page alive for the lifetime of the tab.
      page.cleanup();
      if (out.length > MAX_PDF_CHARS) {
        out += `\n[Truncated — only the first ${i} page(s) of "${file.name}" were read.]`;
        break;
      }
    }
    return out.trim();
  } catch {
    return '';
  } finally {
    // Terminates the dedicated worker too.
    await doc?.destroy().catch(() => {});
  }
}

/** Pull readable text out of a zipped Office document (docx/pptx/xlsx). */
async function extractOffice(file: File): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  const xmlToText = (xml: string): string =>
    decodeEntities(
      xml
        // Keep paragraph/line/cell boundaries as whitespace before stripping tags.
        .replace(/<\/(w:p|a:p|text:p)>/g, '\n')
        .replace(/<(w:br|a:br)\b[^>]*\/?>/g, '\n')
        .replace(/<[^>]+>/g, ''),
    )
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

  if (isDocx(file)) {
    const doc = zip.file('word/document.xml');
    return doc ? xmlToText(await doc.async('string')) : '';
  }

  if (isPptx(file)) {
    // Slides are individual files; order them numerically (slide1, slide2, …).
    const slideFiles = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => {
        const na = Number(a.match(/slide(\d+)/)?.[1] ?? 0);
        const nb = Number(b.match(/slide(\d+)/)?.[1] ?? 0);
        return na - nb;
      });
    const parts: string[] = [];
    for (let i = 0; i < slideFiles.length; i++) {
      const f = zip.file(slideFiles[i]!);
      if (!f) continue;
      const body = xmlToText(await f.async('string'));
      if (body) parts.push(`--- Slide ${i + 1} ---\n${body}`);
    }
    return parts.join('\n\n');
  }

  // xlsx: read shared strings + each sheet's cell values into a simple grid.
  //
  // Read as a flat list of `<t>` and `<c>` elements this went quietly wrong in
  // three ways, all of which hand the model a plausible grid holding the wrong
  // values: a cell with mixed formatting is several `<t>` runs inside one
  // `<si>`, so collecting per `<t>` shifted every later string cell; empty cells
  // are either omitted from the row or written self-closing, so reading cells
  // positionally moved every later value in the row under the wrong header; and
  // the entity decoding the docx/pptx path does was never applied, so "P&L"
  // arrived as "P&amp;L".
  const shared: string[] = [];
  const ssFile = zip.file('xl/sharedStrings.xml');
  if (ssFile) {
    const ss = await ssFile.async('string');
    for (const si of ss.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) {
      shared.push(runsToText(si[1] ?? ''));
    }
  }
  const sheetNames = Object.keys(zip.files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort();
  const out: string[] = [];
  for (const name of sheetNames) {
    const f = zip.file(name);
    if (!f) continue;
    const xml = await f.async('string');
    const rows: string[] = [];
    for (const rowMatch of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const cells: string[] = [];
      for (const c of (rowMatch[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1] ?? '';
        // Position the cell by its own reference rather than by arrival order.
        const col = columnIndex(/\br="([A-Za-z]+)/.exec(attrs)?.[1]);
        while (col > cells.length) cells.push('');
        const inner = c[2];
        if (inner === undefined) {
          cells.push(''); // self-closing `<c/>`: styled, but holds no value
          continue;
        }
        const type = /\bt="([^"]*)"/.exec(attrs)?.[1];
        if (type === 'inlineStr') {
          cells.push(runsToText(inner));
          continue;
        }
        const v = inner.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? '';
        cells.push(type === 's' ? (shared[Number(v)] ?? '') : decodeEntities(v));
      }
      if (cells.some((x) => x !== '')) rows.push(cells.join('\t'));
    }
    if (rows.length) out.push(rows.join('\n'));
  }
  return out.join('\n\n');
}

/**
 * The five entities XML requires. `&amp;` is decoded last on purpose: decoding
 * it first turns the escaped text `&amp;lt;` into `<` instead of the `&lt;` the
 * document actually says.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * The text of one shared or inline string: its formatting runs joined back into
 * a single value. Phonetic runs (`<rPh>`, which Japanese input adds) are dropped
 * — they repeat the value as furigana rather than continuing it.
 */
function runsToText(inner: string): string {
  let text = '';
  const body = inner.replace(/<rPh\b[^>]*>[\s\S]*?<\/rPh>/g, '');
  for (const t of body.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) {
    text += decodeEntities(t[1] ?? '');
  }
  return text;
}

/** `r="AB7"` → 27, the 0-based column. -1 when the cell carries no reference. */
function columnIndex(ref: string | undefined): number {
  if (!ref) return -1;
  let n = 0;
  for (const ch of ref.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
