/**
 * Find (and optionally delete) generated files left in Storage with nothing pointing
 * at them.
 *
 * `artifacts.conversation_id` cascades, so deleting a chat took its artifact rows and
 * left the objects behind — the rows were the only record of where they were. The app
 * now removes the objects when the conversation goes (see conversations.service), but
 * every chat deleted before that is still paying for its files.
 *
 * Reports by default and deletes nothing. Pass --apply to remove what it lists.
 *
 *   node scripts/sweep-artifact-orphans.mjs
 *   node scripts/sweep-artifact-orphans.mjs --apply
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUCKETS = ['artifacts', 'exports'];
const APPLY = process.argv.includes('--apply');

/** The service role key, straight out of .env.local — this has to see every user's
 *  objects, and RLS deliberately stops the anon key from doing that. */
function env() {
  const text = readFileSync(`${ROOT}/.env.local`, 'utf8');
  const read = (key) => text.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim();
  const url = read('NEXT_PUBLIC_SUPABASE_URL');
  const key = read('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('.env.local is missing the Supabase URL or service key');
  return { url, key };
}

const { url, key } = env();
const supabase = createClient(url, key, { auth: { persistSession: false } });

/** Every object under a prefix, depth-first. Storage lists one level at a time:
 *  an entry with no `id` is a folder, not a file. */
async function walk(bucket, prefix = '') {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit: 100, offset });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    if (!data?.length) break;
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id) out.push({ path, size: entry.metadata?.size ?? 0, at: entry.created_at });
      else out.push(...(await walk(bucket, path)));
    }
    if (data.length < 100) break;
  }
  return out;
}
/** Every storage_path the artifacts table still refers to. */
async function referenced() {
  const paths = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('artifacts')
      .select('storage_path')
      .range(from, from + 999);
    if (error) throw new Error(`artifacts: ${error.message}`);
    for (const row of data ?? []) if (row.storage_path) paths.add(row.storage_path);
    if (!data || data.length < 1000) break;
  }
  return paths;
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

const live = await referenced();
console.log(`${live.size} file(s) referenced by an artifacts row\n`);

let leakedBytes = 0;
const toRemove = new Map();

for (const bucket of BUCKETS) {
  const objects = await walk(bucket);
  const orphans = objects.filter((o) => !live.has(o.path));
  const bytes = orphans.reduce((sum, o) => sum + o.size, 0);
  leakedBytes += bytes;
  if (orphans.length) toRemove.set(bucket, orphans);

  console.log(`${bucket}: ${objects.length} object(s), ${orphans.length} orphaned (${kb(bytes)})`);
  // The whole list, oldest first: this is the review before anything is deleted.
  for (const o of [...orphans].sort((a, b) => String(a.at).localeCompare(String(b.at)))) {
    console.log(`  ${String(o.at).slice(0, 19)}  ${kb(o.size).padStart(10)}  ${o.path}`);
  }
}

console.log(`\ntotal orphaned: ${kb(leakedBytes)}`);

if (!APPLY) {
  console.log('\nreport only — re-run with --apply to delete the files listed above.');
  process.exit(0);
}

for (const [bucket, orphans] of toRemove) {
  const paths = orphans.map((o) => o.path);
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    const { error } = await supabase.storage.from(bucket).remove(batch);
    if (error) {
      console.error(`remove ${bucket} batch ${i / 100}: ${error.message}`);
      process.exit(1);
    }
    console.log(`removed ${batch.length} from ${bucket}`);
  }
}
console.log(`\nfreed ${kb(leakedBytes)}`);
