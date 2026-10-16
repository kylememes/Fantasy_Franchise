-- User-supplied workbook imports affect overall only. Other ratings remain original.
create table public.overall_imports(id text primary key,source_file text not null,sha256 text not null unique,summary jsonb not null,applied_at timestamptz);
create table public.overall_import_rows(import_id text not null references public.overall_imports,player_id uuid not null references public.players,overall int not null check(overall between 0 and 99),source_row int not null check(source_row>1),source_name text not null,primary key(import_id,player_id),unique(import_id,source_row));
alter table public.players add column overall_source text,add column overall_source_row int;
alter table public.overall_imports enable row level security;
alter table public.overall_import_rows enable row level security;
revoke all on public.overall_imports,public.overall_import_rows from anon,authenticated;
