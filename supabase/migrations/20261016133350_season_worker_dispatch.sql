-- Hosted delivery only: no API key is embedded in a cron command.
create extension if not exists pg_net;
create function public.dispatch_game_worker() returns void language plpgsql security definer set search_path=public as $$
declare lid uuid;gid uuid;ticket uuid;
begin
 -- Finish live games from server time even when all spectators have disconnected.
 for lid in select l.id from leagues l where exists(select 1 from season_games g where g.league_id=l.id and g.status='live') for update of l skip locked loop
  for gid in select g.id from season_games g where g.league_id=lid and g.status='live' order by g.id loop perform refresh_game_internal(gid);end loop;
 end loop;
 update season_games g set status='error' from game_jobs j where j.game_id=g.id and g.status='building' and j.claimed_at<now()-interval '3 minutes' and j.attempts>=5;
 delete from game_worker_tickets where expires_at<now();
 if exists(select 1 from season_games g join game_jobs j on j.game_id=g.id where g.status='queued' or(g.status='building' and j.claimed_at<now()-interval '3 minutes' and j.attempts<5)) then
  insert into game_worker_tickets default values returning game_worker_tickets.ticket into ticket;
  perform net.http_post(url:='https://mgxegzxxutbvzhuikdty.supabase.co/functions/v1/game-worker',headers:='{"Content-Type":"application/json"}'::jsonb,body:=jsonb_build_object('ticket',ticket),timeout_milliseconds:=15000);
 end if;
end $$;
revoke all on function public.dispatch_game_worker() from public,anon,authenticated;
select cron.schedule('fantasy-franchise-games','5 seconds',$$select public.dispatch_game_worker()$$);
