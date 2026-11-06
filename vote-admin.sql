begin;
create or replace function public.admin_icon_ballots()
returns table(ballot_id uuid,first_id smallint,second_id smallint,first_note text,second_note text)
language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from event_private.admins where user_id=auth.uid())
    then raise exception 'Administrator access required' using errcode='42501'; end if;
  return query select b.request_id,b.first_id,b.second_id,b.first_note,b.second_note
    from event_private.icon_ballots b order by b.request_id;
end; $$;
create or replace function public.admin_icon_ballot_change(
  p_id uuid,p_delete boolean,p_first smallint,p_second smallint,p_first_note text,p_second_note text
)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from event_private.admins where user_id=auth.uid())
    then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_delete is true then
    delete from event_private.icon_ballots where request_id=p_id;
  else
    if p_first is null or p_second is null or p_first=p_second
      or p_first_note is null or p_second_note is null
      or char_length(btrim(p_first_note)) not between 1 and 100
      or char_length(btrim(p_second_note)) not between 1 and 100
      or (select count(*) from event_private.icon_candidates where id in(p_first,p_second))<>2
      then return false; end if;
    update event_private.icon_ballots set first_id=p_first,second_id=p_second,
      first_note=btrim(p_first_note),second_note=btrim(p_second_note) where request_id=p_id;
  end if;
  return found;
end; $$;
revoke all on function public.admin_icon_ballots(),public.admin_icon_ballot_change(uuid,boolean,smallint,smallint,text,text) from public,anon,authenticated;
grant execute on function public.admin_icon_ballots(),public.admin_icon_ballot_change(uuid,boolean,smallint,smallint,text,text) to authenticated;
commit;
