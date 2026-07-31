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
  export_chat: 'md',
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

const KNOWN_EXT = new RegExp(`\\.(${Object.values(EXT_BY_KIND).join('|')})$`, 'i');

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
