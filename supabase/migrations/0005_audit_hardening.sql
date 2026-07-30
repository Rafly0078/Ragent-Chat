-- ============================================================================
-- 0005_audit_hardening.sql — audit follow-ups (NOT YET APPLIED)
--
-- Written by the project audit. It is intentionally NOT pushed: every statement
-- here touches a live database, and two of them change data-visibility rules.
-- Review, then apply with `supabase db push` (or paste into the SQL editor)
-- during a maintenance window.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Child-table policies now verify the PARENT's owner.
--
-- 0002_rls.sql's header claims child tables are "verified via their parent's
-- user_id for defense in depth", but the policies only check
-- `auth.uid() = user_id`. Any authenticated user could therefore insert
-- `messages(conversation_id = <someone else's conversation>, user_id = self)`.
-- Consequences: FK success vs. 23503 is an existence oracle for other users'
-- ids; the attacker's rows hang off the victim's conversation and cascade-delete
-- with it; and because document_versions has `unique (document_id, version)`,
-- inserting (victim_document, N) permanently blocks the victim from creating
-- version N.
-- ---------------------------------------------------------------------------

drop policy if exists "messages_all_own" on public.messages;
create policy "messages_all_own" on public.messages
  for all
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "attachments_all_own" on public.attachments;
create policy "attachments_all_own" on public.attachments
  for all
  using (
    auth.uid() = user_id
    and (
      message_id is null
      or exists (
        select 1 from public.messages m
        where m.id = message_id and m.user_id = auth.uid()
      )
    )
  )
  with check (
    auth.uid() = user_id
    and (
      message_id is null
      or exists (
        select 1 from public.messages m
        where m.id = message_id and m.user_id = auth.uid()
      )
    )
  );

drop policy if exists "artifacts_all_own" on public.artifacts;
create policy "artifacts_all_own" on public.artifacts
  for all
  using (
    auth.uid() = user_id
    and (
      conversation_id is null
      or exists (
        select 1 from public.conversations c
        where c.id = conversation_id and c.user_id = auth.uid()
      )
    )
  )
  with check (
    auth.uid() = user_id
    and (
      conversation_id is null
      or exists (
        select 1 from public.conversations c
        where c.id = conversation_id and c.user_id = auth.uid()
      )
    )
  );

drop policy if exists "document_versions_all_own" on public.document_versions;
create policy "document_versions_all_own" on public.document_versions
  for all
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.documents d
      where d.id = document_id and d.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.documents d
      where d.id = document_id and d.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 2. The auth.sessions trigger can no longer wedge sign-in.
--
-- `ensure_profile_on_login()` runs inside the transaction that inserts the
-- session row, with no exception handler — so ANY failure writing
-- public.profiles (a future NOT NULL column, a check constraint, a permission
-- change after a GoTrue upgrade) aborts the session insert and ALL logins fail
-- for ALL users. The app already self-heals a missing profile via
-- `ensureProfile` on the client, so this trigger must never be able to block
-- authentication.
-- ---------------------------------------------------------------------------

create or replace function public.ensure_profile_on_login()
returns trigger
language plpgsql
security definer set search_path = public, auth
as $$
declare
  u auth.users%rowtype;
begin
  begin
    select * into u from auth.users where id = new.user_id;
    if not found then
      return new;
    end if;

    insert into public.profiles (id, email, display_name, avatar_url, is_guest)
    values (
      u.id,
      u.email,
      coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
      coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture'),
      coalesce(u.is_anonymous, false)
    )
    on conflict (id) do nothing; -- never clobber a customized profile
  exception
    when others then
      -- Never let profile bookkeeping fail a login.
      raise warning 'ensure_profile_on_login failed for %: %', new.user_id, sqlerrm;
  end;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Sync fidelity + integrity constraints.
--
-- `thinking` and `summary` have no columns, so both are silently dropped on
-- every cloud round-trip: extended thinking reverts to off after a reload, and
-- the compaction summary is rebuilt from scratch (re-sending the full history
-- and re-paying for the summarization). `reasoning` and `metadata` are lost the
-- same way, which is why generated artifacts need the separate recovery path in
-- conversations.service.ts.
--
-- After applying this, wire the columns up in src/lib/services/mappers.ts.
-- ---------------------------------------------------------------------------

alter table public.conversations
  add column if not exists thinking jsonb not null default '{"enabled": false, "effort": "medium"}'::jsonb,
  add column if not exists summary jsonb;

alter table public.messages
  add column if not exists reasoning text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Message order: `seq` had no unique constraint and the read ordered on it
-- alone, so duplicate/zero values let messages come back interleaved (equal
-- sort keys are returned in arbitrary order in Postgres).
create unique index if not exists messages_convo_seq_uidx
  on public.messages (conversation_id, seq);

-- One default workspace per user.
create unique index if not exists workspaces_one_default_idx
  on public.workspaces (user_id) where is_default;

-- ---------------------------------------------------------------------------
-- 4. Orphan cleanup on delete.
--
-- `artifacts.message_id` and `downloads.artifact_id` use `on delete set null`,
-- which is what produces the orphaned-artifact recovery heuristic in
-- conversations.service.ts (it guesses the owning message and piles every
-- orphan onto the last assistant turn). An artifact has no meaning without its
-- message, and a download row pointing at a deleted artifact just lists a file
-- that can't be fetched.
-- ---------------------------------------------------------------------------

alter table public.artifacts
  drop constraint if exists artifacts_message_id_fkey,
  add constraint artifacts_message_id_fkey
    foreign key (message_id) references public.messages (id) on delete cascade;

alter table public.downloads
  drop constraint if exists downloads_artifact_id_fkey,
  add constraint downloads_artifact_id_fkey
    foreign key (artifact_id) references public.artifacts (id) on delete cascade;

