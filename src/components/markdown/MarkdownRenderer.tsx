'use client';

// Heavy markdown pipeline. This whole module (react-markdown + remark/rehype +
// KaTeX + highlight.js, and their CSS) is code-split behind a next/dynamic
// boundary in ./Markdown, so none of it touches the initial bundle or FCP.
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github-dark.css';

import { memo, useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import { AlertTriangle } from 'lucide-react';
import { CodeBlock } from './CodeBlock';
import { Mermaid } from './Mermaid';
import { PatchBlock } from './PatchBlock';

/** Minimal structural type for a hast node — avoids a hard dep on `hast` types. */
interface HastNode {
  type: string;
  value?: string;
  children?: HastNode[];
}

/** Recursively extract raw text from a hast node (for the copy button + mermaid). */
function nodeToString(node?: HastNode): string {
  if (!node) return '';
  let out = '';
  for (const child of node.children ?? []) {
    if (child.type === 'text') out += child.value ?? '';
    else if (child.type === 'element') out += nodeToString(child);
  }
  return out;
}

/**
 * Shown in place of a ```artifact code fence once streaming has finished.
 * By the time this renders, `detectArtifacts` (src/lib/tools/detect.ts) has
 * already run against the full message and stripped every block it could
 * parse — so any ```artifact fence still present here is, by construction,
 * one that failed to parse. Surfacing that clearly (instead of falling
 * through to the generic CodeBlock, which just labels it "ARTIFACT" and
 * looks like a normal finished block) avoids the illusion that a file was
 * produced when nothing was actually generated.
 */
function ArtifactDirectiveNotice({ raw, streaming }: { raw: string; streaming: boolean }) {
  if (streaming) {
    // Still being generated — this is completely normal mid-stream, not a
    // failure yet. Render with the same neutral chrome as any other block.
    return (
      <CodeBlock language="artifact" raw={raw}>
        <code>{raw}</code>
      </CodeBlock>
    );
  }
  return (
    <div className="my-2 flex items-start gap-2 rounded-xl border border-error/30 bg-error/5 p-3 text-sm text-error">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-medium">File wasn&apos;t created</p>
        <p className="text-error/80">
          The model&apos;s response for this file was cut short or malformed, so nothing was
          generated. Try Regenerate, or ask for a shorter document.
        </p>
      </div>
    </div>
  );
}

function makeComponents(streaming: boolean): Components {
  return {
    // Let our CodeBlock own the <pre>; unwrap the default one.
    pre({ children }) {
      return <>{children}</>;
    },
    code({ className, children, node, ...props }) {
      const match = /language-(\w+)/.exec(className ?? '');
      const raw = nodeToString(node as HastNode);
      const isBlock = Boolean(match) || raw.includes('\n');

      if (!isBlock) {
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      }

      const lang = match?.[1];
      if (lang === 'mermaid') {
        return <Mermaid code={raw} streaming={streaming} />;
      }
      if (lang === 'artifact') {
        return <ArtifactDirectiveNotice raw={raw} streaming={streaming} />;
      }
      if (lang === 'codepatch') {
        return <PatchBlock raw={raw} streaming={streaming} />;
      }

      return (
        <CodeBlock language={lang} raw={raw}>
          <code className={className}>{children}</code>
        </CodeBlock>
      );
    },
    a({ children, href, ...props }) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
          {children}
        </a>
      );
    },
    table({ children }) {
      return (
        <div className="table-wrap">
          <table>{children}</table>
        </div>
      );
    },
  };
}

const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  const components = useMemo(() => makeComponents(streaming), [streaming]);
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, [rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

export default MarkdownRenderer;
