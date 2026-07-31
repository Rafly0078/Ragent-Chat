'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Download,
  Palette,
  Plus,
  Server,
  Sliders,
  Terminal,
  Trash2,
  Upload,
  Sparkles,
  Smartphone,
  User,
} from 'lucide-react';
import { AmbientBackground } from '@/components/AmbientBackground';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { useSettings } from '@/lib/store/settings-store';
import { useChatStore } from '@/lib/store/chat-store';
import { ACCENT_PRESETS } from '@/lib/store/defaults';
import { useModels } from '@/features/models/use-models';
import { useHydrated } from '@/lib/hooks/use-hydrated';
import { API_BASE_URL } from '@/lib/api/config';
import { downloadText } from '@/lib/utils/export';
import { uid } from '@/lib/utils/id';
import { usePWAInstall } from '@/lib/hooks/use-pwa-install';
import { cn } from '@/lib/utils/cn';
import { APP_NAME, APP_VERSION } from '@/lib/app-meta';
import { AccountSection } from '@/features/auth/AccountSection';
import type { PromptPreset } from '@/types';

type SectionId = 'account' | 'appearance' | 'connection' | 'prompt' | 'params' | 'app' | 'data';

const NAV: { id: SectionId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'account', label: 'Account', icon: User },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'connection', label: 'Connection', icon: Server },
  { id: 'prompt', label: 'System prompt', icon: Terminal },
  { id: 'params', label: 'Generation', icon: Sliders },
  { id: 'app', label: 'Install app', icon: Smartphone },
  { id: 'data', label: 'Data & backup', icon: Download },
];

