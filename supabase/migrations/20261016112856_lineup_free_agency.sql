-- Persistent depth orders. Effective orders preserve edits and append new eligible players.
create table public.depth_positions(key text primary key,eligible text[] not null);
insert into public.depth_positions select position,array[position] from public.position_limits where position<>'DE';
update public.depth_positions set eligible=array['EDGE','DE'] where key='EDGE';
insert into public.depth_positions values('KR',array['RB','WR','CB','FS','SS']),('PR',array['RB','WR','CB','FS','SS']);
create table public.depth_charts(league_id uuid not null references public.leagues on delete cascade,franchise_id text not null references public.franchises,orders jsonb not null default '{}',version int not null default 1,primary key(league_id,franchise_id));
alter table public.depth_positions enable row level security;
alter table public.depth_charts enable row level security;
revoke all on public.depth_positions,public.depth_charts from public,anon,authenticated;
grant select on public.depth_positions,public.depth_charts to authenticated;
create policy read_depth_positions on public.depth_positions for select to authenticated using(true);
create policy read_own_depth on public.depth_charts for select to authenticated using(exists(select 1 from public.memberships m where m.league_id=depth_charts.league_id and m.franchise_id=depth_charts.franchise_id and m.user_id=(select auth.uid())));

create function public.effective_depth(lid uuid,team text) returns jsonb language sql stable set search_path=public as $$
 select coalesce(jsonb_object_agg(d.key,coalesce((select jsonb_agg(p.player_id order by
   coalesce((select ord from jsonb_array_elements_text(coalesce(c.orders->d.key,'[]')) with ordinality x(id,ord) where id=p.player_id::text),2147483647),
   case when d.key in('KR','PR') then coalesce((p.profile->'attributes'->>'kick_return')::int,(p.profile->>'overall')::int) else (p.profile->>'overall')::int end desc,p.player_id)
   from league_players p where p.league_id=lid and p.franchise_id=team and p.profile->>'position'=any(d.eligible)),'[]')),'{}')
 from depth_positions d left join depth_charts c on c.league_id=lid and c.franchise_id=team;
$$;
revoke all on function public.effective_depth(uuid,text) from public,anon,authenticated;

create function public.save_depth_order(lid uuid,position_key text,ordered_players uuid[],expected_version int) returns int language plpgsql security definer set search_path=public as $$
declare team text;v int;eligible_ids uuid[];orders_now jsonb;
begin
 perform 1 from leagues where id=lid for update;
 select franchise_id into team from memberships where league_id=lid and user_id=auth.uid();
 if team is null then raise exception 'League access denied';end if;
 select coalesce(version,0) into v from depth_charts where league_id=lid and franchise_id=team;v:=coalesce(v,0);
 if expected_version is null or expected_version<>v then raise exception 'Lineup changed in another session. Reload before saving.';end if;
 if position_key is null or not exists(select 1 from depth_positions where key=position_key) then raise exception 'Invalid depth position';end if;
 select array_agg(p.player_id order by p.player_id) into eligible_ids from league_players p join depth_positions d on d.key=position_key and p.profile->>'position'=any(d.eligible) where p.league_id=lid and p.franchise_id=team;
 if ordered_players is null or cardinality(ordered_players)=0 or (select array_agg(x order by x) from unnest(ordered_players)x) is distinct from eligible_ids then raise exception 'Depth order must contain every eligible roster player exactly once';end if;
 orders_now:=effective_depth(lid,team)||jsonb_build_object(position_key,to_jsonb(ordered_players));
 insert into depth_charts values(lid,team,orders_now,1) on conflict(league_id,franchise_id) do update set orders=excluded.orders,version=depth_charts.version+1 returning version into v;
 update leagues set revision=revision+1 where id=lid;return v;
end $$;
revoke all on function public.save_depth_order(uuid,text,uuid[],int) from public,anon;
grant execute on function public.save_depth_order(uuid,text,uuid[],int) to authenticated;

-- Ownership changes invalidate an editor's version and immediately repair saved orders.
create function public.repair_depth_ownership() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if old.franchise_id is distinct from new.franchise_id then
  update depth_charts set orders=effective_depth(new.league_id,franchise_id),version=version+1 where league_id=new.league_id and franchise_id in(old.franchise_id,new.franchise_id);
 end if;return new;
end $$;
revoke all on function public.repair_depth_ownership() from public,anon,authenticated;
create trigger repair_depth_ownership after update of franchise_id on public.league_players for each row execute function public.repair_depth_ownership();

