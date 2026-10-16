import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
let db: PGlite, lid: string;
const owner = "10000000-0000-0000-0000-000000000001",
  friend = "10000000-0000-0000-0000-000000000002",
  outsider = "10000000-0000-0000-0000-000000000003";
const q = async (sql: string, args: unknown[] = []) =>
  (await db.query<any>(sql, args)).rows;
async function identity(id: string) {
  await db.exec("reset role");
  await q("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
async function admin(sql: string, args: unknown[] = []) {
  await db.exec("reset role");
  const r = await q(sql, args);
  await db.exec("set role authenticated");
  return r;
}
async function control(action: string) {
  await q("select draft_control($1,$2)", [lid, action]);
}
async function state() {
  return (await q("select * from leagues where id=$1", [lid]))[0];
}
async function players(team: string) {
  return q(
    "select p.player_id,profile,c.* from league_players p join player_contracts c using(league_id,player_id) where p.league_id=$1 and franchise_id=$2 and profile->>'position'='QB' order by player_trade_value(profile,c.annual_salary,c.years)",
    [lid, team],
  );
}
async function roster(team: string) {
  return q(
    "select player_id,profile from league_players where league_id=$1 and franchise_id=$2 and profile->>'position'='QB' order by (profile->>'overall')::int",
    [lid, team],
  );
}
async function offer(
  team: string,
  give: string[],
  take: string[],
  gp: string[] = [],
  tp: string[] = [],
) {
  return (
    await q(
      "select propose_trade($1,$2,$3::uuid[],$4::uuid[],$5::uuid[],$6::uuid[]) id",
      [lid, team, give, take, gp, tp],
    )
  )[0].id;
}
async function respond(tid: string, decision: string) {
  return (await q("select respond_trade($1,$2) status", [tid, decision]))[0]
    .status;
}
before(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth,public to authenticated,anon;insert into auth.users values('${owner}'),('${friend}'),('${outsider}');`,
  );
  for (const name of [
    "001_franchise.sql",
    "20261015214620_mobile_draft_pacing.sql",
    "20261015215105_player_dataset_catalog.sql",
  ])
    await db.exec(await readFile("supabase/migrations/" + name, "utf8"));
  await identity(owner);
  lid = (await q("select create_league('Management verification','BAL') id"))[0]
    .id;
  const token = (
    await q("select token from league_invites where league_id=$1", [lid])
  )[0].token;
  await identity(friend);
  await q("select join_league($1,'KC')", [token]);
  await db.exec("reset role");
  await db.exec(
    await readFile(
      "supabase/migrations/20261016022903_franchise_management.sql",
      "utf8",
    ),
  );
  await identity(owner);
});
after(async () => {
  await db.close();
});
test("round contracts, full draft simulation across checkpoint, pause and authorization", async () => {
  const scale = await q("select * from draft_contract_scale order by round");
  assert.equal(scale.length, 53);
  assert.equal(scale[0].annual_salary, 30000000);
  assert.equal(scale[1].annual_salary, 20000000);
  assert.deepEqual(
    [
      scale[4].years,
      scale[5].years,
      scale[9].years,
      scale[10].years,
      scale[14].years,
      scale[15].years,
      scale[34].years,
      scale[35].years,
    ],
    [5, 4, 4, 3, 3, 2, 2, 1],
  );
  const payroll = scale.reduce((a, c) => a + c.annual_salary, 0);
  assert.ok(275000000 - payroll > 60000000);
  assert.ok(
    scale.every((s, i) => !i || s.annual_salary <= scale[i - 1].annual_salary),
  );
  await identity(friend);
  await assert.rejects(control("simulate_all"), /Commissioner/);
  await identity(owner);
  await control("simulate_all");
  assert.equal((await state()).state, "completing");
  await control("pause");
  assert.equal((await q("select cpu_tick($1)n", [lid]))[0].n, 0);
  await control("resume");
  assert.equal((await state()).state, "completing");
  let guard = 0;
  while ((await state()).state !== "completed") {
    await admin(
      "update leagues set next_cpu_pick_at=clock_timestamp()-interval '1 second' where id=$1",
      [lid],
    );
    const n = (await q("select cpu_tick($1)n", [lid]))[0].n;
    assert.ok(n > 0);
    assert.ok(++guard < 230);
  }
  assert.equal((await state()).next_pick, 1696);
  assert.equal(
    (
      await q(
        "select count(*)::int n from player_contracts where league_id=$1",
        [lid],
      )
    )[0].n,
    1696,
  );
  const salaries = await q(
    "select franchise_id,sum(annual_salary)::int payroll from league_players join player_contracts using(league_id,player_id) where league_id=$1 group by franchise_id",
    [lid],
  );
  assert.equal(salaries.length, 32);
  assert.ok(salaries.every((x) => x.payroll === payroll));
});
test("human trades need the other owner, settle once, expire stale offers and retain draft history", async () => {
  const a = await roster("BAL"),
    b = await roster("KC");
  const draft = (
    await q(
      "select franchise_id from draft_picks where league_id=$1 and player_id=$2",
      [lid, a[0].player_id],
    )
  )[0].franchise_id;
  const tid = await offer("KC", [a[0].player_id], [b[0].player_id]);
  const stale = await offer("KC", [a[0].player_id], [b[1].player_id]);
  assert.equal(
    (await q("select status from trade_offers where id=$1", [tid]))[0].status,
    "pending",
  );
  await assert.rejects(respond(tid, "accept"), /Unauthorized/);
  await identity(outsider);
  await assert.rejects(respond(tid, "accept"), /access denied/);
  assert.equal((await q("select * from trade_offers")).length, 0);
  await assert.rejects(
    q("select management_snapshot($1)", [lid]),
    /access denied/,
  );
  await identity(friend);
  assert.equal(await respond(tid, "accept"), "accepted");
  assert.equal(await respond(tid, "accept"), "accepted");
  assert.equal(await respond(stale, "accept"), "expired");
  assert.equal(
    (
      await q(
        "select franchise_id from league_players where league_id=$1 and player_id=$2",
        [lid, a[0].player_id],
      )
    )[0].franchise_id,
    "KC",
  );
  assert.equal(
    (
      await q(
        "select franchise_id from draft_picks where league_id=$1 and player_id=$2",
        [lid, a[0].player_id],
      )
    )[0].franchise_id,
    draft,
  );
  await identity(owner);
  await assert.rejects(
    offer("KC", [a[1].player_id, a[1].player_id], [b[2].player_id]),
    /Duplicate/,
  );
});
test("future picks transfer, cap and positional coverage validate at settlement", async () => {
  const snap = (await q("select management_snapshot($1)s", [lid]))[0].s;
  const gp = snap.picks.find(
      (p: any) => p.franchise_id === "BAL" && p.round === 1,
    ),
    tp = snap.picks.find((p: any) => p.franchise_id === "KC" && p.round === 2);
  const tid = await offer("KC", [], [], [gp.id], [tp.id]);
  await identity(friend);
  assert.equal(await respond(tid, "accept"), "accepted");
  assert.equal(
    (
      await q("select franchise_id from rookie_pick_rights where id=$1", [
        gp.id,
      ])
    )[0].franchise_id,
    "KC",
  );
  await identity(owner);
  const a = await roster("BAL"),
    b = await roster("KC");
  const cap = await offer("KC", [a[0].player_id], [b[0].player_id]);
  await admin("update leagues set salary_cap=1 where id=$1", [lid]);
  await identity(friend);
  await assert.rejects(respond(cap, "accept"), /salary cap/);
  assert.equal(
    (await q("select status from trade_offers where id=$1", [cap]))[0].status,
    "pending",
  );
  await admin("update leagues set salary_cap=275000000 where id=$1", [lid]);
  assert.equal(await respond(cap, "reject"), "rejected");
  await identity(owner);
  const k = (
    await q(
      "select player_id from league_players where league_id=$1 and franchise_id='BAL' and profile->>'position'='K'",
      [lid],
    )
  )[0].player_id;
  const invalid = await offer("KC", [k], [], [], [gp.id]);
  await identity(friend);
  await assert.rejects(respond(invalid, "accept"), /eligible player/);
  await respond(invalid, "reject");
});
test("CPU rejects weak compensation and accepts fair value, keeping contracts attached", async () => {
  await identity(owner);
  let a = await roster("BAL"),
    b = await roster("ARI");
  // Controlled test ratings make the fairness boundary unambiguous.
  await admin(
    "update league_players set profile=profile||jsonb_build_object('overall',case when player_id=$2 then 50 when player_id=$3 then 99 else 75 end) where league_id=$1 and player_id=any($4::uuid[])",
    [lid, a[0].player_id, b[2].player_id, [...a, ...b].map((x) => x.player_id)],
  );
  const bad = await offer("ARI", [a[0].player_id], [b[2].player_id]);
  assert.equal(
    (await q("select status from trade_offers where id=$1", [bad]))[0].status,
    "rejected",
  );
  await admin(
    "update league_players set profile=profile||jsonb_build_object('overall',case when player_id=$2 then 99 else 60 end,'age',25) where league_id=$1 and player_id=any($3::uuid[])",
    [lid, a[2].player_id, [a[2].player_id, b[0].player_id]],
  );
  const contract = (
    await q(
      "select annual_salary from player_contracts where league_id=$1 and player_id=$2",
      [lid, a[2].player_id],
    )
  )[0].annual_salary;
  const good = await offer("ARI", [a[2].player_id], [b[0].player_id]);
  assert.equal(
    (await q("select status from trade_offers where id=$1", [good]))[0].status,
    "accepted",
  );
  assert.equal(
    (
      await q(
        "select annual_salary from player_contracts where league_id=$1 and player_id=$2",
        [lid, a[2].player_id],
      )
    )[0].annual_salary,
    contract,
  );
});
test("coaching saves only owner settings, validates all sliders and rejects stale edits", async () => {
  const keys = [
    "run_pass",
    "tempo",
    "deep_pass",
    "short_pass",
    "play_action",
    "rpo",
    "fourth_down",
    "two_point",
    "red_zone",
    "blitz",
    "man_zone",
    "aggression",
    "run_defense",
    "pass_defense",
    "press",
    "prevent_big_plays",
  ];
  const settings = Object.fromEntries(keys.map((k) => [k, 50]));
  const save = (s: any, v: number) =>
    q("select save_coaching($1,'Spread','Multiple',$2::jsonb,$3)v", [
      lid,
      JSON.stringify(s),
      v,
    ]);
  assert.equal((await save(settings, 0))[0].v, 1);
  await assert.rejects(save(settings, 0), /another session/);
  await assert.rejects(
    save({ ...settings, blitz: 101 }, 1),
    /Invalid tendency/,
  );
  await assert.rejects(save({ ...settings, extra: 4 }, 1), /16 coaching/);
  assert.equal((await save({ ...settings, blitz: 65 }, 1))[0].v, 2);
  await identity(friend);
  assert.equal(
    (await q("select * from coaching_settings where franchise_id='BAL'"))
      .length,
    0,
  );
  await identity(outsider);
  await assert.rejects(save(settings, 0), /access denied/);
  await identity(owner);
  await assert.rejects(
    q("update player_contracts set annual_salary=1"),
    /permission denied/,
  );
  await assert.rejects(
    q("select settle_trade(gen_random_uuid())"),
    /permission denied/,
  );
});
