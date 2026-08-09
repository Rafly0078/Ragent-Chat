/** Load-cost probe: long tasks + load timing under 6x CPU throttle. */
import puppeteer from 'puppeteer-core';
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
function chromiumPath() {
  const root = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
  const dir = readdirSync(root).find((d) => d.startsWith('chromium-'));
  for (const sub of ['chrome-win64', 'chrome-win']) {
    const exe = path.join(root, dir, sub, 'chrome.exe');
    if (existsSync(exe)) return exe;
  }
  throw new Error('no chrome');
}
const browser = await puppeteer.launch({ executablePath: chromiumPath(), headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.emulate({ viewport: { width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }, userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36' });
const now = Date.now();
await page.evaluateOnNewDocument((count, now) => {
  const params = { temperature: 0.7, topP: 0.9, topK: 40, repeatPenalty: 1.1, contextLength: 131072, maxTokens: -1, contextAuto: true, maxTokensAuto: true };
  const conversations = Array.from({ length: count }, (_, i) => ({
    id: `seed-${i}`, title: `Seeded conversation number ${i} with a fairly long title`,
    model: 'qwen3:8b', systemPrompt: '', params, thinking: { enabled: false, effort: 'medium' },
    createdAt: now - i * 3600000, updatedAt: now - i * 3600000, pinned: i < 3,
    messages: [{ id: `m${i}a`, role: 'user', content: 'hello '.repeat(40), createdAt: now },
               { id: `m${i}b`, role: 'assistant', content: 'world '.repeat(120), createdAt: now }],
  }));
  localStorage.setItem('ollama-webui:chats', JSON.stringify({ state: { conversations, activeId: 'seed-0' }, version: 5 }));
  window.__long = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] });
}, 60, now);
const client = await page.createCDPSession();
await client.send('Emulation.setCPUThrottlingRate', { rate: 6 });
await page.goto(process.argv[2], { waitUntil: 'networkidle2', timeout: 90000 });
await new Promise((r) => setTimeout(r, 2500));
const out = await page.evaluate(() => ({
  longTasks: window.__long,
  longTaskTotalMs: window.__long.reduce((a, b) => a + b, 0),
  domContentLoadedMs: Math.round(performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd),
  loadMs: Math.round(performance.getEntriesByType('navigation')[0].loadEventEnd),
  // `[class*="group/item"]`, not an escaped `.group\/item`: same match, no
  // backslash for a shell heredoc to swallow.
  rows: document.querySelectorAll('nav[aria-label="Conversations"] [class*="group/item"]').length,
}));
console.log(JSON.stringify(out, null, 2));
await browser.close();