alter table public.player_contracts alter column draft_round drop not null;
alter table public.player_contracts add column origin text not null default 'draft' check(origin in('draft','free_agency'));
create or replace function public.assign_draft_contract() returns trigger language plpgsql security definer set search_path=public as $$ begin
 insert into player_contracts(league_id,player_id,annual_salary,years,start_season,draft_round) select new.league_id,new.player_id,c.annual_salary,c.years,l.season,c.round from draft_contract_scale c join leagues l on l.id=new.league_id where c.round=new.pick/32+1;return new;
end $$;
create table public.roster_transactions(id uuid primary key default gen_random_uuid(),league_id uuid not null references public.leagues on delete cascade,player_id uuid not null,franchise_id text not null references public.franchises,actor uuid not null references auth.users,action text not null check(action in('sign','release')),annual_salary int not null,created_at timestamptz not null default now(),foreign key(league_id,player_id) references public.league_players on delete cascade);
create index roster_transactions_league on public.roster_transactions(league_id,created_at desc);
alter table public.roster_transactions enable row level security;
revoke all on public.roster_transactions from public,anon,authenticated;
grant select on public.roster_transactions to authenticated;
create policy read_roster_transactions on public.roster_transactions for select to authenticated using(public.is_member(league_id));

-- Asking prices are game rules, independent of real NFL contracts. Keep draft-round floor
-- for a released player so releasing and re-signing cannot erase an expensive deal.
create function public.free_agent_salary(lid uuid,pid uuid) returns int language sql stable set search_path=public as $$
 select greatest(case when (p.profile->>'overall')::int>=97 then 30000000 when (p.profile->>'overall')::int>=94 then 20000000 when (p.profile->>'overall')::int>=90 then 12000000 when (p.profile->>'overall')::int>=85 then 7000000 when (p.profile->>'overall')::int>=80 then 4000000 when (p.profile->>'overall')::int>=75 then 2000000 when (p.profile->>'overall')::int>=70 then 1250000 else 750000 end,
 coalesce((select c.annual_salary from draft_picks d join draft_contract_scale c on c.round=d.pick/32+1 where d.league_id=lid and d.player_id=pid),0))
 from league_players p where p.league_id=lid and p.player_id=pid;
$$;
revoke all on function public.free_agent_salary(uuid,uuid) from public,anon,authenticated;

create function public.sign_free_agent(lid uuid,pid uuid,expected_salary int) returns void language plpgsql security definer set search_path=public as $$
declare l leagues;team text;p league_players;pay bigint;price int;n int;
begin
 select * into l from leagues where id=lid for update;
 select franchise_id into team from memberships where league_id=lid and user_id=auth.uid();
 if team is null then raise exception 'League access denied';end if;
 if l.state<>'completed' then raise exception 'Free agency opens after draft completion';end if;
 select * into p from league_players where league_id=lid and player_id=pid;
 if not found or p.franchise_id is not null then raise exception 'Player is no longer a free agent';end if;
 price:=free_agent_salary(lid,pid);
 if expected_salary is null or expected_salary<>price then raise exception 'Asking price changed. Review the offer again.';end if;
 select count(*),coalesce(sum(c.annual_salary),0) into n,pay from league_players r left join player_contracts c using(league_id,player_id) where r.league_id=lid and r.franchise_id=team;
 if n>=60 then raise exception 'Roster maximum is 60 players. Release a player first.';end if;
 if pay+price>l.salary_cap then raise exception 'Signing exceeds salary cap';end if;
 update league_players set franchise_id=team where league_id=lid and player_id=pid;
 insert into player_contracts(league_id,player_id,annual_salary,years,start_season,draft_round,origin) values(lid,pid,price,1,l.season,null,'free_agency');
 insert into roster_transactions(league_id,player_id,franchise_id,actor,action,annual_salary) values(lid,pid,team,auth.uid(),'sign',price);
 update leagues set revision=revision+1 where id=lid;
 insert into league_events(league_id,message) values(lid,team||' signed '||(p.profile->>'name')||' to a one-year deal.');
end $$;
revoke all on function public.sign_free_agent(uuid,uuid,int) from public,anon;
grant execute on function public.sign_free_agent(uuid,uuid,int) to authenticated;

