'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyText } from '@/lib/utils/clipboard';

/**
 * The reference's "Install via terminal" block: a paper card with a tab row and
 * a copyable one-liner. Here the two tabs are the app's two real connection
 * modes, so the block teaches something instead of decorating.
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
    <div className="w-full max-w-xl">
      <p className="type-eyebrow mb-2 text-content-muted">Connect your models</p>
      <div className="overflow-hidden rounded-[4px] bg-white text-[#0000f2]">
        <div
          className="flex items-center gap-1 border-b border-[#0000f2]/15 px-2 py-1.5"
          role="tablist"
          aria-label="Connection mode"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={active === t.id}
              onClick={() => setActive(t.id)}
              className={`focus-ring px-2.5 py-1 font-mono text-[0.7rem] uppercase tracking-[0.1em] transition-colors ${
                active === t.id
                  ? 'bg-[#0000f2] text-white'
                  : 'text-[#0000f2]/60 hover:text-[#0000f2]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-start gap-3 px-3 py-3">
          <code className="min-w-0 flex-1 break-all font-mono text-[0.78rem] leading-6">
            {tab.cmd}
          </code>
          <button
            onClick={() => void copy()}
            aria-label={copied ? 'Copied' : 'Copy command'}
            className="focus-ring shrink-0 p-1 text-[#0000f2]/60 transition-colors hover:text-[#0000f2]"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <p className="mt-2 font-mono text-[0.72rem] leading-5 text-content-muted">{tab.hint}</p>
    </div>
  );
}