export default function SettingsPage() {
  const hydrated = useHydrated();
  const s = useSettings();
  const { models } = useModels();
  const { toast } = useToast();

  const conversations = useChatStore((st) => st.conversations);
  const importConversations = useChatStore((st) => st.importConversations);
  const fileRef = useRef<HTMLInputElement>(null);
  const chatFileRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState<SectionId>('account');

  const exportSettings = () => {
    const payload = {
      theme: s.theme,
      accent: s.accent,
      apiUrlOverride: s.apiUrlOverride,
      connectionMode: s.connectionMode,
      defaultModel: s.defaultModel,
      defaultSystemPrompt: s.defaultSystemPrompt,
      defaultParams: s.defaultParams,
      presets: s.presets,
      animatedBackground: s.animatedBackground,
      sendOnEnter: s.sendOnEnter,
      showTokenCounter: s.showTokenCounter,
      sandboxAutoHeal: s.sandboxAutoHeal,
      sandboxMaxIterations: s.sandboxMaxIterations,
    };
    downloadText(
      'ollama-webui-settings.json',
      JSON.stringify(payload, null, 2),
      'application/json',
    );
    toast('Settings exported', 'success');
  };

  const importSettings = async (file: File) => {
    try {
      const data: unknown = JSON.parse(await file.text());
      s.importSettings(data);
      toast('Settings imported', 'success');
    } catch {
      toast('Invalid settings file', 'error');
    }
  };

  const exportChats = () => {
    downloadText(
      'ollama-webui-chats.json',
      JSON.stringify(conversations, null, 2),
      'application/json',
    );
    toast('Conversations exported', 'success');
  };

  const importChats = async (file: File) => {
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      toast('Invalid conversations file', 'error');
      return;
    }
    // The store validates and coerces, and reports how many survived. A file
    // that parses as JSON but holds nothing usable used to be written straight
    // into the store — and localStorage — where it crashed the sidebar on every
    // render, including after a reload.
    const imported = importConversations(data, false);
    if (imported === 0) {
      toast('No valid conversations found in that file', 'error');
      return;
    }
    toast(`Imported ${imported} conversation${imported === 1 ? '' : 's'}`, 'success');
  };

  if (!hydrated) return <div className="min-h-[100dvh]" />;

  return (
    <>
      <AmbientBackground />
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-5xl flex-col px-4 py-6 sm:py-10">
        {/* The back link is an eyebrow above the title rather than an icon beside
            it. As a bare arrow it read as a stray glyph next to a 40px display
            word; as a labelled link it says where it goes. */}
        <header className="mb-10">
          <Link
            href="/chat"
            className="type-label focus-ring group mb-6 inline-flex items-center gap-2 text-content-muted transition-colors duration-fast hover:text-content"
          >
            <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-fast group-hover:-translate-x-0.5" />
            Back to chat
          </Link>
          <h1 className="type-display text-[clamp(1.75rem,4vw,2.5rem)] text-content">Settings</h1>
          <p className="mt-3 max-w-md text-sm leading-6 text-content-muted">
            Synced to your account when signed in; local otherwise.
          </p>
        </header>

        <div className="flex flex-col gap-6 pb-14 md:flex-row md:items-start md:gap-10">
          {/* Section nav: sticky rail on desktop, horizontal scroller on mobile.
              The active item takes a 2px acid rail, not a fill — a fill of any
              colour measures ~1.1:1 against this field, and the rail is the same
              idiom the chat sidebar uses for the same reason. */}
          <nav className="md:sticky md:top-10 md:w-52 md:shrink-0">
            <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:mx-0 md:flex-col md:gap-0 md:overflow-visible md:px-0 md:pb-0">
              {NAV.map((item) => {
                const Icon = item.icon;
                const isActive = active === item.id;
                return (
                  <li key={item.id} className="shrink-0 md:shrink">
                    <button
                      onClick={() => setActive(item.id)}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'type-label focus-ring relative flex w-full items-center gap-2.5 whitespace-nowrap py-2.5 pl-4 pr-3 transition-colors duration-fast',
                        isActive
                          ? 'bg-border/10 text-content'
                          : 'text-content-muted hover:bg-border/[0.06] hover:text-content',
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'absolute inset-y-0 left-0 w-[2px] transition-colors duration-fast',
                          isActive ? 'bg-accent' : 'bg-transparent',
                        )}
                      />
                      <Icon className={cn('h-4 w-4 shrink-0', isActive && 'text-accent')} />
                      {item.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Active section */}
          <div className="min-w-0 flex-1">
            {/* Account */}
            {active === 'account' && <AccountSection />}

            {/* Appearance */}
            {active === 'appearance' && (
              <Section icon={Palette} title="Appearance">
                <Field label="Canvas">
                  <p className="text-sm leading-6 text-content-muted">
                    One canvas, everywhere: the electric-blue field with off-white type. There is no
                    light/dark switch because the design has no light/dark pair &mdash; only the
                    accent below is adjustable.
                  </p>
                </Field>

                <Field label="Accent color">
                  <div className="flex flex-wrap gap-2">
                    {ACCENT_PRESETS.map((a) => (
                      <button
                        key={a.value}
                        onClick={() => s.setAccent(a.value)}
                        className={cn(
                          'flex h-9 items-center gap-2 rounded-xl border px-3 text-sm transition-colors',
                          s.accent === a.value
                            ? 'border-border/30 text-content'
                            : 'border-border/15 text-content-muted',
                        )}
                        style={{
                          boxShadow:
                            s.accent === a.value ? `0 0 0 2px rgb(${a.rgb} / 0.4)` : undefined,
                        }}
                      >
                        <span
                          className="h-4 w-4 rounded-full"
                          style={{ background: `rgb(${a.rgb})` }}
                        />
                        {a.name}
                      </button>
                    ))}
                  </div>
                </Field>

                <ToggleRow
                  label="Animated background"
                  description="Ambient gradient blobs. Disable to save battery."
                  checked={s.animatedBackground}
                  onChange={() => s.toggle('animatedBackground')}
                />
                <ToggleRow
                  label="Send on Enter"
                  description="Enter sends, Shift+Enter for newline. Ctrl+Enter always sends."
                  checked={s.sendOnEnter}
                  onChange={() => s.toggle('sendOnEnter')}
                />
                <ToggleRow
                  label="Show token counter"
                  description="Estimate tokens while typing."
                  checked={s.showTokenCounter}
                  onChange={() => s.toggle('showTokenCounter')}
                />
              </Section>
            )}

            {/* Connection */}
            {active === 'connection' && (
              <Section icon={Server} title="Connection">
                <Field
                  label="Connection mode"
                  hint={
                    s.connectionMode === 'direct'
                      ? 'Browser talks straight to Ollama. No duration limit, but the Ollama server needs CORS enabled (OLLAMA_ORIGINS).'
                      : "Routed through this app's server, which forwards to Ollama. No CORS setup needed, but a single reply is capped by the host's function duration (e.g. ~300s on Vercel Hobby)."
                  }
                >
                  <div className="flex gap-2">
                    {(
                      [
                        { value: 'direct', label: 'Direct' },
                        { value: 'bridge', label: 'Via server' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => s.setConnectionMode(opt.value)}
                        className={cn(
                          'btn-surface h-9 flex-1',
                          s.connectionMode === opt.value &&
                            'border-accent/50 bg-accent/10 text-content',
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </Field>

                {s.connectionMode === 'direct' ? (
                  <Field
                    label="API URL"
                    hint="Your Ollama server's public URL (e.g. a Cloudflare Tunnel address). Overrides NEXT_PUBLIC_API_URL for this browser only."
                  >
                    <input
                      value={s.apiUrlOverride}
                      onChange={(e) => s.setApiUrlOverride(e.target.value)}
                      placeholder={API_BASE_URL || 'https://my-ollama-tunnel.trycloudflare.com'}
                      className="input font-mono text-sm"
                      spellCheck={false}
                    />
                    <p className="mt-1.5 text-xs text-content-subtle">
                      Active endpoint:{' '}
                      <code className="text-accent-soft">{API_BASE_URL || '(unset)'}</code> — the
                      browser connects to this directly, so make sure CORS is enabled on the Ollama
                      server (<code className="text-accent-soft">OLLAMA_ORIGINS</code>).
                    </p>
                  </Field>
                ) : (
                  <Field label="Server endpoint">
                    <p className="text-xs text-content-subtle">
                      Requests go to <code className="text-accent-soft">/api/bridge/*</code> on this
                      app&apos;s server, which forwards to the{' '}
                      <code className="text-accent-soft">OLLAMA_API_URL</code> configured in the
                      deployment&apos;s environment variables — nothing to set here.
                    </p>
                  </Field>
                )}

                <Field label="Default model">
                  <select
                    value={s.defaultModel}
                    onChange={(e) => s.setDefaultModel(e.target.value)}
                    className="input"
                  >
                    <option value="">Auto (first available)</option>
                    {models.map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </Section>
            )}

            {/* System prompt */}
            {active === 'prompt' && (
              <Section icon={Terminal} title="Default system prompt">
                <textarea
                  value={s.defaultSystemPrompt}
                  onChange={(e) => s.setDefaultSystemPrompt(e.target.value)}
                  rows={4}
                  className="input resize-none font-mono text-[0.85rem] leading-relaxed"
                />
                <PresetManager presets={s.presets} />
              </Section>
            )}

            {/* Default generation params */}
            {active === 'params' && (
              <Section icon={Sliders} title="Default generation parameters">
                <div className="space-y-6">
                  <Slider
                    label="Temperature"
                    value={s.defaultParams.temperature}
                    min={0}
                    max={2}
                    step={0.05}
                    onChange={(v) => s.setDefaultParams({ temperature: v })}
                    format={(v) => v.toFixed(2)}
                  />
                  <Slider
                    label="Top P"
                    value={s.defaultParams.topP}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(v) => s.setDefaultParams({ topP: v })}
                    format={(v) => v.toFixed(2)}
                  />
                  <Slider
                    label="Top K"
                    value={s.defaultParams.topK}
                    min={0}
                    max={100}
                    step={1}
                    onChange={(v) => s.setDefaultParams({ topK: v })}
                  />
                  <Slider
                    label="Repeat penalty"
                    value={s.defaultParams.repeatPenalty}
                    min={0.8}
                    max={2}
                    step={0.01}
                    onChange={(v) => s.setDefaultParams({ repeatPenalty: v })}
                    format={(v) => v.toFixed(2)}
                  />
                  <Slider
                    label="Context length"
                    value={s.defaultParams.contextLength}
                    min={512}
                    max={131072}
                    step={512}
                    onChange={(v) => s.setDefaultParams({ contextLength: v })}
                  />
                  <Slider
                    label="Max tokens"
                    value={s.defaultParams.maxTokens}
                    min={-1}
                    max={8192}
                    step={1}
                    onChange={(v) => s.setDefaultParams({ maxTokens: v })}
                  />
                </div>

                <div className="mt-6 space-y-4 border-t border-border/60 pt-5">
                  <ToggleRow
                    label="Auto-audit & perbaiki kode"
                    description="Setelah kode web (HTML/CSS/JS) selesai dibuat, jalankan di sandbox, deteksi error, lalu minta model memperbaikinya otomatis sampai bersih. Membuat panggilan model tambahan."
                    checked={s.sandboxAutoHeal}
                    onChange={() => s.toggle('sandboxAutoHeal')}
                  />
                  <Slider
                    label="Maksimum iterasi perbaikan"
                    value={s.sandboxMaxIterations}
                    min={1}
                    max={8}
                    step={1}
                    onChange={(v) => s.setSandboxMaxIterations(v)}
                  />
                </div>
              </Section>
            )}

            {/* Install app (PWA) */}
            {active === 'app' && (
              <Section icon={Smartphone} title="Install app">
                <InstallAppSection />
              </Section>
            )}

            {/* Data */}
            {active === 'data' && (
              <Section icon={Download} title="Data & backup">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Button variant="surface" onClick={exportSettings}>
                    <Download className="h-4 w-4" /> Export settings
                  </Button>
                  <Button variant="surface" onClick={() => fileRef.current?.click()}>
                    <Upload className="h-4 w-4" /> Import settings
                  </Button>
                  <Button variant="surface" onClick={exportChats}>
                    <Download className="h-4 w-4" /> Export chats ({conversations.length})
                  </Button>
                  <Button variant="surface" onClick={() => chatFileRef.current?.click()}>
                    <Upload className="h-4 w-4" /> Import chats
                  </Button>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) void importSettings(e.target.files[0]);
                    e.target.value = '';
                  }}
                />
                <input
                  ref={chatFileRef}
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) void importChats(e.target.files[0]);
                    e.target.value = '';
                  }}
                />
                <div className="mt-4 rounded-xl border border-error/20 bg-error/5 p-4">
                  <p className="text-sm font-medium text-content">Reset settings</p>
                  <p className="mt-0.5 text-xs text-content-muted">
                    Restores default theme, prompts and parameters. Conversations are kept.
                  </p>
                  <Button
                    variant="danger"
                    className="mt-3 h-9"
                    onClick={() => {
                      s.reset();
                      toast('Settings reset to defaults');
                    }}
                  >
                    <Trash2 className="h-4 w-4" /> Reset settings
                  </Button>
                </div>
              </Section>
            )}
          </div>
        </div>

        {/* Pushed to the bottom of the viewport. Short panels (Account is three
            lines) used to leave the colophon stranded mid-field with hundreds of
            pixels of nothing under it.

            The ghosted wordmark is the reference's own page-closing device, and
            it earns its place here: it turns the void a two-line panel leaves
            behind into the composed bottom of the page instead of a gap. */}
        <div className="mt-auto">
          <div className="pointer-events-none w-full select-none" aria-hidden>
            <span className="hw-ghost block w-full text-center text-[13vw]">{APP_NAME}</span>
          </div>
          <div className="hw-rule flex flex-wrap items-center justify-between gap-x-6 gap-y-2 pt-6">
            <span className="type-label inline-flex items-center gap-2 text-content-muted">
              <Sparkles className="h-3.5 w-3.5 text-accent" />
              {APP_NAME} — private, local-first AI
            </span>
            <span className="type-label text-content-subtle">{APP_VERSION}</span>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Panel shell.
 *
 * The entrance is a CSS animation, not a framer-motion mount tween. As
 * `initial={{ opacity: 0 }}` it meant the panel's content was invisible until JS
 * hydrated and the tween ran — a settings page whose text depends on a
 * decorative animation having completed. `animate-fade-in` uses `both` fill, so
 * it paints with the stylesheet and the reduced-motion rule in globals.css
 * collapses it to its end state.
 */
function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass mb-6 animate-fade-in p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <Icon className="h-5 w-5 text-accent" />
        <h2 className="type-display text-xl text-content">{title}</h2>
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="type-label mb-2 block text-content">{label}</label>
      {hint && <p className="mb-2 text-xs text-content-subtle">{hint}</p>}
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-content">{label}</p>
        <p className="text-xs text-content-muted">{description}</p>
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

function PresetManager({ presets }: { presets: PromptPreset[] }) {
  const addPreset = useSettings((st) => st.addPreset);
  const updatePreset = useSettings((st) => st.updatePreset);
  const removePreset = useSettings((st) => st.removePreset);
  const [name, setName] = useState('');
  const [content, setContent] = useState('');

  return (
    <div className="mt-4">
      <p className="mb-2 text-sm font-medium text-content">Prompt presets</p>
      <div className="space-y-2">
        {presets.map((p) => (
          <div
            key={p.id}
            className="flex flex-col gap-2 rounded-xl border border-border/15 bg-border/[0.02] p-2 sm:flex-row sm:items-start"
          >
            <input
              value={p.name}
              onChange={(e) => updatePreset(p.id, { name: e.target.value })}
              className="input h-9 w-full text-sm sm:h-8 sm:w-40 sm:shrink-0"
            />
            <textarea
              value={p.content}
              onChange={(e) => updatePreset(p.id, { content: e.target.value })}
              rows={2}
              className="input min-w-0 flex-1 resize-none text-xs"
            />
            <button
              onClick={() => removePreset(p.id)}
              className="btn-ghost h-9 w-9 shrink-0 self-end rounded-lg text-content-subtle hover:text-error sm:h-8 sm:w-8 sm:self-start"
              aria-label={`Delete ${p.name}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Preset name"
          className="input h-9 w-full text-sm sm:h-8 sm:w-40 sm:shrink-0"
        />
        <input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Prompt content…"
          className="input h-9 min-w-0 flex-1 text-sm sm:h-8"
        />
        <button
          onClick={() => {
            if (!name.trim() || !content.trim()) return;
            addPreset({ id: uid(), name: name.trim(), content: content.trim() });
            setName('');
            setContent('');
          }}
          className="btn-surface h-9 w-9 shrink-0 self-end rounded-lg sm:h-8 sm:w-8 sm:self-start"
          aria-label="Add preset"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function InstallAppSection() {
  const { canInstall, installed, isIOS, promptInstall } = usePWAInstall();

  if (installed) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/5 p-4">
        <Smartphone className="h-5 w-5 text-success" />
        <div>
          <p className="text-sm font-medium text-content">App is installed</p>
          <p className="text-xs text-content-muted">
            You&apos;re running Ragent as an installed app. Launch it from your home screen.
          </p>
        </div>
      </div>
    );
  }

  if (isIOS) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 rounded-xl border border-border/15 bg-surface-raised p-4">
          <Smartphone className="h-5 w-5 text-accent" />
          <div>
            <p className="text-sm font-medium text-content">Install on iOS</p>
            <p className="text-xs text-content-muted">
              Tap the Share button in Safari, then &ldquo;Add to Home Screen&rdquo; to install this
              app.
            </p>
          </div>
        </div>
        <p className="text-xs text-content-subtle">
          iOS doesn&apos;t support the automatic install prompt — you need to add it manually from
          the Share sheet. Once installed, it works like a native app: full screen, its own icon,
          and no browser chrome.
        </p>
      </div>
    );
  }

  if (!canInstall) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 rounded-xl border border-border/15 bg-surface-raised p-4">
          <Smartphone className="h-5 w-5 text-accent" />
          <div>
            <p className="text-sm font-medium text-content">Install as an app</p>
            <p className="text-xs text-content-muted">
              The install button will appear here automatically once Chrome detects this app is
              installable (usually after a few seconds of browsing).
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-border/50 bg-border/5 p-3 text-xs text-content-subtle">
          <p className="mb-1 font-medium text-content-muted">Manual install:</p>
          <ul className="list-inside list-disc space-y-0.5">
            <li>
              <b>Chrome/Edge (Android):</b> Menu (⋮) → Install app
            </li>
            <li>
              <b>Chrome/Edge (Desktop):</b> Menu (⋮) → Install {`\u201C`}Ragent{`\u201D`}
            </li>
            <li>
              <b>Safari (iOS):</b> Share → Add to Home Screen
            </li>
          </ul>
        </div>
        <p className="text-xs text-content-subtle">
          Tip: run <code className="text-accent-soft">npm run build && npm run start</code> for the
          best PWA experience — the dev server sometimes delays the install prompt.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/5 p-4">
        <Smartphone className="h-5 w-5 text-accent" />
        <div className="flex-1">
          <p className="text-sm font-medium text-content">Install Ragent</p>
          <p className="text-xs text-content-muted">
            Install this app on your device for quick access — it opens in its own window and feels
            like a native app. It still needs a connection to reach your models.
          </p>
        </div>
      </div>
      <Button variant="primary" onClick={() => void promptInstall()}>
        <Smartphone className="h-4 w-4" /> Install app
      </Button>
    </div>
  );
}
