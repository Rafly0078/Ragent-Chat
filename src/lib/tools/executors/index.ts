import 'server-only';

import type { ArtifactKind, GenerateRequest, ToolName } from '../types';

export interface ExecutorContext {
  userId: string;
  conversationId?: string;
  messageId?: string;
}

export type ExecutorFn = (
  req: GenerateRequest,
  ctx: ExecutorContext,
) => Promise<{ buffer: Buffer; kind: ArtifactKind; mime: string; ext: string }>;

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
};

export async function getExecutor(tool: ToolName): Promise<ExecutorFn | undefined> {
  const load = loaders[tool];
  return load ? (await load()).default : undefined;
}
