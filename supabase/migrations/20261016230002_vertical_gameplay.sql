-- Future kickoffs opt into V3. Existing frozen jobs and saved finals retain their version.
alter function public.team_game_input(uuid,text) rename to team_game_input_v2;
revoke all on function public.team_game_input_v2(uuid,text) from public,anon,authenticated;
create function public.team_game_input(lid uuid,team text) returns jsonb language sql stable security definer set search_path=public as $$
 select team_game_input_v2(lid,team)||jsonb_build_object('gameplay_version',3);
$$;
revoke all on function public.team_game_input(uuid,text) from public,anon,authenticated;

create or replace function public.commit_simulation(gid uuid,job_lease uuid,p_result jsonb) returns boolean language plpgsql security definer set search_path=public as $$
declare g season_games;j game_jobs;
begin
 perform 1 from leagues where id=(select league_id from season_games where id=gid) for update;
 select * into strict g from season_games where id=gid for update;
 select * into strict j from game_jobs where game_id=gid for update;
 if g.status<>'building' or j.lease is distinct from job_lease then return false;end if;
 if (p_result->>'engine_version') is distinct from (case when j.frozen#>>'{home,gameplay_version}'='3' and j.frozen#>>'{away,gameplay_version}'='3' then 'ff-football-3' when j.frozen#>>'{home,coach_bonus_version}'='1' or j.frozen#>>'{away,coach_bonus_version}'='1' then 'ff-football-2' else 'ff-football-1' end) or jsonb_array_length(p_result->'plays') not between 1 and 449 or (p_result->>'home_score')::int not between 0 and 200 or (p_result->>'away_score')::int not between 0 and 200 then raise exception 'Invalid engine result';end if;
 update game_jobs set result=p_result,last_error=null where game_id=gid;
 if g.participants=0 then perform finish_game_internal(gid);
 else update season_games set status='live',anchor_at=now(),cursor=0,engine_version=p_result->>'engine_version' where id=gid;end if;
 update leagues set revision=revision+1 where id=g.league_id;return true;
end $$;
revoke all on function public.commit_simulation(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.commit_simulation(uuid,uuid,jsonb) to service_role;

create or replace function public.game_action(gid uuid,action text,play_speed int default 1) returns void language plpgsql security definer set search_path=public as $$
declare g season_games;s league_seasons;l uuid;team text;cur int;timeline jsonb;next_cursor int;
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
 elsif action in ('pause','resume','speed','next','next_drive','finish') then
  if g.status='final' then return;end if;
  if g.status not in('live','paused') then raise exception 'Wait for the simulation worker';end if;
  cur=live_cursor(g);
  if action='next_drive' then
   select result->'plays' into timeline from game_jobs where game_id=gid;
   select min(ordinality)::int-1 into next_cursor from jsonb_array_elements(timeline) with ordinality p(value,ordinality)
    where ordinality>cur+1 and (value->>'offense' is distinct from timeline->cur->>'offense'
      or ((value->>'quarter')::int=3 and (timeline->cur->>'quarter')::int<3));
   cur=coalesce(next_cursor,jsonb_array_length(timeline));
  end if;
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

revoke all on function public.game_action(uuid,text,int) from public,anon;
grant execute on function public.game_action(uuid,text,int) to authenticated;
