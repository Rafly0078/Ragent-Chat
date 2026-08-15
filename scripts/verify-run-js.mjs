/**
 * Exercises `run_js` in a REAL browser, because that is the only place it exists:
 * console capture, error handling, promise awaiting, and the CSP network block all
 * live inside an origin-isolated iframe. Asserting on any of it in node would
 * prove nothing.
 *
 * The harness is served over http://127.0.0.1 rather than file://, because a
 * file:// parent gets an opaque origin of its own and Chromium then treats the
 * sandboxed srcdoc child differently than it does in production.
 *
 * Run: node scripts/verify-run-js.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const require = createRequire(pathToFileURL(`${ROOT}/package.json`).href);
const jiti = require('jiti')(`${ROOT}/verify.js`, {
  alias: { '@': `${ROOT}/src` },
  interopDefault: true,
  esmResolve: true,
});
const { buildRunDocument, RUN_JS_CHANNEL } = jiti(`${ROOT}/src/lib/tools/client/run-js.ts`);

const RUN_ID = 'test-run';

/**
 * A parent page that mounts the guest exactly as run-js.ts does — same sandbox
 * attribute, same sender verification — and stashes what it captured on
 * `window.__result` for CDP to read.
 */
function harness(code) {
  const guest = buildRunDocument(RUN_ID, code);
  // `</script>` inside the JSON literal would close the parent's script block —
  // JSON.stringify escapes quotes, not HTML. The parent then fails to parse and
  // no iframe is ever created, which looks exactly like "the sandbox produced
  // nothing". Production doesn't hit this: run-js.ts assigns `srcdoc` from JS.
  const embedded = JSON.stringify(guest).replace(/<\//g, '<\\/');
  return `<!DOCTYPE html><html><body><script>
window.__result = null;
var lines = [];
var iframe = document.createElement('iframe');
iframe.setAttribute('sandbox', 'allow-scripts');
window.addEventListener('message', function (ev) {
  if (ev.source !== iframe.contentWindow) return;
  var d = ev.data;
  if (!d || d.__ch !== ${JSON.stringify(RUN_JS_CHANNEL)} || d.runId !== ${JSON.stringify(RUN_ID)}) return;
  if (d.type === 'log') lines.push(d.payload.stream + '|' + d.payload.text);
  else if (d.type === 'done') window.__result = lines;
});
document.body.appendChild(iframe);
iframe.srcdoc = ${embedded};
setTimeout(function () { if (!window.__result) window.__result = lines.concat(['TIMEOUT|']); }, 6000);
</script></body></html>`;
}

/** Chromium ships with Playwright; layout differs by build, so probe. */
function findChromium() {
  const base = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  for (const dir of readdirSync(base)) {
    if (!dir.startsWith('chromium')) continue;
    for (const sub of ['chrome-win64', 'chrome-win', 'chrome-linux']) {
      for (const exe of ['chrome.exe', 'chrome', 'headless_shell.exe', 'headless_shell']) {
        const p = join(base, dir, sub, exe);
        if (existsSync(p)) return p;
      }
    }
  }
  throw new Error('no Playwright Chromium found');
}

const cases = new Map();
const server = createServer((req, res) => {
  const code = cases.get((req.url ?? '/').slice(1));
  if (code === undefined) {
    res.writeHead(404).end('no such case');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(harness(code));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const profile = mkdtempSync(join(tmpdir(), 'runjs-'));
const debugPort = 9411 + Math.floor(Math.random() * 200);
const chrome = spawn(
  findChromium(),
  [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageSocket() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* not listening yet */
    }
    await sleep(250);
  }
  throw new Error('Chromium never exposed a page target');
}

const ws = await pageSocket();
const sock = new WebSocket(ws);
await new Promise((res, rej) => {
  sock.addEventListener('open', res, { once: true });
  sock.addEventListener('error', rej, { once: true });
});
let msgId = 0;
const pending = new Map();
sock.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  pending.get(msg.id)?.(msg);
  pending.delete(msg.id);
});
const cdp = (method, params) =>
  new Promise((res) => {
    const id = ++msgId;
    pending.set(id, res);
    sock.send(JSON.stringify({ id, method, params }));
  });

await cdp('Page.enable', {});

let n = 0;
/** Serve `code`, load it, and return the lines the harness collected. */
async function run(code) {
  const path = `c${n++}`;
  cases.set(path, code);
  await cdp('Page.navigate', { url: `${origin}/${path}` });
  for (let i = 0; i < 50; i++) {
    await sleep(150);
    const r = await cdp('Runtime.evaluate', {
      expression: 'JSON.stringify(window.__result)',
      returnByValue: true,
    });
    const value = r.result?.result?.value;
    if (value && value !== 'null') return JSON.parse(value);
  }
  return ['NO_RESULT|'];
}

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

try {
  console.log('\n1. capture');
  eq('console.log is captured', await run('console.log("hi", 42)'), ['log|hi 42']);
  eq('a trailing expression is returned', await run('2 + 3'), ['result|5']);
  eq('objects are rendered, not [object Object]', await run('({a:1})'), ['result|{\n  "a": 1\n}']);
  eq('console.error is tagged', await run('console.error("bad")'), ['error|bad']);
  eq('multiple logs keep their order', await run('console.log(1);console.log(2)'), [
    'log|1',
    'log|2',
  ]);

  console.log('\n2. failure is a result, not a crash');
  const thrown = await run('throw new Error("boom")');
  eq(
    'a thrown error comes back as an error line',
    thrown[0]?.startsWith('error|Error: boom'),
    true,
  );
  eq('and nothing else', thrown.length, 1);

  console.log('\n3. code that could break out of the document');
  // `srcdoc` is parsed as HTML, so an unescaped `</script>` in the snippet would
  // close the guest's script element and the rest would render as page text.
  eq('a closing script tag in a string is harmless', await run('console.log("a</script>b")'), [
    'log|a</script>b',
  ]);
  eq(
    'a closing script tag in a regex is harmless',
    await run('console.log(/<\\/script>/.source)'),
    ['log|<\\/script>'],
  );
  eq('a template literal with backticks survives', await run('`x${1 + 1}y`'), ['result|x2y']);

  console.log('\n3. async');
  eq('a returned promise is awaited', await run('Promise.resolve(7)'), ['result|7']);
  eq(
    'a rejected promise is reported',
    (await run('Promise.reject(new Error("nope"))'))[0]?.startsWith('error|Error: nope'),
    true,
  );

  console.log('\n4. isolation');
  // CSP is `default-src 'none'`, so fetch must fail rather than reach the network.
  eq(
    'network is blocked by CSP',
    await run('fetch("https://example.com").then(() => "REACHED", () => "BLOCKED")'),
    ['result|BLOCKED'],
  );
  // An opaque origin has no accessible storage; touching it throws.
  eq(
    'localStorage is unreachable',
    await run('try { localStorage.setItem("k","v"); "REACHED" } catch (e) { "BLOCKED" }'),
    ['result|BLOCKED'],
  );
  // No `allow-same-origin`, so the parent document is cross-origin to the guest.
  eq(
    'the parent DOM is unreachable',
    await run('try { String(parent.document.title); "REACHED" } catch (e) { "BLOCKED" }'),
    ['result|BLOCKED'],
  );

  console.log(`\n${pass} passed, ${fail} failed`);
} finally {
  sock.close();
  chrome.kill();
  server.close();
  await sleep(300);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* Windows may still hold the profile files */
  }
}

process.exit(fail === 0 ? 0 : 1);
