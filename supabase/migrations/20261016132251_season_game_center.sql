-- Durable seasons, frozen game inputs, authoritative playback and cosmetic staff hires.
create table public.schedule_templates(year int not null,phase text not null check(phase in ('preseason','regular')),week int not null check(week between 1 and 18),home text not null references franchises,away text not null references franchises,kickoff timestamptz,source_game_id text not null,source_url text not null,primary key(year,source_game_id),check(home<>away));
create table public.coach_catalog(id text primary key,name text not null,role text not null check(role in ('HC','OC','DC')),source text not null);
create table public.franchise_staff(league_id uuid not null references leagues on delete cascade,franchise_id text not null references franchises,role text not null check(role in ('HC','OC','DC')),coach_id text not null references coach_catalog,primary key(league_id,franchise_id,role),unique(league_id,coach_id));
create index staff_coach on public.franchise_staff(coach_id);
create table public.league_seasons(league_id uuid not null references leagues on delete cascade,season int not null,year int not null default 2026,phase text not null default 'preseason' check(phase in ('preseason','regular')),week int not null default 1,status text not null default 'setup' check(status in ('setup','open','complete')),primary key(league_id,season));
create table public.season_games(id uuid primary key default gen_random_uuid(),league_id uuid not null,season int not null,phase text not null,week int not null,home text not null references franchises,away text not null references franchises,kickoff timestamptz,source_game_id text not null,status text not null default 'scheduled' check(status in ('scheduled','queued','building','live','paused','final','error')),home_score int,away_score int,cursor int not null default 0,anchor_at timestamptz,speed int not null default 1 check(speed in (1,2,4)),participants int not null default 0,engine_version text,box jsonb,finalized_at timestamptz,foreign key(league_id,season) references league_seasons on delete cascade,unique(league_id,season,source_game_id),check(home<>away),check((status='final')=(finalized_at is not null)));
create index games_week on public.season_games(league_id,season,phase,week);
create index games_queue on public.season_games(status) where status in ('queued','building','live');
create table public.game_ready(game_id uuid not null references season_games on delete cascade,user_id uuid not null references auth.users,last_seen_at timestamptz not null default now(),primary key(game_id,user_id));
-- Private worker payloads and tickets have RLS and no client grants or policies.
create table public.game_jobs(game_id uuid primary key references season_games on delete cascade,seed bigint not null,frozen jsonb not null,result jsonb,lease uuid,claimed_at timestamptz,attempts int not null default 0,last_error text);
create table public.game_worker_tickets(ticket uuid primary key default gen_random_uuid(),expires_at timestamptz not null default now()+interval '90 seconds');

alter table public.schedule_templates enable row level security;
alter table public.coach_catalog enable row level security;
alter table public.franchise_staff enable row level security;
alter table public.league_seasons enable row level security;
alter table public.season_games enable row level security;
alter table public.game_ready enable row level security;
alter table public.game_jobs enable row level security;
alter table public.game_worker_tickets enable row level security;
create policy schedule_read on public.schedule_templates for select to authenticated using(true);
create policy coach_read on public.coach_catalog for select to authenticated using(true);
create policy staff_read on public.franchise_staff for select to authenticated using(is_member(league_id));
create policy season_read on public.league_seasons for select to authenticated using(is_member(league_id));
create policy games_read on public.season_games for select to authenticated using(is_member(league_id));
create policy ready_read on public.game_ready for select to authenticated using(exists(select 1 from public.season_games g where g.id=game_id and is_member(g.league_id)));
revoke all on public.schedule_templates,public.coach_catalog,public.franchise_staff,public.league_seasons,public.season_games,public.game_ready from public,anon,authenticated;
grant select on public.schedule_templates,public.coach_catalog,public.franchise_staff,public.league_seasons,public.season_games,public.game_ready to authenticated;
revoke all on public.game_jobs,public.game_worker_tickets from public,anon,authenticated;

create function public.hire_coach(lid uuid,staff_role text,coach text) returns void language plpgsql security definer set search_path=public as $$
declare team text;
begin
 perform 1 from leagues where id=lid for update;
 select franchise_id into team from memberships where league_id=lid and user_id=auth.uid();
 if team is null then raise exception 'Access denied';end if;
 if staff_role not in ('HC','OC','DC') then raise exception 'Invalid staff role';end if;
 if coach is not null then
  if not exists(select 1 from coach_catalog where id=coach and role=staff_role) then raise exception 'Coach is not eligible for this role';end if;
  if exists(select 1 from franchise_staff where league_id=lid and coach_id=coach and (franchise_id<>team or role<>staff_role)) then raise exception 'Coach has already been hired in this league';end if;
 end if;
 delete from franchise_staff where league_id=lid and franchise_id=team and role=staff_role;
 if coach is not null then insert into franchise_staff values(lid,team,staff_role,coach);end if;
 update leagues set revision=revision+1 where id=lid;
 insert into league_events(league_id,message) values(lid,team||' updated its '||staff_role||' position'||coalesce(': '||(select name from coach_catalog where id=coach),''));
end $$;

create function public.prepare_season_internal(lid uuid) returns void language plpgsql security definer set search_path=public as $$
declare l leagues;
begin
 select * into strict l from leagues where id=lid;
 if l.state<>'completed' then raise exception 'Complete the fantasy draft first';end if;
 if exists(select 1 from league_seasons where league_id=lid and season=l.season) then return;end if;
 if l.season<>1 then raise exception 'Only the inaugural 2026 season is configured';end if;
 if (select count(*) from schedule_templates where year=2026 and phase='regular')<>272 or (select count(*) from schedule_templates where year=2026 and phase='preseason')<>48 then raise exception '2026 schedule has not been installed';end if;
 insert into league_seasons(league_id,season) values(lid,l.season);
 insert into season_games(league_id,season,phase,week,home,away,kickoff,source_game_id) select lid,l.season,phase,week,home,away,kickoff,source_game_id from schedule_templates where year=2026;
end $$;

