/**
 * Exercises the document markdown parser, with the fence cases that used to hang it.
 *
 * The regression: the fence opener was `/^```(\w+)?\s*$/`, so ```` ```c# ```` matched
 * nothing, fell through to the paragraph branch, and that branch breaks on
 * /^```/ *without consuming the line* — `parseBlocks` then spun forever and
 * pinned a CPU until the platform killed the request.
 *
 * Run: node scripts/verify-markdown.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\/]$/, '');
const require = createRequire(pathToFileURL(`${ROOT}/package.json`).href);
const jiti = require('jiti')(`${ROOT}/verify.js`, {
  alias: { '@': `${ROOT}/src`, 'server-only': `${ROOT}/scripts/_empty-module.cjs` },
  interopDefault: true,
  esmResolve: true,
});

const { parseMarkdown } = jiti(`${ROOT}/src/lib/documents/markdown.ts`);

let pass = 0;
let fail = 0;
function check(label, condition, detail) {
  if (condition) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Every info string a model actually writes has to open a code block. */
for (const [info, lang] of [
  ['c#', 'c#'],
  ['c++', 'c++'],
  ['objective-c', 'objective-c'],
  ['js copy', 'js'],
  [' js', 'js'],
  ['', undefined],
  ['ts', 'ts'],
  ['C#', 'C#'],
]) {
  const blocks = parseMarkdown(`\`\`\`${info}\nbody line\n\`\`\`\n\ntail`);
  check(
    `fence info ${JSON.stringify(info)} opens a code block`,
    blocks[0]?.type === 'code' && blocks[0]?.text === 'body line' && blocks[0]?.lang === lang,
    JSON.stringify(blocks[0]),
  );
  check(
    `fence info ${JSON.stringify(info)} keeps the text after it`,
    blocks.at(-1)?.type === 'paragraph',
  );
}

// A longer marker is not closed by a shorter run inside it.
{
  const blocks = parseMarkdown('````md\n```js\nnested\n```\n````');
  check(
    'a ```` fence survives a nested ``` fence',
    blocks.length === 1 && blocks[0].text === '```js\nnested\n```',
    JSON.stringify(blocks),
  );
}

// Inherited Object.prototype keys are titles, not variants.
{
  const blocks = parseMarkdown(':::constructor Heads up\nbody\n:::');
  check(
    ':::constructor is a plain note titled with the word',
    blocks[0]?.type === 'callout' && blocks[0].variant === 'note',
    JSON.stringify(blocks[0]),
  );
}
{
  const blocks = parseMarkdown(':::callout valueOf Title\nbody\n:::');
  check(
    ':::callout valueOf keeps the word as the title',
    blocks[0]?.type === 'callout' && blocks[0].variant === 'note',
    JSON.stringify(blocks[0]),
  );
}
{
  const blocks = parseMarkdown('> [!hasOwnProperty] x\n> body');
  check(
    'a bogus GitHub alert stays a quote',
    blocks[0]?.type === 'quote',
    JSON.stringify(blocks[0]),
  );
}

// The shapes that already worked must keep working.
{
  const blocks = parseMarkdown(
    '# Title\n\nA paragraph.\n\n- one\n- two\n\n1. first\n2. second\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n:::warning Careful\ninside\n:::\n\n> quoted\n\n---\n',
  );
  const kinds = blocks.map((b) => b.type).join(',');
  check(
    'a mixed document still parses into the same block sequence',
    kinds === 'heading,paragraph,list,list,table,callout,quote,hr',
    kinds,
  );
  check('the warning callout keeps its variant', blocks[5]?.variant === 'warning');
}

// An unterminated fence must still terminate the parse.
{
  const blocks = parseMarkdown('text\n\n```py\nno closer');
  check('an unterminated fence ends the parse', blocks.length === 2 && blocks[1].type === 'code');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