create function public.release_player(lid uuid,pid uuid,expected_salary int) returns void language plpgsql security definer set search_path=public as $$
declare l leagues;team text;p league_players;salary int;
begin
 select * into l from leagues where id=lid for update;
 select franchise_id into team from memberships where league_id=lid and user_id=auth.uid();
 if team is null then raise exception 'League access denied';end if;
 if l.state<>'completed' then raise exception 'Releases open after draft completion';end if;
 select * into p from league_players where league_id=lid and player_id=pid;
 if not found or p.franchise_id is distinct from team then raise exception 'Player is not on your roster';end if;
 select annual_salary into salary from player_contracts where league_id=lid and player_id=pid;
 if salary is null or expected_salary is null or salary<>expected_salary then raise exception 'Contract changed. Review release again.';end if;
 if (select count(*) from league_players where league_id=lid and franchise_id=team)<=46 then raise exception 'Keep at least 46 players on your roster';end if;
 if exists(select 1 from position_limits lim where (select count(*) from league_players r where r.league_id=lid and r.franchise_id=team and r.player_id<>pid and r.profile->>'position'=lim.position)<lim.starters) then raise exception 'Release would leave a position without enough eligible players';end if;
 update league_players set franchise_id=null where league_id=lid and player_id=pid;
 delete from player_contracts where league_id=lid and player_id=pid;
 update trade_offers set status='expired',reason='A player in this offer was released.',resolved_at=now() where league_id=lid and status='pending' and pid=any(give_players||take_players);
 insert into roster_transactions(league_id,player_id,franchise_id,actor,action,annual_salary) values(lid,pid,team,auth.uid(),'release',salary);
 update leagues set revision=revision+1 where id=lid;
 insert into league_events(league_id,message) values(lid,team||' released '||(p.profile->>'name')||'.');
end $$;
revoke all on function public.release_player(uuid,uuid,int) from public,anon;
grant execute on function public.release_player(uuid,uuid,int) to authenticated;

-- Extend the stable snapshot API without changing its existing payload.
alter function public.management_snapshot(uuid) rename to management_snapshot_base;
revoke all on function public.management_snapshot_base(uuid) from public,anon,authenticated;
create function public.management_snapshot(lid uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare base jsonb;team text;
begin
 -- Base checks membership before any private data is read.
 base:=management_snapshot_base(lid);
 select franchise_id into team from memberships where league_id=lid and user_id=auth.uid();
 return base||jsonb_build_object('revision',(select revision from leagues where id=lid),'depth',jsonb_build_object('orders',effective_depth(lid,team),'version',coalesce((select version from depth_charts where league_id=lid and franchise_id=team),0)),
 'free_agents',(select coalesce(jsonb_agg(jsonb_build_object('player_id',player_id,'annual_salary',free_agent_salary(lid,player_id))),'[]') from league_players where league_id=lid and franchise_id is null));
end $$;
revoke all on function public.management_snapshot(uuid) from public,anon;
grant execute on function public.management_snapshot(uuid) to authenticated;

-- Workbook skill import staging is private; no client can change ratings.
create table public.attribute_imports(id text primary key,sha256 text not null unique,expected_count int not null,applied_at timestamptz);
create table public.attribute_import_rows(import_id text not null references public.attribute_imports,player_id uuid not null references public.players,source_row int not null check(source_row>1),attributes jsonb not null check(jsonb_typeof(attributes)='object'),primary key(import_id,player_id),unique(import_id,source_row));
alter table public.attribute_imports enable row level security;
alter table public.attribute_import_rows enable row level security;
revoke all on public.attribute_imports,public.attribute_import_rows from public,anon,authenticated;
alter table public.players add column attributes_source text,add column attributes_source_row int,add column development_source text;

-- Game-assigned development, not workbook facts. Stable hash avoids changes on refresh.
create function public.initial_game_development(pid uuid,ovr int,age int) returns text language sql immutable set search_path=public as $$
 select case when ovr>=95 and ('x'||substr(md5(pid::text),1,6))::bit(24)::int%100<45 then 'Franchise Superstar'
 when ovr>=90 or (age<=26 and ovr>=83 and ('x'||substr(md5(pid::text),1,6))::bit(24)::int%100<30) then 'Superstar'
 when ovr>=82 or (age<=25 and ('x'||substr(md5(pid::text),1,6))::bit(24)::int%100<25) then 'Star' else 'Normal' end;
$$;
revoke all on function public.initial_game_development(uuid,int,int) from public,anon,authenticated;
