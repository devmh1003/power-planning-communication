begin;

create table if not exists public.event_letters (
  id bigint generated always as identity primary key,
  request_id uuid not null unique,
  sender text not null check (char_length(btrim(sender)) between 1 and 40),
  recipient text not null check (char_length(btrim(recipient)) between 1 and 40),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

alter table public.event_letters add column if not exists owner_hash bytea;
alter table public.event_letters enable row level security;

create schema if not exists event_private;
revoke all on schema event_private from public, anon, authenticated;
create table if not exists event_private.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table event_private.admins enable row level security;
revoke all on table public.event_letters from public, anon, authenticated;
-- Explicitly remove column grants from earlier versions.
revoke select (id, sender, recipient, title, body, created_at)
  on public.event_letters from public, anon, authenticated;
grant select (id, recipient, title, body)
  on public.event_letters to anon, authenticated;

drop policy if exists event_letters_public_read on public.event_letters;
create policy event_letters_public_read
  on public.event_letters for select to anon, authenticated using (true);

drop function if exists public.post_event_letter(uuid, text, text, text, text);
create or replace function public.post_event_letter(
  p_request_id uuid,
  p_owner_key uuid,
  p_sender text,
  p_recipient text,
  p_title text,
  p_body text
) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  result_id bigint;
  key_hash bytea := sha256(convert_to(p_owner_key::text, 'UTF8'));
begin
  if key_hash is null then
    raise exception 'Owner key is required';
  end if;
  insert into public.event_letters (request_id, owner_hash, sender, recipient, title, body)
  values (p_request_id, key_hash, btrim(p_sender), btrim(p_recipient), btrim(p_title), btrim(p_body))
  on conflict (request_id) do nothing returning id into result_id;
  if result_id is null then
    select id into result_id from public.event_letters
    where request_id = p_request_id and owner_hash = key_hash;
  end if;
  return result_id;
end;
$$;

revoke all on function public.post_event_letter(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.post_event_letter(uuid, uuid, text, text, text, text)
  to anon, authenticated;

create or replace function public.manage_event_letter(
  p_id bigint, p_owner_key uuid, p_delete boolean,
  p_recipient text, p_title text, p_body text
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  is_admin boolean := exists (
    select 1 from event_private.admins where user_id = auth.uid()
  );
begin
  if p_delete then
    delete from public.event_letters where id = p_id
      and (is_admin or owner_hash = sha256(convert_to(p_owner_key::text, 'UTF8')));
  else
    update public.event_letters
      set recipient = btrim(p_recipient), title = btrim(p_title), body = btrim(p_body)
      where id = p_id
      and (is_admin or owner_hash = sha256(convert_to(p_owner_key::text, 'UTF8')));
  end if;
  return found;
end;
$$;

create or replace function public.admin_event_letters(p_before bigint default null)
returns table (id bigint, sender text, recipient text, title text, body text, created_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from event_private.admins where user_id = auth.uid()) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  return query
    select l.id, l.sender, l.recipient, l.title, l.body, l.created_at
    from public.event_letters l where p_before is null or l.id < p_before
    order by l.id desc limit 21;
end;
$$;

revoke all on function public.manage_event_letter(bigint, uuid, boolean, text, text, text)
  from public, anon, authenticated;
grant execute on function public.manage_event_letter(bigint, uuid, boolean, text, text, text)
  to anon, authenticated;

revoke all on function public.admin_event_letters(bigint) from public, anon, authenticated;
grant execute on function public.admin_event_letters(bigint) to authenticated;

commit;
