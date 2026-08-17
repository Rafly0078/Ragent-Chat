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

/** Capture the body the proxy POSTS upstream, without caring what comes back. */
async function sentBody(protocol, messages, options) {
  let captured;
  globalThis.fetch = async (_url, init) => {
    captured = JSON.parse(init.body);
    return sse([{ choices: [{ delta: { content: 'ok' } }, { finish_reason: 'stop' }] }]);
  };
  const res = await providerChat(
    { provider: 'custom', baseUrl: 'https://example.com/v1', apiKey: 'k', protocol },
    { model: 'test-model', messages, stream: true, ...(options ? { options } : {}) },
  );
  await res.text();
  return captured;
}

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

console.log('\n5. the reasoning goes back with the tool call that produced it');
{
  // What the gateway rejected the turn over: "[invalid_request_error] The
  // `reasoning_content` in the thinking mode must be passed back to the API" — after
  // the files had already been written, so the work was done and thrown away.
  const body = await sentBody('openai', [
    { role: 'user', content: 'build me a landing page' },
    {
      role: 'assistant',
      content: '',
      reasoning: 'three files, start with the markup',
      toolCalls: [{ id: 'c1', name: 'create_html', arguments: { name: 'index.html' } }],
    },
    { role: 'tool', toolCallId: 'c1', content: 'Created "index.html".' },
  ]);

  const assistant = body.messages.find((m) => m.role === 'assistant');
  eq(
    'reasoning_content is echoed',
    assistant?.reasoning_content,
    'three files, start with the markup',
  );
  eq('the call is still replayed', assistant?.tool_calls?.[0]?.function?.name, 'create_html');
  eq(
    'the tool result keeps its id',
    body.messages.find((m) => m.role === 'tool')?.tool_call_id,
    'c1',
  );

  // Nothing new reaches a provider that never streamed reasoning: a strict endpoint
  // rejecting an unknown message field is a worse failure than the one being fixed.
  const plain = await sentBody('openai', [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
  ]);
  eq(
    'no reasoning, no field',
    'reasoning_content' in (plain.messages.find((m) => m.role === 'assistant') ?? {}),
    false,
  );
}

console.log('\n6. anthropic: the request never starts on the assistant');
{
  // What context compaction can leave behind. It picks its cut by token budget, so
  // the keep window can open on the model's ANSWER rather than the question that
  // produced it — and on this protocol every system message, the summary included,
  // is folded into `system`, so nothing stands in front of it. Anthropic answers
  // 400 ("first message must use the \"user\" role"), the client reads that 400 as
  // "this model can't do thinking" and disables the toggle, and the next send
  // recomputes the same cut — so the conversation stays bricked rather than
  // recovering on its own.
  const compacted = await sentBody('anthropic', [
    { role: 'system', content: 'Summary of the earlier conversation: the build broke.' },
    { role: 'assistant', content: 'so that is why it failed.' },
    { role: 'user', content: 'ok, fix it' },
  ]);
  eq(
    'the orphaned answer is dropped',
    compacted.messages.map((m) => m.role),
    ['user'],
  );
  eq('the summary still travels as system', typeof compacted.system, 'string');

  const normal = await sentBody('anthropic', [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
    { role: 'user', content: 'more' },
  ]);
  eq(
    'a well-formed history is untouched',
    normal.messages.map((m) => m.role),
    ['user', 'assistant', 'user'],
  );
}

console.log('\n7. max_tokens is clamped by context headroom, not only by the ceiling');
{
  // `num_predict` arriving here is usually NOT a number the user typed: with
  // maxTokensAuto on (the default) the client resolves the slider's -1 into the
  // provider's published output ceiling and sends that. Passing it through
  // untouched put a ~95k-token prompt plus a 32768-token completion reservation
  // into a 128k window, and the upstream's "maximum context length is 128000
  // tokens" reply names no max_tokens field, so `rejectsMaxTokens` didn't match
  // and there was no retry either — the turn just died.
  const clamped = await sentBody('openai', [{ role: 'user', content: 'x'.repeat(380_000) }], {
    num_ctx: 128_000,
    num_predict: 32_768,
  });
  eq('asks for what is left of the window', clamped.max_tokens < 32_768, true);
  eq('and still asks for something usable', clamped.max_tokens >= 4_096, true);

  const explicit = await sentBody('openai', [{ role: 'user', content: 'hi' }], {
    num_ctx: 128_000,
    num_predict: 1_000,
  });
  eq('a small deliberate budget is never raised', explicit.max_tokens, 1_000);
}

console.log('\n8. an encrypted thinking block keeps the one copy of itself that exists');
{
  // `content_block.data` is reasoning Anthropic's classifier encrypted: opaque to
  // us, readable by the model, and never sent again. It used to be parsed off the
  // event and dropped, so the block was stored with empty text — the reasoning was
  // gone for good, and every later turn replayed it as `{data: ''}`, which the API
  // documents as a block that must go back unmodified.
  const out = await chunks('anthropic', [
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'redacted_thinking', data: 'ENCRYPTEDBLOB' },
    },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'answer' } },
    { type: 'message_stop' },
  ]);
  const block = out.find((c) => c.part?.redacted);
  eq('the payload reaches the client as the block text', block?.message?.thinking, 'ENCRYPTEDBLOB');
  eq('and is still flagged redacted', block?.part, {
    kind: 'thinking',
    index: 0,
    redacted: true,
  });

  const replayed = await sentBody('anthropic', [
    { role: 'user', content: 'q' },
    { role: 'assistant', content: 'a', thinking: [{ text: 'ENCRYPTEDBLOB', redacted: true }] },
    { role: 'user', content: 'q2' },
  ]);
  eq('it goes back unmodified', replayed.messages[1].content[0], {
    type: 'redacted_thinking',
    data: 'ENCRYPTEDBLOB',
  });

  const legacy = await sentBody('anthropic', [
    { role: 'user', content: 'q' },
    { role: 'assistant', content: 'a', thinking: [{ text: '', redacted: true }] },
    { role: 'user', content: 'q2' },
  ]);
  eq(
    'a block stored empty before the fix is skipped, not sent as data:""',
    legacy.messages[1].content.map((c) => c.type),
    ['text'],
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
