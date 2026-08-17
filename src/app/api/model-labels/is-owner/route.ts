import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { isOwner, ownerConfigured } from '@/lib/supabase/owner';
import { clientKey, hit, tooManyRequests } from '@/lib/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/model-labels/is-owner — whether the current user may curate model
 * names. Used purely to decide if the edit UI shows; every write is re-checked
 * server-side, so a spoofed `true` here grants nothing.
 */
export async function GET(request: Request): Promise<Response> {
  // Rate limit but no guard(): the answer is public by design, so a 401 here
  // would hide the edit UI from the owner's own first request. The ceiling is
  // what was missing — isOwner() spends a Supabase /auth/v1/user round trip on
  // every call that carries a parseable cookie, with nothing capping the rate.
  const rate = hit(`model-labels-is-owner-read:${clientKey(request)}`, 120, 60_000);
  if (!rate.ok) return tooManyRequests(rate);

  const supabase = await getSupabaseServer();
  if (!supabase || !ownerConfigured()) {
    return NextResponse.json({ isOwner: false });
  }
  return NextResponse.json({ isOwner: await isOwner(supabase) });
}
