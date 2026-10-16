import { readFile, mkdir, writeFile } from "node:fs/promises";
export type AttributeImport = {
  import_id: string;
  sha256: string;
  matched_players: number;
  mapping: Record<string, string>;
  matches: {
    player_id: string;
    source_row: number;
    attributes: Record<string, number>;
  }[];
};
const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
export async function readAttributeImport(
  directory = "supabase/.temp/attributes",
): Promise<AttributeImport> {
  const manifest = JSON.parse(
    await readFile(`${directory}/uploaded-attributes-manifest.json`, "utf8"),
  );
  const [header, ...rows] = (
    await readFile(`${directory}/uploaded-attributes.csv`, "utf8")
  )
    .trim()
    .split("\n")
    .map((r) => r.split(","));
  if (header[0] !== "player_id" || header[1] !== "source_row")
    throw Error("Invalid skill CSV header");
  return {
    ...manifest,
    matches: rows.map((row) => {
      if (row.length !== header.length) throw Error("Invalid skill CSV row");
      return {
        player_id: row[0],
        source_row: Number(row[1]),
        attributes: Object.fromEntries(
          header.slice(2).map((key, i) => [key, Number(row[i + 2])]),
        ),
      };
    }),
  };
}
export function validateAttributes(
  input: AttributeImport,
  reviewed: {
    sha256: string;
    matches: { player_id: string; source_row: number }[];
  },
) {
  if (
    input.sha256 !== reviewed.sha256 ||
    input.matched_players !== reviewed.matches.length ||
    input.matches.length !== input.matched_players
  )
    throw Error("Invalid attribute import metadata");
  const identities = new Map(
    reviewed.matches.map((m) => [m.player_id, m.source_row]),
  );
  const seen = new Set<string>();
  const keys = Object.values(input.mapping).sort();
  for (const m of input.matches) {
    if (
      seen.has(m.player_id) ||
      identities.get(m.player_id) !== m.source_row ||
      JSON.stringify(Object.keys(m.attributes).sort()) !==
        JSON.stringify(keys) ||
      Object.values(m.attributes).some(
        (v) => !Number.isInteger(v) || v < 0 || v > 99,
      )
    )
      throw Error("Invalid skill or identity match");
    seen.add(m.player_id);
  }
}
export function attributeImportSql(input: AttributeImport) {
  const key = quote(input.import_id);
  const setup = `insert into public.attribute_imports(id,sha256,expected_count) values(${key},${quote(input.sha256)},${input.matched_players}) on conflict(id) do nothing;`;
  const batches = [];
  for (let i = 0; i < input.matches.length; i += 75)
    batches.push(
      `insert into public.attribute_import_rows(import_id,player_id,source_row,attributes) select ${key},player_id,source_row,attributes from jsonb_to_recordset(${quote(JSON.stringify(input.matches.slice(i, i + 75)))}::jsonb) as x(player_id uuid,source_row int,attributes jsonb) on conflict(import_id,player_id) do nothing;`,
    );
  const activate = `begin;do $$ declare k text:=${key};n int;expected int;begin
 select expected_count into expected from public.attribute_imports where id=k and applied_at is null for update;
 if not found then return;end if;
 select count(*) into n from public.attribute_import_rows where import_id=k;
 if n<>expected then raise exception 'Incomplete attribute import';end if;
 if exists(select 1 from public.attribute_import_rows r join public.overall_import_rows o on o.player_id=r.player_id and o.source_row=r.source_row join public.overall_imports i on i.id=o.import_id where r.import_id=k and i.sha256=${quote(input.sha256)} having count(*)<>expected) then raise exception 'Attribute identity mismatch';end if;
 perform 1 from public.leagues l where exists(select 1 from public.league_players p join public.attribute_import_rows r on r.player_id=p.player_id where r.import_id=k and p.league_id=l.id) order by l.id for update;
 update public.players p set attributes=r.attributes,attributes_source=k,attributes_source_row=r.source_row from public.attribute_import_rows r where r.import_id=k and p.id=r.player_id;
 update public.league_players p set profile=p.profile||jsonb_build_object('attributes',r.attributes,'attributes_source',k,'attributes_source_row',r.source_row) from public.attribute_import_rows r where r.import_id=k and p.player_id=r.player_id;
 -- Initialize missing game traits once, independently from worksheet skill provenance.
 update public.players set development=public.initial_game_development(id,overall,age),development_source='ff-game-assigned-v1' where dataset='nflverse-2026-original-v1' and development='Unrevealed';
 update public.league_players set profile=profile||jsonb_build_object('development',public.initial_game_development(player_id,(profile->>'overall')::int,(profile->>'age')::int),'development_source','ff-game-assigned-v1') where profile->>'dataset'='nflverse-2026-original-v1' and profile->>'development'='Unrevealed';
 update public.leagues l set revision=revision+1 where exists(select 1 from public.league_players p where p.league_id=l.id and p.profile->>'dataset'='nflverse-2026-original-v1');
 update public.player_datasets set metadata=metadata||jsonb_build_object('attribute_import',k,'attributes','uploaded worksheet where matched'),label='NFL roster · uploaded ratings' where id='nflverse-2026-original-v1';
 update public.attribute_imports set applied_at=now() where id=k;
 end $$;commit;`;
  return { setup, batches, activate };
}
async function main() {
  const input = await readAttributeImport();
  validateAttributes(
    input,
    JSON.parse(await readFile("data/uploaded-overalls.json", "utf8")),
  );
  const out = attributeImportSql(input);
  await mkdir("supabase/.temp/attributes", { recursive: true });
  await writeFile("supabase/.temp/attributes/setup.sql", out.setup);
  for (const [i, b] of out.batches.entries())
    await writeFile(`supabase/.temp/attributes/${i}.sql`, b);
  await writeFile("supabase/.temp/attributes/activate.sql", out.activate);
  console.log({ players: input.matched_players, batches: out.batches.length });
}
if (process.argv[1]?.endsWith("uploaded-attributes.ts")) void main();
