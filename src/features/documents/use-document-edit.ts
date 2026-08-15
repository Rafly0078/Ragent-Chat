'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Artifact, GenerateRequest } from '@/lib/tools/types';
import { useChatStore } from '@/lib/store/chat-store';
import { extractDocumentText } from '@/lib/utils/files';
import { chat } from '@/lib/api/client';

/** Buffering an arbitrary upload on the main thread freezes the tab. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export interface DocumentEditState {
  /** The original uploaded file */
  originalFile: File | null;
  /** Extracted text content from the file */
  extractedContent: string;
  /** AI-improved content */
  improvedContent: string;
  /** Generated artifact from the improved content */
  generatedArtifact: Artifact | null;
  /** Current step in the flow */
  step:
    | 'idle'
    | 'extracting'
    | 'extracted'
    | 'improving'
    | 'improved'
    | 'generating'
    | 'done'
    | 'error';
  /** Error message if something failed */
  error: string | null;
}

const INITIAL: DocumentEditState = {
  originalFile: null,
  extractedContent: '',
  improvedContent: '',
  generatedArtifact: null,
  step: 'idle',
  error: null,
};

export function useDocumentEdit(conversationId: string | null) {
  const [state, setState] = useState<DocumentEditState>(INITIAL);
  /**
   * The dialog that owns this hook is mounted permanently (ChatInput renders it
   * unconditionally; Modal only conditionally renders its children), so closing
   * it did not cancel anything. A request that landed after `reset()` wrote its
   * result back onto the cleared state — reopening the dialog then showed step 1
   * empty, step 2 "Content improved", and step 3 ready to generate a document
   * from content the user had just discarded.
   */
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
    },
    [],
  );

  /** Start a new request, superseding any in flight. */
  const beginRequest = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    return controller;
  }, []);

  const extractContent = useCallback(
    async (file: File) => {
      const controller = beginRequest();
      if (file.size > MAX_UPLOAD_BYTES) {
        setState((s) => ({
          ...s,
          originalFile: null,
          step: 'error',
          error: `"${file.name}" is larger than 25 MB.`,
        }));
        return;
      }
      setState((s) => ({ ...s, originalFile: file, step: 'extracting', error: null }));

      try {
        const text = await extractFileContent(file);
        if (controller.signal.aborted) return;
        if (!text.trim()) {
          throw new Error(
            `Could not extract text from "${file.name}". The file may be empty or unsupported.`,
          );
        }
        setState((s) => ({ ...s, extractedContent: text, step: 'extracted' }));
      } catch (err) {
        if (controller.signal.aborted) return;
        setState((s) => ({
          ...s,
          step: 'error',
          error: err instanceof Error ? err.message : 'Failed to extract file content',
        }));
      }
    },
    [beginRequest],
  );

  const improveContent = useCallback(
    async (systemPrompt?: string) => {
      // Both of these used to `return` silently, so on a fresh session the user
      // clicked "Improve Content" and absolutely nothing happened — no spinner,
      // no error, no state change, and the step-gated UI left them stuck.
      if (!conversationId) {
        setState((s) => ({
          ...s,
          step: 'error',
          error: 'Open or start a chat first — the improver uses that conversation’s model.',
        }));
        return;
      }
      if (!state.extractedContent) {
        setState((s) => ({ ...s, step: 'error', error: 'No extracted content to improve.' }));
        return;
      }

      const controller = beginRequest();
      setState((s) => ({ ...s, step: 'improving', error: null }));

      try {
        const prompt = systemPrompt
          ? `${systemPrompt}\n\nImprove and refine the following document content. Maintain the original structure and meaning while improving clarity, grammar, and formatting:\n\n${state.extractedContent}`
          : `Improve and refine the following document content. Maintain the original structure and meaning while improving clarity, grammar, and formatting:\n\n${state.extractedContent}`;

        // Via `chat()`, not a hand-rolled fetch.
        //
        // This used to POST a bare `{model, messages, stream}` body at
        // `apiUrl('/api/chat')`, which for every cloud provider resolves to
        // /api/providers/chat — a route that requires
        // `{provider, baseUrl, apiKey, protocol, request}`. It threw "Unknown
        // cloud provider" 400, and the catch below flattened that into
        // "Failed to get AI improvement". So Improve Content was broken for
        // every non-Ollama provider, with an error that named the wrong cause.
        // `chat()` already knows how to address both shapes.
        const improved = await chat(
          {
            model:
              useChatStore.getState().conversations.find((c) => c.id === conversationId)?.model ??
              '',
            messages: [{ role: 'user', content: prompt }],
          },
          controller.signal,
        );

        if (controller.signal.aborted) return;
        if (!improved.trim()) throw new Error('The model returned an empty response.');

        setState((s) => ({ ...s, improvedContent: improved, step: 'improved' }));
      } catch (err) {
        if (controller.signal.aborted) return;
        setState((s) => ({
          ...s,
          step: 'error',
          error: err instanceof Error ? err.message : 'Failed to improve content',
        }));
      }
    },
    [beginRequest, conversationId, state.extractedContent],
  );

  const generateDocument = useCallback(
    async (opts: { tool: GenerateRequest['tool']; name?: string; title?: string }) => {
      const controller = beginRequest();
      setState((s) => ({ ...s, step: 'generating', error: null }));

      try {
        const res = await fetch('/api/tools/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tool: opts.tool,
            name: opts.name,
            title: opts.title,
            content: state.improvedContent || state.extractedContent,
            conversationId,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: 'Generation failed' }));
          throw new Error(body.error ?? 'Document generation failed');
        }

        const { artifact } = (await res.json()) as { artifact: Artifact };
        if (controller.signal.aborted) return;
        setState((s) => ({ ...s, generatedArtifact: artifact, step: 'done' }));
      } catch (err) {
        if (controller.signal.aborted) return;
        setState((s) => ({
          ...s,
          step: 'error',
          error: err instanceof Error ? err.message : 'Failed to generate document',
        }));
      }
    },
    [beginRequest, state.improvedContent, state.extractedContent, conversationId],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(INITIAL);
  }, []);

  return { ...state, extractContent, improveContent, generateDocument, reset };
}

/**
 * Extract text content from a file using the browser.
 *
 * Thin wrapper over `extractDocumentText` — the shared implementation in
 * lib/utils/files.ts, which this file used to duplicate with weaker parsers: a
 * bare `<w:t>` regex where the shared one is paragraph-boundary aware, and, for
 * .xlsx alone, a full `exceljs` workbook *writer* (930 KB of async chunk) to
 * read cell values out of a zip jszip was already opening two branches over.
 *
 * Every failure path THROWS. They used to return a bracketed placeholder
 * (`[PDF "x.pdf" — could not extract text]`), which is non-empty, so
 * `extractContent`'s `if (!text.trim())` check passed, the UI reported
 * "31 characters extracted", the placeholder was sent to the model as the
 * document to improve, and the user got a PDF whose entire content was an
 * error string.
 */
async function extractFileContent(file: File): Promise<string> {
  let text: string;
  try {
    text = await extractDocumentText(file);
  } catch {
    throw new Error(`Could not read "${file.name}" — it may be corrupt or an unsupported format.`);
  }
  const out = text.trim();
  if (!out) throw new Error(`No text found in "${file.name}".`);
  return out;
}
