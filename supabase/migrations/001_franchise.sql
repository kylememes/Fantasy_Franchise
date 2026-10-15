-- PostgreSQL is the authoritative draft engine. All state transitions lock one league.
create table public.franchises (id text primary key, city text not null, name text not null, conference text not null, division text not null, color text not null);
insert into public.franchises values
('ARI','Arizona','Cardinals','NFC','West','#97233f'),('ATL','Atlanta','Falcons','NFC','South','#a71930'),('BAL','Baltimore','Ravens','AFC','North','#6454ac'),('BUF','Buffalo','Bills','AFC','East','#3274d9'),('CAR','Carolina','Panthers','NFC','South','#0085ca'),('CHI','Chicago','Bears','NFC','North','#c85823'),('CIN','Cincinnati','Bengals','AFC','North','#fb4f14'),('CLE','Cleveland','Browns','AFC','North','#d77522'),('DAL','Dallas','Cowboys','NFC','East','#869bbf'),('DEN','Denver','Broncos','AFC','West','#fb4f14'),('DET','Detroit','Lions','NFC','North','#0076b6'),('GB','Green Bay','Packers','NFC','North','#49936e'),('HOU','Houston','Texans','AFC','South','#bd3145'),('IND','Indianapolis','Colts','AFC','South','#527ab1'),('JAX','Jacksonville','Jaguars','AFC','South','#00a2a4'),('KC','Kansas City','Chiefs','AFC','West','#e31837'),('LAC','Los Angeles','Chargers','AFC','West','#0080c6'),('LAR','Los Angeles','Rams','NFC','West','#2979ff'),('LV','Las Vegas','Raiders','AFC','West','#a5acaf'),('MIA','Miami','Dolphins','AFC','East','#008e97'),('MIN','Minnesota','Vikings','NFC','North','#9063cd'),('NE','New England','Patriots','AFC','East','#56769e'),('NO','New Orleans','Saints','NFC','South','#d3bc8d'),('NYG','New York','Giants','NFC','East','#3274d9'),('NYJ','New York','Jets','AFC','East','#24865e'),('PHI','Philadelphia','Eagles','NFC','East','#208c93'),('PIT','Pittsburgh','Steelers','AFC','North','#ffb612'),('SEA','Seattle','Seahawks','NFC','West','#69be28'),('SF','San Francisco','49ers','NFC','West','#d44848'),('TB','Tampa Bay','Buccaneers','NFC','South','#d50a0a'),('TEN','Tennessee','Titans','AFC','South','#4b92db'),('WAS','Washington','Commanders','NFC','East','#bb7c3e');

create table public.position_limits (position text primary key, starters int not null, maximum int not null);
insert into public.position_limits values ('QB',1,3),('RB',1,3),('FB',1,1),('WR',3,6),('TE',1,3),('LT',1,2),('LG',1,2),('C',1,2),('RG',1,2),('RT',1,2),('EDGE',2,4),('DE',1,2),('DT',2,4),('LB',3,5),('CB',3,6),('FS',1,2),('SS',1,2),('K',1,1),('P',1,1);

create table public.players (
 id uuid primary key default gen_random_uuid(), name text not null, position text not null references public.position_limits,
 age int not null check(age between 18 and 50), jersey int not null check(jersey between 0 and 99),
 overall int not null check(overall between 0 and 99), attributes jsonb not null, salary int not null check(salary>=0),
 height_inches int not null, weight_lbs int not null, development text not null,
 source text not null, dataset text not null, history text not null default 'Fictional test player. No NFL career statistics.',
 unique(dataset,name)
);
-- 2,120 clearly fictional testing players; >= 32 * max slots per position.
insert into public.players(name,position,age,jersey,overall,attributes,salary,height_inches,weight_lbs,development,source,dataset)
select 'Prospect '||p.position||' '||lpad(n::text,3,'0'),p.position,21+(n%15),n%100,
 58+((n*17+length(p.position)*7)%40),
 jsonb_build_object('speed',55+n%40,'awareness',50+(n*3)%45,'strength',55+(n*7)%40,'accuracy',50+(n*11)%45,'catching',50+(n*13)%45,'blocking',50+(n*19)%45,'tackling',50+(n*23)%45),
 750000+((n*17)%30)*250000,70+n%10,case when p.position in ('LT','LG','C','RG','RT','DT') then 290+n%45 else 190+n%55 end,
 case when n%25=0 then 'Superstar' when n%7=0 then 'Star' else 'Normal' end,
 'Original synthetic test data. Not EA ratings or real NFL players.','provisional-v1'
