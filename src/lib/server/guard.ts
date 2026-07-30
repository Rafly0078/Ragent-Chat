import 'server-only';

import { getSupabaseServer } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/supabase/env';
import { clientKey, hit, tooManyRequests } from './rate-limit';

/**
 * Shared entry guard for the Route Handlers.
 *
 * Why this exists: `AuthGate` puts a mandatory sign-in dialog over the whole
 * app whenever Supabase is configured, but that wall is client-side only —
 * nothing stopped anyone from POSTing straight to `/api/bridge/chat` (running
 * inference on the owner's Ollama box), `/api/search` (spending the owner's
 * Tavily quota) or `/api/tools/execute` (server-side document rendering).
 * This enforces the same rule on the server.
 *
 * Guest-only deployments are preserved deliberately: when Supabase isn't
 * configured, `AuthGate` no-ops and the app is *meant* to run without sign-in,
 * so the guard only applies the rate limit.
 */

export interface GuardOptions {
  /** Max requests per window for this route. */
  limit: number;
  /** Window length in ms. */
  windowMs: number;
  /** Namespace so routes don't share a counter. */
  bucket: string;
}

export interface GuardOk {
  ok: true;
  /** Authenticated user id, or null in a guest-only deployment. */
  userId: string | null;
}

export interface GuardFail {
  ok: false;
  response: Response;
}

export async function guard(
  request: Request,
  options: GuardOptions,
): Promise<GuardOk | GuardFail> {
  // Flood guard FIRST, keyed on IP, before the session lookup. `getUser()` is a
  // network round trip to Supabase, so checking auth first would let an
  // unauthenticated flood amplify into one upstream request per hit. The ceiling
  // is deliberately looser than the per-user limit so several people behind one
  // NAT aren't punished for each other.
  const flood = hit(
    `${options.bucket}:flood:${clientKey(request)}`,
    options.limit * 4,
    options.windowMs,
  );
  if (!flood.ok) return { ok: false, response: tooManyRequests(flood) };

  let userId: string | null = null;

  if (supabaseConfigured()) {
    const supabase = await getSupabaseServer();
    const { data } = (await supabase?.auth.getUser()) ?? { data: { user: null } };
    if (!data.user) {
      return {
        ok: false,
        response: Response.json(
          { error: 'Sign in to use this feature.' },
          { status: 401 },
        ),
      };
    }
    userId = data.user.id;
  }

  const result = hit(
    `${options.bucket}:${clientKey(request, userId)}`,
    options.limit,
    options.windowMs,
  );
  if (!result.ok) return { ok: false, response: tooManyRequests(result) };

  return { ok: true, userId };
}
