import { NextResponse } from 'next/server';
import { getExecutor, isTextOutput } from '@/lib/tools/executors';
import { sourceMetadata } from '@/lib/tools/executors/edit-artifact';
import { getSupabaseServer } from '@/lib/supabase/server';
import { EXT_BY_KIND, type Artifact, type ToolName } from '@/lib/tools/types';
import { uid } from '@/lib/utils/id';
import { getTool } from '@/lib/tools/registry';
import { validateGenerateRequest } from '@/lib/tools/validate';
import { guard } from '@/lib/server/guard';
import { bodyErrorResponse, readJson } from '@/lib/server/body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * create_pdf launches headless Chromium, and a cold Lambda has to unpack the
 * brotli-packed binary before the first page even loads — comfortably past the
 * 10s default on Vercel's Hobby plan. 60s is the ceiling there; the render
 * itself aborts at 45s (see `PDF_TIMEOUT_MS` in `src/lib/documents/pdf-render.ts`)
 * so a stuck browser surfaces as a real error rather than a platform timeout.
 */
export const maxDuration = 60;

/** Generation payloads are text; 8MB is far beyond any realistic document. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;
/**
 * Ceiling on the guest-mode `data:` URL fallback. That URL is stored inside the
 * chat message and persisted to localStorage, so a large file silently blew the
 * ~5MB quota and killed persistence for the whole session.
 */
const MAX_INLINE_BYTES = 1_200_000;

const KNOWN_EXT = new RegExp(`\\.(${Object.values(EXT_BY_KIND).join('|')})$`, 'i');

/**
 * Build a safe filename from the model-supplied `name`.
 *
 * `name` reached the storage key unmodified, so `"../../x/evil"` produced an
 * object path containing `..`, and control characters / quotes flowed into the
 * DB row and any Content-Disposition built from it. Only a *known* artifact
 * extension is stripped — the old `/\.[^.]+$/` also ate real content
 * ("Q1 2024 sales v1.2" → "Q1 2024 sales v1").
 */
