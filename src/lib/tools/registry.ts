/**
 * Tool manifest. Client-safe metadata for every capability. Executors live
 * server-side (src/lib/tools/executors) and are dispatched by the
 * /api/tools/execute route keyed on `name`. UI reads this manifest to render
 * available tools; adding a tool here + an executor is all it takes.
 */

import type { ToolMeta, ToolName } from './types';

export const TOOLS: ToolMeta[] = [
  {
    name: 'create_pdf',
    label: 'PDF',
    description: 'Generate a PDF document from Markdown.',
    category: 'document',
    produces: 'pdf',
    server: true,
  },
  {
    name: 'create_docx',
    label: 'Word',
    description: 'Generate a DOCX document from Markdown.',
    category: 'document',
    produces: 'docx',
    server: true,
  },
  {
    name: 'create_pptx',
    label: 'PowerPoint',
    description: 'Generate a PPTX slide deck.',
    category: 'document',
    produces: 'pptx',
    server: true,
  },
  {
    name: 'create_xlsx',
    label: 'Excel',
    description: 'Generate an XLSX spreadsheet.',
    category: 'document',
    produces: 'xlsx',
    server: true,
  },
  {
    name: 'create_csv',
    label: 'CSV',
    description: 'Generate a CSV file.',
    category: 'document',
    produces: 'csv',
    server: true,
  },
  {
    name: 'create_md',
    label: 'Markdown',
    description: 'Generate a Markdown file.',
    category: 'document',
    produces: 'md',
    server: true,
  },
  {
    name: 'create_html',
    label: 'HTML',
    description: 'Generate an HTML file.',
    category: 'document',
    produces: 'html',
    server: true,
  },
  {
    name: 'create_json',
    label: 'JSON',
    description: 'Generate a JSON file.',
    category: 'document',
    produces: 'json',
    server: true,
  },
  {
    name: 'create_xml',
    label: 'XML',
    description: 'Generate an XML file.',
    category: 'document',
    produces: 'xml',
    server: true,
  },
  {
    name: 'create_txt',
    label: 'Text',
    description: 'Generate a plain-text file.',
    category: 'document',
    produces: 'txt',
    server: true,
  },
  {
    name: 'zip_project',
    label: 'Project ZIP',
    description: 'Bundle multiple files into a ZIP archive.',
    category: 'export',
    produces: 'zip',
    server: true,
  },
  // The one READ tool: it returns page text to the model instead of producing a
  // file, which is why `produces` is absent and the category is `parse` (a
  // ToolCategory member that existed and had no members until now).
  {
    name: 'fetch_url',
    label: 'Fetch URL',
    description:
      'Read a specific web page and return its text. Use when the user names a URL, ' +
      'or when a search result needs to be read in full rather than summarised.',
    category: 'parse',
    server: true,
  },
  // The only tool that does NOT run on the server, and `server: false` is load-
  // bearing rather than descriptive — see lib/tools/client/index.ts. Executing
  // model-authored code in the deployment would be arbitrary RCE; in the browser
  // it runs in an origin-isolated iframe with no network.
  {
    name: 'run_js',
    label: 'Run JavaScript',
    description:
      'Execute a JavaScript snippet and return what it printed. Use for arithmetic, ' +
      'date maths, parsing, sorting, or checking a small algorithm — anything where ' +
      'computing the answer beats reasoning it out. No network and no file access.',
    category: 'parse',
    server: false,
  },
  // No executor yet (see executors/index.ts). Marked `future` so the directive
  // parser rejects it instead of stripping the block and then 400ing — which
  // lost the message content and showed "Unknown tool: export_chat".
  {
    name: 'export_chat',
    label: 'Export chat',
    description: 'Export the conversation as a document.',
    category: 'export',
    produces: 'md',
    server: true,
    future: true,
  },
];

const BY_NAME = new Map<ToolName, ToolMeta>(TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): ToolMeta | undefined {
  return BY_NAME.get(name as ToolName);
}

export function isToolName(name: string): name is ToolName {
  return BY_NAME.has(name as ToolName);
}
