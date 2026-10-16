-- Original game-assigned coach specialties, not official coaching ratings.
-- No roster/profile, saved result, draft pick or existing hire is rewritten.
alter table public.coach_catalog add column bonuses jsonb not null default '[]'::jsonb check(jsonb_typeof(bonuses)='array');
alter table public.coach_catalog add column identity text;
update public.coach_catalog set identity='Secondary',bonuses='[{"positions":["CB"],"attributes":["man_coverage"],"label":"CB man coverage","amount":2},{"positions":["FS","SS"],"attributes":["tackling"],"label":"Safeties tackling","amount":1}]'::jsonb where id='aaron-glenn' and role='HC';
update public.coach_catalog set identity='Passing',bonuses='[{"positions":["QB"],"attributes":["short_accuracy"],"label":"QB short accuracy","amount":2},{"positions":["TE"],"attributes":["catching"],"label":"TE catching","amount":1}]'::jsonb where id='andy-reid' and role='HC';
update public.coach_catalog set identity='Running',bonuses='[{"positions":["LT","LG","C","RG","RT"],"attributes":["run_blocking"],"label":"OL run blocking","amount":2},{"positions":["QB"],"attributes":["medium_accuracy"],"label":"QB medium accuracy","amount":1}]'::jsonb where id='ben-johnson' and role='HC';
update public.coach_catalog set identity='Running',bonuses='[{"positions":["RB"],"attributes":["vision"],"label":"RB ballcarrier vision","amount":2},{"positions":["QB"],"attributes":["short_accuracy"],"label":"QB short accuracy","amount":1}]'::jsonb where id='brian-schottenheimer' and role='HC';
update public.coach_catalog set identity='Running',bonuses='[{"positions":["LT","LG","C","RG","RT"],"attributes":["run_blocking"],"label":"OL run blocking","amount":2},{"positions":["RB"],"attributes":["carrying"],"label":"RB carrying","amount":1}]'::jsonb where id='dan-campbell' and role='HC';
update public.coach_catalog set identity='Front',bonuses='[{"positions":["EDGE","DE"],"attributes":["power_moves","finesse_moves"],"label":"Edge pass rush","amount":2},{"positions":["CB"],"attributes":["zone_coverage"],"label":"CB zone coverage","amount":1}]'::jsonb where id='dan-quinn' and role='HC';
update public.coach_catalog set identity='Passing',bonuses='[{"positions":["QB"],"attributes":["pressure_response"],"label":"QB pressure response","amount":2},{"positions":["WR"],"attributes":["short_route"],"label":"WR short routes","amount":1}]'::jsonb where id='dave-canales' and role='HC';
update public.coach_catalog set identity='Front',bonuses='[{"positions":["LB"],"attributes":["tackling"],"label":"LB tackling","amount":2},{"positions":["EDGE","DE","DT"],"attributes":["block_shedding"],"label":"DL block shedding","amount":1}]'::jsonb where id='demeco-ryans' and role='HC';
update public.coach_catalog set identity='Secondary',bonuses='[{"positions":["CB"],"attributes":["zone_coverage"],"label":"CB zone coverage","amount":2},{"positions":["FS","SS"],"attributes":["pursuit"],"label":"Safeties pursuit","amount":1}]'::jsonb where id='jeff-hafley' and role='HC';
update public.coach_catalog set identity='Secondary',bonuses='[{"positions":["FS","SS"],"attributes":["zone_coverage"],"label":"Safeties zone coverage","amount":2},{"positions":["LB"],"attributes":["awareness"],"label":"LB awareness","amount":1}]'::jsonb where id='jesse-minter' and role='HC';
update public.coach_catalog set identity='Running',bonuses='[{"positions":["LT","LG","C","RG","RT"],"attributes":["run_blocking"],"label":"OL run blocking","amount":2},{"positions":["EDGE","DE","DT"],"attributes":["strength"],"label":"DL strength","amount":1}]'::jsonb where id='jim-harbaugh' and role='HC';
update public.coach_catalog set identity='Passing',bonuses='[{"positions":["QB"],"attributes":["medium_accuracy"],"label":"QB medium accuracy","amount":2},{"positions":["WR"],"attributes":["catching"],"label":"WR catching","amount":1}]'::jsonb where id='joe-brady' and role='HC';
update public.coach_catalog set identity='Balanced',bonuses='[{"positions":["K"],"attributes":["kick_accuracy"],"label":"K kicking accuracy","amount":2},{"positions":["LB"],"attributes":["tackling"],"label":"LB tackling","amount":1}]'::jsonb where id='john-harbaugh' and role='HC';
update public.coach_catalog set identity='Passing',bonuses='[{"positions":["QB"],"attributes":["deep_accuracy"],"label":"QB deep accuracy","amount":2},{"positions":["WR"],"attributes":["medium_route"],"label":"WR medium routes","amount":1}]'::jsonb where id='kellen-moore' and role='HC';
update public.coach_catalog set identity='Passing',bonuses='[{"positions":["QB"],"attributes":["pressure_response"],"label":"QB pressure response","amount":2},{"positions":["WR"],"attributes":["catching"],"label":"WR catching","amount":1}]'::jsonb where id='kevin-o-connell' and role='HC';
update public.coach_catalog set identity='Running',bonuses='[{"positions":["RB"],"attributes":["vision"],"label":"RB ballcarrier vision","amount":2},{"positions":["LT","LG","C","RG","RT"],"attributes":["pass_blocking"],"label":"OL pass blocking","amount":1}]'::jsonb where id='kevin-stefanski' and role='HC';
update public.coach_catalog set identity='Running',bonuses='[{"positions":["LT","LG","C","RG","RT"],"attributes":["run_blocking"],"label":"OL run blocking","amount":2},{"positions":["RB"],"attributes":["catching"],"label":"RB receiving","amount":1}]'::jsonb where id='klint-kubiak' and role='HC';
update public.coach_catalog set identity='Running',bonuses='[{"positions":["RB"],"attributes":["vision"],"label":"RB ballcarrier vision","amount":2},{"positions":["TE"],"attributes":["run_blocking"],"label":"TE run blocking","amount":1}]'::jsonb where id='kyle-shanahan' and role='HC';
update public.coach_catalog set identity='Passing',bonuses='[{"positions":["QB"],"attributes":["short_accuracy"],"label":"QB short accuracy","amount":2},{"positions":["RB"],"attributes":["carrying"],"label":"RB carrying","amount":1}]'::jsonb where id='liam-coen' and role='HC';
update public.coach_catalog set identity='Passing',bonuses='[{"positions":["QB"],"attributes":["medium_accuracy"],"label":"QB medium accuracy","amount":2},{"positions":["RB"],"attributes":["vision"],"label":"RB ballcarrier vision","amount":1}]'::jsonb where id='matt-lafleur' and role='HC';
update public.coach_catalog set identity='Passing',bonuses='[{"positions":["WR"],"attributes":["medium_route"],"label":"WR medium routes","amount":2},{"positions":["QB"],"attributes":["short_accuracy"],"label":"QB short accuracy","amount":1}]'::jsonb where id='mike-lafleur' and role='HC';
update public.coach_catalog set identity='Secondary',bonuses='[{"positions":["FS","SS"],"attributes":["zone_coverage"],"label":"Safeties zone coverage","amount":2},{"positions":["EDGE","DE"],"attributes":["power_moves","finesse_moves"],"label":"Edge pass rush","amount":1}]'::jsonb where id='mike-macdonald' and role='HC';
update public.coach_catalog set identity='Passing',bonuses='[{"positions":["QB"],"attributes":["short_accuracy"],"label":"QB short accuracy","amount":2},{"positions":["WR"],"attributes":["release"],"label":"WR release","amount":1}]'::jsonb where id='mike-mccarthy' and role='HC';
update public.coach_catalog set identity='Front',bonuses='[{"positions":["LB"],"attributes":["tackling"],"label":"LB tackling","amount":2},{"positions":["EDGE","DE","DT"],"attributes":["block_shedding"],"label":"DL block shedding","amount":1}]'::jsonb where id='mike-vrabel' and role='HC';
update public.coach_catalog set identity='Passing',bonuses='[{"positions":["LT","LG","C","RG","RT"],"attributes":["pass_blocking"],"label":"OL pass blocking","amount":2},{"positions":["WR"],"attributes":["release"],"label":"WR release","amount":1}]'::jsonb where id='nick-sirianni' and role='HC';
update public.coach_catalog set identity='Front',bonuses='[{"positions":["EDGE","DE","DT"],"attributes":["block_shedding"],"label":"DL block shedding","amount":2},{"positions":["CB"],"attributes":["zone_coverage"],"label":"CB zone coverage","amount":1}]'::jsonb where id='robert-saleh' and role='HC';
update public.coach_catalog set identity='Passing',bonuses='[{"positions":["WR"],"attributes":["medium_route"],"label":"WR medium routes","amount":2},{"positions":["QB"],"attributes":["pressure_response"],"label":"QB pressure response","amount":1}]'::jsonb where id='sean-mcvay' and role='HC';
update public.coach_catalog set identity='Passing',bonuses='[{"positions":["QB"],"attributes":["short_accuracy"],"label":"QB short accuracy","amount":2},{"positions":["RB"],"attributes":["catching"],"label":"RB receiving","amount":1}]'::jsonb where id='sean-payton' and role='HC';
update public.coach_catalog set identity='Passing',bonuses='[{"positions":["QB"],"attributes":["pressure_response"],"label":"QB pressure response","amount":2},{"positions":["RB"],"attributes":["vision"],"label":"RB ballcarrier vision","amount":1}]'::jsonb where id='shane-steichen' and role='HC';
update public.coach_catalog set identity='Front',bonuses='[{"positions":["EDGE","DE"],"attributes":["power_moves","finesse_moves"],"label":"Edge pass rush","amount":2},{"positions":["CB"],"attributes":["man_coverage"],"label":"CB man coverage","amount":1}]'::jsonb where id='todd-bowles' and role='HC';
update public.coach_catalog set identity='Passing',bonuses='[{"positions":["QB"],"attributes":["medium_accuracy"],"label":"QB medium accuracy","amount":2},{"positions":["TE"],"attributes":["catching"],"label":"TE catching","amount":1}]'::jsonb where id='todd-monken' and role='HC';
update public.coach_catalog set identity='Passing',bonuses='[{"positions":["QB"],"attributes":["deep_accuracy"],"label":"QB deep accuracy","amount":2},{"positions":["WR"],"attributes":["contested_catch"],"label":"WR contested catching","amount":1}]'::jsonb where id='zac-taylor' and role='HC';

