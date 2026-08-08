'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyText } from '@/lib/utils/clipboard';

/**
 * The reference's "Install via terminal" block: a paper card with a tab row and
 * a copyable one-liner. Tabs cover both Ollama modes and cloud-provider setup.
 */
const TABS = [
  {
    id: 'tunnel',
    label: 'Tunnel',
    hint: 'Expose your local Ollama over HTTPS, then point OLLAMA_API_URL at it.',
    cmd: 'cloudflared tunnel --url http://localhost:11434',
  },
  {
    id: 'direct',
    label: 'Direct',
    hint: 'Let the browser talk to Ollama itself. Needs your origin allowed.',
    cmd: 'OLLAMA_ORIGINS=https://your-app.vercel.app ollama serve',
  },
  {
    id: 'cloud',
    label: 'Cloud',
    hint: 'Pick OpenAI, Anthropic, OpenRouter, Groq, DeepSeek, or a custom HTTPS endpoint.',
    cmd: 'Settings → Connection → Provider',
  },
] as const;

export function InstallBlock() {
  const [active, setActive] = useState<(typeof TABS)[number]['id']>('tunnel');
  const [copied, setCopied] = useState(false);
  const tab = TABS.find((t) => t.id === active) ?? TABS[0];

  const copy = async () => {
    const ok = await copyText(tab.cmd);
    setCopied(ok);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="w-full max-w-2xl">
      <p className="type-eyebrow mb-4">Connect your models</p>
      {/* `.paper` flips the whole token set to ink-on-white for this subtree, so
          the card is written in `text-content` / `bg-accent` like everything else
          instead of in literals. It is the one paper surface in the product — a
          sheet under the lamp.

          The shadow is written literally rather than taken from `shadow-float`:
          `.paper` rebinds the elevation tokens to light-mode alphas for the
          benefit of anything nested inside it, but this card casts onto the night
          field, so it needs the dark drop the field expects. */}
      <div className="paper overflow-hidden rounded-lg shadow-[0_18px_50px_-18px_rgb(2_4_10_/_0.8)]">
        <div
          className="flex items-center gap-1 border-b border-border/15 px-2 py-2"
          role="tablist"
          aria-label="Connection mode"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={active === t.id}
              onClick={() => setActive(t.id)}
              className={`focus-ring rounded px-3 py-1.5 font-mono text-[0.7rem] uppercase tracking-[0.08em] transition-colors duration-fast ${
                active === t.id
                  ? 'bg-accent text-accent-fg'
                  : 'hover:bg-border/8 text-content-subtle hover:text-content'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-start gap-3 px-4 py-4">
          <span aria-hidden className="select-none pt-px font-mono text-[0.78rem] text-accent">
            $
          </span>
          <code className="min-w-0 flex-1 break-all font-mono text-[0.8rem] leading-6 text-content">
            {tab.cmd}
          </code>
          <button
            onClick={() => void copy()}
            aria-label={copied ? 'Copied' : 'Copy command'}
            className="focus-ring hover:bg-border/8 -m-1.5 shrink-0 rounded p-1.5 text-content-subtle transition-colors duration-fast hover:text-content"
          >
            {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <p className="mt-3 max-w-prose font-mono text-[0.72rem] leading-5 text-content-subtle">
        {tab.hint}
      </p>
    </div>
  );
}
