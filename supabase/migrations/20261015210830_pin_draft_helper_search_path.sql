-- Pure array arithmetic needs no database object lookup.
alter function public.draft_team(text[],integer) set search_path = '';
