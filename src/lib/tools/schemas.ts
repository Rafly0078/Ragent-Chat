/**
 * JSON Schemas for the tools, in the shape providers expect for native function
 * calling.
 *
 * Until now there was no schema anywhere in the repo. The only description of a
 * tool's inputs was the `GenerateRequest` TypeScript interface — erased at
 * runtime — plus prose in `prompt.ts`, and the two had already drifted:
 * `detect.ts` parses `sheets`, `slides`, `files` and `data`, and `prompt.ts`
 * documents none of them, so multi-sheet spreadsheets, explicit slide decks and
 * multi-file ZIPs were unreachable from model output.
 *
 * This is now the single source of truth for what a tool accepts. It feeds:
 *   - the `tools` array sent to OpenAI-compatible and Anthropic providers,
 *   - the tool list rendered into the text-directive prompt for models without
 *     native function calling,
 * so the prompt can no longer disagree with the parser.
 *
 * `validate.ts` still coerces at the HTTP boundary. Schemas guide a model;
 * they do not constrain a hand-crafted request.
 */

import { TOOLS } from './registry';
import type { ToolName } from './types';

/** The subset of JSON Schema both provider APIs accept. */
export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: false;
}

const MARKDOWN_CONTENT = {
  type: 'string',
  description:
    'The full document body as Markdown. Headings, lists, tables, code fences, ' +
    'bold/italic and links are all rendered. Write it naturally — no escaping.',
} as const;

const NAME = {
  type: 'string',
  description: 'Filename including extension, e.g. "quarterly-report.pdf".',
} as const;

const TITLE = {
  type: 'string',
  description: 'Document title, used for the cover page and metadata.',
} as const;

const THEME = {
  type: 'object',
  description: 'Optional presentation overrides.',
  properties: {
    accent: { type: 'string', description: 'Accent colour as a hex code, e.g. "#0B5FFF".' },
    ink: { type: 'string', description: 'Body text colour as a hex code.' },
    font: { type: 'string', description: 'Preferred font family name.' },
    cover: { type: 'boolean', description: 'Render a cover page.' },
    subtitle: { type: 'string' },
    author: { type: 'string' },
  },
} as const;

const ROWS = {
  type: 'array',
  description: 'Rows of cells. The first row is treated as the header.',
  items: { type: 'array', items: { type: ['string', 'number', 'boolean', 'null'] } },
} as const;

/**
 * Per-tool input schemas. Anything absent from this map is not offered natively.
 */
export const TOOL_SCHEMAS: Partial<Record<ToolName, JsonSchema>> = {
  create_pdf: {
    type: 'object',
    properties: { content: MARKDOWN_CONTENT, name: NAME, title: TITLE, theme: THEME },
    required: ['content'],
  },
  create_docx: {
    type: 'object',
    properties: { content: MARKDOWN_CONTENT, name: NAME, title: TITLE, theme: THEME },
    required: ['content'],
  },
  create_md: {
    type: 'object',
    properties: { content: MARKDOWN_CONTENT, name: NAME, title: TITLE },
    required: ['content'],
  },
  create_html: {
    type: 'object',
    properties: { content: MARKDOWN_CONTENT, name: NAME, title: TITLE, theme: THEME },
    required: ['content'],
  },
  create_txt: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'The plain-text body, verbatim.' },
      name: NAME,
      title: TITLE,
    },
    required: ['content'],
  },
  create_pptx: {
    type: 'object',
    properties: {
      slides: {
        type: 'array',
        description:
          'One entry per slide. Prefer this over `content` — it gives you control ' +
          'over where each slide breaks.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            bullets: { type: 'array', items: { type: 'string' } },
            body: { type: 'string', description: 'Paragraph text, when bullets do not fit.' },
          },
        },
      },
      content: {
        type: 'string',
        description: 'Markdown fallback — each top-level heading becomes a slide.',
      },
      name: NAME,
      title: TITLE,
      theme: THEME,
    },
  },
  create_xlsx: {
    type: 'object',
    properties: {
      sheets: {
        type: 'array',
        description: 'One entry per worksheet. Use this for a multi-sheet workbook.',
        items: {
          type: 'object',
          properties: { name: { type: 'string' }, rows: ROWS },
          required: ['rows'],
        },
      },
      rows: ROWS,
      name: NAME,
      title: TITLE,
    },
  },
  create_csv: {
    type: 'object',
    properties: {
      rows: ROWS,
      content: { type: 'string', description: 'Raw CSV text, if you already have it.' },
      name: NAME,
    },
  },
  create_json: {
    type: 'object',
    properties: {
      data: { description: 'Any JSON value. Serialized as-is.' },
      content: { type: 'string', description: 'Pre-serialized JSON text.' },
      name: NAME,
    },
  },
  create_xml: {
    type: 'object',
    properties: {
      data: { description: 'An object to convert to XML. `title` becomes the root tag.' },
      content: { type: 'string', description: 'Raw XML text, if you already have it.' },
      name: NAME,
      title: TITLE,
    },
  },
  zip_project: {
    type: 'object',
    properties: {
      files: {
        type: 'array',
        description: 'Every file in the archive. Paths may include directories.',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'e.g. "src/index.ts".' },
            content: { type: 'string' },
          },
          required: ['path', 'content'],
        },
      },
      name: NAME,
    },
    required: ['files'],
  },
  fetch_url: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description:
          'Absolute http(s) URL of the page to read. Private, loopback and ' +
          'link-local addresses are refused.',
      },
      maxChars: {
        type: 'number',
        description: 'Cap on returned characters. Defaults to 40000.',
      },
    },
    required: ['url'],
  },
  run_js: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description:
          'The JavaScript to run. Use console.log to report values, or end with an ' +
          'expression — its value is returned. A returned promise is awaited. ' +
          'Runs in a sandbox with NO network, NO file access and NO DOM worth ' +
          'touching, and is killed after 5 seconds.',
      },
    },
    required: ['content'],
  },
};

export interface ToolDefinition {
  name: ToolName;
  description: string;
  schema: JsonSchema;
}

/**
 * Every tool offerable to a provider: has a schema, has an executor, not
 * `future`. Derived from `TOOLS` so the registry is genuinely the source of
 * truth — the comment claiming so has been false since the UI started
 * hardcoding its own list.
 */
export function toolDefinitions(): ToolDefinition[] {
  const out: ToolDefinition[] = [];
  for (const meta of TOOLS) {
    if (meta.future) continue;
    const schema = TOOL_SCHEMAS[meta.name];
    if (!schema) continue;
    out.push({ name: meta.name, description: meta.description, schema });
  }
  return out;
}
