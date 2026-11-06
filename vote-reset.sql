begin;
create or replace function public.admin_icon_vote_reset(p_confirmation text)
returns bigint language plpgsql security definer set search_path='' as $$
declare removed bigint;
begin
  if not exists(select 1 from event_private.admins where user_id=auth.uid())
    then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_confirmation is distinct from '결과 초기화'
    then raise exception 'Confirmation required' using errcode='22023'; end if;
  delete from event_private.icon_ballots;
  get diagnostics removed = row_count;
  return removed;
end; $$;
revoke all on function public.admin_icon_vote_reset(text) from public,anon,authenticated;
grant execute on function public.admin_icon_vote_reset(text) to authenticated;
commit;
