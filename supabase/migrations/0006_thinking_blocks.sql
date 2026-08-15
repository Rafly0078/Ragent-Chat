-- ---------------------------------------------------------------------------
-- 0006 — ordered thinking blocks
--
-- Reasoning was a single flat `messages.reasoning text` column (added in 0005),
-- which can hold the words but not the SHAPE. A model that thinks, answers, then
-- thinks again produced one blob of all thinking and one blob of all text, with
-- the ordering between them unrecoverable — so interleaved thinking could not be
-- rendered truthfully, and Anthropic's per-block `signature` (which must be
-- echoed back verbatim on the next turn, or the request is rejected) had nowhere
-- to live at all.
--
-- `thinking_blocks` stores the ordered parts array as jsonb. Shape, per element:
--
--   { "kind": "text" | "thinking",
--     "index": int,              -- upstream content-block index, or synthesized
--     "text": string,
--     "startedAt": epoch_ms,     -- thinking only
--     "endedAt": epoch_ms,       -- thinking only, absent if never closed
--     "signature": string,       -- thinking only, Anthropic
--     "redacted": bool,          -- thinking only, Anthropic
--     "interrupted": bool }      -- thinking only, stream died mid-block
--
-- `content` and `reasoning` are kept as the FLATTENED MIRRORS of this, not
-- replaced. A lot reads them (the request builder, artifact/patch detection,
-- compaction, export, search-source extraction) and every message written before
-- today has only them. Readers fall back when `thinking_blocks` is empty, so old
-- rows keep rendering exactly as they did and an older client that doesn't know
-- about the column still gets a coherent message.
--
-- Not `metadata`: `safeMetadata` in src/lib/services/mappers.ts rejects arrays
-- outright, and a column that is validated on its own is easier to reason about
-- than a reserved key inside a free-form blob.
--
-- Default '[]' rather than null so readers never have to distinguish "no blocks"
-- from "column absent".
-- ---------------------------------------------------------------------------

alter table public.messages
  add column if not exists thinking_blocks jsonb not null default '[]'::jsonb;

comment on column public.messages.thinking_blocks is
  'Ordered text/thinking segments. content + reasoning are flattened mirrors of this; empty array means a pre-0006 message that only has the mirrors.';
