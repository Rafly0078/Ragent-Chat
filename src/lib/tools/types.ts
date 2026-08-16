/**
 * Tool Engine — shared types. No server-only imports here; this module is safe
 * to load in the browser (manifest, detection, rendering all use it).
 *
 * A "tool" is any capability the assistant can invoke. Document-producing tools
 * emit an artifact. Adding a new tool means adding a manifest entry + (for
 * server tools) an executor — chat logic never changes.
 */

export type ArtifactKind =
  'pdf' | 'docx' | 'pptx' | 'xlsx' | 'csv' | 'txt' | 'md' | 'html' | 'json' | 'xml' | 'zip';

export type ToolName =
  | 'create_pdf'
  | 'create_docx'
  | 'create_pptx'
  | 'create_xlsx'
  | 'create_csv'
  | 'create_txt'
  | 'create_md'
  | 'create_html'
  | 'create_json'
  | 'create_xml'
  | 'zip_project'
  | 'fetch_url'
  | 'run_js'
  | 'read_attachment'
  | 'edit_artifact'
  | 'export_chat';

export type ToolCategory = 'document' | 'export' | 'parse' | 'future';

export interface ToolMeta {
  name: ToolName;
  label: string;
  description: string;
  category: ToolCategory;
  /** Artifact kind produced, if any. */
  produces?: ArtifactKind;
  /** Whether execution runs server-side (needs the /api/tools/execute route). */
  server: boolean;
  /** Not yet implemented — surfaced in UI but disabled. */
  future?: boolean;
}

/** A single slide for create_pptx. */
export interface SlideSpec {
  title?: string;
  bullets?: string[];
  body?: string;
}

/** A named sheet of tabular data for create_xlsx. */
export interface SheetSpec {
  name: string;
  rows: Array<Array<string | number | boolean | null>>;
}

/** A file entry for zip_project. */
export interface FileSpec {
  path: string;
  content: string;
}

/**
 * Design hints supplied by the model alongside the content.
 *
 * Everything here is untrusted and optional — `accent` may be a colour word, a
 * malformed hex, or absent. `src/lib/documents/theme.ts` normalizes it into a
 * full contrast-checked palette on the server; nothing downstream should read
 * these raw strings directly.
 */
export interface ThemeSpec {
  /** Brand colour: `#0B5FFF`, `0b5fff`, or a word like `teal`. */
  accent?: string;
  /** Body-text colour. Rarely worth overriding. */
  ink?: string;
  /** `sans` | `serif` | `mono` | `editorial`, or a family name. */
  font?: string;
  /** Emit a cover page. Undefined lets the renderer decide from length. */
  cover?: boolean;
  /** Deck/report subtitle, shown under the title on the cover. */
  subtitle?: string;
  /** Byline on the cover. */
  author?: string;
}

/**
 * Normalized generation request. A superset of every generator's inputs; each
 * executor reads only the fields it needs. Produced by the directive parser or
 * by UI actions, then POSTed to /api/tools/execute.
 */
export interface GenerateRequest {
  tool: ToolName;
  /** Desired filename (extension optional — the executor normalizes it). */
  name?: string;
  title?: string;
  /** Markdown / plain text / HTML body, depending on the tool. */
  content?: string;
  /** Single-sheet tabular data (csv, or xlsx when `sheets` is absent). */
  rows?: Array<Array<string | number | boolean | null>>;
  /** Multi-sheet workbook data (xlsx). */
  sheets?: SheetSpec[];
  /** Slides (pptx). */
  slides?: SlideSpec[];
  /** Files to bundle (zip_project). */
  files?: FileSpec[];
  /** Arbitrary payload (json / xml). */
  data?: unknown;
  /** Model-chosen colours, font and cover flag (pdf / docx / pptx). */
  theme?: ThemeSpec;
  /** Target page (fetch_url). */
  url?: string;
  /** Cap on returned characters (fetch_url). */
  maxChars?: number;
  /** Character offset to read from (read_attachment). */
  offset?: number;
  /** How many characters to read (read_attachment). */
  length?: number;
  /** Artifact to revise (edit_artifact). */
  artifactId?: string;
  /** Search/replace edits to apply to its source (edit_artifact). */
  hunks?: Array<{ search: string; replace: string }>;
  /** Linking metadata — filled by the client, not the model. */
  conversationId?: string;
  messageId?: string;
}

/** A generated, addressable output. */
export interface Artifact {
  id: string;
  conversationId?: string;
  messageId?: string;
  kind: ArtifactKind;
  name: string;
  mimeType: string;
  /** Size in bytes. */
  size: number;
  version: number;
  createdAt: number;
  /** Signed URL (authed) or object/data URL (guest). May expire. */
  url?: string;
  bucket?: string;
  storagePath?: string;
  /** True when not persisted server-side (guest mode). */
  ephemeral?: boolean;
  metadata?: Record<string, unknown>;
}

/** Result returned by the execute route. */
export interface ExecuteResult {
  artifact: Artifact;
}

/** Map a tool name to the artifact kind it produces. */
export const TOOL_KIND: Record<ToolName, ArtifactKind | undefined> = {
  create_pdf: 'pdf',
  create_docx: 'docx',
  create_pptx: 'pptx',
  create_xlsx: 'xlsx',
  create_csv: 'csv',
  create_txt: 'txt',
  create_md: 'md',
  create_html: 'html',
  create_json: 'json',
  create_xml: 'xml',
  zip_project: 'zip',
  // A read tool: it returns text to the model, not a downloadable file.
  fetch_url: undefined,
  run_js: undefined,
  read_attachment: undefined,
  // Resolved at runtime from the artifact being edited, not from the tool name.
  edit_artifact: undefined,
  export_chat: 'md',
};

