/**
 * Small id helpers.
 *
 * Every id produced here ends up in a Postgres `uuid` column (conversations.id,
 * messages.id, artifacts.id), so the fallback must also be a valid UUID.
 * `crypto.randomUUID` is secure-context-only, which a self-hosted deployment on
 * `http://<lan-ip>` is not — the old fallback emitted `m5k3j2-a8f9c1x2`, every
 * insert failed with `22P02 invalid input syntax for type uuid`, the sync layer
 * swallowed it, and the user was told their chats were saved while nothing ever
 * reached the database.
 */
export function uid(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // RFC 4122 version 4 / variant bits.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push(bytes[i]!.toString(16).padStart(2, '0'));
  return (
    `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-` +
    `${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`
  );
}
