-- Durable pacing: every connected client and background worker shares this gate.
alter table public.leagues add column next_cpu_pick_at timestamptz not null default clock_timestamp()+interval '4 seconds';
create or replace function public.draft_control(lid uuid,action text) returns void language plpgsql security definer set search_path=public as $$
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
 update leagues set next_cpu_pick_at=clock_timestamp()+interval '4 seconds',state=target,resume_state=case when target='paused' then l.state else null end,revision=revision+1 where id=lid;
 insert into league_events(league_id,message) values(lid,'Commissioner: '||action||'.');
end $$;

create or replace function public.commit_pick(lid uuid,pid uuid) returns void language plpgsql security definer set search_path=public as $$
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
 update leagues set next_cpu_pick_at=clock_timestamp()+case when state='completing' then interval '1 second' else interval '4 seconds' end,next_pick=next_pick+1,revision=revision+1,state=case when next_pick+1=480 then 'awaiting_completion' when next_pick+1=1696 then 'completed' else state end where id=lid;
end $$;

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

-- Hosted delivery checks the same persisted gate once per second.
do $$ begin
 if to_regclass('cron.job') is not null then
  perform cron.schedule('fantasy-franchise-cpu','1 second', $job$select public.cpu_tick_internal(id,8) from public.leagues where state in ('running','completing')$job$);
 end if;
end $$;
