/**
 * Headless sandbox runner. Mounts a hidden, locked-down iframe, loads a
 * composed document via `srcdoc`, collects the errors its bootstrap posts back,
 * and resolves a SandboxReport once the page signals "done" (or a timeout
 * fires). Browser-only — must run in the DOM, never on the server.
 *
 * The iframe uses `sandbox="allow-scripts"` WITHOUT `allow-same-origin`, so the
 * guest code runs in an opaque origin: it can execute scripts but cannot reach
 * this app's cookies, localStorage, or DOM. postMessage is the only channel.
 */

import { buildBootstrap, SANDBOX_CHANNEL } from './bootstrap';
import { composeDocument } from './compose';
import type { SandboxIssue, SandboxReport, WebSource } from './types';
import { uid } from '@/lib/utils/id';

const RUN_TIMEOUT_MS = 8000;
/**
 * Hard cap on collected issues. An error thrown inside a `requestAnimationFrame`
 * or `setInterval` callback fires once per tick for the whole run — ~480
 * near-identical 2KB messages — which then all went into the heal prompt (~1MB)
 * and blew the model call's own timeout. A looping error is the most common kind,
 * so this is exactly the case the loop has to survive.
 */
const MAX_ISSUES = 25;

/**
 * Run `src` in a throwaway hidden iframe and resolve its report. When an
 * `iframe` is provided (the visible preview), that element is reused so the
 * user sees exactly what was audited; otherwise a hidden one is created and
 * removed on completion.
 */
export function runSandbox(
  src: WebSource,
  opts?: { iframe?: HTMLIFrameElement; signal?: AbortSignal },
): Promise<SandboxReport> {
  return new Promise((resolve) => {
    const runId = uid();
    const bootstrap = buildBootstrap(runId);
    const doc = composeDocument(src, bootstrap);
    const issues: SandboxIssue[] = [];

    // A detached iframe has no browsing context: assigning `srcdoc` loads
    // nothing, no `load` event fires, and the run could only ever time out. Fall
    // back to our own hidden frame if the caller's element is already gone.
    const supplied = opts?.iframe?.isConnected ? opts.iframe : undefined;
    const owned = !supplied;
    const iframe = supplied ?? document.createElement('iframe');
    if (owned) {
      iframe.setAttribute('aria-hidden', 'true');
      iframe.style.cssText =
        'position:fixed;left:-99999px;top:0;width:1024px;height:768px;border:0;visibility:hidden;';
      document.body.appendChild(iframe);
    }
    iframe.setAttribute('sandbox', 'allow-scripts');

    let settled = false;

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      opts?.signal?.removeEventListener('abort', onAbort);
      clearTimeout(timer);
      if (owned) iframe.remove();
    };

    const finish = (blank: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ issues, blank });
    };

    const onMessage = (ev: MessageEvent) => {
      // Verify the SENDER, not just the payload. `__ch` and `runId` are embedded
      // as literals in the guest document, so the audited code can read them off
      // `document.scripts[0].textContent` and forge its own verdict — posting a
      // clean `done` before its errors fire, or injecting arbitrary "issue" text
      // that gets forwarded verbatim into the next model prompt. (Comparing
      // `ev.origin` is useless here: an allow-scripts-only frame is opaque, so
      // its origin is the literal string "null".)
      if (ev.source !== iframe.contentWindow) return;
      const data = ev.data as
        { __ch?: string; runId?: string; type?: string; payload?: unknown } | undefined;
      if (!data || data.__ch !== SANDBOX_CHANNEL || data.runId !== runId) return;
      if (data.type === 'issue') {
        if (issues.length < MAX_ISSUES) issues.push(data.payload as SandboxIssue);
      } else if (data.type === 'done') {
        const payload = data.payload as { blank?: boolean } | undefined;
        finish(Boolean(payload?.blank));
      }
    };

    const onAbort = () => finish(false);

    window.addEventListener('message', onMessage);
    opts?.signal?.addEventListener('abort', onAbort, { once: true });

    // Safety net: if the page never fires "done" (a script hangs before load, or
    // the caller's iframe was detached mid-run), record that as a real failure.
    // Resolving with an empty issue list made `isClean` report success for code
    // that never actually executed.
    const timer = setTimeout(() => {
      issues.push({
        kind: 'error',
        message:
          `The page did not finish loading within ${RUN_TIMEOUT_MS}ms — it may contain an ` +
          'infinite loop or a script that never completes.',
      });
      finish(false);
    }, RUN_TIMEOUT_MS);

    iframe.srcdoc = doc;
  });
}