create function public.team_game_input(lid uuid,team text) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',team,'players',coalesce((select jsonb_agg(profile order by player_id) from league_players where league_id=lid and franchise_id=team),'[]'::jsonb),'depth',effective_depth(lid,team),'coaching',coalesce((select jsonb_build_object('offense',offense,'defense',defense,'tendencies',tendencies) from coaching_settings where league_id=lid and franchise_id=team),jsonb_build_object('offense','Balanced','defense','4–3','tendencies','{}'::jsonb)),'staff',coalesce((select jsonb_object_agg(s.role,c.name) from franchise_staff s join coach_catalog c on c.id=s.coach_id where s.league_id=lid and s.franchise_id=team),'{}'::jsonb));
$$;
create function public.queue_game_internal(gid uuid,forced boolean default false) returns void language plpgsql security definer set search_path=public as $$
declare g season_games;humans int;ready int;frozen jsonb;sd bigint;
begin
 select * into strict g from season_games where id=gid for update;
 if g.status<>'scheduled' then return;end if;
 select count(*) into humans from memberships where league_id=g.league_id and franchise_id in (g.home,g.away);
 select count(*) into ready from game_ready r join memberships m on m.user_id=r.user_id and m.league_id=g.league_id where r.game_id=gid and r.last_seen_at>now()-interval '30 seconds' and m.franchise_id in(g.home,g.away);
 if not forced and ready<humans then return;end if;
 frozen=jsonb_build_object('phase',g.phase,'home',team_game_input(g.league_id,g.home),'away',team_game_input(g.league_id,g.away));
 if jsonb_array_length(frozen#>'{home,players}')<46 or jsonb_array_length(frozen#>'{away,players}')<46 then raise exception 'Both teams need complete eligible rosters';end if;
 sd=('x'||substr(md5(gen_random_uuid()::text),1,8))::bit(32)::bigint;
 insert into game_jobs(game_id,seed,frozen) values(gid,sd,frozen||jsonb_build_object('seed',sd));
 update season_games set status='queued',participants=case when forced then 0 else humans end where id=gid;
end $$;

create function public.finish_game_internal(gid uuid) returns void language plpgsql security definer set search_path=public as $$
declare g season_games;r jsonb;
begin
 select * into strict g from season_games where id=gid for update;
 if g.status='final' then return;end if;
 select result into r from game_jobs where game_id=gid;
 if r is null then raise exception 'Simulation is not prepared';end if;
 update season_games set status='final',home_score=(r->>'home_score')::int,away_score=(r->>'away_score')::int,cursor=jsonb_array_length(r->'plays'),box=r->'box',engine_version=r->>'engine_version',finalized_at=now(),anchor_at=null where id=gid;
 update leagues set revision=revision+1 where id=g.league_id;
 insert into league_events(league_id,message) values(g.league_id,g.away||' '||(r->>'away_score')||' — '||g.home||' '||(r->>'home_score')||' · FINAL');
end $$;
create function public.refresh_game_internal(gid uuid) returns void language plpgsql security definer set search_path=public as $$
declare g season_games;total int;current_cursor int;
begin
 select * into strict g from season_games where id=gid for update;
 if g.status<>'live' then return;end if;
 select jsonb_array_length(result->'plays') into total from game_jobs where game_id=gid;
 current_cursor=g.cursor+greatest(0,floor(extract(epoch from(now()-g.anchor_at))*g.speed/4)::int);
 if current_cursor>=total then perform finish_game_internal(gid);end if;
end $$;
create function public.live_cursor(g public.season_games) returns int language sql stable set search_path=public as $$
 select g.cursor+case when g.status='live' then greatest(0,floor(extract(epoch from(now()-g.anchor_at))*g.speed/4)::int) else 0 end;
$$;

create function public.week_control(lid uuid,action text,expected_phase text,expected_week int) returns void language plpgsql security definer set search_path=public as $$
declare l leagues;s league_seasons;g season_games;
begin
 select * into strict l from leagues where id=lid for update;
 if not is_commissioner(lid) then raise exception 'Commissioner only';end if;
 perform prepare_season_internal(lid);
 select * into strict s from league_seasons where league_id=lid and season=l.season for update;
 if s.phase<>expected_phase or s.week<>expected_week then raise exception 'Week changed. Refresh the league';end if;
 if s.status='complete' then raise exception 'The regular season is complete';end if;
 for g in select * from season_games where league_id=lid and season=l.season and phase=s.phase and week=s.week order by id loop perform refresh_game_internal(g.id);end loop;
 if action='advance' then
  if s.status<>'open' then raise exception 'Open the current week first';end if;
  if exists(select 1 from season_games where league_id=lid and season=l.season and phase=s.phase and week=s.week and status<>'final') then raise exception 'Finish every game before advancing, or simulate unfinished games';end if;
  if s.phase='regular' and s.week=18 then
   update league_seasons set status='complete' where league_id=lid and season=l.season;
   update leagues set revision=revision+1 where id=lid;return;
  end if;
  if s.phase='preseason' and s.week=3 then s.phase='regular';s.week=1;else s.week=s.week+1;end if;
  update league_seasons set phase=s.phase,week=s.week,status='open' where league_id=lid and season=l.season;
 elsif action='open' then
  update league_seasons set status='open' where league_id=lid and season=l.season;
 elsif action='simulate_unfinished' then
  if s.status<>'open' then raise exception 'Open the current week first';end if;
  for g in select * from season_games where league_id=lid and season=l.season and phase=s.phase and week=s.week order by id loop
   if g.status='scheduled' then perform queue_game_internal(g.id,true);
   elsif g.status in ('live','paused') then perform finish_game_internal(g.id);
   elsif g.status in ('queued','building') then update season_games set participants=0 where id=g.id;
   elsif g.status='error' then update game_jobs set attempts=0,lease=null,claimed_at=null,last_error=null where game_id=g.id;update season_games set status='queued',participants=0 where id=g.id;end if;
  end loop;
 else raise exception 'Unknown week action';end if;
 -- Only CPU matchups auto-start when a week opens. No human readiness is implied.
 if action in ('open','advance') then
  for g in select * from season_games where league_id=lid and season=l.season and phase=s.phase and week=s.week and status='scheduled' and not exists(select 1 from memberships m where m.league_id=lid and m.franchise_id in(season_games.home,season_games.away)) order by id loop perform queue_game_internal(g.id);end loop;
 end if;
 update leagues set revision=revision+1 where id=lid;
 insert into league_events(league_id,message) values(lid,'Commissioner: '||replace(action,'_',' ')||' · '||s.phase||' Week '||s.week);
end $$;

create function public.game_action(gid uuid,action text,play_speed int default 1) returns void language plpgsql security definer set search_path=public as $$
declare g season_games;s league_seasons;l uuid;team text;cur int;
begin
 select league_id into strict l from season_games where id=gid;
 perform 1 from leagues where id=l for update;
 select * into strict g from season_games where id=gid for update;
 select franchise_id into team from memberships where league_id=l and user_id=auth.uid();
 if team is null or team not in(g.home,g.away) then raise exception 'Only participating owners can control this game';end if;
 select * into strict s from league_seasons where league_id=l and season=g.season;
 if s.status<>'open' or s.phase<>g.phase or s.week<>g.week then raise exception 'This game is not in the open week';end if;
 perform refresh_game_internal(gid);select * into g from season_games where id=gid;
 if action in ('ready','unready') then
  if g.status<>'scheduled' then return;end if;
  if action='unready' then delete from game_ready where game_id=gid and user_id=auth.uid();else insert into game_ready(game_id,user_id) values(gid,auth.uid()) on conflict(game_id,user_id) do update set last_seen_at=now();perform queue_game_internal(gid);end if;
 elsif action='retry' and g.status='error' then
  update game_jobs set attempts=0,lease=null,claimed_at=null,last_error=null where game_id=gid;update season_games set status='queued' where id=gid;
 elsif action in ('pause','resume','speed','next','finish') then
  if g.status='final' then return;end if;
  if g.status not in('live','paused') then raise exception 'Wait for the simulation worker';end if;
  cur=live_cursor(g);
  if action='finish' then perform finish_game_internal(gid);
  else
   if play_speed not in(1,2,4) then raise exception 'Invalid speed';end if;
   update season_games set cursor=cur+case when action='next' then 1 else 0 end,anchor_at=now(),speed=case when action='speed' then play_speed else speed end,status=case when action='pause' then 'paused' when action='resume' then 'live' else status end where id=gid;
   select * into g from season_games where id=gid;
   if g.cursor>=(select jsonb_array_length(result->'plays') from game_jobs where game_id=gid) then perform finish_game_internal(gid);end if;
  end if;
 else raise exception 'Invalid game action';end if;
 update leagues set revision=revision+1 where id=l;
end $$;

create function public.season_snapshot(lid uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare l leagues;s league_seasons;g season_games;r jsonb;
begin
 select * into strict l from leagues where id=lid for update;
 if not is_member(lid) then raise exception 'Access denied';end if;
 if l.state<>'completed' then return null;end if;
 perform prepare_season_internal(lid);
 select * into strict s from league_seasons where league_id=lid and season=l.season;
 for g in select * from season_games where league_id=lid and season=l.season and status='live' order by id loop perform refresh_game_internal(g.id);end loop;
 select jsonb_build_object('season',to_jsonb(s),'games',coalesce((select jsonb_agg(to_jsonb(x) order by x.week,x.kickoff,x.id) from (select id,phase,week,home,away,kickoff,status,home_score,away_score from season_games where league_id=lid and season=l.season) x),'[]'::jsonb),'staff',coalesce((select jsonb_agg(to_jsonb(fs)) from franchise_staff fs where league_id=lid),'[]'::jsonb),'standings',(select jsonb_agg(to_jsonb(st) order by st.wins desc,st.differential desc,st.id) from (select f.id,f.conference,f.division,count(sg.id) filter(where (sg.home=f.id and sg.home_score>sg.away_score) or(sg.away=f.id and sg.away_score>sg.home_score)) wins,count(sg.id) filter(where(sg.home=f.id and sg.home_score<sg.away_score)or(sg.away=f.id and sg.away_score<sg.home_score)) losses,count(sg.id) filter(where sg.home_score=sg.away_score) ties,coalesce(sum(case when sg.home=f.id then sg.home_score else sg.away_score end),0) points_for,coalesce(sum(case when sg.home=f.id then sg.away_score else sg.home_score end),0) points_against,coalesce(sum(case when sg.home=f.id then sg.home_score-sg.away_score else sg.away_score-sg.home_score end),0) differential from franchises f left join season_games sg on sg.league_id=lid and sg.season=l.season and sg.phase=s.phase and sg.status='final' and f.id in(sg.home,sg.away) group by f.id) st)) into r;
 return r;
end $$;
create function public.game_snapshot(gid uuid,after_play int default -1) returns jsonb language plpgsql security definer set search_path=public as $$
declare g season_games;lid uuid;r jsonb;f jsonb;cur int;total int;
begin
 select league_id into strict lid from season_games where id=gid;
 perform 1 from leagues where id=lid for update;
 if not is_member(lid) then raise exception 'Access denied';end if;
 perform refresh_game_internal(gid);select * into strict g from season_games where id=gid;
 if g.status='scheduled' then update game_ready set last_seen_at=now() where game_id=gid and user_id=auth.uid() and last_seen_at>now()-interval '30 seconds';end if;
 select result,frozen into r,f from game_jobs where game_id=gid;
 cur=live_cursor(g);total=coalesce(jsonb_array_length(r->'plays'),0);
 return jsonb_build_object('game',to_jsonb(g)||jsonb_build_object('cursor',least(cur,total)),'ready',coalesce((select jsonb_agg(user_id) from game_ready where game_id=gid and last_seen_at>now()-interval '30 seconds'),'[]'::jsonb),'owners',coalesce((select jsonb_agg(jsonb_build_object('team',franchise_id,'user_id',user_id)) from memberships where league_id=lid and franchise_id in(g.home,g.away)),'[]'::jsonb),'players',case when after_play<0 then r->'players' else null end,'total_plays',total,'plays',coalesce((select jsonb_agg(p.value order by p.ordinality) from jsonb_array_elements(r->'plays') with ordinality p(value,ordinality) where p.ordinality>greatest(-1,after_play)+1 and (g.status='final' or p.ordinality<=cur+1)),'[]'::jsonb),'staff',case when f is null then null else jsonb_build_object('home',f#>'{home,staff}','away',f#>'{away,staff}') end,'coaching',case when f is null then null else jsonb_build_object('home',f#>'{home,coaching}','away',f#>'{away,coaching}') end);
end $$;

-- Worker endpoints: service-role only; never authorize caller-supplied identities in clients.
create function public.claim_simulations(p_lid uuid default null,p_actor uuid default null,p_ticket uuid default null,p_gid uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare ticket_ok uuid;g season_games;j game_jobs;batch jsonb='[]'::jsonb;
begin
 if p_ticket is not null then
  delete from game_worker_tickets where ticket=p_ticket and expires_at>now() returning ticket into ticket_ok;
  if ticket_ok is null then raise exception 'Invalid worker ticket';end if;
 elsif p_lid is null or p_actor is null or not exists(select 1 from memberships where league_id=p_lid and user_id=p_actor) then raise exception 'Access denied';end if;
 for g in select sg.* from season_games sg join game_jobs gj on gj.game_id=sg.id where (p_lid is null or sg.league_id=p_lid) and (sg.status='queued' or(sg.status='building' and gj.claimed_at<now()-interval '3 minutes')) and gj.attempts<5 order by (sg.id=p_gid) desc nulls last,sg.id limit 4 for update of sg skip locked loop
  update game_jobs set lease=gen_random_uuid(),claimed_at=now(),attempts=attempts+1 where game_id=g.id returning * into j;
  update season_games set status='building' where id=g.id;
  batch=batch||jsonb_build_array(jsonb_build_object('id',g.id,'lease',j.lease,'input',j.frozen));
 end loop;
 return batch;
end $$;
create function public.commit_simulation(gid uuid,job_lease uuid,p_result jsonb) returns boolean language plpgsql security definer set search_path=public as $$
declare g season_games;j game_jobs;
begin
 perform 1 from leagues where id=(select league_id from season_games where id=gid) for update;
 select * into strict g from season_games where id=gid for update;
 select * into strict j from game_jobs where game_id=gid for update;
 if g.status<>'building' or j.lease is distinct from job_lease then return false;end if;
 if p_result->>'engine_version'<>'ff-football-1' or jsonb_array_length(p_result->'plays') not between 1 and 449 or (p_result->>'home_score')::int not between 0 and 200 or (p_result->>'away_score')::int not between 0 and 200 then raise exception 'Invalid engine result';end if;
 update game_jobs set result=p_result,last_error=null where game_id=gid;
 if g.participants=0 then perform finish_game_internal(gid);
 else update season_games set status='live',anchor_at=now(),cursor=0,engine_version=p_result->>'engine_version' where id=gid;end if;
 update leagues set revision=revision+1 where id=g.league_id;return true;
end $$;
create function public.fail_simulation(gid uuid,job_lease uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 perform 1 from season_games where id=gid for update;
 update season_games set status=case when j.attempts>=5 then 'error' else 'queued' end from game_jobs j where id=gid and j.game_id=gid and j.lease=job_lease and status='building';
 update game_jobs set last_error='Simulation worker failed. Retry available after five attempts.',lease=null,claimed_at=null where game_id=gid and lease=job_lease;
end $$;

revoke execute on function public.prepare_season_internal(uuid),public.team_game_input(uuid,text),public.queue_game_internal(uuid,boolean),public.finish_game_internal(uuid),public.refresh_game_internal(uuid),public.live_cursor(public.season_games),public.claim_simulations(uuid,uuid,uuid,uuid),public.commit_simulation(uuid,uuid,jsonb),public.fail_simulation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_simulations(uuid,uuid,uuid,uuid),public.commit_simulation(uuid,uuid,jsonb),public.fail_simulation(uuid,uuid) to service_role;
revoke execute on function public.hire_coach(uuid,text,text),public.week_control(uuid,text,text,int),public.game_action(uuid,text,int),public.season_snapshot(uuid),public.game_snapshot(uuid,int) from public,anon;
grant execute on function public.hire_coach(uuid,text,text),public.week_control(uuid,text,text,int),public.game_action(uuid,text,int),public.season_snapshot(uuid),public.game_snapshot(uuid,int) to authenticated;

-- Verified factual 2026 schedule; no real scores or standings imported.
insert into schedule_templates(year,phase,week,home,away,kickoff,source_game_id,source_url) values
(2026,'preseason',1,'CIN','DET','2026-08-13T23:00:00.000Z','c66df6a7-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-1'),
(2026,'preseason',1,'PIT','GB','2026-08-13T23:00:00.000Z','c66dfc69-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-1'),
(2026,'preseason',1,'NE','IND','2026-08-13T23:30:00.000Z','c66dfe7a-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-1'),
(2026,'preseason',1,'HOU','LAC','2026-08-14T00:00:00.000Z','c66e0006-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-1'),
(2026,'preseason',1,'LV','ARI','2026-08-14T00:00:00.000Z','c66e0191-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-1'),
(2026,'preseason',1,'SF','TEN','2026-08-14T01:00:00.000Z','c66e0345-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-1'),
(2026,'preseason',1,'ATL','DEN','2026-08-14T23:00:00.000Z','c66e04a7-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-1'),
(2026,'preseason',1,'NYJ','TB','2026-08-14T23:00:00.000Z','c66e0617-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-1'),
(2026,'preseason',1,'WAS','MIA','2026-08-14T23:00:00.000Z','c66e0778-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-1'),
(2026,'preseason',1,'BUF','CAR','2026-08-15T17:00:00.000Z','c6e8525d-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-1'),
(2026,'preseason',1,'CHI','CLE','2026-08-15T17:00:00.000Z','c6e85e19-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-1'),
(2026,'preseason',1,'NYG','MIN','2026-08-15T17:00:00.000Z','c6e86329-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-1'),
(2026,'preseason',1,'KC','LAR','2026-08-15T20:00:00.000Z','c6e8671a-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-1'),
(2026,'preseason',1,'NO','JAX','2026-08-15T20:00:00.000Z','c6e86ad0-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-1'),
(2026,'preseason',1,'BAL','PHI','2026-08-15T23:00:00.000Z','c6e87008-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-1'),
(2026,'preseason',1,'SEA','DAL','2026-08-16T00:00:00.000Z','c6e875cc-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-1'),
(2026,'preseason',2,'HOU','LV','2026-08-21T00:00:00.000Z','c6e87a3d-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-2'),
(2026,'preseason',2,'LAC','SF','2026-08-21T02:00:00.000Z','c6e87f75-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-2'),
(2026,'preseason',2,'PIT','NYJ','2026-08-21T23:00:00.000Z','c6e883ae-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-2'),
(2026,'preseason',2,'JAX','CAR','2026-08-21T23:30:00.000Z','c71ae5b9-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-2'),
(2026,'preseason',2,'DEN','GB','2026-08-22T01:00:00.000Z','c71af19d-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-2'),
(2026,'preseason',2,'DET','WAS','2026-08-22T16:00:00.000Z','c71af76f-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-2'),
(2026,'preseason',2,'CLE','BUF','2026-08-22T17:00:00.000Z','c71afea1-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-2'),
(2026,'preseason',2,'IND','ATL','2026-08-22T17:00:00.000Z','c71b02b9-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-2'),
(2026,'preseason',2,'MIN','BAL','2026-08-22T17:00:00.000Z','c71b06f8-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-2'),
(2026,'preseason',2,'LAR','NO','2026-08-22T20:00:00.000Z','c71b0a90-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-2'),
(2026,'preseason',2,'MIA','NYG','2026-08-22T20:00:00.000Z','c71b0f1e-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-2'),
(2026,'preseason',2,'CIN','CHI','2026-08-22T23:00:00.000Z','c71b1303-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-2'),
(2026,'preseason',2,'NE','PHI','2026-08-22T23:00:00.000Z','c71b1722-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-2'),
(2026,'preseason',2,'TB','KC','2026-08-22T23:30:00.000Z','c74e12b2-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-2'),
(2026,'preseason',2,'ARI','DAL','2026-08-23T02:00:00.000Z','c74e1c92-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-2'),
(2026,'preseason',2,'TEN','SEA','2026-08-24T00:00:00.000Z','c74e206e-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-2'),
(2026,'preseason',3,'BUF','PIT','2026-08-27T23:00:00.000Z','c74e245a-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-3'),
(2026,'preseason',3,'CLE','NE','2026-08-28T00:00:00.000Z','c74e27bf-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-3'),
(2026,'preseason',3,'LV','SF','2026-08-28T00:00:00.000Z','c74e2b5b-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-3'),
(2026,'preseason',3,'LAC','LAR','2026-08-28T02:00:00.000Z','c74e2ea2-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-3'),
(2026,'preseason',3,'BAL','WAS','2026-08-28T22:00:00.000Z','c74e31f8-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-3'),
(2026,'preseason',3,'CAR','HOU','2026-08-28T23:00:00.000Z','c74e353f-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-3'),
(2026,'preseason',3,'MIA','ATL','2026-08-28T23:00:00.000Z','c74e3a0b-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-3'),
(2026,'preseason',3,'JAX','TB','2026-08-28T23:30:00.000Z','c77f0e1f-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-3'),
(2026,'preseason',3,'NYJ','NYG','2026-08-28T23:30:00.000Z','c77f1834-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-3'),
(2026,'preseason',3,'DAL','NO','2026-08-29T00:00:00.000Z','c77f1c49-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-3'),
(2026,'preseason',3,'KC','SEA','2026-08-29T00:00:00.000Z','c77f1fc8-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-3'),
(2026,'preseason',3,'PHI','CIN','2026-08-29T00:00:00.000Z','c77f22f6-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-3'),
(2026,'preseason',3,'GB','ARI','2026-08-29T00:00:00.000Z','c77f2a44-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-3'),
(2026,'preseason',3,'DEN','MIN','2026-08-29T01:00:00.000Z','c77f26f1-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-3'),
(2026,'preseason',3,'IND','DET','2026-08-29T17:00:00.000Z','c77f2d5f-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-3'),
(2026,'preseason',3,'TEN','CHI','2026-08-29T22:00:00.000Z','c77f307e-5f68-11f1-b1d0-bb70a4640075','https://www.nfl.com/schedules/2026/by-week/preseason-week-3'),
(2026,'regular',1,'SEA','NE','2026-09-10T00:20:00.000Z','a8fb0d78-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-1'),
(2026,'regular',1,'LAR','SF','2026-09-11T00:35:00.000Z','a8fc08da-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-1'),
(2026,'regular',1,'CAR','CHI','2026-09-13T17:00:00.000Z','a8fc0e5c-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-1'),
(2026,'regular',1,'CIN','TB','2026-09-13T17:00:00.000Z','a8fc106b-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-1'),
(2026,'regular',1,'DET','NO','2026-09-13T17:00:00.000Z','a8fc1203-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-1'),
(2026,'regular',1,'HOU','BUF','2026-09-13T17:00:00.000Z','a8fc1393-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-1'),
(2026,'regular',1,'IND','BAL','2026-09-13T17:00:00.000Z','a8fc15bd-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-1'),
(2026,'regular',1,'JAX','CLE','2026-09-13T17:00:00.000Z','a8fc1728-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-1'),
(2026,'regular',1,'PIT','ATL','2026-09-13T17:00:00.000Z','a8fc1864-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-1'),
(2026,'regular',1,'TEN','NYJ','2026-09-13T17:00:00.000Z','a8fc1998-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-1'),
(2026,'regular',1,'LAC','ARI','2026-09-13T20:25:00.000Z','a9a87603-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-1'),
(2026,'regular',1,'LV','MIA','2026-09-13T20:25:00.000Z','a9a881ca-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-1'),
(2026,'regular',1,'MIN','GB','2026-09-13T20:25:00.000Z','a9a88631-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-1'),
(2026,'regular',1,'PHI','WAS','2026-09-13T20:25:00.000Z','a9a889dd-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-1'),
(2026,'regular',1,'NYG','DAL','2026-09-14T00:20:00.000Z','a9a88d52-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-1'),
(2026,'regular',1,'KC','DEN','2026-09-15T00:15:00.000Z','a9a890ed-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-1'),
(2026,'regular',2,'BUF','DET','2026-09-18T00:15:00.000Z','a9a8944e-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-2'),
(2026,'regular',2,'ATL','CAR','2026-09-20T17:00:00.000Z','a9a89841-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-2'),
(2026,'regular',2,'BAL','NO','2026-09-20T17:00:00.000Z','a9a89baa-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-2'),
(2026,'regular',2,'CHI','MIN','2026-09-20T17:00:00.000Z','a9a89edd-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-2'),
(2026,'regular',2,'HOU','CIN','2026-09-20T17:00:00.000Z','a9e0c7c0-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-2'),
(2026,'regular',2,'NE','PIT','2026-09-20T17:00:00.000Z','a9e0d18f-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-2'),
(2026,'regular',2,'NYJ','GB','2026-09-20T17:00:00.000Z','a9e0d5a5-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-2'),
(2026,'regular',2,'TB','CLE','2026-09-20T17:00:00.000Z','a9e0d930-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-2'),
(2026,'regular',2,'TEN','PHI','2026-09-20T17:00:00.000Z','a9e0dc7c-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-2'),
(2026,'regular',2,'DEN','JAX','2026-09-20T20:05:00.000Z','a9e0dff8-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-2'),
(2026,'regular',2,'LAC','LV','2026-09-20T20:05:00.000Z','a9e0e3dd-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-2'),
(2026,'regular',2,'ARI','SEA','2026-09-20T20:25:00.000Z','a9e0e78e-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-2'),
(2026,'regular',2,'DAL','WAS','2026-09-20T20:25:00.000Z','a9e0eb90-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-2'),
(2026,'regular',2,'SF','MIA','2026-09-20T20:25:00.000Z','a9e0ef5d-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-2'),
(2026,'regular',2,'KC','IND','2026-09-21T00:20:00.000Z','aa048ee1-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-2'),
(2026,'regular',2,'LAR','NYG','2026-09-22T00:15:00.000Z','aa04989c-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-2'),
(2026,'regular',3,'GB','ATL','2026-09-25T00:15:00.000Z','aa049c95-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-3'),
(2026,'regular',3,'BUF','LAC','2026-09-27T17:00:00.000Z','aa04a02f-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-3'),
(2026,'regular',3,'CLE','CAR','2026-09-27T17:00:00.000Z','aa04a395-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-3'),
(2026,'regular',3,'DET','NYJ','2026-09-27T17:00:00.000Z','aa04a6ca-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-3'),
(2026,'regular',3,'IND','HOU','2026-09-27T17:00:00.000Z','aa04aa26-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-3'),
(2026,'regular',3,'JAX','NE','2026-09-27T17:00:00.000Z','aa04ad75-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-3'),
(2026,'regular',3,'MIA','KC','2026-09-27T17:00:00.000Z','aa04b0d8-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-3'),
(2026,'regular',3,'NYG','TEN','2026-09-27T17:00:00.000Z','aa04b4d9-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-3'),
(2026,'regular',3,'PIT','CIN','2026-09-27T17:00:00.000Z','aa29b6b0-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-3'),
(2026,'regular',3,'WAS','SEA','2026-09-27T17:00:00.000Z','aa29c0fa-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-3'),
(2026,'regular',3,'SF','ARI','2026-09-27T20:05:00.000Z','aa29c59c-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-3'),
(2026,'regular',3,'TB','MIN','2026-09-27T20:05:00.000Z','aa29c929-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-3'),
(2026,'regular',3,'NO','LV','2026-09-27T20:25:00.000Z','aa29d062-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-3'),
(2026,'regular',3,'DAL','BAL','2026-09-27T20:25:00.000Z','aa29cd02-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-3'),
(2026,'regular',3,'DEN','LAR','2026-09-28T00:20:00.000Z','aa29d387-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-3'),
(2026,'regular',3,'CHI','PHI','2026-09-29T00:15:00.000Z','aa29d6db-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-3'),
(2026,'regular',4,'CLE','PIT','2026-10-02T00:15:00.000Z','aa29da01-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-4'),
(2026,'regular',4,'WAS','IND','2026-10-04T13:30:00.000Z','aa29dd21-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-4'),
(2026,'regular',4,'BAL','TEN','2026-10-04T17:00:00.000Z','aa4b4811-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-4'),
(2026,'regular',4,'BUF','NE','2026-10-04T17:00:00.000Z','aa4b51c9-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-4'),
(2026,'regular',4,'CHI','NYJ','2026-10-04T17:00:00.000Z','aa4b55ce-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-4'),
(2026,'regular',4,'CIN','JAX','2026-10-04T17:00:00.000Z','aa4b5943-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-4'),
(2026,'regular',4,'HOU','DAL','2026-10-04T17:00:00.000Z','aa4b5c96-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-4'),
(2026,'regular',4,'NYG','ARI','2026-10-04T17:00:00.000Z','aa4b607b-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-4'),
(2026,'regular',4,'PHI','LAR','2026-10-04T17:00:00.000Z','aa4b63de-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-4'),
(2026,'regular',4,'TB','GB','2026-10-04T17:00:00.000Z','aa4b671b-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-4'),
(2026,'regular',4,'MIN','MIA','2026-10-04T20:05:00.000Z','aa4b6a4b-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-4'),
(2026,'regular',4,'LV','KC','2026-10-04T20:25:00.000Z','aa4b6d71-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-4'),
(2026,'regular',4,'SEA','LAC','2026-10-04T20:25:00.000Z','aa6b4255-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-4'),
(2026,'regular',4,'SF','DEN','2026-10-04T20:25:00.000Z','aa6b4cf4-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-4'),
(2026,'regular',4,'CAR','DET','2026-10-05T00:20:00.000Z','aa6b512d-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-4'),
(2026,'regular',4,'NO','ATL','2026-10-06T00:15:00.000Z','aa6b5517-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-4'),
(2026,'regular',5,'DAL','TB','2026-10-09T00:15:00.000Z','aa6b58bf-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-5'),
(2026,'regular',5,'JAX','PHI','2026-10-11T13:30:00.000Z','aa6b5c2b-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-5'),
(2026,'regular',5,'MIA','CIN','2026-10-11T17:00:00.000Z','aa6b5f66-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-5'),
(2026,'regular',5,'NE','LV','2026-10-11T17:00:00.000Z','aa6b6286-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-5'),
(2026,'regular',5,'NO','MIN','2026-10-11T17:00:00.000Z','aa6b65b1-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-5'),
(2026,'regular',5,'NYJ','CLE','2026-10-11T17:00:00.000Z','aa6b69bb-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-5'),
(2026,'regular',5,'PIT','IND','2026-10-11T17:00:00.000Z','aa94ac06-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-5'),
(2026,'regular',5,'TEN','HOU','2026-10-11T17:00:00.000Z','aa94b527-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-5'),
(2026,'regular',5,'WAS','NYG','2026-10-11T17:00:00.000Z','aa94b906-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-5'),
(2026,'regular',5,'GB','CHI','2026-10-11T17:00:00.000Z','aa94c2ef-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-5'),
(2026,'regular',5,'LAC','DEN','2026-10-11T20:05:00.000Z','aa94bc51-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-5'),
(2026,'regular',5,'ARI','DET','2026-10-11T20:25:00.000Z','aa94bfce-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-5'),
(2026,'regular',5,'SEA','SF','2026-10-11T20:25:00.000Z','aa94c647-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-5'),
(2026,'regular',5,'ATL','BAL','2026-10-12T00:20:00.000Z','aa94c94d-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-5'),
(2026,'regular',5,'LAR','BUF','2026-10-13T00:15:00.000Z','aa94ccd3-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-5'),
(2026,'regular',6,'DEN','SEA','2026-10-16T00:15:00.000Z','aa94cffe-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-6'),
(2026,'regular',6,'JAX','HOU','2026-10-18T13:30:00.000Z','aab56e82-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-6'),
(2026,'regular',6,'ATL','CHI','2026-10-18T17:00:00.000Z','aab577eb-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-6'),
(2026,'regular',6,'CLE','BAL','2026-10-18T17:00:00.000Z','aab57bb8-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-6'),
(2026,'regular',6,'IND','TEN','2026-10-18T17:00:00.000Z','aab57f15-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-6'),
(2026,'regular',6,'NE','NYJ','2026-10-18T17:00:00.000Z','aab58261-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-6'),
(2026,'regular',6,'NYG','NO','2026-10-18T17:00:00.000Z','aab5857e-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-6'),
(2026,'regular',6,'PHI','CAR','2026-10-18T17:00:00.000Z','aab588fe-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-6'),
(2026,'regular',6,'TB','PIT','2026-10-18T17:00:00.000Z','aab58c4b-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-6'),
(2026,'regular',6,'LAR','ARI','2026-10-18T20:05:00.000Z','aab58f7e-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-6'),
(2026,'regular',6,'KC','LAC','2026-10-18T20:25:00.000Z','aab59281-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-6'),
(2026,'regular',6,'LV','BUF','2026-10-18T20:25:00.000Z','aad57852-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-6'),
(2026,'regular',6,'GB','DAL','2026-10-19T00:20:00.000Z','aad58264-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-6'),
(2026,'regular',6,'SF','WAS','2026-10-20T00:15:00.000Z','aad58635-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-6'),
(2026,'regular',7,'CHI','NE','2026-10-23T00:15:00.000Z','aad58a18-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-7'),
(2026,'regular',7,'NO','PIT','2026-10-25T13:30:00.000Z','aad58d7d-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-7'),
(2026,'regular',7,'ATL','SF','2026-10-25T17:00:00.000Z','aad59092-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-7'),
(2026,'regular',7,'BAL','CIN','2026-10-25T17:00:00.000Z','aad594ee-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-7'),
(2026,'regular',7,'CAR','TB','2026-10-25T17:00:00.000Z','aad59a67-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-7'),
(2026,'regular',7,'HOU','NYG','2026-10-25T17:00:00.000Z','aad59e95-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-7'),
(2026,'regular',7,'MIN','IND','2026-10-25T17:00:00.000Z','aad5a2ac-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-7'),
(2026,'regular',7,'NYJ','MIA','2026-10-25T17:00:00.000Z','aaf6ec9e-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-7'),
(2026,'regular',7,'TEN','CLE','2026-10-25T17:00:00.000Z','aaf6f621-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-7'),
(2026,'regular',7,'ARI','DEN','2026-10-25T20:05:00.000Z','aaf6fa3b-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-7'),
(2026,'regular',7,'DET','GB','2026-10-25T20:25:00.000Z','aaf6fda2-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-7'),
(2026,'regular',7,'LV','LAR','2026-10-25T20:25:00.000Z','aaf700e5-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-7'),
(2026,'regular',7,'SEA','KC','2026-10-26T00:20:00.000Z','aaf7040e-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-7'),
(2026,'regular',7,'PHI','DAL','2026-10-27T00:15:00.000Z','aaf70733-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-7'),
(2026,'regular',8,'GB','CAR','2026-10-30T00:15:00.000Z','aaf70a66-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-8'),
(2026,'regular',8,'BUF','BAL','2026-11-01T18:00:00.000Z','aaf70dac-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-8'),
(2026,'regular',8,'CIN','TEN','2026-11-01T18:00:00.000Z','aaf71176-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-8'),
(2026,'regular',8,'DAL','ARI','2026-11-01T18:00:00.000Z','ab16512c-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-8'),
(2026,'regular',8,'DET','MIN','2026-11-01T18:00:00.000Z','ab165aa8-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-8'),
(2026,'regular',8,'JAX','IND','2026-11-01T18:00:00.000Z','ab165e6a-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-8'),
(2026,'regular',8,'NYJ','LV','2026-11-01T18:00:00.000Z','ab1661ac-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-8'),
(2026,'regular',8,'PIT','CLE','2026-11-01T18:00:00.000Z','ab1664ca-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-8'),
(2026,'regular',8,'TB','ATL','2026-11-01T18:00:00.000Z','ab1667cd-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-8'),
(2026,'regular',8,'LAR','LAC','2026-11-01T21:05:00.000Z','ab166ac0-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-8'),
(2026,'regular',8,'DEN','KC','2026-11-01T21:25:00.000Z','ab166dc7-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-8'),
(2026,'regular',8,'MIA','NE','2026-11-01T21:25:00.000Z','ab1670ad-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-8'),
(2026,'regular',8,'WAS','PHI','2026-11-02T01:20:00.000Z','ab167386-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-8'),
(2026,'regular',8,'SEA','CHI','2026-11-03T01:15:00.000Z','ab37feaa-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-8'),
(2026,'regular',9,'BAL','JAX','2026-11-06T01:15:00.000Z','ab380826-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-9'),
(2026,'regular',9,'ATL','CIN','2026-11-08T14:30:00.000Z','ab380bc7-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-9'),
(2026,'regular',9,'CAR','DEN','2026-11-08T18:00:00.000Z','ab380efd-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-9'),
(2026,'regular',9,'IND','DAL','2026-11-08T18:00:00.000Z','ab38123a-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-9'),
(2026,'regular',9,'KC','NYJ','2026-11-08T18:00:00.000Z','ab381724-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-9'),
(2026,'regular',9,'MIA','DET','2026-11-08T18:00:00.000Z','ab381a59-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-9'),
(2026,'regular',9,'NO','CLE','2026-11-08T18:00:00.000Z','ab381d58-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-9'),
(2026,'regular',9,'PHI','NYG','2026-11-08T18:00:00.000Z','ab38203e-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-9'),
(2026,'regular',9,'WAS','LAR','2026-11-08T18:00:00.000Z','ab382331-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-9'),
(2026,'regular',9,'LAC','HOU','2026-11-08T21:05:00.000Z','ab580cb7-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-9'),
(2026,'regular',9,'SF','LV','2026-11-08T21:05:00.000Z','ab581766-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-9'),
(2026,'regular',9,'NE','GB','2026-11-08T21:25:00.000Z','ab581b93-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-9'),
(2026,'regular',9,'SEA','ARI','2026-11-08T21:25:00.000Z','ab581f17-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-9'),
(2026,'regular',9,'CHI','TB','2026-11-09T01:20:00.000Z','ab582247-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-9'),
(2026,'regular',9,'MIN','BUF','2026-11-10T01:15:00.000Z','ab5825a7-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-9'),
(2026,'regular',10,'NYG','WAS','2026-11-13T01:15:00.000Z','ab5828d9-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-10'),
(2026,'regular',10,'DET','NE','2026-11-15T14:30:00.000Z','ab582c2f-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-10'),
(2026,'regular',10,'ATL','KC','2026-11-15T18:00:00.000Z','ab582f5b-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-10'),
(2026,'regular',10,'CLE','HOU','2026-11-15T18:00:00.000Z','ab583279-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-10'),
(2026,'regular',10,'GB','MIN','2026-11-15T18:00:00.000Z','ab788967-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-10'),
(2026,'regular',10,'IND','MIA','2026-11-15T18:00:00.000Z','ab789365-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-10'),
(2026,'regular',10,'NO','CAR','2026-11-15T18:00:00.000Z','ab789769-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-10'),
(2026,'regular',10,'NYJ','BUF','2026-11-15T18:00:00.000Z','ab789ac9-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-10'),
(2026,'regular',10,'TEN','JAX','2026-11-15T18:00:00.000Z','ab789e15-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-10'),
(2026,'regular',10,'ARI','LAR','2026-11-15T21:05:00.000Z','ab78a133-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-10'),
(2026,'regular',10,'LV','SEA','2026-11-15T21:05:00.000Z','ab78a43c-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-10'),
(2026,'regular',10,'DAL','SF','2026-11-15T21:25:00.000Z','ab78a748-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-10'),
(2026,'regular',10,'CIN','PIT','2026-11-16T01:20:00.000Z','ab78aa48-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-10'),
(2026,'regular',10,'BAL','LAC','2026-11-17T01:15:00.000Z','ab78ad5a-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-10'),
(2026,'regular',11,'HOU','IND','2026-11-20T01:15:00.000Z','ab997d97-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-11'),
(2026,'regular',11,'BUF','MIA','2026-11-22T18:00:00.000Z','ab998769-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-11'),
(2026,'regular',11,'CAR','BAL','2026-11-22T18:00:00.000Z','ab998b7f-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-11'),
(2026,'regular',11,'CHI','NO','2026-11-22T18:00:00.000Z','ab998f5e-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-11'),
(2026,'regular',11,'DAL','TEN','2026-11-22T18:00:00.000Z','ab99929a-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-11'),
(2026,'regular',11,'DET','TB','2026-11-22T18:00:00.000Z','ab999586-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-11'),
(2026,'regular',11,'KC','ARI','2026-11-22T18:00:00.000Z','ab999891-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-11'),
(2026,'regular',11,'NYG','JAX','2026-11-22T18:00:00.000Z','ab999b80-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-11'),
(2026,'regular',11,'LAC','NYJ','2026-11-22T21:05:00.000Z','ab999e6f-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-11'),
(2026,'regular',11,'DEN','LV','2026-11-22T21:25:00.000Z','ab99a17b-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-11'),
(2026,'regular',11,'PHI','PIT','2026-11-22T21:25:00.000Z','abbf1908-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-11'),
(2026,'regular',11,'SF','MIN','2026-11-23T01:20:00.000Z','abbf2213-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-11'),
(2026,'regular',11,'WAS','CIN','2026-11-24T01:15:00.000Z','abbf25b8-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-11'),
(2026,'regular',12,'LAR','GB','2026-11-26T01:00:00.000Z','abbf28ed-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-12'),
(2026,'regular',12,'DET','CHI','2026-11-26T18:00:00.000Z','abbf2c16-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-12'),
(2026,'regular',12,'DAL','PHI','2026-11-26T21:30:00.000Z','abbf2f12-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-12'),
(2026,'regular',12,'BUF','KC','2026-11-27T01:20:00.000Z','abbf321b-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-12'),
(2026,'regular',12,'PIT','DEN','2026-11-27T20:00:00.000Z','abbf352d-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-12'),
(2026,'regular',12,'CIN','NO','2026-11-29T18:00:00.000Z','abbf3917-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-12'),
(2026,'regular',12,'CLE','LV','2026-11-29T18:00:00.000Z','abbf3c97-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-12'),
(2026,'regular',12,'HOU','BAL','2026-11-29T18:00:00.000Z','abdfc3c2-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-12'),
(2026,'regular',12,'IND','NYG','2026-11-29T18:00:00.000Z','abdfccbb-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-12'),
(2026,'regular',12,'MIA','NYJ','2026-11-29T18:00:00.000Z','abdfd040-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-12'),
(2026,'regular',12,'MIN','ATL','2026-11-29T18:00:00.000Z','abdfd363-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-12'),
(2026,'regular',12,'JAX','TEN','2026-11-29T21:05:00.000Z','abdfd663-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-12'),
(2026,'regular',12,'ARI','WAS','2026-11-29T21:25:00.000Z','abdfd959-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-12'),
(2026,'regular',12,'SF','SEA','2026-11-29T21:25:00.000Z','abdfdd00-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-12'),
(2026,'regular',12,'LAC','NE','2026-11-30T01:20:00.000Z','abdfe0ab-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-12'),
(2026,'regular',12,'TB','CAR','2026-12-01T01:15:00.000Z','abdfe629-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-12'),
(2026,'regular',13,'LAR','KC','2026-12-04T01:15:00.000Z','abdfe9fb-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-13'),
(2026,'regular',13,'ATL','DET','2026-12-06T18:00:00.000Z','ac014f46-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-13'),
(2026,'regular',13,'CHI','JAX','2026-12-06T18:00:00.000Z','ac015881-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-13'),
(2026,'regular',13,'CLE','CIN','2026-12-06T18:00:00.000Z','ac015cdc-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-13'),
(2026,'regular',13,'NO','GB','2026-12-06T18:00:00.000Z','ac01603b-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-13'),
(2026,'regular',13,'NYG','SF','2026-12-06T18:00:00.000Z','ac016348-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-13'),
(2026,'regular',13,'TB','LAC','2026-12-06T18:00:00.000Z','ac01664b-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-13'),
(2026,'regular',13,'TEN','WAS','2026-12-06T18:00:00.000Z','ac016953-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-13'),
(2026,'regular',13,'ARI','PHI','2026-12-06T21:05:00.000Z','ac016c40-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-13'),
(2026,'regular',13,'DEN','MIA','2026-12-06T21:05:00.000Z','ac016f2b-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-13'),
(2026,'regular',13,'MIN','CAR','2026-12-06T21:25:00.000Z','ac017212-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-13'),
(2026,'regular',13,'NE','BUF','2026-12-06T21:25:00.000Z','ac207191-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-13'),
(2026,'regular',13,'PIT','HOU','2026-12-07T01:20:00.000Z','ac207ad3-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-13'),
(2026,'regular',13,'SEA','DAL','2026-12-08T01:15:00.000Z','ac207eae-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-13'),
(2026,'regular',14,'NE','MIN','2026-12-11T01:15:00.000Z','ac208212-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-14'),
(2026,'regular',14,'BAL','TB','2026-12-13T18:00:00.000Z','ac208548-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-14'),
(2026,'regular',14,'CAR','NO','2026-12-13T18:00:00.000Z','ac208883-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-14'),
(2026,'regular',14,'CLE','ATL','2026-12-13T18:00:00.000Z','ac208bad-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-14'),
(2026,'regular',14,'DET','TEN','2026-12-13T18:00:00.000Z','ac208ebc-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-14'),
(2026,'regular',14,'MIA','CHI','2026-12-13T18:00:00.000Z','ac2091af-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-14'),
(2026,'regular',14,'NYJ','DEN','2026-12-13T18:00:00.000Z','ac2094c8-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-14'),
(2026,'regular',14,'PHI','IND','2026-12-13T18:00:00.000Z','ac411814-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-14'),
(2026,'regular',14,'WAS','HOU','2026-12-13T18:00:00.000Z','ac4122e2-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-14'),
(2026,'regular',14,'LV','LAC','2026-12-13T21:05:00.000Z','ac4128a9-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-14'),
(2026,'regular',14,'CIN','KC','2026-12-13T21:25:00.000Z','ac412c64-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-14'),
(2026,'regular',14,'SEA','NYG','2026-12-13T21:25:00.000Z','ac413167-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-14'),
(2026,'regular',14,'SF','LAR','2026-12-13T21:25:00.000Z','ac4134f5-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-14'),
(2026,'regular',14,'GB','BUF','2026-12-14T01:20:00.000Z','ac41381d-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-14'),
(2026,'regular',14,'JAX','PIT','2026-12-15T01:15:00.000Z','ac413b2b-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-14'),
(2026,'regular',15,'LAC','SF','2026-12-18T01:15:00.000Z','ac413e34-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-15'),
(2026,'regular',15,'PHI','SEA','2026-12-19T22:00:00.000Z','ac414151-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-15'),
(2026,'regular',15,'BUF','CHI','2026-12-20T01:20:00.000Z','ac603d57-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-15'),
(2026,'regular',15,'CAR','CIN','2026-12-20T18:00:00.000Z','ac6046a8-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-15'),
(2026,'regular',15,'GB','MIA','2026-12-20T18:00:00.000Z','ac604a6e-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-15'),
(2026,'regular',15,'HOU','JAX','2026-12-20T18:00:00.000Z','ac604e37-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-15'),
(2026,'regular',15,'NYG','CLE','2026-12-20T18:00:00.000Z','ac6051b9-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-15'),
(2026,'regular',15,'PIT','BAL','2026-12-20T18:00:00.000Z','ac60550d-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-15'),
(2026,'regular',15,'TB','NO','2026-12-20T18:00:00.000Z','ac60584b-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-15'),
(2026,'regular',15,'TEN','IND','2026-12-20T18:00:00.000Z','ac605b63-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-15'),
(2026,'regular',15,'WAS','ATL','2026-12-20T18:00:00.000Z','ac605e66-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-15'),
(2026,'regular',15,'ARI','NYJ','2026-12-20T21:05:00.000Z','ac60617b-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-15'),
(2026,'regular',15,'LAR','DAL','2026-12-20T21:25:00.000Z','ac7f5336-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-15'),
(2026,'regular',15,'LV','DEN','2026-12-20T21:25:00.000Z','ac7f60fe-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-15'),
(2026,'regular',15,'MIN','DET','2026-12-21T01:20:00.000Z','ac7f6703-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-15'),
(2026,'regular',15,'KC','NE','2026-12-22T01:15:00.000Z','ac7f6aff-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-15'),
(2026,'regular',16,'PHI','HOU','2026-12-25T01:15:00.000Z','ac7f6e6e-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-16'),
(2026,'regular',16,'CHI','GB','2026-12-25T18:00:00.000Z','ac7f71a4-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-16'),
(2026,'regular',16,'DEN','BUF','2026-12-25T21:30:00.000Z','ac7f74ca-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-16'),
(2026,'regular',16,'SEA','LAR','2026-12-26T01:15:00.000Z','ac7f77ed-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-16'),
(2026,'regular',16,'BAL','CLE','2026-12-27T18:00:00.000Z','ac9e36ff-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-16'),
(2026,'regular',16,'MIA','LAC','2026-12-27T18:00:00.000Z','ac9e3acb-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-16'),
(2026,'regular',16,'NO','ARI','2026-12-27T18:00:00.000Z','ac9e3e14-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-16'),
(2026,'regular',16,'NYJ','NE','2026-12-27T18:00:00.000Z','ac9e4134-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-16'),
(2026,'regular',16,'LV','TEN','2026-12-27T21:05:00.000Z','ac9e442c-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-16'),
(2026,'regular',16,'KC','SF','2026-12-27T21:25:00.000Z','ac9e473f-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-16'),
(2026,'regular',16,'DAL','JAX','2026-12-28T01:20:00.000Z','ac9e4a3a-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-16'),
(2026,'regular',16,'DET','NYG','2026-12-29T01:15:00.000Z','ac9e4d51-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-16'),
(2026,'regular',16,'ATL','TB',null,'ac7f7b15-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-16'),
(2026,'regular',16,'IND','CIN',null,'ac7f7ddf-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-16'),
(2026,'regular',16,'MIN','WAS',null,'ac9e2a00-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-16'),
(2026,'regular',16,'PIT','CAR',null,'ac9e330f-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-16'),
(2026,'regular',17,'CIN','BAL','2027-01-01T01:15:00.000Z','acc1d288-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-17'),
(2026,'regular',17,'ATL','NO','2027-01-03T18:00:00.000Z','acc1e9f7-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-17'),
(2026,'regular',17,'CAR','SEA','2027-01-03T18:00:00.000Z','acc1ed66-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-17'),
(2026,'regular',17,'CLE','IND','2027-01-03T18:00:00.000Z','acc1f09a-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-17'),
(2026,'regular',17,'DAL','NYG','2027-01-03T18:00:00.000Z','acc1f3c0-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-17'),
(2026,'regular',17,'MIA','BUF','2027-01-03T18:00:00.000Z','acc1f6d4-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-17'),
(2026,'regular',17,'NYJ','MIN','2027-01-03T18:00:00.000Z','ace0969b-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-17'),
(2026,'regular',17,'TEN','PIT','2027-01-03T18:00:00.000Z','ace0a08e-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-17'),
(2026,'regular',17,'ARI','LV','2027-01-03T21:05:00.000Z','ace0a457-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-17'),
(2026,'regular',17,'CHI','DET','2027-01-03T21:25:00.000Z','ace0a7e7-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-17'),
(2026,'regular',17,'SF','PHI','2027-01-04T01:20:00.000Z','ace0ab32-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-17'),
(2026,'regular',17,'GB','HOU','2027-01-05T01:15:00.000Z','ace0ae7b-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-17'),
(2026,'regular',17,'JAX','WAS',null,'acc1dc59-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-17'),
(2026,'regular',17,'LAC','KC',null,'acc1e08e-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-17'),
(2026,'regular',17,'NE','DEN',null,'acc1e3de-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-17'),
(2026,'regular',17,'TB','LAR',null,'acc1e702-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-17'),
(2026,'regular',18,'ARI','SF',null,'ace0b1ad-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-18'),
(2026,'regular',18,'BAL','PIT',null,'ace0b48a-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-18'),
(2026,'regular',18,'BUF','NYJ',null,'ace0b74f-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-18'),
(2026,'regular',18,'CAR','ATL',null,'ace0ba82-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-18'),
(2026,'regular',18,'CIN','CLE',null,'acff782d-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-18'),
(2026,'regular',18,'DEN','LAC',null,'acff8054-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-18'),
(2026,'regular',18,'GB','DET',null,'acff837c-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-18'),
(2026,'regular',18,'HOU','TEN',null,'acff8654-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-18'),
(2026,'regular',18,'IND','JAX',null,'acff8914-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-18'),
(2026,'regular',18,'KC','LV',null,'acff8bba-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-18'),
(2026,'regular',18,'LAR','SEA',null,'acff8e70-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-18'),
(2026,'regular',18,'MIN','CHI',null,'acff9123-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-18'),
(2026,'regular',18,'NE','MIA',null,'acff93c4-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-18'),
(2026,'regular',18,'NO','TB',null,'acff9659-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-18'),
(2026,'regular',18,'NYG','PHI',null,'ad1f1cde-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-18'),
(2026,'regular',18,'WAS','DAL',null,'ad1f2595-4feb-11f1-abca-2c54536568a9','https://www.nfl.com/schedules/2026/by-week/week-18');
insert into coach_catalog(id,name,role,source) values
('aaron-glenn','Aaron Glenn','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('andrew-janocko','Andrew Janocko','OC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('andy-reid','Andy Reid','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('anthony-weaver','Anthony Weaver','DC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('ben-johnson','Ben Johnson','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('bobby-slowik','Bobby Slowik','OC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('brian-angelichio','Brian Angelichio','OC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('brian-daboll','Brian Daboll','OC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('brian-duker','Brian Duker','DC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('brian-fleury','Brian Fleury','OC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('brian-schottenheimer','Brian Schottenheimer','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('chris-o-leary','Chris O''Leary','DC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('christian-parker','Christian Parker','DC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('dan-campbell','Dan Campbell','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('dan-quinn','Dan Quinn','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('daronte-jones','Daronte Jones','DC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('dave-canales','Dave Canales','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('david-blough','David Blough','OC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('declan-doyle','Declan Doyle','OC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('demeco-ryans','DeMeco Ryans','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('dennard-wilson','Dennard Wilson','DC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('drew-petzing','Drew Petzing','OC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('eric-bieniemy','Eric Bieniemy','OC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('frank-reich','Frank Reich','OC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('gus-bradley','Gus Bradley','DC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('jeff-hafley','Jeff Hafley','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('jesse-minter','Jesse Minter','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('jim-harbaugh','Jim Harbaugh','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('jim-leonhard','Jim Leonhard','DC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('joe-brady','Joe Brady','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('john-harbaugh','John Harbaugh','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('jonathan-gannon','Jonathan Gannon','DC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('kellen-moore','Kellen Moore','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('kevin-o-connell','Kevin O''Connell','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('kevin-stefanski','Kevin Stefanski','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('klint-kubiak','Klint Kubiak','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('kyle-shanahan','Kyle Shanahan','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('liam-coen','Liam Coen','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('matt-lafleur','Matt LaFleur','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('matt-nagy','Matt Nagy','OC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('mike-lafleur','Mike LaFleur','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('mike-macdonald','Mike Macdonald','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('mike-mccarthy','Mike McCarthy','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('mike-mcdaniel','Mike McDaniel','OC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('mike-rutenberg','Mike Rutenberg','DC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('mike-vrabel','Mike Vrabel','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('nate-scheelhaase','Nate Scheelhaase','OC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('nathaniel-hackett','Nathaniel Hackett','OC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('nick-sirianni','Nick Sirianni','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('patrick-graham','Patrick Graham','DC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('pete-carmichael-jr','Pete Carmichael Jr.','OC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('press-taylor','Press Taylor','OC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('raheem-morris','Raheem Morris','DC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('rob-leonard','Rob Leonard','DC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('robert-saleh','Robert Saleh','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('sean-duggan','Sean Duggan','DC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('sean-mannion','Sean Mannion','OC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('sean-mcvay','Sean McVay','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('sean-payton','Sean Payton','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('shane-steichen','Shane Steichen','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('todd-bowles','Todd Bowles','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('todd-monken','Todd Monken','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('tommy-rees','Tommy Rees','OC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('travis-switzer','Travis Switzer','OC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('zac-robinson','Zac Robinson','OC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle'),
('zac-taylor','Zac Taylor','HC','https://www.baltimoreravens.com/photos/every-nfl-head-coach-list-2027-new-jesse-minter'),
('zak-kuhr','Zak Kuhr','DC','https://www.nfl.com/news/nfl-coaching-gm-tracker-latest-news-interviews-developments-2026-hiring-cycle');
