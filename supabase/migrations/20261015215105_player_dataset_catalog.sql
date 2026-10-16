-- Versioned datasets preserve each league's original draft pool and provenance.
create table public.player_datasets(id text primary key,label text not null,source_url text not null,license text not null,rating_source text not null,effective_date date,metadata jsonb not null default '{}',is_default boolean not null default false);
create unique index one_default_dataset on public.player_datasets(is_default) where is_default;
alter table public.player_datasets enable row level security;
revoke all on public.player_datasets from anon,authenticated;
grant select on public.player_datasets to authenticated;
create policy read_datasets on public.player_datasets for select to authenticated using(true);
insert into public.player_datasets(id,label,source_url,license,rating_source,is_default) values('provisional-v1','Fictional test pool','Original synthetic seed','Original test data','ff-original-test',true);
alter table public.players add column external_id text,add column nfl_team text references public.franchises,add column rating_source text not null default 'ff-original-test',add column is_fictional boolean not null default true,add column stats jsonb not null default '{}';
alter table public.players add column display_name text;
alter table public.players add constraint players_dataset_external_id_key unique(dataset,external_id);
alter table public.leagues add column dataset text not null default 'provisional-v1' references public.player_datasets;
create or replace function public.create_league(league_name text,team text) returns uuid language plpgsql security definer set search_path=public as $$
declare lid uuid; ord text[]; pool text;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 if not exists(select 1 from franchises where id=team) then raise exception 'Invalid franchise'; end if;
 select id into pool from player_datasets where is_default;
 if pool is null then raise exception 'No player pool configured'; end if;
 select array_agg(id order by random()) into ord from franchises;
 insert into leagues(name,commissioner,draft_order,dataset) values(trim(league_name),auth.uid(),ord,pool) returning id into lid;
 insert into memberships values(lid,auth.uid(),team);
 insert into league_invites(league_id) values(lid);
 insert into league_players(league_id,player_id,profile) select lid,id,to_jsonb(p)||jsonb_build_object('name',coalesce(p.display_name,p.name)) from players p where dataset=pool;
 insert into league_events(league_id,message) values(lid,'League created. Draft awaits commissioner start.');
 return lid;
end $$;