/**
 * Which tool re-renders a given artifact kind — the inverse of `TOOL_KIND`.
 *
 * Needed by `edit_artifact`: it discovers the kind from the stored artifact, then
 * has to dispatch to the executor that produced it. Written out rather than
 * derived, because the mapping is not one-to-one (`export_chat` also produces
 * `md`) and the `create_*` tool is always the right choice here.
 */
export const TOOL_FOR_KIND: Record<ArtifactKind, ToolName> = {
  pdf: 'create_pdf',
  docx: 'create_docx',
  pptx: 'create_pptx',
  xlsx: 'create_xlsx',
  csv: 'create_csv',
  txt: 'create_txt',
  md: 'create_md',
  html: 'create_html',
  json: 'create_json',
  xml: 'create_xml',
  zip: 'zip_project',
};

export const MIME_BY_KIND: Record<ArtifactKind, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // Text types carry an explicit charset: without it the browser decodes the
  // UTF-8 bytes of a `data:` preview as windows-1252 and non-ASCII shows as
  // mojibake ("—" → "â€”"). Same value is used as the Storage contentType.
  csv: 'text/csv; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  html: 'text/html; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  zip: 'application/zip',
};

export const EXT_BY_KIND: Record<ArtifactKind, string> = {
  pdf: 'pdf',
  docx: 'docx',
  pptx: 'pptx',
  xlsx: 'xlsx',
  csv: 'csv',
  txt: 'txt',
  md: 'md',
  html: 'html',
  json: 'json',
  xml: 'xml',
  zip: 'zip',
};

/**
 * Plain-text file types the generic writer will produce under their own extension.
 *
 * There is no `create_css` or `create_js`, and there shouldn't be: a model asked for
 * a three-file landing page and reached for `create_txt` three times, which is the
 * right instinct. What was wrong was the result — `style.css` came back as
 * `style.css.txt` with `text/plain`, unusable as a stylesheet, and JavaScript
 * containing `a || b` tripped the markdown detector and was reflowed as prose.
 *
 * So the extension the model asks for is honoured, and its media type comes from
 * here. Deliberately a list rather than "keep whatever was typed": the value reaches
 * a `Content-Type` header and a `data:` URL, and `name` is model output.
 */
export const TEXT_FILE_MIME: Record<string, string> = {
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  cjs: 'text/javascript; charset=utf-8',
  jsx: 'text/javascript; charset=utf-8',
  ts: 'text/plain; charset=utf-8',
  tsx: 'text/plain; charset=utf-8',
  svg: 'image/svg+xml; charset=utf-8',
  scss: 'text/plain; charset=utf-8',
  less: 'text/plain; charset=utf-8',
  yml: 'text/plain; charset=utf-8',
  yaml: 'text/plain; charset=utf-8',
  toml: 'text/plain; charset=utf-8',
  ini: 'text/plain; charset=utf-8',
  env: 'text/plain; charset=utf-8',
  sh: 'text/x-shellscript; charset=utf-8',
  py: 'text/x-python; charset=utf-8',
  rb: 'text/plain; charset=utf-8',
  go: 'text/plain; charset=utf-8',
  rs: 'text/plain; charset=utf-8',
  java: 'text/plain; charset=utf-8',
  sql: 'text/plain; charset=utf-8',
  tsv: 'text/tab-separated-values; charset=utf-8',
  log: 'text/plain; charset=utf-8',
  conf: 'text/plain; charset=utf-8',
};

/** The recognised text extension a requested filename carries, if any. */
export function textFileExt(name: string | undefined): string | null {
  const ext = (name ?? '')
    .split(/[/\\]/)
    .pop()
    ?.match(/\.([a-z0-9]+)$/i)?.[1]
    ?.toLowerCase();
  return ext && ext in TEXT_FILE_MIME ? ext : null;
}

const KNOWN_EXT = new RegExp(
  `\\.(${[...Object.values(EXT_BY_KIND), ...Object.keys(TEXT_FILE_MIME)].join('|')})$`,
  'i',
);

/**
 * Human title for a generated document.
 *
 * `req.name` is a *filename*; using it directly as a heading produced documents
 * titled "# report.md" / a 24pt cover reading "report.pdf". Only a known
 * artifact extension is stripped — a plain `.replace(/\.[^.]+$/)` also ate real
 * content ("Q1 2024 sales v1.2" → "Q1 2024 sales v1").
 */
export function displayTitle(req: Pick<GenerateRequest, 'title' | 'name'>): string {
  const explicit = req.title?.trim();
  if (explicit) return explicit;
  const fromName = req.name?.trim().replace(KNOWN_EXT, '').trim();
  return fromName || 'Document';
}

/**
 * Build a safe filename from the model-supplied `name`.
 *
 * `name` used to reach the storage key unmodified, so `"../../x/evil"` produced an
 * object path containing `..`, and control characters and quotes flowed into the DB
 * row and any Content-Disposition built from it.
 *
 * Only a *known* extension is stripped before `ext` is appended — an earlier
 * `/\.[^.]+$/` also ate real content ("Q1 2024 sales v1.2" → "Q1 2024 sales v1") —
 * which also makes passing back the extension the name already carried idempotent:
 * `("style.css", "css")` → `style.css`, not `style.css.css`.
 */
export function safeFilename(raw: string | undefined, ext: string): string {
  const lastSegment = (raw ?? '').split(/[/\\]/).pop() ?? '';
  const base = lastSegment
    .replace(/[\x00-\x1F\x7F"*:<>?|]/g, '_')
    .replace(/^\.+/, '')
    .replace(KNOWN_EXT, '')
    .trim()
    .slice(0, 100)
    .trim();
  return `${base || 'document'}.${ext}`;
}
