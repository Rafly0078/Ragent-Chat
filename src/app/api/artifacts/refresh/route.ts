import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Keep in sync with the TTL used when the artifact is first created in
// /api/tools/execute — this route is what actually keeps a persisted
// artifact usable indefinitely: the client calls it every time an artifact
// is displayed, rather than trusting a URL that may already be stale.
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

/** The only buckets this app writes to — anything else is a malformed request. */
const ALLOWED_BUCKETS = new Set(['artifacts', 'exports']);

/**
 * POST /api/artifacts/refresh — mint a fresh signed URL for a previously
 * generated, already-persisted artifact. Supabase signed URLs expire; a URL
 * saved in chat history months ago will be dead by the time the user reopens
 * that conversation. The file itself is still sitting in Storage though, so
 * we just need a new signed URL for it — not the whole artifact again.
 */
export async function POST(request: Request): Promise<Response> {
  let body: { bucket?: string; storagePath?: string };
  try {
    body = (await request.json()) as { bucket?: string; storagePath?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { bucket, storagePath } = body;
  if (!bucket || !storagePath) {
    return NextResponse.json({ error: 'Missing bucket or storagePath.' }, { status: 400 });
  }
  if (!ALLOWED_BUCKETS.has(bucket)) {
    return NextResponse.json({ error: 'Unknown bucket.' }, { status: 400 });
  }

  const supabase = await getSupabaseServer();
  if (!supabase) {
    return NextResponse.json({ error: 'Storage is not configured.' }, { status: 400 });
  }

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  // Storage RLS already scopes objects to "<uid>/...", but check here too so
  // we never even attempt to sign a path outside the caller's own folder.
  // `..` is rejected explicitly: "<uid>/../<other-uid>/f" starts with the right
  // prefix but resolves elsewhere once the storage layer normalizes it.
  if (!storagePath.startsWith(`${auth.user.id}/`) || storagePath.includes('..')) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: error?.message ?? 'Could not sign URL.' }, { status: 500 });
  }

  return NextResponse.json({ url: data.signedUrl }, { status: 200 });
}
