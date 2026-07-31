'use client';

import { useState, useRef } from 'react';
import { FileText, Upload, Sparkles, Download, Check, AlertCircle } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { useDocumentEdit } from './use-document-edit';
import type { GenerateRequest } from '@/lib/tools/types';
import { cn } from '@/lib/utils/cn';

interface Props {
  open: boolean;
  onClose: () => void;
  conversationId: string | null;
}

/** Click a temporary anchor to save `url` as `filename`. */
function clickDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function DocumentEditDialog({ open, onClose, conversationId }: Props) {
  const {
    originalFile,
    extractedContent,
    improvedContent,
    generatedArtifact,
    step,
    error,
    extractContent,
    improveContent,
    generateDocument,
    reset,
  } = useDocumentEdit(conversationId);

  const [outputFormat, setOutputFormat] = useState<GenerateRequest['tool']>('create_pdf');
  const [improvePrompt, setImprovePrompt] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void extractContent(file);
    e.target.value = '';
  };

  const handleGenerate = () => {
    void generateDocument({
      tool: outputFormat,
      name: originalFile?.name.replace(/\.[^.]+$/, ''),
      title: originalFile?.name.replace(/\.[^.]+$/, ''),
    });
  };

  /**
   * Same problem as the artifact panel: the `download` attribute is ignored for
   * cross-origin URLs and Supabase serves signed URLs inline, so this navigated
   * the tab to the file instead of saving it. Fetch to a blob first.
   */
  const handleDownload = async () => {
    const url = generatedArtifact?.url;
    if (!url || !generatedArtifact) return;
    if (url.startsWith('data:')) {
      clickDownload(url, generatedArtifact.name);
      return;
    }
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const objectUrl = URL.createObjectURL(await res.blob());
      clickDownload(objectUrl, generatedArtifact.name);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      clickDownload(url, generatedArtifact.name); // last resort
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Document Editor"
      description="Upload a document, improve it with AI, and generate a new version."
    >
      <div className="space-y-4">
        {/* Step 1: Upload */}
        <StepRow
          number={1}
          title="Upload document"
          status={
            step === 'idle'
              ? 'active'
              : step === 'extracting'
                ? 'processing'
                : // 'error' used to map to 'done', putting a green check on step 1
                  // directly above the red extraction error.
                  step === 'error'
                  ? 'active'
                  : 'done'
          }
        >
          {(step === 'idle' || step === 'error') && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.docx,.xlsx,.pptx,.txt,.md,.csv"
                className="hidden"
                onChange={handleFileSelect}
              />
              <button
                onClick={() => fileRef.current?.click()}
                // The label promised drag-and-drop that was never implemented, so
                // a dropped file hit the page default and navigated the browser
                // away from the app, destroying all unsaved state.
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const dropped = e.dataTransfer.files?.[0];
                  if (dropped) void extractContent(dropped);
                }}
                className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border/25 p-6 text-sm text-content-muted transition-colors duration-fast hover:border-accent/50 hover:bg-accent/[0.04] hover:text-content"
              >
                <Upload className="h-5 w-5" />
                Click to upload or drag and drop
              </button>
              <p className="mt-1 text-[0.7rem] text-content-subtle">
                Supports: PDF, DOCX, XLSX, PPTX, TXT, MD, CSV · max 25 MB
              </p>
            </>
          )}
          {step === 'extracting' && (
            <div className="flex items-center gap-2 text-sm text-content-muted">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              Extracting content from {originalFile?.name}…
            </div>
          )}
          {(step === 'extracted' ||
            step === 'improving' ||
            step === 'improved' ||
            step === 'generating' ||
            step === 'done') &&
            originalFile && (
              <div className="flex items-center gap-2 rounded-xl border border-border/15 bg-surface-raised p-3">
                <FileText className="h-5 w-5 text-accent" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-content">{originalFile.name}</p>
                  <p className="text-[0.7rem] text-content-subtle">
                    {extractedContent.length.toLocaleString()} characters extracted
                  </p>
                </div>
                <Check className="h-4 w-4 text-success" />
              </div>
            )}
        </StepRow>

        {/* Step 2: Improve with AI */}
        <StepRow
          number={2}
          title="Improve with AI"
          status={
            step === 'extracted'
              ? 'active'
              : step === 'improving'
                ? 'processing'
                : step === 'improved' || step === 'generating' || step === 'done'
                  ? 'done'
                  : 'pending'
          }
        >
          {step === 'extracted' && (
            <div className="space-y-2">
              <textarea
                value={improvePrompt}
                onChange={(e) => setImprovePrompt(e.target.value)}
                rows={2}
                placeholder="Optional: specific improvement instructions (e.g., 'Make it more formal', 'Fix grammar and typos')"
                className="input resize-none text-sm"
              />
              <Button
                variant="primary"
                onClick={() => void improveContent(improvePrompt || undefined)}
                className="w-full"
              >
                <Sparkles className="h-4 w-4" /> Improve Content
              </Button>
            </div>
          )}
          {step === 'improving' && (
            <div className="flex items-center gap-2 text-sm text-content-muted">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              AI is improving your document…
            </div>
          )}
          {step === 'improved' && improvedContent && (
            <div className="flex items-center gap-2 rounded-xl border border-border/15 bg-surface-raised p-3">
              <Sparkles className="h-5 w-5 text-accent" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-content">Content improved</p>
                <p className="text-[0.7rem] text-content-subtle">
                  {improvedContent.length.toLocaleString()} characters
                </p>
              </div>
              <Check className="h-4 w-4 text-success" />
            </div>
          )}
        </StepRow>

        {/* Step 3: Generate output */}
        <StepRow
          number={3}
          title="Generate output"
          status={
            step === 'improved'
              ? 'active'
              : step === 'generating'
                ? 'processing'
                : step === 'done'
                  ? 'done'
                  : 'pending'
          }
        >
          {step === 'improved' && (
            <div className="space-y-2">
              <select
                value={outputFormat}
                onChange={(e) => setOutputFormat(e.target.value as GenerateRequest['tool'])}
                className="input text-sm"
              >
                <option value="create_pdf">PDF</option>
                <option value="create_docx">Word (DOCX)</option>
                <option value="create_pptx">PowerPoint (PPTX)</option>
                <option value="create_xlsx">Excel (XLSX)</option>
                <option value="create_md">Markdown</option>
                <option value="create_html">HTML</option>
                <option value="create_txt">Plain Text</option>
              </select>
              <Button variant="primary" onClick={handleGenerate} className="w-full">
                <FileText className="h-4 w-4" /> Generate Document
              </Button>
            </div>
          )}
          {step === 'generating' && (
            <div className="flex items-center gap-2 text-sm text-content-muted">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              Generating document…
            </div>
          )}
          {step === 'done' && generatedArtifact && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 rounded-xl border border-border/15 bg-surface-raised p-3">
                <FileText className="h-5 w-5 text-success" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-content">
                    {generatedArtifact.name}
                  </p>
                  <p className="text-[0.7rem] text-content-subtle">
                    {generatedArtifact.kind.toUpperCase()} ·{' '}
                    {(generatedArtifact.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <Button
                  variant="primary"
                  onClick={() => void handleDownload()}
                  className="h-8 px-3 text-xs"
                >
                  <Download className="h-3.5 w-3.5" /> Download
                </Button>
              </div>
              <Button variant="ghost" onClick={reset} className="w-full text-xs">
                Edit another document
              </Button>
            </div>
          )}
        </StepRow>

        {/* Error state */}
        {step === 'error' && error && (
          <div className="flex items-start gap-2 rounded-xl border border-error/30 bg-error/5 p-3 text-sm text-error">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">
              <p>{error}</p>
              <Button variant="ghost" onClick={reset} className="mt-2 h-7 text-xs">
                Try again
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function StepRow({
  number,
  title,
  status,
  children,
}: {
  number: number;
  title: string;
  status: 'active' | 'processing' | 'done' | 'pending';
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-3 transition-colors duration-fast',
        status === 'active'
          ? 'border-accent/50 bg-accent/5'
          : status === 'done'
            ? 'border-success/30 bg-success/5'
            : status === 'processing'
              ? 'border-warning/30 bg-warning/5'
              : 'border-border/15 bg-surface-raised',
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <div
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
            status === 'active'
              ? 'bg-accent text-accent-fg'
              : status === 'done'
                ? 'bg-success text-white'
                : status === 'processing'
                  ? 'bg-warning text-white'
                  : 'bg-border/20 text-content-subtle',
          )}
        >
          {status === 'done' ? <Check className="h-3.5 w-3.5" /> : number}
        </div>
        <span
          className={cn(
            'text-sm font-medium',
            status === 'pending' ? 'text-content-subtle' : 'text-content',
          )}
        >
          {title}
        </span>
        {status === 'processing' && (
          <div className="ml-auto h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        )}
      </div>
      <div className="ml-8">{children}</div>
    </div>
  );
}
