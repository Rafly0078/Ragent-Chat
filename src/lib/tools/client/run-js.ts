'use client';

/**
 * Run a snippet of JavaScript for the model and hand back what it printed.
 *
 * Browser-only, and that is the point: the runner is an iframe with
 * `sandbox="allow-scripts"` and NO `allow-same-origin`, so guest code executes in
 * an opaque origin where it cannot reach this app's cookies, localStorage or DOM.
 * postMessage is the only channel out. `/api/tools/execute` could not host this —
 * running model-authored code on the server would be arbitrary RCE in the
 * deployment, and `node:vm` is not a security boundary.
 *
 * The isolation and the sender-verification pattern are taken from
 * lib/sandbox/run.ts, which already reasoned them through. Two things are added
 * here that the audit runner does not need:
 *
 *  - console/result CAPTURE. That runner collects errors; this one has to report
 *    what the code produced, which is the whole answer.
 *  - a Content-Security-Policy of `default-src 'none'`. `allow-scripts` alone
 *    still permits fetch/XHR to any public host, so without this the model could
 *    use `run_js` to exfiltrate whatever it had been shown in the conversation.
 *    Nothing loads, nothing connects; only compute.
 */

export const RUN_JS_CHANNEL = 'ragent-run-js';
const CHANNEL = RUN_JS_CHANNEL;
/** Wall-clock budget. A `while(true)` must not wedge the tab. */
const RUN_TIMEOUT_MS = 5_000;
/** Cap on returned text, so a runaway loop can't fill the context window. */
const MAX_OUTPUT_CHARS = 20_000;
const MAX_LINES = 500;

interface RunMessage {
  __ch?: string;
  runId?: string;
  type?: 'log' | 'done';
  payload?: unknown;
}

/** One captured console call or the final expression value. */
interface LogLine {
  stream: 'log' | 'warn' | 'error' | 'result';
  text: string;
}

/**
 * The guest document: a CSP-locked page whose only script is the harness plus an
 * indirect `eval` of the snippet.
 *
 * Exported so a real browser can be pointed at it in a test — the interesting
 * behaviour (capture, error handling, promise awaiting, the timeout) only exists
 * inside an iframe, so asserting on it in node would prove nothing.
 */
