/**
 * The wire contract that lets the UI say a file is being written WHILE it is being
 * written: a tool call has to announce itself as soon as its name is known, not when
 * its arguments are complete.
 *
 * That distinction is the whole point. A document tool's argument IS the document, so
 * the assembled `tool_calls` chunk arrives a minute after the model started typing —
 * and until this signal existed the turn looked finished and idle for that minute.
 *
 * Both protocols are checked, because they learn the name at different moments:
 * OpenAI puts it in the first `tool_calls` fragment, Anthropic in the block header.
 *
 * The upstream is stubbed at `globalThis.fetch`; the URL is public so the SSRF guard
 * (which resolves DNS) passes before the stub takes over. Needs working DNS.
 *
 * Run: node scripts/verify-tool-stream.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const require = createRequire(pathToFileURL(`${ROOT}/package.json`).href);
const jiti = require('jiti')(`${ROOT}/verify.js`, {
  alias: { '@': `${ROOT}/src`, 'server-only': `${ROOT}/scripts/_empty-module.cjs` },
  interopDefault: true,
  esmResolve: true,
});

const { providerChat } = jiti(`${ROOT}/src/lib/providers/server.ts`);

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

/** An SSE body, one `data:` frame per event. */
function sse(events) {
  const body = events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`);
  return new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const frame of body) controller.enqueue(encoder.encode(frame));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}
/** Drive one upstream transcript through the proxy and return the NDJSON it emits. */
async function chunks(protocol, events) {
  globalThis.fetch = async () => sse(events);
  const res = await providerChat(
    { provider: 'custom', baseUrl: 'https://example.com/v1', apiKey: 'k', protocol },
    { model: 'test-model', messages: [{ role: 'user', content: 'hi' }], stream: true },
  );
  const text = await res.text();
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

const indexOfStart = (out) => out.findIndex((c) => c.tool_call_start);
const indexOfCalls = (out) => out.findIndex((c) => c.tool_calls?.length);

console.log('\n1. openai: the name arrives in the first fragment, the arguments trickle');
{
  // Exactly the shape an OpenAI-compatible gateway streams for one document tool:
  // name first, then the file as argument fragments, then a terminal finish_reason.
  const out = await chunks('openai', [
    { choices: [{ delta: { content: 'Writing it now.' } }] },
    {
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, id: 'c1', function: { name: 'create_html', arguments: '' } }],
          },
        },
      ],
    },
    {
      choices: [
        { delta: { tool_calls: [{ index: 0, function: { arguments: '{"name":"landing",' } }] } },
      ],
    },
    {
      choices: [
        { delta: { tool_calls: [{ index: 0, function: { arguments: '"content":"<h1>Hi' } }] } },
      ],
    },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '</h1>"}' } }] } }] },
    { choices: [{ finish_reason: 'tool_calls' }] },
    '[DONE]',
  ]);

  eq('announces create_html', out[indexOfStart(out)]?.tool_call_start, { name: 'create_html' });
  eq('announced exactly once', out.filter((c) => c.tool_call_start).length, 1);
  eq(
    'announced BEFORE the assembled call — the whole point',
    indexOfStart(out) < indexOfCalls(out),
    true,
  );
  eq('the assembled call still carries the arguments', out[indexOfCalls(out)]?.tool_calls?.[0], {
    id: 'c1',
    name: 'create_html',
    arguments: { name: 'landing', content: '<h1>Hi</h1>' },
  });
  eq('the text delta is untouched', out[0]?.message?.content, 'Writing it now.');
}
console.log('\n2. anthropic: the name is in the block header, before any argument byte');
{
  const out = await chunks('anthropic', [
    { type: 'message_start', message: { model: 'claude', usage: { input_tokens: 5 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'On it.' } },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'tool_use', id: 'tu1', name: 'create_pdf' },
    },
    {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'input_json_delta', partial_json: '{"title":"Report"}' },
    },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
    { type: 'message_stop' },
  ]);

  eq('announces create_pdf', out[indexOfStart(out)]?.tool_call_start, { name: 'create_pdf' });
  eq('announced before the assembled call', indexOfStart(out) < indexOfCalls(out), true);
  eq('assembled with its input', out[indexOfCalls(out)]?.tool_calls?.[0]?.arguments, {
    title: 'Report',
  });
}

console.log('\n3. a read tool announces too — the caller decides what it means');
{
  // `writesFile` in lib/tools/registry is what separates "writing a file" from
  // "reading a page"; the wire stays dumb on purpose.
  const out = await chunks('openai', [
    {
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, id: 'c9', function: { name: 'fetch_url', arguments: '{}' } }],
          },
        },
      ],
    },
    { choices: [{ finish_reason: 'tool_calls' }] },
  ]);
  eq('announced', out[indexOfStart(out)]?.tool_call_start, { name: 'fetch_url' });
}

console.log('\n4. no tools, no noise');
{
  const out = await chunks('openai', [
    { choices: [{ delta: { content: 'Just an answer.' } }] },
    { choices: [{ finish_reason: 'stop' }] },
  ]);
  eq('nothing announced', out.filter((c) => c.tool_call_start).length, 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
