-- Round contracts, explicit whole-draft simulation, atomic trades and coaching.
alter table public.leagues add column salary_cap bigint not null default 275000000 check(salary_cap>0),add column full_draft_sim boolean not null default false;
create table public.draft_contract_scale(round int primary key check(round between 1 and 53),annual_salary int not null check(annual_salary>0),years int not null check(years between 1 and 5));
insert into public.draft_contract_scale select r,case when r<=15 then (array[30000000,20000000,16000000,14000000,12000000,10000000,9000000,8000000,7000000,6000000,5000000,4500000,4000000,3500000,3000000])[r] when r<=30 then 2750000-(r-16)*100000 else greatest(750000,1250000-(r-31)*25000) end,case when r<=5 then 5 when r<=10 then 4 when r<=15 then 3 when r<=35 then 2 else 1 end from generate_series(1,53) r;
create table public.player_contracts(league_id uuid not null,player_id uuid not null,annual_salary int not null check(annual_salary>0),years int not null check(years between 1 and 5),start_season int not null,draft_round int not null references public.draft_contract_scale,primary key(league_id,player_id),foreign key(league_id,player_id) references public.league_players on delete cascade);
create function public.assign_draft_contract() returns trigger language plpgsql security definer set search_path=public as $$ begin
 insert into player_contracts select new.league_id,new.player_id,c.annual_salary,c.years,l.season,c.round from draft_contract_scale c join leagues l on l.id=new.league_id where c.round=new.pick/32+1;return new;
end $$;
revoke all on function public.assign_draft_contract() from public,anon,authenticated;
create trigger draft_contract after insert on public.draft_picks for each row execute function public.assign_draft_contract();
insert into public.player_contracts select d.league_id,d.player_id,c.annual_salary,c.years,l.season,c.round from public.draft_picks d join public.leagues l on l.id=d.league_id join public.draft_contract_scale c on c.round=d.pick/32+1;

create or replace function public.draft_control(lid uuid,action text) returns void language plpgsql security definer set search_path=public as $$
declare l leagues; target text;
begin
 select * into l from leagues where id=lid for update;
 if not is_commissioner(lid) then raise exception 'Commissioner only'; end if;
 target:=case when action='simulate_all' and l.state<>'completed' then 'completing'
 when action='start' and l.state='waiting' then 'running'
 when action='pause' and l.state in ('running','completing') then 'paused'
 when action='resume' and l.state='paused' then l.resume_state
 when action='complete' and l.state='awaiting_completion' then 'completing' else null end;
 if target is null then raise exception 'Invalid draft transition'; end if;
 update leagues set next_cpu_pick_at=clock_timestamp()+interval '4 seconds',state=target,full_draft_sim=full_draft_sim or action='simulate_all',resume_state=case when target='paused' then l.state else null end,revision=revision+1 where id=lid;
 insert into league_events(league_id,message) values(lid,'Commissioner: '||action||'.');
end $$;

-- Extend the existing commit primitive only at the commissioner-authorized checkpoint.
create function public.full_sim_checkpoint() returns trigger language plpgsql set search_path=public as $$ begin
 if new.full_draft_sim and new.state='awaiting_completion' then new.state:='completing';end if;return new;
end $$;
revoke all on function public.full_sim_checkpoint() from public,anon,authenticated;
create trigger full_sim_checkpoint before update on public.leagues for each row execute function public.full_sim_checkpoint();

create table public.rookie_pick_rights(id uuid primary key default gen_random_uuid(),league_id uuid not null references public.leagues on delete cascade,season int not null,round int not null check(round between 1 and 7),original_franchise text not null references public.franchises,franchise_id text not null references public.franchises,unique(league_id,season,round,original_franchise));
create index rookie_pick_owner on public.rookie_pick_rights(league_id,franchise_id);
create table public.trade_offers(id uuid primary key default gen_random_uuid(),league_id uuid not null references public.leagues on delete cascade,from_team text not null references public.franchises,to_team text not null references public.franchises,proposed_by uuid not null references auth.users,give_players uuid[] not null,take_players uuid[] not null,give_picks uuid[] not null,take_picks uuid[] not null,season int not null,status text not null default 'pending' check(status in ('pending','accepted','rejected','cancelled','expired')),reason text not null default '',give_value numeric not null default 0,take_value numeric not null default 0,created_at timestamptz not null default now(),resolved_at timestamptz,check(from_team<>to_team));
create index trade_league_created on public.trade_offers(league_id,created_at desc);
create table public.coaching_settings(league_id uuid not null references public.leagues on delete cascade,franchise_id text not null references public.franchises,offense text not null,defense text not null,tendencies jsonb not null,version int not null default 1,primary key(league_id,franchise_id));

