import { readFile, mkdir, writeFile } from "node:fs/promises";
import { limits } from "../src/lib/types";
import type { Player } from "../src/lib/types";
export function validatePool(players: (Player & { external_id: string })[]) {
  const ids = new Set<string>();
  for (const p of players) {
    if (
      !p.id ||
      !p.external_id ||
      ids.has(p.id) ||
      !limits[p.position] ||
      !p.source ||
      !p.rating_source
    )
      throw new Error("Invalid player identity, position or provenance");
    ids.add(p.id);
    for (const value of [p.overall, ...Object.values(p.attributes)])
      if (!Number.isInteger(value) || value < 0 || value > 99)
        throw new Error("Ratings must be integers from 0 to 99");
  }
  for (const [pos, max] of Object.entries(limits))
    if (players.filter((p) => p.position === pos).length < 32 * max)
      throw new Error(`Insufficient ${pos} coverage`);
}
const literal = (value: unknown) =>
  "'" + JSON.stringify(value).replaceAll("'", "''") + "'::jsonb";
export function poolInsert(players: Player[]) {
  return `insert into public.players(id,name,display_name,position,age,jersey,overall,attributes,salary,height_inches,weight_lbs,development,source,dataset,history,external_id,nfl_team,rating_source,is_fictional,stats)
select id,name||' · '||external_id,name,position,age,jersey,overall,attributes,salary,height_inches,weight_lbs,development,source,dataset,history,external_id,nfl_team,rating_source,is_fictional,stats
from jsonb_to_recordset(${literal(players)}) as x(id uuid,name text,position text,age int,jersey int,overall int,attributes jsonb,salary int,height_inches int,weight_lbs int,development text,source text,dataset text,history text,external_id text,nfl_team text,rating_source text,is_fictional boolean,stats jsonb)
on conflict (id) do nothing;`;
}
async function main() {
  const players = JSON.parse(await readFile("data/nfl-2026-pool.json", "utf8"));
  validatePool(players);
  await mkdir("supabase/.temp/pool", { recursive: true });
  for (let n = 0; n < players.length; n += 100)
    await writeFile(
      `supabase/.temp/pool/${n / 100}.sql`,
      poolInsert(players.slice(n, n + 100)),
    );
  console.log(
    `Validated ${players.length} players; generated ${Math.ceil(players.length / 100)} import batches.`,
  );
}

if (process.argv[1]?.endsWith("pool-sql.ts")) void main();
