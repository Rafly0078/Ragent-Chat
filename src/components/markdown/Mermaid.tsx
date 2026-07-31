'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Renders a Mermaid diagram from source. Mermaid is loaded lazily (dynamic
 * import) so it never touches the initial bundle — it only downloads when a
 * diagram actually appears in a message.
 *
 * While the message is still streaming, rendering is deferred entirely. A
 * partially-streamed diagram is syntactically incomplete, so a full
 * parse + layout + sanitize ran (and threw) on *every token*; worse, mermaid's
 * failure path skips its own temp-node cleanup, leaving an orphaned <div> with a
 * full error SVG attached to document.body for every failed attempt.
 */
export function Mermaid({ code, streaming = false }: { code: string; streaming?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  /** Off-DOM container handed to mermaid so it never appends to document.body. */
  const scratchRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (streaming) return;
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        if (cancelled) return;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          securityLevel: 'strict',
          fontFamily: 'var(--font-sans)',
        });
        if (!scratchRef.current) {
          const el = document.createElement('div');
          el.style.cssText = 'position:absolute;left:-99999px;top:0;';
          document.body.appendChild(el);
          scratchRef.current = el;
        }
        const { svg: rendered } = await mermaid.render(
          `mermaid-${id}`,
          code.trim(),
          scratchRef.current,
        );
        if (!cancelled) {
          setSvg(rendered);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to render diagram');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, id, streaming]);

  // Remove the scratch container (and anything mermaid left inside it) on unmount.
  useEffect(
    () => () => {
      scratchRef.current?.remove();
      scratchRef.current = null;
    },
    [],
  );

  if (streaming) {
    return (
      <div className="my-4 h-32 animate-pulse rounded-xl border border-border/15 bg-border/5" />
    );
  }

  if (error) {
    return (
      <div className="my-4 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-medium">Couldn&apos;t render Mermaid diagram</p>
          <pre className="mt-1 overflow-x-auto text-xs text-warning/70">{code}</pre>
        </div>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-4 h-32 animate-pulse rounded-xl border border-border/15 bg-border/5" />
    );
  }

  return (
    <div
      ref={hostRef}
      className="my-4 flex justify-center overflow-x-auto rounded-xl border border-border/15 bg-border/[0.02] p-4"
      // Mermaid output is sanitized (securityLevel: 'strict').
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