alter table public.draft_contract_scale enable row level security;
alter table public.player_contracts enable row level security;
alter table public.rookie_pick_rights enable row level security;
alter table public.trade_offers enable row level security;
alter table public.coaching_settings enable row level security;
revoke all on public.draft_contract_scale,public.player_contracts,public.rookie_pick_rights,public.trade_offers,public.coaching_settings from anon,authenticated;
grant select on public.draft_contract_scale,public.player_contracts,public.rookie_pick_rights,public.trade_offers,public.coaching_settings to authenticated;
create policy read_contract_scale on public.draft_contract_scale for select to authenticated using(true);
create policy read_contracts on public.player_contracts for select to authenticated using(public.is_member(league_id));
create policy read_pick_rights on public.rookie_pick_rights for select to authenticated using(public.is_member(league_id));
create policy read_trades on public.trade_offers for select to authenticated using(public.is_member(league_id) and (status='accepted' or exists(select 1 from public.memberships m where m.league_id=trade_offers.league_id and m.user_id=(select auth.uid()) and m.franchise_id in (from_team,to_team))));
create policy read_coaching on public.coaching_settings for select to authenticated using(exists(select 1 from public.memberships m where m.league_id=coaching_settings.league_id and m.franchise_id=coaching_settings.franchise_id and m.user_id=(select auth.uid())));

