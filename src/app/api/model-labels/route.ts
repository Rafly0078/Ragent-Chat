import { NextResponse } from 'next/server';
import { getSupabaseServer, getSupabaseAdmin } from '@/lib/supabase/server';
import { isOwner } from '@/lib/supabase/owner';
import { guard } from '@/lib/server/guard';
import { clientKey, hit, tooManyRequests } from '@/lib/server/rate-limit';
import { bodyErrorResponse, readJson } from '@/lib/server/body';
import type { Database } from '@/lib/supabase/types';

type ModelLabelInsert = Database['public']['Tables']['model_labels']['Insert'];

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 32 * 1024;
const MAX_MODEL_NAME_CHARS = 500;
const MAX_DISPLAY_NAME_CHARS = 120;
const MAX_DESCRIPTION_CHARS = 1_000;

/**
 * /api/model-labels — owner-curated display names for models.
 *
 *   GET    → public list of labels (used to override raw Ollama names).
 *   PUT    → owner-only upsert of one label (display name / description / hidden).
 *   DELETE → owner-only removal of a label (model falls back to its raw name).
 *
 * Reads run under the cookie-bound client (RLS allows a public SELECT). Writes
 * are double-gated: RLS blocks all non-service writes, and the route rejects
 * anyone who isn't the configured OWNER_EMAIL before touching the admin client.
 */

export async function GET(request: Request): Promise<Response> {
  // Rate limit but no guard(): the SELECT is public by design, so a 401 here
  // would hide the labels from every guest. The ceiling is what was missing —
  // this was the one route that reached Postgres with nothing in front of it.
  const rate = hit(`model-labels-read:${clientKey(request)}`, 120, 60_000);
  if (!rate.ok) return tooManyRequests(rate);

  const supabase = await getSupabaseServer();
  if (!supabase) {
    // Supabase not configured — no labels, app still works with raw names.
    return NextResponse.json({ labels: [] });
  }
  const { data, error } = await supabase
    .from('model_labels')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ labels: data ?? [] });
}

interface PutBody {
  modelName?: string;
  displayName?: string;
  description?: string | null;
  hidden?: boolean;
  sortOrder?: number;
}

export async function PUT(request: Request): Promise<Response> {
  const gate = await guard(request, { bucket: 'model-labels-write', limit: 30, windowMs: 60_000 });
  if (!gate.ok) return gate.response;

  const supabase = await getSupabaseServer();
  if (!supabase) {
    return NextResponse.json({ error: 'Auth is not configured.' }, { status: 500 });
  }
  if (!(await isOwner(supabase))) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  let body: PutBody;
  try {
    body = await readJson<PutBody>(request, MAX_BODY_BYTES);
  } catch (err) {
    return (
      bodyErrorResponse(err) ?? NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    );
  }

  const modelName = body.modelName?.trim();
  if (modelName && modelName.length > MAX_MODEL_NAME_CHARS) {
    return NextResponse.json({ error: 'modelName is too long.' }, { status: 400 });
  }
  if (!modelName) {
    return NextResponse.json({ error: 'Missing "modelName".' }, { status: 400 });
  }
  const displayName = body.displayName?.trim();
  if (displayName && displayName.length > MAX_DISPLAY_NAME_CHARS) {
    return NextResponse.json({ error: 'displayName is too long.' }, { status: 400 });
  }
  if (!displayName) {
    return NextResponse.json({ error: 'Missing "displayName".' }, { status: 400 });
  }

  const description = body.description?.toString().trim() || null;
  if (description && description.length > MAX_DESCRIPTION_CHARS) {
    return NextResponse.json({ error: 'description is too long.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' },
      { status: 500 },
    );
  }

  const row: ModelLabelInsert = {
    model_name: modelName,
    display_name: displayName,
    description,
    hidden: Boolean(body.hidden),
    ...(typeof body.sortOrder === 'number' && Number.isSafeInteger(body.sortOrder)
      ? { sort_order: body.sortOrder }
      : {}),
  };

  const { data, error } = await admin
    .from('model_labels')
    .upsert(row, { onConflict: 'model_name' })
    .select('*')
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ label: data });
}

export async function DELETE(request: Request): Promise<Response> {
  const gate = await guard(request, { bucket: 'model-labels-write', limit: 30, windowMs: 60_000 });
  if (!gate.ok) return gate.response;

  const supabase = await getSupabaseServer();
  if (!supabase) {
    return NextResponse.json({ error: 'Auth is not configured.' }, { status: 500 });
  }
  if (!(await isOwner(supabase))) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  const modelName = new URL(request.url).searchParams.get('modelName')?.trim();
  if (modelName && modelName.length > MAX_MODEL_NAME_CHARS) {
    return NextResponse.json({ error: 'modelName is too long.' }, { status: 400 });
  }
  if (!modelName) {
    return NextResponse.json({ error: 'Missing "modelName".' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' },
      { status: 500 },
    );
  }

  const { error } = await admin.from('model_labels').delete().eq('model_name', modelName);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
