import 'server-only';

import { getSupabaseServer } from '@/lib/supabase/server';
import { applyPatch } from '../patch';
import { TOOL_FOR_KIND, type ArtifactKind, type GenerateRequest, type ThemeSpec } from '../types';
import { getExecutor, isTextOutput, type ExecutorContext, type ToolFileOutput } from './index';

/**
 * Revise a document that was already generated, from its SOURCE.
 *
 * Every other document tool is write-only: to change one heading in a report the
 * model had to re-emit the entire document, which for a long report is most of a
 * response spent restating text nobody asked to change.
 *
 * The reason this could not simply be wired up is that what gets stored is the
 * RENDERED file — a PDF or DOCX binary — and you cannot meaningfully patch that.
 * So `route.ts` now keeps the Markdown it was rendered from in
 * `artifacts.metadata.source` (jsonb, which already existed; no migration), and
 * this reads it back, applies the edit, and re-renders through the same executor
 * that produced the original.
 *
 * Edits are SEARCH/REPLACE hunks, reusing `applyPatch` from ../patch — the same
 * fuzzy matcher behind ```codepatch, which already handles whitespace drift and
 * treats an ambiguous SEARCH as a failure rather than rewriting the wrong
 * occurrence. Taking whole documents instead would defeat the point of the tool.
 */

interface StoredSource {
  source?: unknown;
  title?: unknown;
  theme?: unknown;
}

/**
 * A re-rendered file, plus the metadata its row has to carry.
 *
 * `route.ts` derives `artifacts.metadata` from the REQUEST, and an edit request
 * holds hunks rather than text — so a revision was written with no source, and
 * the SECOND edit of any document was refused ("no editable source stored"). The
 * patched text exists nowhere but this executor, so it travels back out with the
 * file it was rendered into.
 *
 * Declared on this executor rather than on `ToolFileOutput`, because this is the
 * one tool whose source the route cannot see in the request; every other tool's
 * is `req.content`. `route.ts` reads it back through `editedSourceMetadata`.
 */
export interface EditedArtifactOutput extends ToolFileOutput {
  metadata: Record<string, unknown>;
}