export function buildRunDocument(runId: string, code: string): string {
  // Two escapes, both load-bearing.
  //
  // `srcdoc` content is parsed as HTML, so a `</script>` anywhere in the model's
  // code would close the guest's script element early and the rest of the snippet
  // would render as page text. `JSON.stringify` escapes quotes and newlines, not
  // HTML — so `</` is additionally escaped to `<\/`, which JSON and JS both read
  // back as a plain `/`, leaving the executed code byte-identical.
  const embedded = JSON.stringify(code).replace(/<\//g, '<\\/');
  return `<!DOCTYPE html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval';">
</head><body><script>
(function () {
  var CH = ${JSON.stringify(CHANNEL)};
  var RUN = ${JSON.stringify(runId)};
  var count = 0;
  function send(type, payload) {
    try { parent.postMessage({ __ch: CH, runId: RUN, type: type, payload: payload }, '*'); } catch (e) {}
  }
  // Values are rendered here, in the guest realm, because a DOM node or a
  // function cannot cross postMessage's structured clone — the whole run would
  // fail with a DataCloneError instead of reporting the value.
  function render(v, depth) {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    var t = typeof v;
    if (t === 'string') return depth ? JSON.stringify(v) : v;
    if (t === 'number' || t === 'boolean' || t === 'bigint') return String(v);
    if (t === 'function') return '[Function' + (v.name ? ': ' + v.name : '') + ']';
    if (t === 'symbol') return String(v);
    if (v instanceof Error) return (v.stack || (v.name + ': ' + v.message));
    if ((depth || 0) > 4) return '[deep]';
    try {
      return JSON.stringify(v, function (k, val) {
        if (typeof val === 'bigint') return String(val);
        if (typeof val === 'function') return '[Function]';
        return val;
      }, 2);
    } catch (e) {
      try { return String(v); } catch (e2) { return '[unrenderable]'; }
    }
  }
  function line(stream, args) {
    if (count++ > ${MAX_LINES}) return;
    var parts = [];
    for (var i = 0; i < args.length; i++) parts.push(render(args[i], 0));
    send('log', { stream: stream, text: parts.join(' ') });
  }
  console.log = function () { line('log', arguments); };
  console.info = function () { line('log', arguments); };
  console.debug = function () { line('log', arguments); };
  console.warn = function () { line('warn', arguments); };
  console.error = function () { line('error', arguments); };

  window.onerror = function (msg, src, l, c, err) {
    line('error', [err && err.stack ? err.stack : msg]);
    send('done', {});
    return true;
  };
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev && ev.reason;
    line('error', [r && r.stack ? r.stack : String(r)]);
  });

  // Indirect eval, so the snippet runs in global scope and can use \`const\`,
  // function declarations and top-level await-free async patterns naturally.
  // This is why the CSP above needs 'unsafe-eval' — which grants nothing here
  // beyond what running the code already implies. The origin is still opaque and
  // \`default-src 'none'\` still blocks every fetch, so the snippet can compute
  // and nothing else.
  var result;
  try {
    result = (0, eval)(${embedded});
  } catch (e) {
    line('error', [e && e.stack ? e.stack : String(e)]);
    send('done', {});
    return;
  }

  // A returned promise is awaited: async work is the common case and reporting
  // "[object Promise]" would be useless.
  if (result && typeof result.then === 'function') {
    result.then(
      function (v) { if (v !== undefined) send('log', { stream: 'result', text: render(v, 0) }); send('done', {}); },
      function (e) { line('error', [e && e.stack ? e.stack : String(e)]); send('done', {}); }
    );
    return;
  }
  if (result !== undefined) send('log', { stream: 'result', text: render(result, 0) });
  send('done', {});
})();
</script></body></html>`;
}

/**
 * Execute `code` in the sandbox and resolve its captured output.
 *
 * Never rejects on guest-code failure — a thrown exception IS the result the
 * model needs to see, so it comes back as an `error` line.
 */
export function runJs(code: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve('Error: run_js needs a browser and this ran on the server.');
      return;
    }
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const lines: LogLine[] = [];
    let settled = false;

    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.style.cssText = 'position:fixed;left:-99999px;top:0;width:1px;height:1px;border:0;';

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
      clearTimeout(timer);
      iframe.remove();
    };

    const finish = (note?: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (note) lines.push({ stream: 'error', text: note });
      resolve(format(lines));
    };

    const onMessage = (ev: MessageEvent) => {
      // Verify the SENDER, not the payload. `runId` is embedded as a literal in
      // the guest document, so the code being run can read it back off its own
      // <script> and forge messages — including a premature `done` that hides
      // its errors, or fabricated output that goes straight to the model.
      // (`ev.origin` is useless: an allow-scripts-only frame is opaque, so its
      // origin is the literal string "null".)
      if (ev.source !== iframe.contentWindow) return;
      const data = ev.data as RunMessage | undefined;
      if (!data || data.__ch !== CHANNEL || data.runId !== runId) return;
      if (data.type === 'log') {
        const payload = data.payload as LogLine | undefined;
        if (payload && lines.length <= MAX_LINES) {
          lines.push({ stream: payload.stream ?? 'log', text: String(payload.text ?? '') });
        }
      } else if (data.type === 'done') {
        finish();
      }
    };

    const onAbort = () => finish('Cancelled.');

    window.addEventListener('message', onMessage);
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(
      () =>
        finish(
          `The snippet did not finish within ${RUN_TIMEOUT_MS / 1000}s — it may contain an infinite loop or wait on something that never resolves.`,
        ),
      RUN_TIMEOUT_MS,
    );

    document.body.appendChild(iframe);
    iframe.srcdoc = buildRunDocument(runId, code);
  });
}

/** Assemble captured lines into the text handed back as the tool result. */
function format(lines: LogLine[]): string {
  if (lines.length === 0) {
    return 'The snippet ran and produced no output. Use console.log, or end with an expression, to return something.';
  }
  const body = lines
    .slice(0, MAX_LINES)
    .map((l) => {
      if (l.stream === 'result') return `=> ${l.text}`;
      if (l.stream === 'error') return `Error: ${l.text}`;
      if (l.stream === 'warn') return `Warning: ${l.text}`;
      return l.text;
    })
    .join('\n');
  const clipped =
    lines.length > MAX_LINES ? `\n… ${lines.length - MAX_LINES} more lines omitted.` : '';
  const out = body + clipped;
  return out.length > MAX_OUTPUT_CHARS
    ? `${out.slice(0, MAX_OUTPUT_CHARS)}\n… truncated at ${MAX_OUTPUT_CHARS} characters.`
    : out;
}
