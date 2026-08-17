'use client';

import { useEffect, useState } from 'react';
import type { ModelInfo } from '@/types';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { saveModelLabel, deleteModelLabel } from './model-labels';

/**
 * Owner-only dialog to set the display name / description for a model, or hide
 * it from the picker. Saving hits /api/model-labels (re-checked server-side).
 */
export function ModelLabelEditor({
  open,
  model,
  onClose,
  onSaved,
}: {
  open: boolean;
  model: ModelInfo | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  // Seed the fields from the model each time the dialog opens — `hidden` included.
  // It used to be reset to false here, so an owner who reopened a hidden model just
  // to fix its name un-hid it on save without ever touching the switch.
  useEffect(() => {
    if (open && model) {
      setDisplayName(model.customLabel ? model.label : '');
      setDescription(model.description ?? '');
      setHidden(Boolean(model.hidden));
    }
  }, [open, model]);

  if (!model) return null;

  const save = async () => {
    const name = displayName.trim();
    if (!name) {
      toast('Enter a display name.', 'error');
      return;
    }
    setBusy(true);
    try {
      await saveModelLabel({
        modelName: model.name,
        displayName: name,
        description: description.trim() || null,
        hidden,
      });
      toast('Model name saved.', 'success');
      onSaved();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to save.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      await deleteModelLabel(model.name);
      toast('Reverted to the original name.', 'success');
      onSaved();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to reset.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Rename model"
      description={model.name}
      footer={
        <>
          {model.customLabel && (
            <Button variant="ghost" onClick={reset} disabled={busy} className="mr-auto">
              Reset to original
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-content">Display name</span>
          <input
            autoFocus
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Qwen 3.5"
            className="input w-full"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-content">
            Description <span className="text-content-subtle">(optional)</span>
          </span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short note shown in the picker"
            className="input w-full"
          />
        </label>

        <div className="flex items-center justify-between gap-4">
          <div>
            <span className="block text-sm font-medium text-content">Hide from list</span>
            <span className="text-xs text-content-muted">Everyone stops seeing this model.</span>
          </div>
          {/* `label` gives the switch an accessible name — without it a screen
              reader announced only "switch, off" with no hint what it controls,
              since the adjacent text isn't associated with the button. */}
          <Switch checked={hidden} onChange={setHidden} label="Hide from list" />
        </div>
      </div>
    </Modal>
  );
}
