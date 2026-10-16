-- Linked negotiations and private per-owner read receipts. Existing offers/results remain intact.
alter table public.trade_offers add column counter_of uuid references public.trade_offers(id) on delete set null;
alter table public.trade_offers add column thread_id uuid references public.trade_offers(id) on delete set null;
alter table public.trade_offers add column evaluation jsonb not null default '{}'::jsonb;
alter table public.trade_offers drop constraint trade_offers_status_check;
alter table public.trade_offers add constraint trade_offers_status_check check(status in('pending','accepted','rejected','cancelled','expired','countered'));
create index trade_thread_history on public.trade_offers(league_id,thread_id,created_at);
create index trade_counter_parent on public.trade_offers(counter_of);
create table public.trade_reads(offer_id uuid not null references public.trade_offers(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,read_at timestamptz not null default now(),primary key(offer_id,user_id));
alter table public.trade_reads enable row level security;
revoke all on public.trade_reads from public,anon,authenticated;
grant select on public.trade_reads to authenticated;
create policy read_own_trade_receipts on public.trade_reads for select to authenticated using(user_id=(select auth.uid()) and exists(select 1 from public.trade_offers t join public.memberships m on m.league_id=t.league_id and m.franchise_id in(t.from_team,t.to_team) where t.id=offer_id and m.user_id=(select auth.uid())));

-- Original game valuation, including development and remaining contract years.
create or replace function public.player_trade_value(p jsonb,salary int,years int) returns numeric language sql immutable set search_path=public as $$
 select power(greatest(1,(p->>'overall')::int-45),2)*case when p->>'position'='QB' then 1.2 when p->>'position' in ('K','P','FB') then 0.45 else 1 end*greatest(0.65,1.15-greatest(0,(p->>'age')::int-24)*0.035)*(1+0.04*(greatest(1,years)-1))*greatest(0.8,1.08-salary::numeric/150000000)*case lower(p->>'development') when 'franchise superstar' then 1.2 when 'generational' then 1.2 when 'superstar' then 1.12 when 'star' then 1.05 else 1 end;
$$;
revoke all on function public.player_trade_value(jsonb,int,int) from public,anon,authenticated;

-- One evaluator drives previews and every new offer. Callers enforce owner identity.
create function public.evaluate_trade_internal(lid uuid,mine text,target_team text,give_players uuid[],take_players uuid[],give_picks uuid[],take_picks uuid[]) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare l leagues;gv numeric;tv numeric;gmax numeric;tmax numeric;gpv numeric;cpu boolean;fair boolean;interest int;problems jsonb:='[]';feedback jsonb:='[]';pay bigint;n int;t text;positions text;complete boolean;
begin
 select * into strict l from leagues where id=lid;
 if give_players is null or take_players is null or give_picks is null or take_picks is null then raise exception 'Trade arrays are required';end if;
 if mine=target_team or not exists(select 1 from franchises where id=target_team) then raise exception 'Choose another franchise';end if;
 complete:=cardinality(give_players)+cardinality(give_picks) between 1 and 10 and cardinality(take_players)+cardinality(take_picks) between 1 and 10;
 if not complete then problems:=problems||jsonb_build_array('Each side must include 1–10 assets.');end if;
 if l.state<>'completed' then problems:=problems||jsonb_build_array('Trades open after draft completion.');end if;
 if (select count(distinct x) from unnest(give_players||take_players)x)<>cardinality(give_players||take_players) or (select count(distinct x) from unnest(give_picks||take_picks)x)<>cardinality(give_picks||take_picks) then raise exception 'Duplicate or null trade assets';end if;
 if (select count(*) from league_players where league_id=lid and franchise_id=mine and player_id=any(give_players))<>cardinality(give_players) or (select count(*) from league_players where league_id=lid and franchise_id=target_team and player_id=any(take_players))<>cardinality(take_players) or (select count(*) from rookie_pick_rights where league_id=lid and franchise_id=mine and id=any(give_picks) and season>l.season)<>cardinality(give_picks) or (select count(*) from rookie_pick_rights where league_id=lid and franchise_id=target_team and id=any(take_picks) and season>l.season)<>cardinality(take_picks) then raise exception 'Trade assets are not currently owned by the selected teams';end if;
 if (select count(*) from player_contracts where league_id=lid and player_id=any(give_players||take_players))<>cardinality(give_players||take_players) then problems:=problems||jsonb_build_array('A selected player contract is unavailable. Refresh the league.');end if;
 select coalesce(sum(v),0),coalesce(max(v),0) into gv,gmax from (select player_trade_value(p.profile,c.annual_salary,greatest(1,c.start_season+c.years-l.season))*case when (select count(*) from league_players x where x.league_id=lid and x.franchise_id=target_team and x.profile->>'position'=p.profile->>'position')<=lim.starters or ((p.profile->>'overall')::int >= 3+coalesce((select max((x.profile->>'overall')::int) from league_players x where x.league_id=lid and x.franchise_id=target_team and x.profile->>'position'=p.profile->>'position'),0)) then 1.1 else 1 end v from league_players p join player_contracts c using(league_id,player_id) join position_limits lim on lim.position=p.profile->>'position' where p.league_id=lid and p.player_id=any(give_players))x;
 select coalesce(sum(v),0),coalesce(max(v),0) into tv,tmax from (select player_trade_value(p.profile,c.annual_salary,greatest(1,c.start_season+c.years-l.season)) v from league_players p join player_contracts c using(league_id,player_id) where p.league_id=lid and p.player_id=any(take_players))x;
 select coalesce(sum((array[1400,650,300,150,80,40,20])[round]*power(0.85,season-l.season-1)),0) into gpv from rookie_pick_rights where league_id=lid and id=any(give_picks);gv:=gv+gpv;
 select tv+coalesce(sum((array[1400,650,300,150,80,40,20])[round]*power(0.85,season-l.season-1)),0) into tv from rookie_pick_rights where league_id=lid and id=any(take_picks);
 cpu:=not exists(select 1 from memberships where league_id=lid and franchise_id=target_team);
 if complete then
  foreach t in array array[mine,target_team] loop
   select count(*),coalesce(sum(c.annual_salary),0) into n,pay from league_players p left join player_contracts c using(league_id,player_id) where p.league_id=lid and (case when p.player_id=any(give_players) then target_team when p.player_id=any(take_players) then mine else p.franchise_id end)=t;
   if pay>l.salary_cap then problems:=problems||jsonb_build_array(t||' would exceed the salary cap.');end if;
   if n>60 then problems:=problems||jsonb_build_array(t||' would exceed the roster maximum.');end if;
   select string_agg(lim.position,', ' order by lim.position) into positions from position_limits lim where (select count(*) from league_players p where p.league_id=lid and p.profile->>'position'=lim.position and (case when p.player_id=any(give_players) then target_team when p.player_id=any(take_players) then mine else p.franchise_id end)=t)<lim.starters;
   if positions is not null then problems:=problems||jsonb_build_array(t||' must keep enough eligible players at: '||positions||'.');end if;
  end loop;
 end if;
 fair:=gv>=tv*1.08 and not(tmax>=1600 and gmax<tmax*0.7 and gpv<tmax*0.9);
 interest:=case when not complete or jsonb_array_length(problems)>0 then 0 else least(100,greatest(0,round(gv/greatest(tv,1)/1.08*75)::int)) end;
 if not fair then interest:=least(74,interest);end if;
 if tmax>=1600 and gmax<tmax*0.7 and gpv<tmax*0.9 then
  interest:=least(45,interest);
  feedback:=feedback||jsonb_build_array('They want a stronger centerpiece for their high-value player, or meaningful early-round picks.');
 end if;
 if gv<tv*1.08 then feedback:=feedback||jsonb_build_array('The package needs more total value. Add a player or a future pick, or request less in return.');end if;
 select string_agg(distinct p.profile->>'position',', ') into positions from league_players p where p.league_id=lid and p.player_id=any(give_players) and (p.profile->>'overall')::int>=3+coalesce((select max((x.profile->>'overall')::int) from league_players x where x.league_id=lid and x.franchise_id=target_team and x.profile->>'position'=p.profile->>'position'),0);
 if positions is not null then feedback:=feedback||jsonb_build_array('Your offered players would improve their top rating at: '||positions||'.');end if;
 if cpu and fair and jsonb_array_length(problems)=0 then feedback:=feedback||jsonb_build_array('The CPU values this package and is interested in the deal.');end if;
 if not cpu then feedback:=jsonb_build_array('This franchise has a human owner. Value estimates help compare the package; the owner makes the decision.');end if;
 return jsonb_build_object('valid',jsonb_array_length(problems)=0,'is_cpu',cpu,'cpu_accepts',cpu and fair and jsonb_array_length(problems)=0,'interest',case when cpu then interest else null end,'give_value',round(gv),'take_value',round(tv),'feedback',feedback,'problems',problems);
end $$;
revoke all on function public.evaluate_trade_internal(uuid,text,text,uuid[],uuid[],uuid[],uuid[]) from public,anon,authenticated;

create function public.trade_preview(lid uuid,target_team text,give_players uuid[],take_players uuid[],give_picks uuid[] default '{}',take_picks uuid[] default '{}') returns jsonb language plpgsql stable security definer set search_path=public as $$
declare mine text;
begin
 select franchise_id into mine from memberships where league_id=lid and user_id=auth.uid();
 if mine is null then raise exception 'League access denied';end if;
 return evaluate_trade_internal(lid,mine,target_team,give_players,take_players,give_picks,take_picks);
end $$;
revoke all on function public.trade_preview(uuid,text,uuid[],uuid[],uuid[],uuid[]) from public,anon;
grant execute on function public.trade_preview(uuid,text,uuid[],uuid[],uuid[],uuid[]) to authenticated;

create or replace function public.propose_trade(lid uuid,target_team text,give_players uuid[],take_players uuid[],give_picks uuid[] default '{}',take_picks uuid[] default '{}') returns uuid language plpgsql security definer set search_path=public as $$
declare mine text;l leagues;tid uuid;e jsonb;
begin
 select * into strict l from leagues where id=lid for update;
 select franchise_id into mine from memberships where league_id=lid and user_id=auth.uid();
 if mine is null then raise exception 'League access denied';end if;
 if l.state<>'completed' then raise exception 'Trades open after draft completion';end if;
 perform ensure_rookie_picks(lid);
 e:=evaluate_trade_internal(lid,mine,target_team,give_players,take_players,give_picks,take_picks);
 if not(e->>'valid')::boolean then raise exception '%',e->'problems'->>0;end if;
 insert into trade_offers(league_id,from_team,to_team,proposed_by,give_players,take_players,give_picks,take_picks,season,give_value,take_value,evaluation) values(lid,mine,target_team,auth.uid(),give_players,take_players,give_picks,take_picks,l.season,(e->>'give_value')::numeric,(e->>'take_value')::numeric,e) returning id into tid;
 update trade_offers set thread_id=tid where id=tid;
 if (e->>'is_cpu')::boolean then
  if (e->>'cpu_accepts')::boolean then
   perform settle_trade(tid);
   update trade_offers set reason='CPU accepted: the package met its value, centerpiece and roster requirements.' where id=tid;
  else update trade_offers set status='rejected',reason='CPU: '||(select string_agg(value,' ') from jsonb_array_elements_text(e->'feedback')),resolved_at=now() where id=tid;end if;
 end if;
 update leagues set revision=revision+1 where id=lid;
 return tid;
end $$;
revoke all on function public.propose_trade(uuid,text,uuid[],uuid[],uuid[],uuid[]) from public,anon;
grant execute on function public.propose_trade(uuid,text,uuid[],uuid[],uuid[],uuid[]) to authenticated;

-- The league lock serializes counters, acceptance and asset changes. No client-side cancel race.
create function public.counter_trade(tid uuid,give_players uuid[],take_players uuid[],give_picks uuid[] default '{}',take_picks uuid[] default '{}') returns uuid language plpgsql security definer set search_path=public as $$
declare parent trade_offers;mine text;child uuid;lid uuid;target text;
begin
 select league_id into lid from trade_offers where id=tid;
 perform 1 from leagues where id=lid for update;
 select * into parent from trade_offers where id=tid for update;
 select franchise_id into mine from memberships where league_id=lid and user_id=auth.uid();
 if mine is null or mine not in(parent.from_team,parent.to_team) then raise exception 'Trade access denied';end if;
 if parent.status<>'pending' and not(parent.status='rejected' and mine=parent.from_team) then raise exception 'This offer has already been resolved. Refresh the inbox.';end if;
 if parent.season<>(select season from leagues where id=lid) then raise exception 'Trade season changed';end if;
 target:=case when mine=parent.from_team then parent.to_team else parent.from_team end;
 child:=propose_trade(lid,target,give_players,take_players,give_picks,take_picks);
 update trade_offers set counter_of=parent.id,thread_id=coalesce(parent.thread_id,parent.id) where id=child;
 if parent.status='pending' then update trade_offers set status='countered',reason='Replaced by a counteroffer in this negotiation.',resolved_at=now() where id=parent.id;end if;
 return child;
end $$;
revoke all on function public.counter_trade(uuid,uuid[],uuid[],uuid[],uuid[]) from public,anon;
grant execute on function public.counter_trade(uuid,uuid[],uuid[],uuid[],uuid[]) to authenticated;

create function public.mark_trade_read(tid uuid) returns void language plpgsql security definer set search_path=public as $$
declare t trade_offers;mine text;
begin
 select * into t from trade_offers where id=tid;
 select franchise_id into mine from memberships where league_id=t.league_id and user_id=auth.uid();
 if mine is null or mine not in(t.from_team,t.to_team) then raise exception 'Trade access denied';end if;
 insert into trade_reads(offer_id,user_id) values(tid,auth.uid()) on conflict(offer_id,user_id) do update set read_at=now();
end $$;
revoke all on function public.mark_trade_read(uuid) from public,anon;
grant execute on function public.mark_trade_read(uuid) to authenticated;

alter function public.management_snapshot(uuid) rename to management_snapshot_pre_trades;
revoke all on function public.management_snapshot_pre_trades(uuid) from public,anon,authenticated;
create function public.management_snapshot(lid uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare base jsonb;mine text;
begin
 base:=management_snapshot_pre_trades(lid);
 select franchise_id into mine from memberships where league_id=lid and user_id=auth.uid();
 return base||jsonb_build_object('human_teams',(select coalesce(jsonb_agg(franchise_id order by franchise_id),'[]') from memberships where league_id=lid),'unread_trade_ids',(select coalesce(jsonb_agg(t.id order by t.created_at desc),'[]') from trade_offers t where t.league_id=lid and t.to_team=mine and t.status='pending' and not exists(select 1 from trade_reads r where r.offer_id=t.id and r.user_id=auth.uid())));
end $$;
revoke all on function public.management_snapshot(uuid) from public,anon;
grant execute on function public.management_snapshot(uuid) to authenticated;