function safeFilename(raw: string | undefined, ext: string): string {
  const lastSegment = (raw ?? '').split(/[/\\]/).pop() ?? '';
  const base = lastSegment
    .replace(/[\x00-\x1F\x7F"*:<>?|]/g, '_')
    .replace(/^\.+/, '')
    .replace(KNOWN_EXT, '')
    .trim()
    .slice(0, 100)
    .trim();
  return `${base || 'document'}.${ext}`;
}

/**
 * POST /api/tools/execute — Execute a tool (generate a document).
 * Accepts a GenerateRequest, runs the executor, optionally persists to
 * Supabase Storage, and returns the Artifact metadata.
 */
export async function POST(request: Request): Promise<Response> {
  // Document rendering is real server CPU (pdf-lib, exceljs, pptxgenjs), so this
  // route is gated and rate limited like the rest.
  const gate = await guard(request, { bucket: 'tools', limit: 30, windowMs: 60_000 });
  if (!gate.ok) return gate.response;

  let raw: unknown;
  try {
    raw = await readJson<unknown>(request, MAX_BODY_BYTES);
  } catch (err) {
    return (
      bodyErrorResponse(err) ?? NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    );
  }

  // Validate and coerce at the trust boundary. This route used to check only
  // that `tool` was truthy and resolved to an executor; every other field went
  // into the executor as-is, and the executors trust their inputs. So
  // `{"tool":"create_csv","rows":"oops"}` — reachable from any client — passed a
  // `rows.length` truthiness check, then `rows.map` threw and the request 500'd.
  const checked = validateGenerateRequest(raw);
  if (!checked.ok) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }
  const body = checked.request;

  // A client-side tool (`run_js`) must never be run here. Executing
  // model-authored code inside the deployment would be arbitrary RCE, and
  // `node:vm` is not a security boundary — the browser's origin-isolated iframe
  // is. Refused explicitly rather than falling into the "no executor" 500 below,
  // so the message says what actually happened.
  if (getTool(body.tool)?.server === false) {
    return NextResponse.json(
      { error: `"${body.tool}" runs in the browser, not on the server.` },
      { status: 400 },
    );
  }

  const executor = await getExecutor(body.tool as ToolName);
  if (!executor) {
    // The name is a valid ToolName (validation just checked) but no loader is
    // registered — a registry/executor-table mismatch, i.e. our bug, not theirs.
    return NextResponse.json({ error: `No executor for tool: ${body.tool}` }, { status: 500 });
  }

  const supabase = await getSupabaseServer();
  const userId = gate.userId ?? 'guest';

  try {
    const result = await executor(body, {
      userId,
      conversationId: body.conversationId,
      messageId: body.messageId,
    });

    // A read tool (`fetch_url`) returns text for the model, not a file. Nothing
    // to upload, no artifact row, no signed URL — just hand it back.
    if (isTextOutput(result)) {
      return NextResponse.json({ text: result.text });
    }

    const artifactId = uid();
    const ext = result.ext;
    // `filename`/`version` may be overridden by the executor: `edit_artifact`
    // produces revision N+1 of an existing document and keeps its name, neither
    // of which the model supplied.
    const filename = result.filename ?? safeFilename(body.name ?? body.title, ext);
    const version = result.version ?? 1;
    const storagePath = `${userId}/${artifactId}/${filename}`;

    let artifact: Artifact = {
      id: artifactId,
      kind: result.kind,
      name: filename,
      mimeType: result.mime,
      size: result.buffer.length,
      version,
      createdAt: Date.now(),
      ephemeral: true,
    };

    // Persist to Supabase Storage if configured
    if (supabase && userId !== 'guest') {
      const bucket =
        getTool(body.tool as ToolName)?.category === 'export' ? 'exports' : 'artifacts';

      const { error: uploadErr } = await supabase.storage
        .from(bucket)
        .upload(storagePath, result.buffer, {
          contentType: result.mime,
          upsert: false,
        });

      if (uploadErr) {
        // Previously swallowed silently — the artifact would fall back to
        // ephemeral (data URL) with no way to tell why. Log it so a missing
        // bucket / RLS misconfiguration is actually visible.
        console.error(
          `[tools/execute] Storage upload failed for ${storagePath}:`,
          uploadErr.message,
        );
      } else {
        // Signed URL — long-lived (7 days) rather than 1 hour, since it gets
        // stored in chat history and read back much later. ArtifactPanel
        // additionally re-signs on load (see /api/artifacts/refresh), so
        // this is a safety margin, not the only line of defense.
        const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;
        const { data: urlData, error: signErr } = await supabase.storage
          .from(bucket)
          .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS, { download: filename });

        // A signing failure used to still flip `ephemeral` to false with
        // `url: undefined`, so the client got an artifact it could neither
        // download nor preview (and ArtifactPanel crashed on `url.startsWith`).
        // Keep it ephemeral instead and let the data: fallback below handle it.
        if (signErr || !urlData?.signedUrl) {
          console.error(
            `[tools/execute] Failed to sign URL for ${storagePath}:`,
            signErr?.message ?? 'no URL returned',
          );
        } else {
          artifact = {
            ...artifact,
            ephemeral: false,
            url: urlData.signedUrl,
            bucket,
            storagePath,
          };
        }

        // Persist artifact metadata to database.
        //
        // `conversation_id` / `message_id` are FKs, but those rows are written by
        // the client's debounced sync — for an artifact generated on the very
        // first turn neither exists yet, so the insert failed with 23503 and the
        // file was stranded in Storage with no row to find it by. Retry without
        // the parent links: `loadConversations` already recovers artifacts that
        // have a conversation but no message, and a row with neither is still
        // better than none.
        const artifactRow = {
          id: artifactId,
          user_id: userId,
          kind: result.kind,
          name: filename,
          mime_type: result.mime,
          size_bytes: result.buffer.length,
          bucket,
          storage_path: storagePath,
          version,
          // The text this was rendered from, so `edit_artifact` can revise it
          // later without the model re-emitting the whole document. Empty for
          // tools whose input is structured (rows/sheets/slides/files) rather
          // than text — `edit_artifact` reports that case rather than guessing.
          metadata: sourceMetadata(body),
        };
        let artifactSaved = true;
        const { error: artifactInsertErr } = await supabase.from('artifacts').insert({
          ...artifactRow,
          conversation_id: body.conversationId ?? null,
          message_id: body.messageId ?? null,
        });
        if (artifactInsertErr) {
          const retry = await supabase
            .from('artifacts')
            .insert({ ...artifactRow, conversation_id: null, message_id: null });
          artifactSaved = !retry.error;
          console.error(
            '[tools/execute] artifacts insert failed:',
            artifactInsertErr.message,
            artifactSaved
              ? '— retried without parent links'
              : `— retry also failed: ${retry.error?.message}`,
          );
        }

        // Create download record. Skipped when the artifact row is missing —
        // `downloads.artifact_id` references it, so the insert could only fail.
        if (artifactSaved) {
          const { error: downloadInsertErr } = await supabase.from('downloads').insert({
            id: uid(),
            user_id: userId,
            artifact_id: artifactId,
            name: filename,
            status: 'ready',
            progress: 100,
            size_bytes: result.buffer.length,
            bucket,
            storage_path: storagePath,
          });
          if (downloadInsertErr) {
            console.error('[tools/execute] downloads insert failed:', downloadInsertErr.message);
          }
        }
      }
    } else if (supabase && userId === 'guest') {
      // Supabase IS configured, but there's no authenticated session on this
      // request — this is the most common reason files "disappear": nothing
      // ever gets uploaded, and the fallback data: URL below only lives
      // inside this one chat message in localStorage.
      console.warn(
        '[tools/execute] No authenticated Supabase session — artifact will be ephemeral ' +
          '(embedded as a data: URL, not saved to Storage). Sign in (or enable anonymous ' +
          'sessions) for files to persist across reloads.',
      );
    }

    // For guest mode or if storage upload failed, return as data URL. Capped:
    // this string is persisted inside the chat message.
    if (artifact.ephemeral) {
      if (result.buffer.length > MAX_INLINE_BYTES) {
        return NextResponse.json(
          {
            error:
              `The generated file is ${(result.buffer.length / 1e6).toFixed(1)} MB — too large to ` +
              'embed in the chat. Sign in so it can be saved to storage instead.',
          },
          { status: 413 },
        );
      }
      artifact.url = `data:${result.mime};base64,${result.buffer.toString('base64')}`;
    }

    return NextResponse.json({ artifact }, { status: 200 });
  } catch (err) {
    console.error('Tool execution failed:', err);
    const message = err instanceof Error ? err.message : 'Tool execution failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
