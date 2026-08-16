import 'server-only';

import type { Browser } from 'puppeteer-core';

/**
 * Headless Chromium, in two very different environments.
 *
 * On Vercel/Lambda the binary comes from `@sparticuz/chromium`, which ships a
 * brotli-compressed build and expands it into /tmp on first use. Locally that
 * package is useless — it is a Linux x64 build — so development uses whatever
 * Chrome or Edge the machine already has.
 *
 * Nothing here throws a bare error: a failure to launch is reported as a
 * `BrowserUnavailableError`, which the PDF executor uses to decide whether to
 * fall back to the pdf-lib renderer rather than losing the user's document.
 */

export class BrowserUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'BrowserUnavailableError';
  }
}

/** True when running on Vercel or bare AWS Lambda. */
function isServerless(): boolean {
  return Boolean(
    process.env.AWS_LAMBDA_FUNCTION_VERSION ||
    process.env.AWS_EXECUTION_ENV ||
    (process.env.VERCEL && process.env.NODE_ENV === 'production'),
  );
}

/**
 * Local Chrome/Edge locations, in preference order.
 * `CHROME_PATH` wins so a developer with a non-standard install can point at it.
 */
function localCandidates(): string[] {
  const env = [process.env.CHROME_PATH, process.env.PUPPETEER_EXECUTABLE_PATH].filter(
    (p): p is string => Boolean(p),
  );
  const platform = process.platform;
  if (platform === 'win32') {
    const roots = [
      process.env['PROGRAMFILES'],
      process.env['PROGRAMFILES(X86)'],
      process.env['LOCALAPPDATA'],
    ].filter((p): p is string => Boolean(p));
    const rel = [
      'Google\\Chrome\\Application\\chrome.exe',
      'Microsoft\\Edge\\Application\\msedge.exe',
      'Chromium\\Application\\chrome.exe',
    ];
    return [...env, ...roots.flatMap((r) => rel.map((x) => `${r}\\${x}`))];
  }
  if (platform === 'darwin') {
    return [
      ...env,
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  }
  return [
    ...env,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/snap/bin/chromium',
  ];
}

async function firstExisting(paths: string[]): Promise<string | null> {
  const { access } = await import('node:fs/promises');
  for (const p of paths) {
    try {
      await access(p);
      return p;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/**
 * Launch a browser. Callers must `close()` it.
 *
 * Deliberately not pooled. A warm singleton across invocations sounds cheaper,
 * but a serverless container can be frozen mid-request and resumed with a dead
 * CDP socket, which surfaces as an unexplained hang on a later, unrelated
 * document rather than a clean cold start.
 */
export async function launchBrowser(): Promise<Browser> {
  const puppeteer = await import('puppeteer-core');

  if (isServerless()) {
    // Loaded through the promise chain rather than a try/catch around an `await`,
    // so the binding needs no type annotation: the only one available for this
    // module is an `import()` type, which the lint rule forbids for good reason —
    // it hides a dependency from every reader who greps for imports.
    const chromium = await import('@sparticuz/chromium')
      .then((m) => m.default)
      .catch((err: unknown) => {
        throw new BrowserUnavailableError(
          `@sparticuz/chromium is not installed or failed to load: ${describe(err)}`,
        );
      });
    try {
      // `graphics: false` keeps swiftshader out of the bundle — nothing here
      // needs WebGL, and it is a large chunk of the cold-start unpack cost.
      chromium.setGraphicsMode = false;
      const executablePath = await chromium.executablePath();
      return await puppeteer.launch({
        args: [...chromium.args, '--font-render-hinting=none'],
        defaultViewport: { width: 1240, height: 1754 },
        executablePath,
        headless: true,
      });
    } catch (err) {
      throw new BrowserUnavailableError(`Chromium failed to start on Lambda: ${describe(err)}`);
    }
  }

  const executablePath = await firstExisting(localCandidates());
  if (!executablePath) {
    throw new BrowserUnavailableError(
      'No local Chrome/Chromium/Edge found. Set CHROME_PATH to a browser executable to render PDFs in development.',
    );
  }
  try {
    return await puppeteer.launch({
      executablePath,
      headless: true,
      defaultViewport: { width: 1240, height: 1754 },
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    });
  } catch (err) {
    throw new BrowserUnavailableError(`Failed to launch ${executablePath}: ${describe(err)}`);
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
