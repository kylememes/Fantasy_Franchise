import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { poolInsert, validatePool } from "../scripts/pool-sql";
import { limits, onClock } from "../src/lib/types";
let db: PGlite, dir: string, lid: string, invite: string;
const owner = "00000000-0000-0000-0000-000000000001",
  friend = "00000000-0000-0000-0000-000000000002",
  outsider = "00000000-0000-0000-0000-000000000003";
async function q<T = Record<string, unknown>>(
  sql: string,
  args: unknown[] = [],
) {
  return (await db.query<T>(sql, args)).rows;
}
async function identity(id: string) {
  await db.exec("reset role");
  await q("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
async function admin() {
  await db.exec("reset role");
}
async function state() {
  return (await q<any>("select * from leagues where id=$1", [lid]))[0];
}
async function snap() {
  return (await q<any>("select league_snapshot($1) s", [lid]))[0].s;
}
async function control(action: string) {
  await q("select draft_control($1,$2)", [lid, action]);
}
async function advanceCpuClock() {
  await db.exec("reset role");
  await q(
    "update leagues set next_cpu_pick_at=clock_timestamp()-interval '1 second' where id=$1",
    [lid],
  );
  await db.exec("set role authenticated");
}
async function humanPick(id: string) {
  await identity(id);
  const s = await state();
  const team = onClock(s.draft_order, s.next_pick);
  const p = (
    await q<any>(
      `select player_id from league_players p where league_id=$1 and franchise_id is null and
(select count(*) from league_players r where r.league_id=p.league_id and r.franchise_id=$2 and r.profile->>'position'=p.profile->>'position') <
(select maximum from position_limits where position=p.profile->>'position') order by (profile->>'overall')::int desc limit 1`,
      [lid, team],
    )
  )[0];
  await q("select submit_pick($1,$2,$3,$4)", [
    lid,
    p.player_id,
    s.next_pick,
    s.revision,
  ]);
}
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "ff-test-"));
  db = new PGlite(dir);
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth,public to authenticated,anon;insert into auth.users values('${owner}'),('${friend}'),('${outsider}');`,
  );
  await db.exec(
    await readFile("supabase/migrations/001_franchise.sql", "utf8"),
  );
  await db.exec(
    await readFile(
      "supabase/migrations/20261015214620_mobile_draft_pacing.sql",
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      "supabase/migrations/20261015215105_player_dataset_catalog.sql",
      "utf8",
    ),
  );
});
after(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});
test("snake order reverses at both round boundaries; roster template sums to 53", () => {
  const order = Array.from({ length: 32 }, (_, i) => String(i));
  assert.equal(onClock(order, 0), "0");
  assert.equal(onClock(order, 31), "31");
  assert.equal(onClock(order, 32), "31");
  assert.equal(onClock(order, 63), "0");
  assert.equal(onClock(order, 64), "0");
  assert.equal(
    Object.values(limits).reduce((a, b) => a + b, 0),
    53,
  );
});
test("create league, invitations, unique ownership, RLS isolation and private queues", async () => {
  await identity(owner);
  lid = (await q<any>("select create_league('Test Dynasty','BAL') id"))[0].id;
  const s = await snap();
  invite = s.invite;
  assert.equal(s.league.state, "waiting");
  assert.equal(s.league.next_pick, 0);
  assert.equal(new Set(s.league.draft_order).size, 32);
  assert.equal(
    (
      await q<any>("select count(*) n from league_players where league_id=$1", [
        lid,
      ])
    )[0].n,
    2120,
  );
  await identity(friend);
  assert.equal((await q("select * from leagues")).length, 0);
  await assert.rejects(snap(), /access denied/);
  assert.equal(
    (await q<any>("select invite_preview($1) p", [invite]))[0].p.name,
    "Test Dynasty",
  );
  await assert.rejects(
    q("select join_league($1,'BAL')", [invite]),
    /unique constraint/,
  );
  await q("select join_league($1,'BUF')", [invite]);
  assert.equal((await snap()).invite, null);
  assert.equal((await q("select * from league_invites")).length, 0);
  await assert.rejects(
    q("select join_league($1,'CHI')", [invite]),
    /unique constraint/,
  );
  await assert.rejects(control("start"), /Commissioner/);
  await assert.rejects(
    q("select commit_pick($1,gen_random_uuid())", [lid]),
    /permission denied/,
  );
  await assert.rejects(
    q("select cpu_tick_internal($1,1)", [lid]),
    /permission denied/,
  );
  await assert.rejects(
    q("update leagues set state='running' where id=$1", [lid]),
    /permission denied/,
  );
  const p = (
    await q<any>(
      "select player_id from league_players where league_id=$1 limit 1",
      [lid],
    )
  )[0].player_id;
  await q("insert into draft_queue values($1,$2,$3,0)", [lid, friend, p]);
  await identity(owner);
  assert.equal((await q("select * from draft_queue")).length, 0);
  await assert.rejects(
    q("insert into draft_queue values($1,$2,$3,1)", [lid, friend, p]),
    /row-level security/,
  );
  const old = invite;
  invite = (await q<any>("select rotate_invite($1) t", [lid]))[0].t;
  await identity(outsider);
  await assert.rejects(q("select invite_preview($1)", [old]), /not found/);
  await assert.rejects(q("select cpu_tick($1)", [lid]), /access denied/);
  await assert.rejects(q("select league_snapshot($1)", [lid]), /access denied/);
  assert.equal((await q("select * from draft_picks")).length, 0);
  await identity(owner);
  const other = (
    await q<any>("select create_league('Another League','KC') id")
  )[0].id;
  assert.notEqual(other, lid);
  await q("select manage_member($1,$2)", [lid, friend]);
  assert.equal((await snap()).members.length, 1);
  await identity(friend);
  await q("select join_league($1,'BUF')", [invite]);
  await identity(owner);
});
test("start, CPU picks, unauthorized picks, pause, stale request and persistence across restart", async () => {
  await identity(owner);
  assert.equal((await q<any>("select cpu_tick($1) n", [lid]))[0].n, 0);
  await control("start");
  await assert.rejects(control("start"), /Invalid draft/);
  await assert.rejects(
    q("select manage_member($1,$2)", [lid, friend]),
    /Cannot remove/,
  );
  let s = await state();
  while (!["BAL", "BUF"].includes(onClock(s.draft_order, s.next_pick))) {
    await advanceCpuClock();
    await q("select cpu_tick($1)", [lid]);
    s = await state();
  }
  const current =
    onClock(s.draft_order, s.next_pick) === "BAL" ? owner : friend;
  const wrong = current === owner ? friend : owner;
  const p = (
    await q<any>(
      "select player_id from league_players where league_id=$1 and franchise_id is null limit 1",
      [lid],
    )
  )[0].player_id;
  await identity(wrong);
  await assert.rejects(
    q("select submit_pick($1,$2,$3,$4)", [lid, p, s.next_pick, s.revision]),
    /Not your turn/,
  );
  await identity(owner);
  await control("pause");
  const paused = await state();
  assert.equal(paused.state, "paused");
  assert.equal((await q<any>("select cpu_tick($1) n", [lid]))[0].n, 0);
  await identity(current);
  await assert.rejects(
    q("select submit_pick($1,$2,$3,$4)", [lid, p, s.next_pick, s.revision]),
    /not accepting/,
  );
  await db.close();
  db = new PGlite(dir);
  await identity(owner);
  assert.equal((await state()).next_pick, paused.next_pick);
  assert.equal((await state()).state, "paused");
  await control("resume");
  await identity(current);
  await assert.rejects(
    q("select submit_pick($1,$2,$3,$4)", [lid, p, s.next_pick, s.revision]),
    /Draft changed/,
  );
  const fresh = await state();
  const requests = await Promise.allSettled([
    q("select submit_pick($1,$2,$3,$4)", [
      lid,
      p,
      fresh.next_pick,
      fresh.revision,
    ]),
    q("select submit_pick($1,$2,$3,$4)", [
      lid,
      p,
      fresh.next_pick,
      fresh.revision,
    ]),
  ]);
  assert.equal(requests.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await state()).next_pick, fresh.next_pick + 1);
  await identity(outsider);
  await assert.rejects(q("select join_league($1,'CHI')", [invite]), /locked/);
});
test("complete 15 rounds, explicit checkpoint, pause auto-completion, fill every positional slot without duplicates", async () => {
  let done = false;
  for (let safety = 0; safety < 1800 && !done; safety++) {
    await identity(owner);
    let s = await state();
    if (s.state === "awaiting_completion") {
      done = true;
      break;
    }
    const t = onClock(s.draft_order, s.next_pick);
    if (t === "BAL" || t === "BUF")
      await humanPick(t === "BAL" ? owner : friend);
    else {
      await advanceCpuClock();
      await q("select cpu_tick($1)", [lid]);
    }
  }
  assert.equal(done, true);
  await identity(owner);
  assert.equal((await state()).next_pick, 480);
  assert.equal((await q<any>("select cpu_tick($1) n", [lid]))[0].n, 0);
  await assert.rejects(control("resume"), /Invalid/);
  await identity(friend);
  await assert.rejects(control("complete"), /Commissioner/);
  await identity(owner);
  await control("complete");
  await q("select cpu_tick($1)", [lid]);
  await control("pause");
  const paused = await state();
  assert.equal(paused.resume_state, "completing");
  await q("select cpu_tick($1)", [lid]);
  assert.equal((await state()).next_pick, paused.next_pick);
  await control("resume");
  for (let safety = 0; safety < 200; safety++) {
    await advanceCpuClock();
    await q("select cpu_tick($1)", [lid]);
    if ((await state()).state === "completed") break;
  }
  const final = await state();
  assert.equal(final.state, "completed");
  assert.equal(final.next_pick, 1696);
  const picks = (await snap()).picks;
  assert.equal(picks.length, 1696);
  assert.equal(new Set(picks.map((p: any) => p.player_id)).size, 1696);
  for (const p of picks)
    assert.equal(p.franchise_id, onClock(final.draft_order, p.pick));
  const totals = await q<any>(
    "select franchise_id,count(*) n from league_players where league_id=$1 and franchise_id is not null group by 1",
    [lid],
  );
  assert.equal(totals.length, 32);
  for (const t of totals) assert.equal(t.n, 53);
  const coverage = await q<any>(
    "select franchise_id,profile->>'position' pos,count(*) n from league_players where league_id=$1 and franchise_id is not null group by 1,2",
    [lid],
  );
  for (const c of coverage) assert.equal(c.n, limits[c.pos]);
  assert.equal(coverage.length, 32 * 19);
  assert.equal((await q<any>("select cpu_tick($1) n", [lid]))[0].n, 0);
  await assert.rejects(control("start"), /Invalid/);
  await identity(outsider);
  assert.equal((await q("select * from league_players")).length, 0);
  await admin();
});

test("real NFL dataset: attribution, duplicate identities, full roster coverage and existing draft preservation", async () => {
  await admin();
  const pool = JSON.parse(await readFile("data/nfl-2026-pool.json", "utf8"));
  validatePool(pool);
  assert.ok(pool.filter((p: any) => !p.is_fictional).length > 2000);
  assert.ok(
    pool.some((p: any) => p.name === "Lamar Jackson" && !p.is_fictional),
  );
  await q(
    "insert into player_datasets(id,label,source_url,license,rating_source) values('nflverse-2026-original-v1','NFL test','https://github.com/nflverse/nflverse-data','CC BY 4.0','ff-original-v1')",
  );
  for (let n = 0; n < pool.length; n += 100)
    await db.exec(poolInsert(pool.slice(n, n + 100)));
  await q("update player_datasets set is_default=false");
  await q(
    "update player_datasets set is_default=true where id='nflverse-2026-original-v1'",
  );
  await identity(owner);
  const original = await state();

  assert.equal((await state()).next_pick, original.next_pick);
  const realLid = (
    await q<any>("select create_league('NFL Roster Test','BAL') id")
  )[0].id;
  const count = (
    await q<any>("select count(*) n from league_players where league_id=$1", [
      realLid,
    ])
  )[0].n;
  assert.equal(count, pool.length);
  // Fixture-only shortcut skips the human rounds to exercise complete real-pool coverage.
  await admin();
  await q(
    "update leagues set state='completing',next_cpu_pick_at=clock_timestamp()-interval '1 second' where id=$1",
    [realLid],
  );
  for (let n = 0; n < 250; n++) {
    await q(
      "update leagues set next_cpu_pick_at=clock_timestamp()-interval '1 second' where id=$1",
      [realLid],
    );
    await q("select cpu_tick_internal($1,8)", [realLid]);
    if (
      (await q<any>("select state from leagues where id=$1", [realLid]))[0]
        .state === "completed"
    )
      break;
    // Inaugural checkpoint is always respected even when invoked through the internal engine.
    await q(
      "update leagues set state='completing' where id=$1 and state='awaiting_completion'",
      [realLid],
    );
  }
  assert.equal(
    (await q<any>("select next_pick from leagues where id=$1", [realLid]))[0]
      .next_pick,
    1696,
  );
  const coverage = await q<any>(
    "select franchise_id,profile->>'position' pos,count(*) n from league_players where league_id=$1 and franchise_id is not null group by 1,2",
    [realLid],
  );
  assert.equal(coverage.length, 32 * 19);
  for (const c of coverage) assert.equal(c.n, limits[c.pos]);
  assert.equal(
    (
      await q<any>(
        "select count(distinct player_id) n from draft_picks where league_id=$1",
        [realLid],
      )
    )[0].n,
    1696,
  );
});