from public.position_limits p cross join lateral generate_series(1,p.maximum*40) n;

create table public.leagues (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 3 and 60), commissioner uuid not null references auth.users,
 state text not null default 'waiting' check(state in ('waiting','running','paused','awaiting_completion','completing','completed')),
 resume_state text check(resume_state in ('running','completing')), draft_order text[] not null check(cardinality(draft_order)=32),
 next_pick int not null default 0 check(next_pick between 0 and 1696), revision int not null default 0,
 season int not null default 1, created_at timestamptz not null default now()
);
create table public.league_invites(league_id uuid primary key references public.leagues on delete cascade, token uuid not null default gen_random_uuid() unique);
create table public.memberships(league_id uuid not null references public.leagues on delete cascade,user_id uuid not null references auth.users,franchise_id text not null references public.franchises,primary key(league_id,user_id),unique(league_id,franchise_id));
create table public.league_players(league_id uuid not null references public.leagues on delete cascade,player_id uuid not null references public.players,franchise_id text references public.franchises,profile jsonb not null,primary key(league_id,player_id));
create index on public.league_players(league_id,franchise_id);
create table public.draft_picks(league_id uuid not null references public.leagues on delete cascade,pick int not null,franchise_id text not null references public.franchises,player_id uuid not null,created_at timestamptz not null default now(),primary key(league_id,pick),unique(league_id,player_id),foreign key(league_id,player_id) references public.league_players(league_id,player_id));
create table public.draft_queue(league_id uuid not null,user_id uuid not null,player_id uuid not null,rank int not null check(rank>=0),primary key(league_id,user_id,player_id),foreign key(league_id,user_id) references public.memberships on delete cascade,foreign key(league_id,player_id) references public.league_players);
create table public.league_events(id bigint generated always as identity primary key,league_id uuid not null references public.leagues on delete cascade,message text not null,created_at timestamptz not null default now());

create function public.is_member(lid uuid) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from memberships where league_id=lid and user_id=auth.uid())$$;
create function public.is_commissioner(lid uuid) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from leagues where id=lid and commissioner=auth.uid())$$;

alter table public.franchises enable row level security;
alter table public.position_limits enable row level security;
alter table public.players enable row level security;
alter table public.leagues enable row level security;
alter table public.league_invites enable row level security;
alter table public.memberships enable row level security;
alter table public.league_players enable row level security;
alter table public.draft_picks enable row level security;
alter table public.draft_queue enable row level security;
alter table public.league_events enable row level security;
create policy read_franchises on public.franchises for select to authenticated using(true);
create policy read_limits on public.position_limits for select to authenticated using(true);
create policy read_leagues on public.leagues for select to authenticated using(public.is_member(id));
create policy read_invites on public.league_invites for select to authenticated using(public.is_commissioner(league_id));
create policy read_members on public.memberships for select to authenticated using(public.is_member(league_id));
create policy read_pool on public.league_players for select to authenticated using(public.is_member(league_id));
create policy read_picks on public.draft_picks for select to authenticated using(public.is_member(league_id));
create policy read_events on public.league_events for select to authenticated using(public.is_member(league_id));
create policy own_queue on public.draft_queue for all to authenticated using(user_id=auth.uid() and public.is_member(league_id)) with check(user_id=auth.uid() and public.is_member(league_id));

create function public.create_league(league_name text,team text) returns uuid language plpgsql security definer set search_path=public as $$
declare lid uuid; ord text[];
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 if not exists(select 1 from franchises where id=team) then raise exception 'Invalid franchise'; end if;
 select array_agg(id order by random()) into ord from franchises;
 insert into leagues(name,commissioner,draft_order) values(trim(league_name),auth.uid(),ord) returning id into lid;
 insert into memberships values(lid,auth.uid(),team);
 insert into league_invites(league_id) values(lid);
 insert into league_players(league_id,player_id,profile) select lid,id,to_jsonb(p) from players p where dataset='provisional-v1';
 insert into league_events(league_id,message) values(lid,'League created. Draft awaits commissioner start.');
 return lid;
end $$;