export default async function editArtifact(
  req: GenerateRequest,
  ctx: ExecutorContext,
): Promise<EditedArtifactOutput> {
  const artifactId = req.artifactId?.trim();
  if (!artifactId) throw new Error('edit_artifact needs the "artifactId" of the file to revise.');

  const hunks = (req.hunks ?? []).filter(
    (h) => h && typeof h.search === 'string' && h.search.length > 0,
  );
  if (hunks.length === 0) {
    throw new Error(
      'edit_artifact needs at least one hunk with a non-empty "search" and its "replace".',
    );
  }

  const supabase = await getSupabaseServer();
  if (!supabase || ctx.userId === 'guest') {
    // Guest artifacts never reach Storage — they are `data:` URLs with no row —
    // so there is nothing to look up. Say so rather than half-working.
    throw new Error(
      'Editing a generated file needs a signed-in account. Regenerate the whole document instead.',
    );
  }

  // RLS already scopes this to the caller; `user_id` is belt-and-braces so a
  // policy regression can't turn this into a read of someone else's document.
  const { data: row, error } = await supabase
    .from('artifacts')
    .select('kind, name, version, metadata')
    .eq('id', artifactId)
    .eq('user_id', ctx.userId)
    .maybeSingle();

  if (error) throw new Error(`Could not look up that file: ${error.message}`);
  if (!row) throw new Error(`No file with id "${artifactId}" in this account.`);

  const stored = (row.metadata ?? {}) as StoredSource;
  const source = typeof stored.source === 'string' ? stored.source : '';
  if (!source) {
    throw new Error(
      `"${row.name}" has no editable source stored — it predates source tracking, or was ` +
        'built from structured data rather than text. Regenerate the whole document instead.',
    );
  }

  const patch = applyPatch(source, hunks);
  if (patch.applied.length === 0) {
    // The model's SEARCH text is what's wrong, and it can fix that — quote the
    // first failure so it can see how its guess differed.
    const first = patch.failed[0]?.search ?? '';
    throw new Error(
      `None of the edits matched "${row.name}". Not found: ${JSON.stringify(
        first.slice(0, 200),
      )}. Read the document's current text before editing, and match it exactly.`,
    );
  }
  // A PARTIAL application is a failure too. `applied.length > 0` was the only
  // check, so a three-hunk edit with one SEARCH off by a word stored a new
  // version carrying two of the three changes — and the tool result the model
  // reads says nothing but `Created "report.md" (… version 2)`, so it reported
  // all three as done and the user downloaded a document still containing the
  // text they asked to have changed. Same stance as `applyPatch`'s on ambiguity:
  // refuse, and let the model re-send corrected hunks.
  if (patch.failed.length > 0) {
    throw new Error(
      `${patch.failed.length} of ${hunks.length} edits didn't match "${row.name}". Not found: ` +
        `${JSON.stringify(patch.failed[0]!.search.slice(0, 200))}. Nothing was changed — ` +
        're-send every hunk, matching the current text exactly.',
    );
  }

  const kind = row.kind as ArtifactKind;
  const tool = TOOL_FOR_KIND[kind];
  const executor = tool ? await getExecutor(tool) : undefined;
  if (!executor) throw new Error(`Cannot re-render a "${kind}" file.`);

  // Title and theme are carried out of the row and back into the new one below:
  // an edit request has neither, so a revision was retitled "Document" and
  // rebuilt with the default palette rather than the accent it was created with.
  const carried: Pick<GenerateRequest, 'title' | 'theme'> = {
    ...(typeof stored.title === 'string' ? { title: stored.title } : {}),
    ...(stored.theme && typeof stored.theme === 'object'
      ? { theme: stored.theme as ThemeSpec }
      : {}),
  };

  const rendered = await executor(
    {
      tool,
      content: patch.result,
      // The stored filename, because for `create_txt` the extension decides what
      // the file IS: without it `textFileExt` sees nothing, so every revision of
      // `style.css` lost the verbatim guard and came back reflowed as markdown
      // prose. It is also what `displayTitle` falls back to, so an untitled
      // `notes.md` stops being retitled "# Document" on every edit.
      name: row.name,
      ...carried,
    },
    ctx,
  );
  // Only reachable if TOOL_FOR_KIND ever pointed at a read tool.
  if (isTextOutput(rendered)) throw new Error(`Re-rendering "${row.name}" produced no file.`);

  return {
    ...rendered,
    // Keep the original name and carry the version forward, so the panel shows a
    // revision of one document rather than two unrelated files.
    filename: row.name,
    version: (typeof row.version === 'number' ? row.version : 1) + 1,
    // The source the NEXT edit will patch. Built here because `route.ts` only
    // sees the request, and this request holds hunks rather than the new text.
    metadata: sourceMetadata({ content: patch.result, ...carried }),
  };
}

/**
 * What `route.ts` stores in `artifacts.metadata` so a later edit is possible.
 * Absent for tools whose input isn't text (rows, sheets, slides, files), which is
 * why `edit_artifact` reports that case explicitly instead of failing obscurely.
 *
 * Takes the text fields rather than a whole request so the edit path can build
 * the same shape from what it actually rendered — one definition of what a row
 * has to carry, instead of two that can drift.
 */
export function sourceMetadata(
  req: Pick<GenerateRequest, 'content' | 'title' | 'theme'>,
): Record<string, unknown> {
  if (typeof req.content !== 'string' || !req.content) return {};
  return {
    source: req.content,
    ...(req.title ? { title: req.title } : {}),
    ...(req.theme ? { theme: req.theme } : {}),
  };
}

/**
 * The metadata a re-render came back with, for `route.ts` to store instead of
 * deriving it from the request. Undefined for every other tool.
 *
 * The cast is what not widening `ToolFileOutput` costs: `metadata` is set by this
 * executor alone, and adding it to the shared contract would invite the other
 * executors to answer a question only this one has.
 */
export function editedSourceMetadata(out: ToolFileOutput): Record<string, unknown> | undefined {
  return (out as Partial<EditedArtifactOutput>).metadata;
}