create function public.ensure_rookie_picks(lid uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 if (select max(season) from rookie_pick_rights where league_id=lid)>=(select season+3 from leagues where id=lid) then return;end if;
 insert into rookie_pick_rights(league_id,season,round,original_franchise,franchise_id) select lid,l.season+y,r,f.id,f.id from leagues l cross join franchises f cross join generate_series(1,3)y cross join generate_series(1,7)r where l.id=lid on conflict(league_id,season,round,original_franchise) do nothing;
end $$;
revoke all on function public.ensure_rookie_picks(uuid) from public,anon,authenticated;

create function public.player_trade_value(p jsonb,salary int,years int) returns numeric language sql immutable set search_path=public as $$
 select power(greatest(1,(p->>'overall')::int-45),2)*case when p->>'position'='QB' then 1.2 when p->>'position' in ('K','P','FB') then 0.45 else 1 end*greatest(0.65,1.15-greatest(0,(p->>'age')::int-24)*0.035)*(1+0.04*(years-1))*greatest(0.8,1.08-salary::numeric/150000000);
$$;
revoke all on function public.player_trade_value(jsonb,int,int) from public,anon,authenticated;

-- Internal settlement primitive. Every caller holds the league lock first.
create function public.settle_trade(tid uuid) returns text language plpgsql security definer set search_path=public as $$
declare t trade_offers;l leagues;team text;n int;pay bigint;
begin
 select * into t from trade_offers where id=tid for update;
 if t.status<>'pending' then return t.status;end if;
 select * into l from leagues where id=t.league_id;
 if l.state<>'completed' or t.season<>l.season
 or (select count(*) from league_players where league_id=t.league_id and franchise_id=t.from_team and player_id=any(t.give_players))<>cardinality(t.give_players)
 or (select count(*) from league_players where league_id=t.league_id and franchise_id=t.to_team and player_id=any(t.take_players))<>cardinality(t.take_players)
 or (select count(*) from rookie_pick_rights where league_id=t.league_id and franchise_id=t.from_team and id=any(t.give_picks) and season>l.season)<>cardinality(t.give_picks)
 or (select count(*) from rookie_pick_rights where league_id=t.league_id and franchise_id=t.to_team and id=any(t.take_picks) and season>l.season)<>cardinality(t.take_picks) then
 update trade_offers set status='expired',reason='Assets or league phase changed. Submit a new offer.',resolved_at=now() where id=tid;return 'expired';end if;
 -- Validate projected ownership before writing anything.
 foreach team in array array[t.from_team,t.to_team] loop
  with projected as(select p.* from league_players p where p.league_id=t.league_id and
   (case when p.player_id=any(t.give_players) then t.to_team when p.player_id=any(t.take_players) then t.from_team else p.franchise_id end)=team)
  select count(*),coalesce(sum(c.annual_salary),0) into n,pay from projected p join player_contracts c on c.league_id=p.league_id and c.player_id=p.player_id;
  if n>60 or pay>l.salary_cap then raise exception 'Trade exceeds roster maximum or salary cap for %',team;end if;
  if exists(select 1 from position_limits lim where (select count(*) from league_players p where p.league_id=t.league_id and p.profile->>'position'=lim.position and (case when p.player_id=any(t.give_players) then t.to_team when p.player_id=any(t.take_players) then t.from_team else p.franchise_id end)=team)<lim.starters) then raise exception 'Trade leaves % without an eligible player at a position',team;end if;
 end loop;
 update league_players set franchise_id=case when player_id=any(t.give_players) then t.to_team else t.from_team end where league_id=t.league_id and player_id=any(t.give_players||t.take_players);
 update rookie_pick_rights set franchise_id=case when id=any(t.give_picks) then t.to_team else t.from_team end where league_id=t.league_id and id=any(t.give_picks||t.take_picks);
 update trade_offers set status='accepted',reason='Both teams accepted; ownership and cap validated.',resolved_at=now() where id=tid;
 update leagues set revision=revision+1 where id=t.league_id;
 insert into league_events(league_id,message) values(t.league_id,'Trade completed: '||t.from_team||' ↔ '||t.to_team||'.');return 'accepted';
end $$;
revoke all on function public.settle_trade(uuid) from public,anon,authenticated;

create function public.propose_trade(lid uuid,target_team text,give_players uuid[],take_players uuid[],give_picks uuid[] default '{}',take_picks uuid[] default '{}') returns uuid language plpgsql security definer set search_path=public as $$
declare mine text;l leagues;tid uuid;gv numeric;tv numeric;gmax numeric;tmax numeric;gpv numeric;cpu boolean;
begin
 select * into l from leagues where id=lid for update;
 select franchise_id into mine from memberships where league_id=lid and user_id=auth.uid();
 if mine is null then raise exception 'League access denied';end if;
 if l.state<>'completed' then raise exception 'Trades open after draft completion';end if;
 if target_team=mine or not exists(select 1 from franchises where id=target_team) then raise exception 'Choose another franchise';end if;
 if give_players is null or take_players is null or give_picks is null or take_picks is null or cardinality(give_players)+cardinality(give_picks) not between 1 and 10 or cardinality(take_players)+cardinality(take_picks) not between 1 and 10 then raise exception 'Each side must include 1–10 assets';end if;
 perform ensure_rookie_picks(lid);
 if (select count(distinct x) from unnest(give_players||take_players)x)<>cardinality(give_players||take_players) or (select count(distinct x) from unnest(give_picks||take_picks)x)<>cardinality(give_picks||take_picks) then raise exception 'Duplicate or null trade assets';end if;
 if (select count(*) from league_players where league_id=lid and franchise_id=mine and player_id=any(give_players))<>cardinality(give_players) or (select count(*) from league_players where league_id=lid and franchise_id=target_team and player_id=any(take_players))<>cardinality(take_players) or (select count(*) from rookie_pick_rights where league_id=lid and franchise_id=mine and id=any(give_picks) and season>l.season)<>cardinality(give_picks) or (select count(*) from rookie_pick_rights where league_id=lid and franchise_id=target_team and id=any(take_picks) and season>l.season)<>cardinality(take_picks) then raise exception 'Trade assets are not currently owned by the selected teams';end if;
 select coalesce(sum(v),0),coalesce(max(v),0) into gv,gmax from (select player_trade_value(p.profile,c.annual_salary,c.years)*case when (select count(*) from league_players n where n.league_id=lid and n.franchise_id=target_team and n.profile->>'position'=p.profile->>'position')<=lim.starters then 1.1 else 1 end v from league_players p join player_contracts c using(league_id,player_id) join position_limits lim on lim.position=p.profile->>'position' where p.league_id=lid and p.player_id=any(give_players))x;
 select coalesce(sum(v),0),coalesce(max(v),0) into tv,tmax from (select player_trade_value(p.profile,c.annual_salary,c.years) v from league_players p join player_contracts c using(league_id,player_id) where p.league_id=lid and p.player_id=any(take_players))x;
 select coalesce(sum((array[1400,650,300,150,80,40,20])[round]*power(0.85,season-l.season-1)),0) into gpv from rookie_pick_rights where league_id=lid and id=any(give_picks);gv:=gv+gpv;
 select tv+coalesce(sum((array[1400,650,300,150,80,40,20])[round]*power(0.85,season-l.season-1)),0) into tv from rookie_pick_rights where league_id=lid and id=any(take_picks);
 cpu:=not exists(select 1 from memberships where league_id=lid and franchise_id=target_team);
 insert into trade_offers(league_id,from_team,to_team,proposed_by,give_players,take_players,give_picks,take_picks,season,give_value,take_value) values(lid,mine,target_team,auth.uid(),give_players,take_players,give_picks,take_picks,l.season,round(gv),round(tv)) returning id into tid;
 if cpu then
  if gv<tv*1.08 or (tmax>=1600 and gmax<tmax*0.7 and gpv<tmax*0.9) then update trade_offers set status='rejected',reason='CPU requires fair compensation: more total value or a stronger centerpiece for its star.',resolved_at=now() where id=tid;
  else perform settle_trade(tid);end if;
 end if;
 update leagues set revision=revision+1 where id=lid;return tid;
end $$;
revoke all on function public.propose_trade(uuid,text,uuid[],uuid[],uuid[],uuid[]) from public,anon;
grant execute on function public.propose_trade(uuid,text,uuid[],uuid[],uuid[],uuid[]) to authenticated;

create function public.respond_trade(tid uuid,decision text) returns text language plpgsql security definer set search_path=public as $$
declare t trade_offers;mine text;lid uuid;result text;
begin
 select league_id into lid from trade_offers where id=tid;
 perform 1 from leagues where id=lid for update;
 select * into t from trade_offers where id=tid for update;
 select franchise_id into mine from memberships where league_id=lid and user_id=auth.uid();
 if mine is null or mine not in(t.from_team,t.to_team) then raise exception 'Trade access denied';end if;
 if decision='cancel' and mine<>t.from_team or decision in('accept','reject') and mine<>t.to_team or decision not in('accept','reject','cancel') or decision is null then raise exception 'Unauthorized trade response';end if;
 if t.status<>'pending' then return t.status;end if;
 if decision='accept' then result:=settle_trade(tid);
 else result:=case when decision='cancel' then 'cancelled' else 'rejected' end;update trade_offers set status=result,reason='Owner: '||decision,resolved_at=now() where id=tid;end if;
 update leagues set revision=revision+1 where id=lid;return result;
end $$;
revoke all on function public.respond_trade(uuid,text) from public,anon;
grant execute on function public.respond_trade(uuid,text) to authenticated;

create function public.save_coaching(lid uuid,offense_scheme text,defense_scheme text,settings jsonb,expected_version int) returns int language plpgsql security definer set search_path=public as $$
declare team text;v int;k text;keys text[]:=array['run_pass','tempo','deep_pass','short_pass','play_action','rpo','fourth_down','two_point','red_zone','blitz','man_zone','aggression','run_defense','pass_defense','press','prevent_big_plays'];
begin
 perform 1 from leagues where id=lid for update;
 select franchise_id into team from memberships where league_id=lid and user_id=auth.uid();if team is null then raise exception 'League access denied';end if;
 if offense_scheme is null or offense_scheme not in('West Coast','Spread','Power Run','Air Raid','Balanced','Option') or defense_scheme is null or defense_scheme not in('4–3','3–4','Nickel-heavy','Multiple','Man-heavy','Zone-heavy') then raise exception 'Invalid scheme';end if;
 if settings is null or jsonb_typeof(settings)<>'object' then raise exception 'Invalid tendencies';end if;
 if (select count(*) from jsonb_object_keys(settings))<>cardinality(keys) then raise exception 'All 16 coaching tendencies are required';end if;
 foreach k in array keys loop
 if not(settings?k) or jsonb_typeof(settings->k)<>'number' or (settings->>k)::numeric<>trunc((settings->>k)::numeric) or (settings->>k)::numeric not between 0 and 100 then raise exception 'Invalid tendency: %',k;end if;
 end loop;
 select version into v from coaching_settings where league_id=lid and franchise_id=team;
 if expected_version is null or coalesce(v,0)<>expected_version then raise exception 'Coaching changed in another session. Reload before saving.';end if;
 insert into coaching_settings values(lid,team,offense_scheme,defense_scheme,settings,1) on conflict(league_id,franchise_id) do update set offense=excluded.offense,defense=excluded.defense,tendencies=excluded.tendencies,version=coaching_settings.version+1 returning version into v;
 update leagues set revision=revision+1 where id=lid;return v;
end $$;
revoke all on function public.save_coaching(uuid,text,text,jsonb,int) from public,anon;
grant execute on function public.save_coaching(uuid,text,text,jsonb,int) to authenticated;

create function public.management_snapshot(lid uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare team text;
begin
 select franchise_id into team from memberships where league_id=lid and user_id=auth.uid();if team is null then raise exception 'League access denied';end if;
 perform ensure_rookie_picks(lid);
 return jsonb_build_object('ownership',(select coalesce(jsonb_agg(jsonb_build_object('player_id',player_id,'franchise_id',franchise_id)),'[]') from league_players where league_id=lid and franchise_id is not null),'contracts',(select coalesce(jsonb_agg(c),'[]') from player_contracts c where league_id=lid),'picks',(select coalesce(jsonb_agg(p order by season,round,original_franchise),'[]') from rookie_pick_rights p where league_id=lid),'trades',(select coalesce(jsonb_agg(t order by created_at desc),'[]') from trade_offers t where league_id=lid and (from_team=team or to_team=team or status='accepted')),'coaching',(select to_jsonb(c) from coaching_settings c where league_id=lid and franchise_id=team));
end $$;
revoke all on function public.management_snapshot(uuid) from public,anon;
grant execute on function public.management_snapshot(uuid) to authenticated;
