'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { chat } from '@/lib/api/client';
import { toApiOptions } from '@/lib/api/types';
import { useChatStore } from '@/lib/store/chat-store';
import { useSettings } from '@/lib/store/settings-store';
import { extractWebSource } from '@/lib/sandbox/compose';
import { runSandbox } from '@/lib/sandbox/run';
import { buildHealMessages } from '@/lib/sandbox/heal-prompt';
import { isClean, reportSignature, type SandboxReport, type WebSource } from '@/lib/sandbox/types';

/**
 * `stopped` is distinct from `done`: a user-cancelled run used to land in `done`
 * with `clean: false`, which the badge rendered as "Masih ada masalah" — telling
 * the user their code failed an audit they interrupted.
 */
export type HealPhase = 'idle' | 'running' | 'healing' | 'done' | 'stopped' | 'error';

export interface HealState {
  phase: HealPhase;
  /** Current iteration (1-based) while running/healing. */
  iteration: number;
  maxIterations: number;
  /** The latest sandbox report. */
  report: SandboxReport | null;
  /** The code as it currently stands (updated after each successful heal). */
  source: WebSource | null;
  /** True once the code ran clean. */
  clean: boolean;
  /** User-facing error if the loop itself failed (e.g. model unreachable). */
  error?: string;
}

const INITIAL: HealState = {
  phase: 'idle',
  iteration: 0,
  maxIterations: 0,
  report: null,
  source: null,
  clean: false,
};

/**
 * Drives the audit → fix → re-run loop for one assistant message's web code.
 * The visible preview iframe is passed in so the user watches the same frame
 * that's being audited. Model fixes go through the same `chat()` path as normal
 * generation (browser → Ollama), so there's no server involvement.
 */
export function useSelfHeal(conversationId: string, initialSource: WebSource) {
  const [state, setState] = useState<HealState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);
  /**
   * Latest known-good source, so pressing "Audit & fix" a second time
   * continues from the last fix instead of re-healing the original from scratch
   * and re-spending the whole iteration budget.
   */
  const latestRef = useRef<WebSource | null>(null);

  // Nothing aborted the loop on unmount, so switching conversations mid-run left
  // it iterating against a detached iframe — burning the 8s timeout per pass and
  // issuing further model calls for a panel that no longer exists.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
    },
    [],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState((s) =>
      s.phase === 'idle' || s.phase === 'done' || s.phase === 'stopped'
        ? s
        : { ...s, phase: 'stopped' },
    );
  }, []);

  const run = useCallback(
    async (iframe: HTMLIFrameElement | null) => {
      const settings = useSettings.getState();
      // Clamp at the point of use. The setter clamps, but `importSettings` and a
      // hand-edited localStorage entry both bypass it — and a 0/NaN value meant
      // the loop body never ran, leaving `phase: 'running'` forever with the
      // spinner stuck at "0/0" and no way out but the stop button.
      const rawMax = settings.sandboxMaxIterations;
      const maxIterations = Number.isFinite(rawMax)
        ? Math.max(1, Math.min(8, Math.round(rawMax)))
        : 3;
      const convo = useChatStore.getState().conversations.find((c) => c.id === conversationId);
      const model = convo?.model;

      // Supersede any run still in flight before taking the slot.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      let source = latestRef.current ?? initialSource;
      let lastSignature = '';

      setState({ ...INITIAL, phase: 'running', maxIterations, source });

      for (let i = 1; i <= maxIterations; i++) {
        if (controller.signal.aborted) return;

        setState((s) => ({ ...s, phase: 'running', iteration: i, source }));
        const report = await runSandbox(source, {
          iframe: iframe ?? undefined,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        setState((s) => ({ ...s, report, source }));

        // Clean run — we're done.
        if (isClean(report)) {
          latestRef.current = source;
          setState((s) => ({ ...s, phase: 'done', clean: true, report, source }));
          abortRef.current = null;
          return;
        }

        // No model to heal with, or no budget left — stop with the report shown.
        if (!model || i === maxIterations) {
          setState((s) => ({ ...s, phase: 'done', clean: false, report, source }));
          abortRef.current = null;
          return;
        }

        // A repeated identical failure means the model isn't making progress;
        // bail rather than burn the whole budget on the same error.
        const sig = reportSignature(report);
        if (sig && sig === lastSignature) {
          setState((s) => ({ ...s, phase: 'done', clean: false, report, source }));
          abortRef.current = null;
          return;
        }
        lastSignature = sig;

        // Ask the model to fix it.
        setState((s) => ({ ...s, phase: 'healing', iteration: i, report, source }));
        let reply: string;
        try {
          reply = await chat(
            {
              model,
              messages: buildHealMessages(source, report),
              options: convo ? toApiOptions(convo.params) : undefined,
            },
            controller.signal,
          );
        } catch (err) {
          if (controller.signal.aborted) return;
          setState((s) => ({
            ...s,
            phase: 'error',
            error:
              err instanceof Error ? err.message : 'The model could not be reached for the fix.',
          }));
          abortRef.current = null;
          return;
        }

        const fixed = extractWebSource(reply);
        if (!fixed) {
          // Model didn't return usable code — stop with the current report.
          setState((s) => ({ ...s, phase: 'done', clean: false, report, source }));
          abortRef.current = null;
          return;
        }
        source = fixed;
        latestRef.current = fixed;
      }
    },
    [conversationId, initialSource],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    latestRef.current = null;
    setState(INITIAL);
  }, []);

  return { state, run, stop, reset };
}
