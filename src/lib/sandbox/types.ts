/**
 * Sandbox engine — shared types. Browser-safe (no server-only imports): the
 * runner, the self-heal loop, and the UI all depend on these.
 *
 * The sandbox runs model-authored web code (HTML/CSS/JS) inside a locked-down
 * iframe, captures runtime errors, and (optionally) feeds them back to the
 * model so it can fix its own output — a "self-heal" loop that repeats until
 * the code runs clean or a caller-supplied iteration budget is exhausted.
 */

/** The three code fences that make up a runnable web preview. */
export interface WebSource {
  /** HTML — either a full document or a body fragment. Always present when runnable. */
  html: string;
  /** Concatenated CSS from all ```css blocks. */
  css: string;
  /** Concatenated JS from all ```js / ```javascript blocks. */
  js: string;
}

export type SandboxIssueKind = 'error' | 'console-error' | 'console-warn' | 'render';

/** One problem observed while running the code in the sandbox. */
export interface SandboxIssue {
  kind: SandboxIssueKind;
  message: string;
}

/** The outcome of a single sandbox run. */
export interface SandboxReport {
  issues: SandboxIssue[];
  /** True when the page rendered nothing visible (blank/white screen). */
  blank: boolean;
}

/** Whether a report represents a clean run (no errors, something rendered). */
export function isClean(report: SandboxReport): boolean {
  const hasError = report.issues.some((i) => i.kind === 'error' || i.kind === 'console-error');
  return !hasError && !report.blank;
}

/** A stable signature for a report, used to detect a stalled heal loop. */
export function reportSignature(report: SandboxReport): string {
  return (
    (report.blank ? 'blank|' : '') +
    report.issues
      .filter((i) => i.kind === 'error' || i.kind === 'console-error')
      .map((i) => i.message)
      .sort()
      .join('||')
  );
}
