/**
 * Exercises the interleaved-thinking pipeline end to end at the unit level:
 * the wire→parts router (including <think> tag splitting across chunk
 * boundaries) and the parts folder that the store delegates to.
 *
 * Run: node scripts/verify-thinking.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Resolved from this file, so the script works from any cwd.
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\/]$/, '');
// Resolved against the project, not this script: it lives outside the repo, so a
// bare 'jiti' specifier wouldn't resolve. jiti v1 is CJS with a factory export.
const require = createRequire(pathToFileURL(`${ROOT}/package.json`).href);
const jiti = require('jiti')(`${ROOT}/verify.js`, {
  alias: { '@': `${ROOT}/src` },
  interopDefault: true,
  esmResolve: true,
});

const { createPartRouter } = jiti(`${ROOT}/src/lib/api/stream.ts`);
const { withParts, sealed, seedParts } = jiti(`${ROOT}/src/lib/store/message-parts.ts`);

let pass = 0;
let fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}\n         got  ${g}\n         want ${w}`);
  }
};

// Shorthand: run chunks through a fresh router, return [kind, index, text] triples.
const route = (chunks) => {
  const r = createPartRouter();
  const out = [];
  for (const c of chunks) out.push(...r.route(c));
  out.push(...r.flush());
  return out.map((p) => [p.kind, p.index, p.text]);
};
const msg = (content, thinking, part) => ({
  message: { role: 'assistant', content, thinking },
  ...(part ? { part } : {}),
});

console.log('\n1. server-supplied part metadata (Anthropic real block indices)');
eq(
  'think(0) -> text(1) -> think(2) keeps three parts in order',
  route([
    msg('', 'weigh', { kind: 'thinking', index: 0 }),
    msg('', ' options', { kind: 'thinking', index: 0 }),
    msg('So: ', '', { kind: 'text', index: 1 }),
    msg('yes.', '', { kind: 'text', index: 1 }),
    msg('', 'but wait', { kind: 'thinking', index: 2 }),
  ]),
  [
    ['thinking', 0, 'weigh'],
    ['thinking', 0, ' options'],
    // The upstream called this block 1; the router calls it 0. Text now always
    // goes through the <think> splitter (see below), which owns its own counter —
    // a thinking block's index is still the upstream's, and the ORDER, which is
    // what any of this is for, is untouched either way.
    ['text', 0, 'So: '],
    ['text', 0, 'yes.'],
    ['thinking', 2, 'but wait'],
  ],
);
eq(
  'a thinking block close passes through with its flag and upstream index',
  createPartRouter().route(msg('', '', { kind: 'thinking', index: 4, done: true })),
  [{ kind: 'thinking', index: 4, text: '', done: true }],
);
eq(
  'a text block close carries no part of its own',
  route([
    msg('all done.', '', { kind: 'text', index: 0 }),
    msg('', '', { kind: 'text', index: 0, done: true }),
  ]),
  [['text', 0, 'all done.']],
);
// Anthropic encrypts a reasoning block now and then; `content_block.data` is the
// only copy of it that exists, and the server dropped it on the floor, so the
// block was stored empty and replayed as `{data: ''}` on every later turn.
eq(
  'a redacted thinking block carries the opaque payload the model needs back',
  createPartRouter().route(msg('', 'ENCRYPTED', { kind: 'thinking', index: 0, redacted: true })),
  [{ kind: 'thinking', index: 0, text: 'ENCRYPTED', redacted: true }],
);
// The regression this ordering metadata used to cause: `part` says which stream a
// delta belongs to, not that the provider split its reasoning out of `content`.
// A self-hosted OpenAI-compatible endpoint with no reasoning parser streams the
// tags inline AND gets `part` stamped on by our server, so the splitter never ran
// and the whole chain of thought rendered as answer prose.
eq(
  'inline <think> inside a part-stamped text delta is still split out',
  route([
    msg('<think>hidden', '', { kind: 'text', index: 0 }),
    msg(' reasoning</think>answer', '', { kind: 'text', index: 0 }),
  ]),
  [
    ['thinking', 0, 'hidden'],
    ['thinking', 0, ' reasoning'],
    ['text', 1, 'answer'],
  ],
);

console.log('\n2. no part metadata, separate thinking field (Ollama)');
eq(
  'kind flips synthesize increasing indices',
  route([msg('', 'hmm'), msg('answer'), msg('', 'again'), msg(' more')]),
  [
    ['thinking', 0, 'hmm'],
    ['text', 1, 'answer'],
    ['thinking', 2, 'again'],
    ['text', 3, ' more'],
  ],
);
eq('consecutive same-kind deltas stay in one block', route([msg('a'), msg('b'), msg('c')]), [
  ['text', 0, 'a'],
  ['text', 0, 'b'],
  ['text', 0, 'c'],
]);

console.log('\n3. <think> tags inline in content (Qwen/QwQ/R1 via a gateway)');
eq('single span splits into thinking then text', route([msg('<think>reason</think>answer')]), [
  ['thinking', 0, 'reason'],
  ['text', 1, 'answer'],
]);
eq(
  'tag split across chunk boundaries is not leaked as text',
  route([msg('<thi'), msg('nk>rea'), msg('son</thi'), msg('nk>done')]),
  [
    ['thinking', 0, 'rea'],
    ['thinking', 0, 'son'],
    ['text', 1, 'done'],
  ],
);
eq(
  'two spans interleave with text between them',
  route([msg('<think>one</think>mid<think>two</think>end')]),
  [
    ['thinking', 0, 'one'],
    ['text', 1, 'mid'],
    ['thinking', 2, 'two'],
    ['text', 3, 'end'],
  ],
);
eq('<thinking> long form also recognized', route([msg('<thinking>x</thinking>y')]), [
  ['thinking', 0, 'x'],
  ['text', 1, 'y'],
]);
eq('a lone < that never becomes a tag is flushed as text', route([msg('a < b')]), [
  ['text', 0, 'a < b'],
]);
eq('unterminated fragment at stream end is emitted, not swallowed', route([msg('tail<thi')]), [
  ['text', 0, 'tail'],
  ['text', 0, '<thi'],
]);

console.log('\n4. folding deltas into a message');
const base = { id: 'm', role: 'assistant', content: '', createdAt: 1000 };
const folded = withParts(
  base,
  [
    { kind: 'thinking', index: 0, text: 'why' },
    { kind: 'thinking', index: 0, text: ' not', done: true },
    { kind: 'text', index: 1, text: 'Because.' },
    { kind: 'thinking', index: 2, text: 'recheck' },
  ],
  5000,
);
eq(
  'three ordered parts',
  folded.parts.map((p) => [p.kind, p.index, p.text]),
  [
    ['thinking', 0, 'why not'],
    ['text', 1, 'Because.'],
    ['thinking', 2, 'recheck'],
  ],
);
eq('content mirror is text only', folded.content, 'Because.');
eq('reasoning mirror concatenates thinking', folded.reasoning, 'why notrecheck');
eq('closed block carries endedAt', folded.parts[0].endedAt, 5000);
eq('open block has no endedAt', folded.parts[2].endedAt, undefined);

eq(
  'a delta after a CLOSED block of the same index opens a new part',
  withParts(folded, [{ kind: 'thinking', index: 0, text: 'late' }], 6000).parts.length,
  4,
);

console.log('\n5. sealing');
const s = sealed(folded, true, 7000);
eq('seals the trailing open thinking block', s.parts[2].endedAt, 7000);
eq('marks it interrupted', s.parts[2].interrupted, true);
eq('sealing again is a no-op', sealed(s, true, 9000).parts[2].endedAt, 7000);
eq(
  'sealing a message ending in text changes nothing',
  sealed({ ...base, parts: [{ kind: 'text', index: 0, text: 'x' }] }, true, 7000).parts[0].kind,
  'text',
);

console.log('\n6. legacy messages (pre-parts) seed correctly');
eq(
  'all thinking then all text — the only order the flat model could express',
  seedParts({ ...base, content: 'ans', reasoning: 'thought', reasoningTimeMs: 250 }).map((p) => [
    p.kind,
    p.text,
  ]),
  [
    ['thinking', 'thought'],
    ['text', 'ans'],
  ],
);
eq(
  'reasoningTimeMs becomes the seeded block duration',
  seedParts({ ...base, content: 'a', reasoning: 't', reasoningTimeMs: 250 })[0].endedAt - 1000,
  250,
);
eq('a message with neither seeds nothing', seedParts(base).length, 0);
eq(
  'continuing a legacy message appends after its seeded parts',
  withParts({ ...base, content: 'ans', reasoning: 'th' }, [{ kind: 'text', index: 0, text: '!' }])
    .content,
  'ans!',
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
