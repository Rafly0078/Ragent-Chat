/**
 * System-prompt fragment that teaches the model how to invoke the
 * document-generation tools. Appended to EVERY outgoing chat request inside
 * `toApiMessages` (src/lib/api/types.ts) regardless of whatever custom
 * system prompt a given conversation has stored — so the directive format
 * works even in chats created before this file existed, without the user
 * having to reset anything.
 *
 * Deliberately NOT JSON. The previous format required the model to emit one
 * giant JSON object with the entire document escaped into a single string
 * field. Small/quantized models reliably lose track of quote and newline
 * escaping over a long document and produce invalid JSON, which silently
 * fails to parse (see detectArtifacts in ./detect.ts) — the raw, broken
 * block is then left behind and gets misrendered as a generic, misleadingly
 * "finished-looking" code block instead of ever calling the tool. A plain
 * "key: value" header followed by a raw body avoids escaping entirely,
 * which is far more robust for weaker local models.
 *
 * The design headers (`accent`, `font`, `cover`, …) follow the same rule: they
 * are flat scalar values on their own lines, never a nested object, so a model
 * that fumbles one of them loses only that line and still produces a document.
 * `src/lib/documents/theme.ts` contrast-clamps whatever colour arrives, so a
 * bad pick is a mediocre document rather than unreadable text on paper.
 *
 * create_json/create_xml take the JSON value bare, and the wording below has to
 * stay that way: detect.ts unwraps `sheets`/`slides`/`files` because a shape
 * guard tells the wrapper apart from a document, and no such guard exists for
 * `data` — `{"data": […]}` is a document people legitimately ask for. While the
 * prompt taught that wrapper, a compliant model shipped a file with an extra
 * `data` level around the real content.
 */
export const TOOL_INSTRUCTIONS = `You can generate downloadable files for the user: PDF, Word (docx), PowerPoint (pptx), Excel (xlsx), CSV, Markdown, HTML, JSON, XML, or plain text.

To generate a file, emit exactly one block in this exact shape — a few "key: value" header lines, then a line containing only "---", then the raw file content:

\`\`\`artifact
tool: create_pdf
name: report.pdf
title: Report Title
subtitle: Q3 2025 performance review
author: Acme Analytics
accent: #0B5FFF
font: editorial
cover: true
---
Write the full document content here as plain Markdown.
Use as many lines and paragraphs as the document actually needs.
Do not wrap this in JSON and do not escape quotes or newlines — write it naturally, exactly as you would write normal Markdown.
\`\`\`

Rules:
- "tool" must be exactly one of: create_pdf, create_docx, create_pptx, create_xlsx, create_csv, create_md, create_html, create_json, create_xml, create_txt, zip_project.
- "name" and "title" are optional but recommended.
- Only use this block when the user actually asks you to create, generate, export, or download a file. For a normal question, just answer normally in Markdown — never use this block.
- Emit exactly one block per file, and nothing else inside it — no commentary.
- If the document you are writing itself contains code fences, open and close the artifact block with FOUR backticks (\`\`\`\`artifact … \`\`\`\`) so the inner \`\`\` fences don't end it early.
- Always write the complete document before closing the block. Never stop partway through a sentence, even for long documents.
- For "create_csv", write plain comma-separated rows (one row per line) as the body instead of Markdown.

Design headers (optional, for create_pdf, create_docx and create_pptx only). These make the file look professionally designed instead of plain:
- "accent": the brand/theme colour, as hex ("#0B5FFF") or a colour word ("teal"). It colours the cover, headings, table headers, links and rules. Pick one that fits the subject — corporate blue for a business report, deep green for sustainability, and the company's real brand colour whenever the user names a company.
- "ink": body-text colour. Almost always leave this out.
- "font": one of "sans" (default), "serif", "mono", or "editorial" (serif headings over a sans body — good for reports and whitepapers).
- "cover": "true" to force a full-page coloured cover, "false" to suppress it. Leave it out and a cover appears automatically for longer documents.
- "subtitle" and "author": one line each, shown on the cover under the title.
Choose the colour and font yourself from the document's subject; do not ask the user.

Rich Markdown available in the body (create_pdf, create_docx, create_pptx):
- ==highlighted text== renders as a marker-pen highlight. Use it for the one or two facts that matter most, not for whole paragraphs.
- Callout boxes, each a coloured panel with an icon:
  :::warning Optional title
  Body text, which may span several paragraphs and contain lists.
  :::
  Variants: note, info, tip, success, warning, danger.
- A line containing only <!-- pagebreak --> forces a new page (a new slide in create_pptx).
- Tables, bullet and numbered lists, blockquotes, code fences, bold/italic and links all render with the theme applied.
For create_pptx, each "#", "##" or "###" heading starts a new slide and the text under it becomes that slide's content.

Structured bodies. For five tools the body may instead be a single JSON object, which gives you control the Markdown path cannot:
- create_xlsx — {"sheets": [{"name": "Q3", "rows": [["Region","Revenue"],["EMEA",120]]}]} for a multi-sheet workbook, or {"rows": [[…],[…]]} for one sheet. The first row is the header.
- create_pptx — {"slides": [{"title": "Findings", "bullets": ["…","…"]}, {"title": "Detail", "body": "paragraph text"}]} when you want to decide exactly where each slide breaks.
- zip_project — {"files": [{"path": "src/index.ts", "content": "…"}, {"path": "README.md", "content": "…"}]}. Without this a ZIP ends up containing only a single file, so always use it for a multi-file project.
- create_json and create_xml — the JSON value itself, object or array: {"total": 42} or [{"id": 1}]. Never wrap it as {"data": …} — a top-level "data" key is a legitimate document, so the wrapper is serialized into the file verbatim. For create_xml, "title" becomes the root tag name.
Use the JSON form only for those five; every other tool takes a plain body.`;
