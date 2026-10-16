import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import {
  overallImportSql,
  validateOverallImport,
} from "../scripts/uploaded-overalls";
import { poolInsert } from "../scripts/pool-sql";
test("uploaded overall import updates existing/new leagues only, preserves attributes/picks/contracts and is atomic/idempotent", async () => {
  const pool = JSON.parse(await readFile("data/nfl-2026-pool.json", "utf8")),
    input = JSON.parse(await readFile("data/uploaded-overalls.json", "utf8"));
  validateOverallImport(input, pool);
  assert.throws(
    () =>
      validateOverallImport(
        { ...input, matches: [...input.matches.slice(1), input.matches[1]] },
        pool,
      ),
    /duplicate/,
  );
  assert.throws(
    () =>
      validateOverallImport(
        {
          ...input,
          matches: input.matches.map((r: any, i: number) =>
            i ? r : { ...r, overall: 100 },
          ),
        },
        pool,
      ),
    /Invalid/,
  );
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;insert into auth.users values('10000000-0000-0000-0000-000000000001');select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);",
    );
    for (const name of [
      "001_franchise.sql",
      "20261015214620_mobile_draft_pacing.sql",
      "20261015215105_player_dataset_catalog.sql",
      "20261016022903_franchise_management.sql",
      "20261016034537_uploaded_overall_ratings.sql",
    ])
      await db.exec(await readFile("supabase/migrations/" + name, "utf8"));
    const q = async (sql: string, args: unknown[] = []) =>
      (await db.query<any>(sql, args)).rows;
    const fictional = (
      await q("select create_league('Fictional unchanged','BAL') id")
    )[0].id;
    for (let i = 0; i < pool.length; i += 100)
      await db.exec(poolInsert(pool.slice(i, i + 100)));
    await db.exec(
      "insert into player_datasets(id,label,source_url,license,rating_source) values('nflverse-2026-original-v1','Test NFL','nflverse','CC BY 4.0','original');update player_datasets set is_default=false;update player_datasets set is_default=true where id='nflverse-2026-original-v1';",
    );
    const lid = (
      await q("select create_league('Existing NFL league','BAL') id")
    )[0].id;
    const josh = pool.find(
      (p: any) => p.name === "Josh Allen" && p.position === "QB",
    );
    await q(
      "update leagues set draft_order=array['BAL']||(select array_agg(id order by id) from franchises where id<>'BAL') where id=$1",
      [lid],
    );
    await q("select draft_control($1,'start')", [lid]);
    const before = (await q("select * from leagues where id=$1", [lid]))[0];
    await q("select submit_pick($1,$2,0,$3)", [lid, josh.id, before.revision]);
    const old = (
      await q(
        "select profile from league_players where league_id=$1 and player_id=$2",
        [lid, josh.id],
      )
    )[0].profile;
    const statements = overallImportSql(input);
    await db.exec(statements.setup);
    await db.exec(statements.batches[0]);
    await assert.rejects(db.exec(statements.activate), /Incomplete import/);
    await db.exec("rollback");
    assert.equal(
      (await q("select overall from players where id=$1", [josh.id]))[0]
        .overall,
      josh.overall,
    );
    for (const b of statements.batches.slice(1)) await db.exec(b);
    await db.exec(statements.activate);
    const updated = (
      await q(
        "select profile,franchise_id from league_players where league_id=$1 and player_id=$2",
        [lid, josh.id],
      )
    )[0];
    assert.equal(updated.profile.overall, 99);
    assert.equal(updated.franchise_id, "BAL");
    assert.deepEqual(updated.profile.attributes, old.attributes);
    assert.deepEqual(updated.profile.stats, old.stats);
    assert.equal(
      (
        await q("select count(*)::int n from draft_picks where league_id=$1", [
          lid,
        ])
      )[0].n,
      1,
    );
    assert.equal(
      (
        await q(
          "select annual_salary from player_contracts where league_id=$1 and player_id=$2",
          [lid, josh.id],
        )
      )[0].annual_salary,
      30000000,
    );
    const revision = (
      await q("select revision from leagues where id=$1", [lid])
    )[0].revision;
    await db.exec(statements.activate);
    assert.equal(
      (await q("select revision from leagues where id=$1", [lid]))[0].revision,
      revision,
    );
    assert.equal(
      (await q("select state from leagues where id=$1", [lid]))[0].state,
      "running",
    );
    assert.equal(
      (
        await q(
          "select count(*)::int n from league_players where league_id=$1 and profile->>'overall_source' is not null",
          [fictional],
        )
      )[0].n,
      0,
    );
    const fresh = (
      await q("select create_league('New NFL league','BAL') id")
    )[0].id;
    assert.equal(
      (
        await q(
          "select profile from league_players where league_id=$1 and player_id=$2",
          [fresh, josh.id],
        )
      )[0].profile.overall,
      99,
    );
    const matched = (
      await q(
        "select count(*)::int n from league_players where league_id=$1 and profile->>'overall_source'=$2",
        [fresh, input.import_id],
      )
    )[0].n;
    assert.equal(matched, input.matched_players);
    for (const r of input.matches) {
      const source = pool.find((p: any) => p.id === r.player_id);
      assert.ok(source);
      assert.equal(typeof r.overall, "number");
    }
  } finally {
    await db.close();
  }
});
