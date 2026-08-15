import 'server-only';

import type { ArtifactKind, GenerateRequest, ToolName } from '../types';

export interface ExecutorContext {
  userId: string;
  conversationId?: string;
  messageId?: string;
}

/** A tool that produced a file. */
export interface ToolFileOutput {
  buffer: Buffer;
  kind: ArtifactKind;
  mime: string;
  ext: string;
  /**
   * Override the version the route would assign (1). Set by `edit_artifact`,
   * which produces revision N+1 of an existing document rather than a new one.
   */
  version?: number;
  /**
   * Override the filename the route derives from `name`/`title`. `edit_artifact`
   * keeps the original document's name, which the model never supplied.
   */
  filename?: string;
}

/**
 * A tool that produced TEXT for the model rather than a file.
 *
 * The contract was file-only, which is why every capability here is a document
 * generator: a read tool had nowhere to put its answer. `fetch_url` is the first
 * of these, and the route branches on the shape.
 */
export interface ToolTextOutput {
  text: string;
}

export type ToolOutput = ToolFileOutput | ToolTextOutput;

export function isTextOutput(out: ToolOutput): out is ToolTextOutput {
  return 'text' in out;
}

export type ExecutorFn = (req: GenerateRequest, ctx: ExecutorContext) => Promise<ToolOutput>;

type ExecutorModule = { default: ExecutorFn };

// Heavy document libraries are loaded only for the requested format. Static
// imports made every tool request initialize DOCX/PPTX/XLSX dependencies and
// also executed browser-oriented package probes during `next build`.
const loaders: Partial<Record<ToolName, () => Promise<ExecutorModule>>> = {
  create_pdf: () => import('./pdf'),
  create_docx: () => import('./docx'),
  create_pptx: () => import('./pptx'),
  create_xlsx: () => import('./xlsx'),
  create_csv: () => import('./csv'),
  create_txt: () => import('./txt'),
  create_md: () => import('./md'),
  create_html: () => import('./html'),
  create_json: () => import('./json'),
  create_xml: () => import('./xml'),
  zip_project: () => import('./zip'),
  fetch_url: () => import('./fetch-url'),
  edit_artifact: () => import('./edit-artifact'),
};

export async function getExecutor(tool: ToolName): Promise<ExecutorFn | undefined> {
  const load = loaders[tool];
  return load ? (await load()).default : undefined;
}
