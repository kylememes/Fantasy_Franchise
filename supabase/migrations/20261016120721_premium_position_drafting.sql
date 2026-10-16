-- Needs-aware CPU selection for both paced picks and commissioner full simulation.
-- The salary is identical for every selection in a round, so real-world/seed salaries
-- must not affect fantasy draft value. EDGE and DE share the early pass-rusher need.
create function public.cpu_draft_score(p jsonb,owned int,starter_target int,rush_owned int,draft_round int,available_count int,roster_maximum int) returns numeric language sql immutable set search_path=public as $$
 with input as(select p->>'position' pos,(p->>'overall')::int ovr,(p->>'age')::int age,
  case when p->>'position' in('EDGE','DE') then rush_owned else owned end n,
  case when p->>'position' in('EDGE','DE') then 2 else starter_target end target),
 skill as(select *,case
  when pos='QB' then coalesce((p->'attributes'->>'short_accuracy')::int,ovr)*0.4+coalesce((p->'attributes'->>'medium_accuracy')::int,ovr)*0.35+coalesce((p->'attributes'->>'throw_power')::int,ovr)*0.25
  when pos in('EDGE','DE') then greatest(coalesce((p->'attributes'->>'power_moves')::int,(p->'attributes'->>'pass_rush')::int,ovr),coalesce((p->'attributes'->>'finesse_moves')::int,ovr))
  when pos='WR' then (coalesce((p->'attributes'->>'catching')::int,ovr)+coalesce((p->'attributes'->>'short_route')::int,ovr)+coalesce((p->'attributes'->>'speed')::int,ovr))/3.0
  when pos='CB' then (coalesce((p->'attributes'->>'man_coverage')::int,ovr)+coalesce((p->'attributes'->>'zone_coverage')::int,ovr)+coalesce((p->'attributes'->>'speed')::int,ovr))/3.0
  when pos in('LT','LG','C','RG','RT') then (coalesce((p->'attributes'->>'pass_blocking')::int,ovr)+coalesce((p->'attributes'->>'run_blocking')::int,ovr))/2.0
  else ovr end relevant from input)
 select ovr+(relevant-ovr)*0.12
  +least(4.2,greatest(0,28-age)*0.6)
  -greatest(0,age-case when pos='QB' then 35 when pos='RB' then 28 else 31 end)*0.6
  +case when n<target then 18 else case when draft_round<=15 then -32 when draft_round<=25 then -16 else -4 end end
  +case when n<target then
    case when pos='QB' then 20 when pos in('EDGE','DE') then 18 when pos in('WR','CB') then 16 when pos in('LT','LG','C','RG','RT') then 5 when pos='FB' then -12 else 0 end
    *case when draft_round<=15 then 1.0 else 0.5 end else 0 end
  -n*2
  +least(6,greatest(0,32.0*roster_maximum/greatest(1,available_count)-1)*2)
  +case when p->>'development' in('Franchise Superstar','Generational') then 1.5 when p->>'development'='Superstar' then 1 when p->>'development'='Star' then 0.5 else 0 end
 from skill;
$$;
revoke all on function public.cpu_draft_score(jsonb,int,int,int,int,int,int) from public,anon,authenticated;

-- Index the best available candidates at each position so repeated CPU picks stay fast.
create index league_draft_candidates on public.league_players(league_id,(profile->>'position'),((profile->>'overall')::int) desc,((profile->>'age')::int),player_id) where franchise_id is null;

create or replace function public.cpu_tick_internal(lid uuid,batch_size int default 8) returns int language plpgsql security definer set search_path=public as $$
declare l leagues; team text; pid uuid; done int:=0;
begin
 -- SKIP LOCKED prevents cron/browser workers from queuing behind one another.
 select * into l from leagues where id=lid for update skip locked;
 if l.id is null or l.next_cpu_pick_at>clock_timestamp() then return 0; end if;
 for i in 1..case when l.state='running' then 1 else least(greatest(batch_size,1),8) end loop
  select * into l from leagues where id=lid;
  if l.state not in ('running','completing') then exit; end if;
  team:=draft_team(l.draft_order,l.next_pick);
  if l.state='running' and exists(select 1 from memberships where league_id=lid and franchise_id=team) then exit; end if;
  with counts as(select profile->>'position' pos,count(*)::int n from league_players where league_id=lid and franchise_id=team group by 1),
  available as(select profile->>'position' pos,count(*)::int n from league_players where league_id=lid and franchise_id is null group by 1),
  rush as(select coalesce(sum(n),0)::int n from counts where pos in('EDGE','DE'))
  select p.player_id into pid from position_limits lim
  left join counts c on c.pos=lim.position join available a on a.pos=lim.position cross join rush
  cross join lateral (
   select candidate.player_id,candidate.profile from league_players candidate
   where candidate.league_id=lid and candidate.franchise_id is null and candidate.profile->>'position'=lim.position
   order by (candidate.profile->>'overall')::int desc,(candidate.profile->>'age')::int,candidate.player_id limit 8
  ) p
  where coalesce(c.n,0)<lim.maximum
  -- Specialists are taken only after every eligible non-specialist roster slot.
  order by case when lim.position in('K','P') then 1 else 0 end,
    cpu_draft_score(p.profile,coalesce(c.n,0),lim.starters,rush.n,l.next_pick/32+1,a.n,lim.maximum) desc,p.player_id limit 1;
  if pid is null then raise exception 'Insufficient eligible players'; end if;
  perform commit_pick(lid,pid); done:=done+1;
 end loop;
 return done;
end $$;

revoke all on function public.cpu_tick_internal(uuid,int) from public,anon,authenticated;
