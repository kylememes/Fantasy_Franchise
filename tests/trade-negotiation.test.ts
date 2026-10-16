import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { playerTradeValue } from "../src/lib/trades";

test("trade negotiation: authoritative interest, salary rules, atomic counters, read isolation, and legacy settlement", async () => {
  const db = new PGlite();
  const owner = "10000000-0000-0000-0000-000000000001",
    friend = "10000000-0000-0000-0000-000000000002",
    outsider = "10000000-0000-0000-0000-000000000003";
  const q = async (s: string, a: unknown[] = []) =>
    (await db.query<any>(s, a)).rows;
  const actor = async (id: string) => {
    await db.exec("reset role");
    await q("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated");
  };
  const admin = async (s: string, a: unknown[] = []) => {
    await db.exec("reset role");
    const r = await q(s, a);
    await db.exec("set role authenticated");
    return r;
  };
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;insert into auth.users values('${owner}'),('${friend}'),('${outsider}');select set_config('request.jwt.claim.sub','${owner}',false);`,
    );
    for (const name of [
      "001_franchise.sql",
      "20261015214620_mobile_draft_pacing.sql",
      "20261015215105_player_dataset_catalog.sql",
      "20261016022903_franchise_management.sql",
      "20261016034537_uploaded_overall_ratings.sql",
      "20261016112856_lineup_free_agency.sql",
      "20261016132251_season_game_center.sql",
      "20261016181045_head_coach_bonuses.sql",
      "20261016215749_trade_negotiation.sql",
    ])
      await db.exec(await readFile("supabase/migrations/" + name, "utf8"));
    const lid = (
      await q("select create_league('Trade negotiation','BAL') id")
    )[0].id;
    await q("insert into memberships values($1,$2,'KC')", [lid, friend]);
    await q(
      `with ranked as(select player_id,lim.maximum,row_number() over(partition by profile->>'position' order by player_id) rn from league_players p join position_limits lim on lim.position=p.profile->>'position' where league_id=$1) update league_players p set franchise_id=case when r.rn<=r.maximum then 'BAL' when r.rn<=r.maximum*2 then 'KC' else 'ARI' end from ranked r where p.league_id=$1 and p.player_id=r.player_id and r.rn<=r.maximum*3`,
      [lid],
    );
    await q(
      "insert into player_contracts(league_id,player_id,annual_salary,years,start_season,draft_round) select league_id,player_id,1000000,2,1,20 from league_players where league_id=$1 and franchise_id is not null",
      [lid],
    );
    await q("update leagues set state='completed' where id=$1", [lid]);
    const qb = async (t: string) =>
      await q(
        "select player_id id,profile from league_players where league_id=$1 and franchise_id=$2 and profile->>'position'='QB' order by player_id",
        [lid, t],
      );
    const a = await qb("BAL"),
      b = await qb("ARI"),
      c = await qb("KC");
    for (const [id, ovr, age, dev] of [
      [a[0].id, 50, 35, "Normal"],
      [a[1].id, 99, 22, "Franchise Superstar"],
      [a[2].id, 80, 26, "Star"],
      [b[0].id, 60, 30, "Normal"],
      [b[1].id, 99, 22, "Franchise Superstar"],
    ])
      await q(
        "update league_players set profile=profile||jsonb_build_object('overall',$3::int,'age',$4::int,'development',$5::text) where league_id=$1 and player_id=$2",
        [lid, id, ovr, age, dev],
      );
    const params = (target: string, give: string[], take: string[]) => [
      lid,
      target,
      give,
      take,
      [],
      [],
    ];
    const preview = async (target: string, give: string[], take: string[]) =>
      (
        await q(
          "select trade_preview($1,$2,$3::uuid[],$4::uuid[],$5::uuid[],$6::uuid[]) e",
          params(target, give, take),
        )
      )[0].e;
    const offer = async (target: string, give: string[], take: string[]) =>
      (
        await q(
          "select propose_trade($1,$2,$3::uuid[],$4::uuid[],$5::uuid[],$6::uuid[]) id",
          params(target, give, take),
        )
      )[0].id;
    const counter = async (tid: string, give: string[], take: string[]) =>
      (
        await q("select counter_trade($1,$2::uuid[],$3::uuid[],'{}','{}') id", [
          tid,
          give,
          take,
        ])
      )[0].id;
    const respond = async (tid: string, decision: string) =>
      (await q("select respond_trade($1,$2) s", [tid, decision]))[0].s;
    const snap = async () =>
      (await q("select management_snapshot($1) s", [lid]))[0].s;
    const row = async (tid: string) =>
      (await q("select * from trade_offers where id=$1", [tid]))[0];
    await actor(owner);
    const weak = await preview("ARI", [a[0].id], [b[1].id]);
    assert.equal(weak.is_cpu, true);
    assert.equal(weak.valid, true);
    assert.equal(weak.cpu_accepts, false);
    assert.ok(weak.interest <= 45);
    assert.ok(weak.feedback.some((s: string) => s.includes("centerpiece")));
    assert.equal(
      (await q("select count(*)::int n from trade_offers"))[0].n,
      0,
      "previews never create offers",
    );
    const rejected = await offer("ARI", [a[0].id], [b[1].id]);
    assert.equal((await row(rejected)).status, "rejected");
    assert.deepEqual((await row(rejected)).evaluation, weak);
    const strong = await preview("ARI", [a[1].id], [b[0].id]);
    assert.equal(strong.cpu_accepts, true);
    assert.ok(strong.interest >= 75);
    const accepted = await offer("ARI", [a[1].id], [b[0].id]);
    assert.equal((await row(accepted)).status, "accepted");
    assert.equal(
      (
        await q(
          "select franchise_id from league_players where league_id=$1 and player_id=$2",
          [lid, a[1].id],
        )
      )[0].franchise_id,
      "ARI",
    );
    assert.equal(
      (
        await q(
          "select annual_salary from player_contracts where league_id=$1 and player_id=$2",
          [lid, a[1].id],
        )
      )[0].annual_salary,
      1000000,
    );
    const human = await offer("KC", [a[2].id], [c[0].id]);
    assert.equal((await row(human)).status, "pending");
    await actor(friend);
    let s = await snap();
    assert.ok(s.unread_trade_ids.includes(human));
    assert.deepEqual(s.human_teams, ["BAL", "KC"]);
    assert.ok("head_coach" in s, "snapshot keeps coach information");
    const h = await preview("BAL", [c[1].id], [a[2].id]);
    assert.equal(h.is_cpu, false);
    assert.equal(h.interest, null);
    await q("select mark_trade_read($1)", [human]);
    assert.equal((await snap()).unread_trade_ids.length, 0);
    const child = await counter(human, [c[1].id], [a[2].id]);
    assert.equal((await row(human)).status, "countered");
    assert.equal((await row(child)).counter_of, human);
    assert.equal((await row(child)).thread_id, human);
    await assert.rejects(
      counter(human, [c[1].id], [a[2].id]),
      /already been resolved/,
    );
    await actor(outsider);
    await assert.rejects(preview("BAL", [c[1].id], [a[2].id]), /access denied/);
    await assert.rejects(counter(child, [a[2].id], [c[1].id]), /access denied/);
    await assert.rejects(
      q("select mark_trade_read($1)", [child]),
      /access denied/,
    );
    assert.equal((await q("select * from trade_reads")).length, 0);
    await actor(owner);
    assert.ok((await snap()).unread_trade_ids.includes(child));
    await assert.rejects(respond(human, "accept"), /Unauthorized/);
    await actor(friend);
    assert.equal(
      await respond(human, "accept"),
      "countered",
      "superseded offer cannot settle",
    );
    await actor(owner);
    assert.equal(await respond(child, "accept"), "accepted");
    assert.equal(await respond(child, "accept"), "accepted");
    assert.ok(
      (await snap()).depth.orders.QB.includes(c[1].id),
      "trade repairs saved depth order",
    );
    const pending = await offer("KC", [a[0].id], [c[0].id]);
    await actor(friend);
    await assert.rejects(
      counter(pending, [b[1].id], [a[0].id]),
      /currently owned/,
    );
    assert.equal(
      (await row(pending)).status,
      "pending",
      "failed counter preserves original offer",
    );
    await actor(owner);
    await admin("update leagues set salary_cap=1 where id=$1", [lid]);
    const cap = await preview("ARI", [a[0].id], [b[1].id]);
    assert.equal(cap.valid, false);
    assert.equal(cap.interest, 0);
    assert.ok(cap.problems.some((p: string) => p.includes("salary cap")));
    await assert.rejects(offer("ARI", [a[0].id], [b[1].id]), /salary cap/);
    await admin("update leagues set salary_cap=275000000 where id=$1", [lid]);
    const kicker = (
      await q(
        "select player_id id from league_players where league_id=$1 and franchise_id='BAL' and profile->>'position'='K'",
        [lid],
      )
    )[0].id;
    const picks = (await snap()).picks;
    const pick = picks.find((p: any) => p.franchise_id === "ARI");
    const invalid = (
      await q(
        "select trade_preview($1,'ARI',$2::uuid[],'{}','{}',$3::uuid[]) e",
        [lid, [kicker], [pick.id]],
      )
    )[0].e;
    assert.equal(invalid.valid, false);
    assert.ok(
      invalid.problems.some((p: string) => p.includes("eligible players")),
    );
    for (const trait of [
      "Normal",
      "Star",
      "Superstar",
      "Franchise Superstar",
    ]) {
      const profile = {
        ...a[0].profile,
        overall: 85,
        age: 25,
        development: trait,
      };
      const sql = (
        await admin("select player_trade_value($1::jsonb,1000000,2)::float v", [
          JSON.stringify(profile),
        ])
      )[0].v;
      const js = playerTradeValue(
        profile,
        {
          player_id: a[0].id,
          annual_salary: 1000000,
          years: 2,
          start_season: 1,
          draft_round: 20,
        },
        1,
      );
      assert.ok(Math.abs(sql - js) < 0.000001);
    }
    await admin(
      "update league_players set franchise_id='ARI' where league_id=$1 and player_id=$2",
      [lid, a[0].id],
    );
    await actor(friend);
    assert.equal(await respond(pending, "accept"), "expired");
    await assert.rejects(
      q("select evaluate_trade_internal($1,'KC','BAL','{}','{}','{}','{}')", [
        lid,
      ]),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