create function public.invite_preview(invite_token uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare lid uuid; result jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 select league_id into lid from league_invites where token=invite_token;
 if lid is null then raise exception 'Invitation not found'; end if;
 select jsonb_build_object('name',name,'state',state,'taken',coalesce((select jsonb_agg(franchise_id) from memberships where league_id=lid),'[]'::jsonb)) into result from leagues where id=lid;
 return result;
end $$;
create function public.join_league(invite_token uuid,team text) returns uuid language plpgsql security definer set search_path=public as $$
declare l leagues; lid uuid;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 select league_id into lid from league_invites where token=invite_token;
 select * into l from leagues where id=lid for update;
 -- Recheck after locking to serialize against invite rotation.
 if l.id is null or not exists(select 1 from league_invites where league_id=lid and token=invite_token) then raise exception 'Invitation not found'; end if;
 if l.state<>'waiting' then raise exception 'Team ownership is locked after draft starts'; end if;
 insert into memberships values(lid,auth.uid(),team);
 insert into league_events(league_id,message) values(lid,team||' joined the league.');
 return lid;
end $$;

create function public.manage_member(lid uuid,member_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare l leagues;
begin
 select * into l from leagues where id=lid for update;
 if not is_commissioner(lid) then raise exception 'Commissioner only'; end if;
 if l.state<>'waiting' or member_id=l.commissioner then raise exception 'Cannot remove this owner'; end if;
 delete from memberships where league_id=lid and user_id=member_id;
end $$;
create function public.rotate_invite(lid uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare t uuid;
begin
 perform 1 from leagues where id=lid for update;
 if not is_commissioner(lid) then raise exception 'Commissioner only'; end if;
 update league_invites set token=gen_random_uuid() where league_id=lid returning token into t; return t;
end $$;

create function public.draft_team(ord text[],pick int) returns text language sql immutable as $$ select ord[case when (pick/32)%2=0 then pick%32+1 else 32-pick%32 end] $$;
create function public.draft_control(lid uuid,action text) returns void language plpgsql security definer set search_path=public as $$
declare l leagues; target text;
begin
 select * into l from leagues where id=lid for update;
 if not is_commissioner(lid) then raise exception 'Commissioner only'; end if;
 target:=case
 when action='start' and l.state='waiting' then 'running'
 when action='pause' and l.state in ('running','completing') then 'paused'
 when action='resume' and l.state='paused' then l.resume_state
 when action='complete' and l.state='awaiting_completion' then 'completing'
 else null end;
 if target is null then raise exception 'Invalid draft transition'; end if;
 update leagues set state=target,resume_state=case when target='paused' then l.state else null end,revision=revision+1 where id=lid;
 insert into league_events(league_id,message) values(lid,'Commissioner: '||action||'.');
end $$;

-- Internal primitive; never grant to API roles. Caller must hold league lock.
create function public.commit_pick(lid uuid,pid uuid) returns void language plpgsql security definer set search_path=public as $$
declare l leagues; team text; pos text; mx int; ct int;
begin
 select * into l from leagues where id=lid for update;
 if l.state not in ('running','completing') then raise exception 'Draft is not running'; end if;
 team:=draft_team(l.draft_order,l.next_pick);
 select profile->>'position' into pos from league_players where league_id=lid and player_id=pid and franchise_id is null;
 if pos is null then raise exception 'Player is unavailable'; end if;
 select maximum into mx from position_limits where position=pos;
 select count(*) into ct from league_players where league_id=lid and franchise_id=team and profile->>'position'=pos;
 if ct>=mx then raise exception 'Position roster limit reached'; end if;
 insert into draft_picks values(lid,l.next_pick,team,pid,now());
 update league_players set franchise_id=team where league_id=lid and player_id=pid;
 delete from draft_queue where league_id=lid and player_id=pid;
 update leagues set next_pick=next_pick+1,revision=revision+1,state=case when next_pick+1=480 then 'awaiting_completion' when next_pick+1=1696 then 'completed' else state end where id=lid;
end $$;
create function public.submit_pick(lid uuid,pid uuid,expected_pick int,expected_revision int) returns void language plpgsql security definer set search_path=public as $$
declare l leagues;
begin
 select * into l from leagues where id=lid for update;
 if l.id is null or not is_member(lid) then raise exception 'League access denied'; end if;
 if l.state<>'running' then raise exception 'Draft is not accepting human picks'; end if;
 if l.next_pick<>expected_pick or l.revision<>expected_revision then raise exception 'Draft changed. Refresh and select again.'; end if;
 if not exists(select 1 from memberships where league_id=lid and user_id=auth.uid() and franchise_id=draft_team(l.draft_order,l.next_pick)) then raise exception 'Not your turn'; end if;
 perform commit_pick(lid,pid);
end $$;

create function public.cpu_tick_internal(lid uuid,batch_size int default 8) returns int language plpgsql security definer set search_path=public as $$
declare l leagues; team text; pid uuid; done int:=0;
begin
 -- SKIP LOCKED prevents cron/browser workers from queuing behind one another.
 select * into l from leagues where id=lid for update skip locked;
 if l.id is null then return 0; end if;
 for i in 1..least(greatest(batch_size,1),16) loop
  select * into l from leagues where id=lid;
  if l.state not in ('running','completing') then exit; end if;
  team:=draft_team(l.draft_order,l.next_pick);
  if l.state='running' and exists(select 1 from memberships where league_id=lid and franchise_id=team) then exit; end if;
  with counts as (select profile->>'position' pos,count(*) n from league_players where league_id=lid and franchise_id=team group by 1),
  available as (select profile->>'position' pos,count(*) n from league_players where league_id=lid and franchise_id is null group by 1)
  select p.player_id into pid from league_players p join position_limits lim on lim.position=p.profile->>'position'
  left join counts c on c.pos=lim.position join available a on a.pos=lim.position
  where p.league_id=lid and p.franchise_id is null and coalesce(c.n,0)<lim.maximum
  order by ((p.profile->>'overall')::int + greatest(0,28-(p.profile->>'age')::int)*0.6
   +case when coalesce(c.n,0)<lim.starters then 22 else 0 end
   -coalesce(c.n,0)*6 - (p.profile->>'salary')::numeric/10000000
   +32.0*lim.maximum/a.n) desc,p.player_id limit 1;
  if pid is null then raise exception 'Insufficient eligible players'; end if;
  perform commit_pick(lid,pid); done:=done+1;
 end loop;
 return done;
end $$;
create function public.cpu_tick(lid uuid) returns int language plpgsql security definer set search_path=public as $$
begin if not is_member(lid) then raise exception 'League access denied'; end if; return cpu_tick_internal(lid,8); end $$;

-- Explicit privileges prevent direct mutation and accidental exposure of internal helpers.
revoke all on public.franchises,public.position_limits,public.players,public.leagues,public.league_invites,public.memberships,public.league_players,public.draft_picks,public.draft_queue,public.league_events from anon,authenticated;
grant select on public.franchises,public.position_limits,public.leagues,public.league_invites,public.memberships,public.league_players,public.draft_picks,public.league_events to authenticated;
grant select,insert,update,delete on public.draft_queue to authenticated;
revoke execute on function public.is_member(uuid),public.is_commissioner(uuid),public.create_league(text,text),public.invite_preview(uuid),public.join_league(uuid,text),public.manage_member(uuid,uuid),public.rotate_invite(uuid),public.draft_team(text[],int),public.draft_control(uuid,text),public.commit_pick(uuid,uuid),public.submit_pick(uuid,uuid,int,int),public.cpu_tick_internal(uuid,int),public.cpu_tick(uuid) from public,anon,authenticated;
grant execute on function public.is_member(uuid),public.is_commissioner(uuid),public.create_league(text,text),public.invite_preview(uuid),public.join_league(uuid,text),public.manage_member(uuid,uuid),public.rotate_invite(uuid),public.draft_control(uuid,text),public.submit_pick(uuid,uuid,int,int),public.cpu_tick(uuid) to authenticated;

create function public.league_snapshot(lid uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if not is_member(lid) then raise exception 'League access denied'; end if;
 return jsonb_build_object('league',(select to_jsonb(l) from leagues l where id=lid),
 'members',(select coalesce(jsonb_agg(m),'[]') from memberships m where league_id=lid),
 'picks',(select coalesce(jsonb_agg(p order by pick),'[]') from draft_picks p where league_id=lid),
 'events',(select coalesce(jsonb_agg(e),'[]') from (select message,created_at from league_events where league_id=lid order by id desc limit 12)e),
 'invite',case when is_commissioner(lid) then (select token from league_invites where league_id=lid) else null end);
end $$;
revoke all on function public.league_snapshot(uuid) from public,anon;
grant execute on function public.league_snapshot(uuid) to authenticated;