-- Pure transformation used only while freezing a new game. Stored player ratings stay intact.
create function public.boosted_game_profile(profile jsonb,perks jsonb,coach_name text) returns jsonb language plpgsql immutable set search_path=public as $$
declare attrs jsonb:=coalesce(profile->'attributes','{}'::jsonb);base_attrs jsonb:=attrs;boosts jsonb:='{}';perk jsonb;key text;b numeric;v numeric;amount int;alias text;base_value numeric;
begin
 for perk in select value from jsonb_array_elements(coalesce(perks,'[]'::jsonb)) loop
  if not (perk->'positions' ? (profile->>'position')) then continue;end if;
  for key in select jsonb_array_elements_text(perk->'attributes') loop
   base_value:=null;
   foreach alias in array array[key] || (case key when 'run_blocking' then array['run_block','blocking'] when 'pass_blocking' then array['pass_block','blocking'] when 'power_moves' then array['pass_rush'] when 'finesse_moves' then array['pass_rush'] when 'block_shedding' then array['tackling'] when 'pursuit' then array['tackling'] when 'man_coverage' then array['coverage'] when 'zone_coverage' then array['coverage'] when 'short_route' then array['route_running'] when 'medium_route' then array['route_running'] when 'deep_route' then array['route_running'] when 'short_accuracy' then array['accuracy'] when 'medium_accuracy' then array['accuracy'] when 'deep_accuracy' then array['accuracy'] when 'pressure_response' then array['awareness'] when 'vision' then array['ball_carrier_vision','awareness'] when 'contested_catch' then array['catching'] else array[]::text[] end) loop
    if jsonb_typeof(base_attrs->alias)='number' then base_value:=(base_attrs->>alias)::numeric;exit;end if;
   end loop;
   b:=least(99,greatest(0,coalesce(base_value,least(90,greatest(35,(profile->>'overall')::numeric)))));
   amount:=least(3,coalesce((boosts#>>array[key,'bonus'])::int,0)+(perk->>'amount')::int);
   v:=least(99,b+amount);
   attrs:=jsonb_set(attrs,array[key],to_jsonb(v));
   boosts:=jsonb_set(boosts,array[key],jsonb_build_object('base',b,'bonus',v-b,'value',v));
  end loop;
 end loop;
 return profile||jsonb_build_object('attributes',attrs,'coach_boosts',boosts,'head_coach',coach_name);
end $$;
revoke all on function public.boosted_game_profile(jsonb,jsonb,text) from public,anon,authenticated;

create or replace function public.team_game_input(lid uuid,team text) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',team,'players',coalesce((select jsonb_agg(boosted_game_profile(profile,coalesce(h.bonuses,'[]'::jsonb),h.name) order by player_id) from league_players where league_id=lid and franchise_id=team),'[]'::jsonb),'depth',effective_depth(lid,team),'coaching',coalesce((select jsonb_build_object('offense',offense,'defense',defense,'tendencies',tendencies) from coaching_settings where league_id=lid and franchise_id=team),jsonb_build_object('offense','Balanced','defense','4–3','tendencies','{}'::jsonb)),'staff',coalesce((select jsonb_object_agg(s.role,c.name) from franchise_staff s join coach_catalog c on c.id=s.coach_id where s.league_id=lid and s.franchise_id=team),'{}'::jsonb),'coach_bonus_version',1)
 from (select 1) x left join (select c.name,c.bonuses from franchise_staff fs join coach_catalog c on c.id=fs.coach_id where fs.league_id=lid and fs.franchise_id=team and fs.role='HC') h on true;
$$;
revoke all on function public.team_game_input(uuid,text) from public,anon,authenticated;

-- Human owners get the entire initial hiring window; CPUs fill vacant HC slots from Week 2.
create function public.fill_cpu_head_coaches(lid uuid) returns void language plpgsql security definer set search_path=public as $$
declare t text;chosen text;o text;d text;hired int:=0;
begin
 perform 1 from leagues where id=lid for update;
 for t in select f.id from franchises f where not exists(select 1 from memberships m where m.league_id=lid and m.franchise_id=f.id) and not exists(select 1 from franchise_staff fs where fs.league_id=lid and fs.franchise_id=f.id and fs.role='HC') order by md5(lid::text||f.id),f.id loop
  select offense,defense into o,d from coaching_settings where league_id=lid and franchise_id=t;
  select c.id into chosen from coach_catalog c where c.role='HC' and not exists(select 1 from franchise_staff fs where fs.league_id=lid and fs.coach_id=c.id)
   order by (case when c.identity='Running' and o in('Power Run','Option') then 2 when c.identity='Passing' and o in('West Coast','Spread','Air Raid') then 2 when c.identity='Secondary' and d in('Man-heavy','Zone-heavy','Nickel-heavy') then 2 when c.identity='Front' and d in('4–3','3–4') then 1 else 0 end) desc,md5(lid::text||t||c.id),c.id limit 1;
  if chosen is not null then insert into franchise_staff values(lid,t,'HC',chosen);hired:=hired+1;end if;
 end loop;
 if hired>0 then
  update leagues set revision=revision+1 where id=lid;
  insert into league_events(league_id,message) values(lid,'CPU franchises hired '||hired||' remaining head coaches');
 end if;
end $$;
revoke all on function public.fill_cpu_head_coaches(uuid) from public,anon,authenticated;

create or replace function public.week_control(lid uuid,action text,expected_phase text,expected_week int) returns void language plpgsql security definer set search_path=public as $$
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
  if s.phase='regular' or (s.phase='preseason' and s.week>=2) then perform fill_cpu_head_coaches(lid);end if;
  for g in select * from season_games where league_id=lid and season=l.season and phase=s.phase and week=s.week and status='scheduled' and not exists(select 1 from memberships m where m.league_id=lid and m.franchise_id in(season_games.home,season_games.away)) order by id loop perform queue_game_internal(g.id);end loop;
 end if;
 update leagues set revision=revision+1 where id=lid;
 insert into league_events(league_id,message) values(lid,'Commissioner: '||replace(action,'_',' ')||' · '||s.phase||' Week '||s.week);
end $$;

create or replace function public.management_snapshot(lid uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare base jsonb;team text;
begin
 -- Base checks membership before any private data is read.
 base:=management_snapshot_base(lid);
 select franchise_id into team from memberships where league_id=lid and user_id=auth.uid();
 return base||jsonb_build_object('head_coach',(select jsonb_build_object('id',c.id,'name',c.name,'bonuses',c.bonuses) from franchise_staff fs join coach_catalog c on c.id=fs.coach_id where fs.league_id=lid and fs.franchise_id=team and fs.role='HC'),'revision',(select revision from leagues where id=lid),'depth',jsonb_build_object('orders',effective_depth(lid,team),'version',coalesce((select version from depth_charts where league_id=lid and franchise_id=team),0)),
 'free_agents',(select coalesce(jsonb_agg(jsonb_build_object('player_id',player_id,'annual_salary',free_agent_salary(lid,player_id))),'[]') from league_players where league_id=lid and franchise_id is null));
end $$;
revoke all on function public.week_control(uuid,text,text,int),public.management_snapshot(uuid) from public,anon;
grant execute on function public.week_control(uuid,text,text,int),public.management_snapshot(uuid) to authenticated;

-- Reject results from an engine version that does not match the frozen input.
create or replace function public.commit_simulation(gid uuid,job_lease uuid,p_result jsonb) returns boolean language plpgsql security definer set search_path=public as $$
declare g season_games;j game_jobs;
begin
 perform 1 from leagues where id=(select league_id from season_games where id=gid) for update;
 select * into strict g from season_games where id=gid for update;
 select * into strict j from game_jobs where game_id=gid for update;
 if g.status<>'building' or j.lease is distinct from job_lease then return false;end if;
 if (p_result->>'engine_version') is distinct from (case when j.frozen#>>'{home,coach_bonus_version}'='1' or j.frozen#>>'{away,coach_bonus_version}'='1' then 'ff-football-2' else 'ff-football-1' end) or jsonb_array_length(p_result->'plays') not between 1 and 449 or (p_result->>'home_score')::int not between 0 and 200 or (p_result->>'away_score')::int not between 0 and 200 then raise exception 'Invalid engine result';end if;
 update game_jobs set result=p_result,last_error=null where game_id=gid;
 if g.participants=0 then perform finish_game_internal(gid);
 else update season_games set status='live',anchor_at=now(),cursor=0,engine_version=p_result->>'engine_version' where id=gid;end if;
 update leagues set revision=revision+1 where id=g.league_id;return true;
end $$;
revoke all on function public.commit_simulation(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.commit_simulation(uuid,uuid,jsonb) to service_role;
