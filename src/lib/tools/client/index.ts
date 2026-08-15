'use client';

/**
 * Tools that execute in the BROWSER rather than through /api/tools/execute.
 *
 * `ToolMeta.server` has existed since the registry was written and every tool
 * set it to `true`, so it never discriminated anything. It does now: some
 * capabilities cannot run on the server, and forcing them there would be either
 * impossible or unsafe.
 *
 *   run_js          — executing model-authored code server-side is arbitrary RCE
 *                     inside the deployment. In the browser it runs in an
 *                     origin-isolated iframe where the worst case is the user's
 *                     own tab.
 *   read_attachment — the extracted text lives in the chat store and is never
 *                     uploaded, so the server has nothing to read.
 *
 * Like the server table in ../executors/index.ts, entries are lazily imported so
 * a tool's implementation is only fetched once the model actually calls it.
 */

import type { GenerateRequest, ToolName } from '../types';

/** Client executors return text for the model, never a file. */
export type ClientExecutorFn = (
  req: GenerateRequest,
  signal?: AbortSignal,
) => Promise<{ text: string }>;

const loaders: Partial<Record<ToolName, () => Promise<ClientExecutorFn>>> = {
  run_js: async () => {
    const { runJs } = await import('./run-js');
    return async (req, signal) => {
      const code = typeof req.content === 'string' ? req.content : '';
      if (!code.trim()) throw new Error('run_js needs JavaScript in "content".');
      return { text: await runJs(code, signal) };
    };
  },
  read_attachment: async () => (await import('./read-attachment')).default,
};

export async function getClientExecutor(tool: ToolName): Promise<ClientExecutorFn | undefined> {
  const load = loaders[tool];
  return load ? load() : undefined;
}
