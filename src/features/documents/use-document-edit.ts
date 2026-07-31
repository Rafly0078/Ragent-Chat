'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Artifact, GenerateRequest } from '@/lib/tools/types';
import { useChatStore } from '@/lib/store/chat-store';
import { apiUrl } from '@/lib/api/config';

/** Buffering an arbitrary upload on the main thread freezes the tab. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_PDF_PAGES = 200;

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

        const res = await fetch(apiUrl('/api/chat'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model:
              useChatStore.getState().conversations.find((c) => c.id === conversationId)?.model ??
              '',
            messages: [{ role: 'user', content: prompt }],
            stream: false,
          }),
          signal: controller.signal,
        });

        if (!res.ok) throw new Error('Failed to get AI improvement');

        const data = (await res.json()) as { message?: { content?: string }; response?: string };
        if (controller.signal.aborted) return;
        const improved = data.message?.content ?? data.response ?? '';
        if (!improved) throw new Error('AI returned empty response');

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
 * Every failure path THROWS. They used to return a bracketed placeholder
 * (`[PDF "x.pdf" — could not extract text]`), which is non-empty, so
 * `extractContent`'s `if (!text.trim())` check passed, the UI reported
 * "31 characters extracted", the placeholder was sent to the model as the
 * document to improve, and the user got a PDF whose entire content was an
 * error string.
 */
async function extractFileContent(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

  // Plain text / code / markdown
  if (
    [
      'txt',
      'md',
      'csv',
      'json',
      'log',
      'xml',
      'yaml',
      'yml',
      'ts',
      'tsx',
      'js',
      'jsx',
      'py',
      'go',
      'rs',
      'java',
      'c',
      'cpp',
      'sh',
      'html',
      'css',
    ].includes(ext) ||
    file.type.startsWith('text/')
  ) {
    return file.text();
  }

  // PDF
  if (ext === 'pdf' || file.type === 'application/pdf') {
    let doc: PDFDocumentProxy | null = null;
    try {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString();
      const buf = await file.arrayBuffer();
      doc = await pdfjs.getDocument({ data: buf }).promise;
      let out = '';
      const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
      for (let i = 1; i <= pages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        out += content.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n\n';
        // Without this, pdf.js keeps every parsed page's operator list and font
        // data alive for the lifetime of the tab.
        page.cleanup();
      }
      return out.trim();
    } catch {
      throw new Error(`Could not extract text from "${file.name}" (unsupported or corrupt PDF).`);
    } finally {
      // Also terminates the dedicated worker.
      await doc?.destroy().catch(() => {});
    }
  }

  // DOCX — extract raw XML and pull text from <w:t> tags
  if (ext === 'docx') {
    let xml: string;
    try {
      const JSZip = (await import('jszip')).default;
      const buf = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(buf);
      const xmlFile = zip.file('word/document.xml');
      if (!xmlFile) throw new Error('missing document.xml');
      xml = await xmlFile.async('text');
    } catch {
      throw new Error(`Could not read "${file.name}" — it may not be a valid .docx file.`);
    }
    // Extract text between <w:t> tags
    const texts: string[] = [];
    const regex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      if (match[1]) texts.push(match[1]);
    }
    const out = texts.join(' ').trim();
    if (!out) throw new Error(`No text found in "${file.name}".`);
    return out;
  }

  // XLSX — extract cell values
  if (ext === 'xlsx') {
    let lines: string[];
    try {
      const ExcelJS = (await import('exceljs')).default;
      const buf = await file.arrayBuffer();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      lines = [];
      wb.eachSheet((ws) => {
        ws.eachRow((row) => {
          const vals = row.values as unknown[];
          const cells: string[] = [];
          for (let i = 1; i < vals.length; i++) {
            cells.push(vals[i] == null ? '' : String(vals[i]));
          }
          const line = cells.join(', ');
          if (line.trim()) lines.push(line);
        });
      });
    } catch {
      throw new Error(`Could not read "${file.name}" — it may not be a valid .xlsx file.`);
    }
    const out = lines.join('\n').trim();
    if (!out) throw new Error(`No data found in "${file.name}".`);
    return out;
  }

  // PPTX — extract text from slide XML
  if (ext === 'pptx') {
    const texts: string[] = [];
    try {
      const JSZip = (await import('jszip')).default;
      const buf = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(buf);
      const slideFiles = Object.keys(zip.files)
        .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
        .sort(
          (a, b) =>
            Number(a.match(/slide(\d+)/)?.[1] ?? 0) - Number(b.match(/slide(\d+)/)?.[1] ?? 0),
        );
      for (const slideFile of slideFiles) {
        const entry = zip.file(slideFile);
        if (!entry) continue;
        const xml = await entry.async('text');
        const regex = /<a:t[^>]*>([^<]*)<\/a:t>/g;
        let match;
        while ((match = regex.exec(xml)) !== null) {
          if (match[1]) texts.push(match[1]);
        }
        texts.push('---'); // slide separator
      }
    } catch {
      throw new Error(`Could not read "${file.name}" — it may not be a valid .pptx file.`);
    }
    const out = texts
      .join('\n')
      .replace(/^(?:---\n?)+/, '')
      .trim();
    if (!out || /^-{3}$/.test(out)) throw new Error(`No text found in "${file.name}".`);
    return out;
  }

  // Fallback: try reading as text.
  try {
    return await file.text();
  } catch {
    throw new Error(`Could not read "${file.name}" as text.`);
  }
}
