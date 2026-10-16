import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
test("CPU premium priorities preserve roster needs, specialist-last completion, pacing and pause", async () => {
  const db = new PGlite();
  const q = async (s: string, a: unknown[] = []) =>
    (await db.query<any>(s, a)).rows;
  try {
    await db.exec(
      "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;insert into auth.users values('10000000-0000-0000-0000-000000000001');select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);",
    );
    for (const n of [
      "001_franchise.sql",
      "20261015214620_mobile_draft_pacing.sql",
      "20261015215105_player_dataset_catalog.sql",
      "20261016022903_franchise_management.sql",
      "20261016120721_premium_position_drafting.sql",
    ])
      await db.exec(await readFile("supabase/migrations/" + n, "utf8"));
    const score = async (
      position: string,
      overall = 90,
      owned = 0,
      rush = 0,
      salary = 1,
    ) =>
      (
        await q(
          "select cpu_draft_score($1::jsonb,$2,$3,$4,1,200,3)::float8 s",
          [
            JSON.stringify({
              position,
              overall,
              age: 25,
              attributes: {},
              salary,
              development: "Normal",
            }),
            owned,
            position === "WR" || position === "CB" ? 3 : 1,
            rush,
          ],
        )
      )[0].s;
    const ordinary = await score("RB");
    for (const pos of ["QB", "DE", "EDGE", "WR", "CB"])
      assert.ok(
        (await score(pos)) > ordinary,
        pos + " receives premium starting-role value",
      );
    assert.ok(
      (await score("QB", 95, 1)) < (await score("LT", 85)),
      "Do not take backup QB over a needed lineman",
    );
    assert.ok(
      (await score("LT", 99)) > (await score("CB", 70)),
      "Elite non-premium players can outweigh poor premium players",
    );
    assert.equal(
      await score("QB", 90, 0, 0, 1),
      await score("QB", 90, 0, 0, 100000000),
      "Round-based fantasy pay ignores seed salaries",
    );
    assert.ok(
      (await score("DE", 90, 0, 2)) < (await score("DE", 90, 0, 0)),
      "EDGE and DE share early starter need",
    );
    const lid = (
      await q("select create_league('Premium draft fixture','BAL') id")
    )[0].id;
    await q(
      "update leagues set draft_order=array['BAL']||(select array_agg(id order by id) from franchises where id<>'BAL') where id=$1",
      [lid],
    );
    await q("select draft_control($1,'start')", [lid]);
    await q(
      "update leagues set next_cpu_pick_at=now()-interval '1 second' where id=$1",
      [lid],
    );
    assert.equal(
      (await q("select cpu_tick_internal($1,8) n", [lid]))[0].n,
      0,
      "Normal human picks never auto-select",
    );
    await q("select draft_control($1,'simulate_all')", [lid]);
    await q("select draft_control($1,'pause')", [lid]);
    assert.equal((await q("select cpu_tick_internal($1,8) n", [lid]))[0].n, 0);
    await q("select draft_control($1,'resume')", [lid]);
    assert.equal(
      (await q("select cpu_tick_internal($1,8) n", [lid]))[0].n,
      0,
      "Persisted gate survives resume",
    );
    for (let i = 0; i < 220; i++) {
      await q(
        "update leagues set next_cpu_pick_at=clock_timestamp()-interval '1 second' where id=$1",
        [lid],
      );
      await q("select cpu_tick_internal($1,8)", [lid]);
      if (
        (await q("select state from leagues where id=$1", [lid]))[0].state ===
        "completed"
      )
        break;
    }
    assert.equal(
      (await q("select state from leagues where id=$1", [lid]))[0].state,
      "completed",
    );
    const result = (
      await q(
        "select count(*)::int n,count(distinct player_id)::int unique_players,min(pick/32+1) filter(where p.profile->>'position' in('K','P')) first_specialist from draft_picks d join league_players p using(league_id,player_id) where d.league_id=$1",
        [lid],
      )
    )[0];
    assert.equal(result.n, 1696);
    assert.equal(result.unique_players, 1696);
    assert.equal(result.first_specialist, 52);
    const early = (
      await q(
        "select count(*)::int n from draft_picks d join league_players p using(league_id,player_id) where d.league_id=$1 and pick<160 and p.profile->>'position' in('QB','EDGE','DE','WR','CB')",
        [lid],
      )
    )[0].n;
    assert.ok(
      early >= 112,
      `${early}/160 early picks should favor premium roles`,
    );
    assert.equal(
      (
        await q(
          "select count(*)::int n from(select d.franchise_id,count(*) from draft_picks d join league_players p using(league_id,player_id) where d.league_id=$1 and pick<480 and p.profile->>'position'='QB' group by d.franchise_id having count(*)>1)x",
          [lid],
        )
      )[0].n,
      0,
      "No early backup QB hoarding",
    );
    assert.equal(
      (
        await q(
          "select count(*)::int n from(select franchise_id,count(*) n from league_players where league_id=$1 and franchise_id is not null group by franchise_id having count(*)=53)x",
          [lid],
        )
      )[0].n,
      32,
    );
    assert.equal(
      (
        await q(
          "select count(*)::int n from(select p.franchise_id,lim.position,lim.maximum,count(*) n from league_players p join position_limits lim on lim.position=p.profile->>'position' where p.league_id=$1 and p.franchise_id is not null group by p.franchise_id,lim.position,lim.maximum having count(*)<>lim.maximum)x",
          [lid],
        )
      )[0].n,
      0,
    );
    await db.exec("set role authenticated");
    await assert.rejects(
      q("select cpu_draft_score('{}',0,1,0,1,1,1)"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
