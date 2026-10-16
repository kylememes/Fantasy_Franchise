import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
test("depth order persists, checks ownership/version/eligibility and repairs after atomic sign/release/trade", async () => {
  const db = new PGlite();
  const user = "10000000-0000-0000-0000-000000000001",
    friend = "10000000-0000-0000-0000-000000000002";
  const q = async (s: string, a: unknown[] = []) =>
    (await db.query<any>(s, a)).rows;
  try {
    await db.exec(
      `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated;insert into auth.users values('${user}'),('${friend}');select set_config('request.jwt.claim.sub','${user}',false);`,
    );
    for (const n of [
      "001_franchise.sql",
      "20261015214620_mobile_draft_pacing.sql",
      "20261015215105_player_dataset_catalog.sql",
      "20261016022903_franchise_management.sql",
      "20261016034537_uploaded_overall_ratings.sql",
      "20261016112856_lineup_free_agency.sql",
    ])
      await db.exec(await readFile("supabase/migrations/" + n, "utf8"));
    const lid = (await q("select create_league('Lineup test','BAL') id"))[0].id;
    await q("insert into memberships values($1,$2,'KC')", [lid, friend]);
    await q(
      `with ranked as(select player_id,lim.maximum,row_number() over(partition by profile->>'position' order by player_id) rn from league_players p join position_limits lim on lim.position=p.profile->>'position' where league_id=$1) update league_players p set franchise_id=case when r.rn<=r.maximum then 'BAL' else 'KC' end from ranked r where p.league_id=$1 and p.player_id=r.player_id and r.rn<=r.maximum*2`,
      [lid],
    );
    await q(
      "insert into player_contracts(league_id,player_id,annual_salary,years,start_season,draft_round) select league_id,player_id,1000000,2,1,20 from league_players where league_id=$1 and franchise_id is not null",
      [lid],
    );
    await db.exec("set role authenticated");
    const snap = async () =>
      (await q("select management_snapshot($1) s", [lid]))[0].s;
    let s = await snap();
    assert.equal(s.depth.orders.QB.length, 3);
    assert.equal(s.depth.orders.EDGE.length, 6);
    const order = [...s.depth.orders.QB].reverse();
    await q("select save_depth_order($1,'QB',$2::uuid[],0)", [lid, order]);
    s = await snap();
    assert.deepEqual(s.depth.orders.QB, order);
    assert.equal(s.depth.version, 1);
    await assert.rejects(
      q("select save_depth_order($1,'QB',$2::uuid[],0)", [lid, order]),
      /another session/,
    );
    await assert.rejects(
      q("select save_depth_order($1,'QB',$2::uuid[],1)", [
        lid,
        [order[0], order[0], order[2]],
      ]),
      /every eligible/,
    );
    await assert.rejects(
      q("select save_depth_order($1,'QB',$2::uuid[],1)", [
        lid,
        s.depth.orders.WR.slice(0, 3),
      ]),
      /every eligible/,
    );
    await db.exec("reset role");
    const faRow = (
      await q(
        "select player_id,free_agent_salary($1,player_id) annual_salary from league_players where league_id=$1 and franchise_id is null and profile->>'position'='WR' limit 1",
        [lid],
      )
    )[0];
    await db.exec("set role authenticated");
    const fa = faRow;
    await assert.rejects(
      q("select sign_free_agent($1,$2,$3)", [
        lid,
        fa.player_id,
        fa.annual_salary,
      ]),
      /after draft/,
    );
    await db.exec("reset role");
    await q("update leagues set state='completed' where id=$1", [lid]);
    await db.exec("set role authenticated");
    await assert.rejects(
      q("select sign_free_agent($1,$2,1)", [lid, fa.player_id]),
      /Asking price/,
    );
    await q("select sign_free_agent($1,$2,$3)", [
      lid,
      fa.player_id,
      fa.annual_salary,
    ]);
    await assert.rejects(
      q("select sign_free_agent($1,$2,$3)", [
        lid,
        fa.player_id,
        fa.annual_salary,
      ]),
      /no longer/,
    );
    s = await snap();
    assert.ok(s.ownership.some((p: any) => p.player_id === fa.player_id));
    assert.equal(
      s.contracts.find((c: any) => c.player_id === fa.player_id).origin,
      "free_agency",
    );
    const oldVersion = s.depth.version;
    await q("select release_player($1,$2,1000000)", [lid, order[0]]);
    s = await snap();
    assert.deepEqual(s.depth.orders.QB, order.slice(1));
    assert.ok(s.depth.version > oldVersion);
    assert.ok(!s.contracts.some((c: any) => c.player_id === order[0]));
    await assert.rejects(
      q("select release_player($1,$2,1000000)", [lid, order[0]]),
      /not on your roster/,
    );
    const k = s.depth.orders.K[0];
    await assert.rejects(
      q("select release_player($1,$2,1000000)", [lid, k]),
      /position/,
    );
    // Two-human trade replaces a selected quarterback without retaining stale lineup IDs.
    await db.exec("reset role");
    const awayQB = (
      await q(
        "select player_id from league_players where league_id=$1 and franchise_id='KC' and profile->>'position'='QB' limit 1",
        [lid],
      )
    )[0].player_id;
    await db.exec("set role authenticated");
    const tid = (
      await q("select propose_trade($1,'KC',$2::uuid[],$3::uuid[]) id", [
        lid,
        [order[1]],
        [awayQB],
      ])
    )[0].id;
    await q("select set_config('request.jwt.claim.sub',$1,false)", [friend]);
    await q("select respond_trade($1,'accept')", [tid]);
    await q("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    s = await snap();
    assert.ok(s.depth.orders.QB.includes(awayQB));
    assert.ok(!s.depth.orders.QB.includes(order[1]));
    // Unauthorized reads and direct writes denied by RLS/grants.
    await assert.rejects(
      q("update depth_charts set orders='{}' where league_id=$1", [lid]),
      /permission denied/,
    );
    await db.exec("reset role");
    await q("select set_config('request.jwt.claim.sub','',false)");
    await db.exec("set role authenticated");
    await assert.rejects(snap(), /access denied/);
    await db.exec("reset role");
    await q("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    const free = (
      await q(
        "select player_id,free_agent_salary($1,player_id) price from league_players where league_id=$1 and franchise_id is null limit 1",
        [lid],
      )
    )[0];
    await q("update leagues set salary_cap=1 where id=$1", [lid]);
    await db.exec("set role authenticated");
    await assert.rejects(
      q("select sign_free_agent($1,$2,$3)", [lid, free.player_id, free.price]),
      /salary cap/,
    );
    await db.exec("reset role");
    await q("update leagues set salary_cap=275000000 where id=$1", [lid]);
    // Fill to maximum without touching draft history; enforce maximum atomically.
    await q(
      "with extra as(select player_id from league_players where league_id=$1 and franchise_id is null limit (60-(select count(*)::int from league_players where league_id=$1 and franchise_id='BAL'))) update league_players set franchise_id='BAL' where league_id=$1 and player_id in(select player_id from extra)",
      [lid],
    );
    const last = (
      await q(
        "select player_id,free_agent_salary($1,player_id) price from league_players where league_id=$1 and franchise_id is null limit 1",
        [lid],
      )
    )[0];
    await db.exec("set role authenticated");
    await assert.rejects(
      q("select sign_free_agent($1,$2,$3)", [lid, last.player_id, last.price]),
      /maximum/,
    );
  } finally {
    await db.close();
  }
});
