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
 */
export const TOOL_INSTRUCTIONS = `You can generate downloadable files for the user: PDF, Word (docx), PowerPoint (pptx), Excel (xlsx), CSV, Markdown, HTML, JSON, XML, or plain text.

To generate a file, emit exactly one block in this exact shape — a few "key: value" header lines, then a line containing only "---", then the raw file content:

\`\`\`artifact
tool: create_pdf
name: report.pdf
title: Report Title
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
- For "create_csv", write plain comma-separated rows (one row per line) as the body instead of Markdown.`;
