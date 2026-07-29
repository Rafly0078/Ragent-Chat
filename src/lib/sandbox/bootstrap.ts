/**
 * The bootstrap script injected as the first element in the sandboxed iframe.
 * It wires up error capture (window.onerror, unhandledrejection, console
 * error/warn) and a post-load "blank render" check, then posts everything back
 * to the parent window via postMessage.
 *
 * Kept as a plain string (not a module) because it runs inside the iframe's
 * own realm, not the app bundle. `__SANDBOX_CHANNEL__` is a shared tag so the
 * parent can ignore unrelated messages.
 */

export const SANDBOX_CHANNEL = 'ollama-webui-sandbox';

/** The bootstrap source, parameterized by the channel + a per-run id. */
export function buildBootstrap(runId: string): string {
  return `(function () {
  var CH = ${JSON.stringify(SANDBOX_CHANNEL)};
  var RUN = ${JSON.stringify(runId)};
  var issues = [];
  var MAX_ISSUES = 25;
  function send(type, payload) {
    try {
      parent.postMessage({ __ch: CH, runId: RUN, type: type, payload: payload }, '*');
    } catch (e) {}
  }
  // Capped and de-duplicated: an error inside a rAF/setInterval callback fires
  // once per tick for the whole run, which otherwise produced hundreds of
  // identical entries and a heal prompt too big for the model call to survive.
  function push(kind, message) {
    if (!message || issues.length >= MAX_ISSUES) return;
    var text = String(message);
    if (text.length > 2000) text = text.slice(0, 2000) + '…';
    for (var i = 0; i < issues.length; i++) {
      if (issues[i].message === text) return;
    }
    issues.push({ kind: kind, message: text });
    send('issue', { kind: kind, message: text });
  }

  window.onerror = function (msg, src, line, col, err) {
    var detail = (err && err.stack) ? err.stack : msg;
    if (line) detail += ' (line ' + line + ')';
    push('error', detail);
    return false;
  };
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev && ev.reason;
    push('error', (r && r.stack) ? r.stack : (r && r.message) ? r.message : String(r));
  });

  var origError = console.error;
  console.error = function () {
    push('console-error', Array.prototype.join.call(arguments, ' '));
    try { origError.apply(console, arguments); } catch (e) {}
  };
  var origWarn = console.warn;
  console.warn = function () {
    push('console-warn', Array.prototype.join.call(arguments, ' '));
    try { origWarn.apply(console, arguments); } catch (e) {}
  };

  function isBlank() {
    // Blank-render detection: is there any visible content? An empty/whitespace
    // body with no sized elements means a white screen.
    try {
      var body = document.body;
      var text = body ? (body.innerText || '').trim() : '';
      var hasVisual = body ? body.querySelector('img,canvas,svg,video,input,button,table,ul,ol,[style*="background"]') : null;
      var painted = body ? (body.getBoundingClientRect().height > 4) : false;
      return !text && !hasVisual && !painted;
    } catch (e) {
      return false;
    }
  }

  // Poll instead of sampling once at +400ms: anything that paints later (a fetch
  // for data, an entrance animation, a deferred canvas draw) was reported blank,
  // and the heal loop then spent a model call "fixing" working code.
  function settle(attempt) {
    if (!isBlank() || attempt >= 6) {
      send('done', { blank: isBlank() });
      return;
    }
    setTimeout(function () { settle(attempt + 1); }, 400);
  }

  if (document.readyState === 'complete') {
    setTimeout(function () { settle(0); }, 400);
  } else {
    window.addEventListener('load', function () { setTimeout(function () { settle(0); }, 400); });
  }
})();`;
}
