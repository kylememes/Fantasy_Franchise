import { readFile, mkdir, writeFile } from "node:fs/promises";
import type { Player } from "../src/lib/types";
export type OverallImport = {
  import_id: string;
  source_file: string;
  sha256: string;
  source_rows: number;
  matched_players: number;
  unmatched_app_players: number;
  matches: {
    player_id: string;
    overall: number;
    source_row: number;
    source_name: string;
  }[];
};
const sql = (s: string) => "'" + s.replaceAll("'", "''") + "'";
export function validateOverallImport(input: OverallImport, pool: Player[]) {
  const known = new Map(pool.map((p) => [p.id, p]));
  const seen = new Set<string>(),
    rows = new Set<number>();
  if (
    !input.import_id ||
    !/^[a-f0-9]{64}$/.test(input.sha256) ||
    input.matches.length !== input.matched_players ||
    !input.matched_players
  )
    throw Error("Invalid import metadata/count");
  for (const m of input.matches) {
    if (
      !known.has(m.player_id) ||
      known.get(m.player_id)?.is_fictional ||
      seen.has(m.player_id) ||
      rows.has(m.source_row) ||
      !Number.isInteger(m.source_row) ||
      m.source_row < 2 ||
      !m.source_name ||
      !Number.isInteger(m.overall) ||
      m.overall < 0 ||
      m.overall > 99
    )
      throw Error("Invalid or duplicate overall match");
    seen.add(m.player_id);
    rows.add(m.source_row);
  }
}
export function overallImportSql(input: OverallImport) {
  const metadata = Object.fromEntries(
    Object.entries(input).filter(
      ([k]) => !["matches", "unmatched"].includes(k),
    ),
  );
  const setup = `insert into public.overall_imports(id,source_file,sha256,summary) values(${sql(input.import_id)},${sql(input.source_file)},${sql(input.sha256)},${sql(JSON.stringify(metadata))}::jsonb) on conflict(id) do nothing;`;
  const batches = [];
  for (let i = 0; i < input.matches.length; i += 500) {
    const rows = input.matches
      .slice(i, i + 500)
      .map(({ player_id, overall, source_row, source_name }) => ({
        player_id,
        overall,
        source_row,
        source_name,
      }));
    batches.push(
      `insert into public.overall_import_rows(import_id,player_id,overall,source_row,source_name) select ${sql(input.import_id)},player_id,overall,source_row,source_name from jsonb_to_recordset(${sql(JSON.stringify(rows))}::jsonb) as x(player_id uuid,overall int,source_row int,source_name text) on conflict(import_id,player_id) do nothing;`,
    );
  }
  const activate = `begin;
do $$ declare import_key text:=${sql(input.import_id)}; n int; begin
 perform 1 from public.overall_imports where id=import_key for update;
 if exists(select 1 from public.overall_imports where id=import_key and applied_at is not null) then return;end if;
 select count(*) into n from public.overall_import_rows where import_id=import_key;
 if n<>${input.matched_players} then raise exception 'Incomplete import: %',n;end if;
 perform 1 from public.leagues l where exists(select 1 from public.league_players p join public.overall_import_rows r on r.player_id=p.player_id and r.import_id=import_key where p.league_id=l.id) order by l.id for update;
 update public.players p set overall=r.overall,overall_source=import_key,overall_source_row=r.source_row from public.overall_import_rows r where r.import_id=import_key and p.id=r.player_id;
 update public.league_players p set profile=p.profile||jsonb_build_object('overall',r.overall,'overall_source',import_key,'overall_source_row',r.source_row) from public.overall_import_rows r where r.import_id=import_key and p.player_id=r.player_id;
 update public.leagues l set revision=revision+1 where exists(select 1 from public.league_players p join public.overall_import_rows r on r.player_id=p.player_id and r.import_id=import_key where p.league_id=l.id);
 update public.player_datasets d set label='NFL roster · uploaded overall overlay',metadata=metadata||jsonb_build_object('overall_import',import_key,'overall_matches',${input.matched_players},'attributes','original estimates') where exists(select 1 from public.players p join public.overall_import_rows r on r.player_id=p.id and r.import_id=import_key where p.dataset=d.id);
 update public.overall_imports set applied_at=now() where id=import_key;
 end $$;
commit;`;
  return { setup, batches, activate };
}
async function main() {
  const input = JSON.parse(
    await readFile("data/uploaded-overalls.json", "utf8"),
  );
  validateOverallImport(
    input,
    JSON.parse(await readFile("data/nfl-2026-pool.json", "utf8")),
  );
  const output = overallImportSql(input);
  await mkdir("supabase/.temp/overalls", { recursive: true });
  await writeFile("supabase/.temp/overalls/setup.sql", output.setup);
  for (const [i, b] of output.batches.entries())
    await writeFile(`supabase/.temp/overalls/${i}.sql`, b);
  await writeFile("supabase/.temp/overalls/activate.sql", output.activate);
  console.log(
    JSON.stringify({
      matched: input.matched_players,
      unmatched_app: input.unmatched_app_players,
      batches: output.batches.length,
    }),
  );
}
if (process.argv[1]?.endsWith("uploaded-overalls.ts")) void main();
