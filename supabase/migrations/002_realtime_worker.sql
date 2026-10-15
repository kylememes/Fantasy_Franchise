-- Supabase-specific delivery layer. Database state, never a browser timer, owns progress.
alter publication supabase_realtime add table public.leagues,public.draft_picks,public.memberships;
-- Enable pg_cron in Supabase Database > Extensions before applying this migration.
create extension if not exists pg_cron;
select cron.schedule('fantasy-franchise-cpu','5 seconds',
 $$select public.cpu_tick_internal(id,8) from public.leagues where state in ('running','completing')$$);
