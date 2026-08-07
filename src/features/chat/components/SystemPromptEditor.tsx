'use client';

import { useEffect, useState } from 'react';
import { BookMarked } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { useSettings } from '@/lib/store/settings-store';

interface Props {
  open: boolean;
  onClose: () => void;
  value: string;
  onChange: (prompt: string) => void;
}

/** System prompt editor with preset picker. */
export function SystemPromptEditor({ open, onClose, value, onChange }: Props) {
  const presets = useSettings((s) => s.presets);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="System prompt"
      description="Sets the assistant's behaviour for this conversation."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onChange(draft);
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {presets.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-content-muted">
              <BookMarked className="h-3.5 w-3.5" /> Presets
            </p>
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setDraft(p.content)}
                  className="btn-surface h-8 px-3 text-xs"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <textarea
          aria-label="System prompt"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={10}
          placeholder="You are a helpful assistant…"
          className="input resize-none font-mono text-[0.85rem] leading-relaxed"
          autoFocus
        />
        <p className="text-xs text-content-subtle">{draft.length} characters</p>
      </div>
    </Modal>
  );
}
