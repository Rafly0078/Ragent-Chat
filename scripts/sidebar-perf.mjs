/**
 * Measure the mobile sidebar open on a throttled phone-class device.
 *
 * Drives the Playwright-bundled Chromium over CDP (see the memory note: a
 * `--headless --screenshot` run fakes content that never rendered). Emulates a
 * 375x812 touch viewport with 6x CPU throttling, seeds N conversations into the
 * store's persisted key, then opens the drawer and reports long tasks and the
 * frame gap around the animation.
 *
 * Run with:  node scripts/sidebar-perf.mjs [url] [conversationCount]
 */
import puppeteer from 'puppeteer-core';
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const URL = process.argv[2] ?? 'http://localhost:3100/chat';
const COUNT = Number(process.argv[3] ?? 60);

function chromiumPath() {
  const root = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
  const dir = readdirSync(root).find((d) => d.startsWith('chromium-'));
  // The build folder is `chrome-win64` on current Playwright, `chrome-win` on older ones.
  for (const sub of ['chrome-win64', 'chrome-win']) {
    const exe = path.join(root, dir, sub, 'chrome.exe');
    if (existsSync(exe)) return exe;
  }
  throw new Error(`no chrome.exe under ${path.join(root, dir)}`);
}

const browser = await puppeteer.launch({
  executablePath: chromiumPath(),
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  const page = await browser.newPage();
  await page.emulate({
    viewport: { width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
    userAgent:
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
  });

  // Seed before any app script runs, so the store rehydrates with a real list.
  const now = Date.now();
  await page.evaluateOnNewDocument(
    (count, now) => {
      // Full `Conversation` shape. A partial one (no `params`) throws
      // "Cannot read properties of undefined (reading 'contextAuto')" and the
      // error boundary replaces the whole chat page, so nothing gets measured.
      const params = {
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
        repeatPenalty: 1.1,
        contextLength: 131072,
        maxTokens: -1,
        contextAuto: true,
        maxTokensAuto: true,
      };
      const conversations = Array.from({ length: count }, (_, i) => ({
        id: `seed-${i}`,
        title: `Seeded conversation number ${i} with a fairly long title`,
        model: 'qwen3:8b',
        systemPrompt: '',
        params,
        thinking: { enabled: false, effort: 'medium' },
        createdAt: now - i * 3_600_000,
        updatedAt: now - i * 3_600_000,
        pinned: i < 3,
        messages: [
          { id: `m${i}a`, role: 'user', content: 'hello '.repeat(40), createdAt: now },
          { id: `m${i}b`, role: 'assistant', content: 'world '.repeat(120), createdAt: now },
        ],
      }));
      localStorage.setItem(
        'ollama-webui:chats',
        // `version` must match the store's current persist version, or zustand
        // runs the migration chain over this seed and mangles it.
        JSON.stringify({ state: { conversations, activeId: 'seed-0' }, version: 5 }),
      );
    },
    COUNT,
    now,
  );

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60_000 });

  const client = await page.createCDPSession();
  await client.send('Emulation.setCPUThrottlingRate', { rate: 6 });

  // Counted before AND after the toggle: the pre-fix drawer unmounts when
  // closed, so a 0 here is the baseline behaving as expected rather than a
  // failed seed. The post-toggle count is what proves the list actually loaded.
  const countRows = () =>
    page.evaluate(
      () => document.querySelectorAll('nav[aria-label="Conversations"] .group\\/item').length,
    );
  const rowsBefore = await countRows();

  // Long-task and frame instrumentation, installed after load so it only sees
  // the interaction.
  await page.evaluate(() => {
    window.__long = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__long.push(Math.round(e.duration));
    }).observe({ entryTypes: ['longtask'] });

    window.__frames = [];
    let last = performance.now();
    const tick = (t) => {
      window.__frames.push(Math.round(t - last));
      last = t;
      if (window.__recording) requestAnimationFrame(tick);
    };
    window.__start = () => {
      window.__recording = true;
      window.__frames = [];
      last = performance.now();
      requestAnimationFrame(tick);
    };
    window.__stop = () => {
      window.__recording = false;
    };
  });

  await page.waitForSelector('[aria-label="Toggle sidebar"]', { timeout: 30_000 });
  const toggle = await page.$('[aria-label="Toggle sidebar"]');

  await page.evaluate(() => window.__start());
  await toggle.click();
  await new Promise((r) => setTimeout(r, 1400));
  await page.evaluate(() => window.__stop());

  const rowsAfter = await countRows();

  const { longTasks, frames } = await page.evaluate(() => ({
    longTasks: window.__long,
    frames: window.__frames,
  }));

  const dropped = frames.filter((f) => f > 32).length;
  const worst = frames.length ? Math.max(...frames) : 0;
  console.log(
    JSON.stringify(
      {
        rowsBefore,
        rowsAfter,
        longTasks,
        longTaskTotalMs: longTasks.reduce((a, b) => a + b, 0),
        frameCount: frames.length,
        framesOver32ms: dropped,
        worstFrameMs: worst,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
