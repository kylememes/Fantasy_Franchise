import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import {
  simulateGame,
  type GameInput,
} from "../supabase/functions/_shared/simulation";
test("season authority: invitations, two-user readiness, frozen inputs, private jobs, leases, pause/rejoin, finals, staff and advancement", async () => {
  const db = new PGlite();
  const owner = "10000000-0000-0000-0000-000000000001",
    friend = "10000000-0000-0000-0000-000000000002",
    outsider = "10000000-0000-0000-0000-000000000003";
  const q = async (sql: string, args: unknown[] = []) =>
    (await db.query<any>(sql, args)).rows;
  const identity = async (id: string) => {
    await db.exec("reset role");
    await q("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated");
  };
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to authenticated,anon,service_role;insert into auth.users values('${owner}'),('${friend}'),('${outsider}');`,
    );
    for (const n of [
      "001_franchise.sql",
      "20261015214620_mobile_draft_pacing.sql",
      "20261015215105_player_dataset_catalog.sql",
      "20261016022903_franchise_management.sql",
      "20261016034537_uploaded_overall_ratings.sql",
      "20261016112856_lineup_free_agency.sql",
      "20261016132251_season_game_center.sql",
    ])
      await db.exec(await readFile("supabase/migrations/" + n, "utf8"));
    await identity(owner);
    const lid = (
      await q("select create_league('Season acceptance','BAL') id")
    )[0].id;
    const token = (
      await q("select token from league_invites where league_id=$1", [lid])
    )[0].token;
    await identity(friend);
    await q("select join_league($1,'PHI')", [token]);
    await db.exec("reset role");
    await q(
      `with ranked as(select p.player_id,lim.maximum,row_number() over(partition by profile->>'position' order by player_id) rn from league_players p join position_limits lim on lim.position=p.profile->>'position' where league_id=$1) update league_players p set franchise_id=l.draft_order[((r.rn-1)/r.maximum)::int+1] from ranked r,leagues l where p.league_id=$1 and p.player_id=r.player_id and l.id=$1 and r.rn<=r.maximum*32`,
      [lid],
    );
    await q("update leagues set state='completed',next_pick=1696 where id=$1", [
      lid,
    ]);
    await identity(owner);
    let s = (await q("select season_snapshot($1) s", [lid]))[0].s;
    assert.equal(s.games.length, 320);
    assert.equal(s.season.status, "setup");
    assert.ok(s.games.every((g: any) => g.status === "scheduled"));
    const gid = s.games.find(
      (g: any) => g.phase === "preseason" && g.week === 1 && g.home === "BAL",
    ).id;
    await assert.rejects(
      q("select game_action($1,'ready')", [gid]),
      /open week/,
    );
    await identity(friend);
    await assert.rejects(
      q("select week_control($1,'open','preseason',1)", [lid]),
      /Commissioner/,
    );
    await identity(owner);
    await q("select week_control($1,'open','preseason',1)", [lid]);
    await q("select week_control($1,'open','preseason',1)", [lid]);
    s = (await q("select season_snapshot($1) s", [lid]))[0].s;
    assert.equal(s.games.filter((g: any) => g.status === "queued").length, 15);
    await q("select game_action($1,'ready')", [gid]);
    let game = (await q("select game_snapshot($1) s", [gid]))[0].s;
    assert.equal(game.game.status, "scheduled");
    assert.deepEqual(game.ready, [owner]);
    await q("select hire_coach($1,'HC','andy-reid')", [lid]);
    await identity(friend);
    await assert.rejects(
      q("select hire_coach($1,'HC','andy-reid')", [lid]),
      /already/,
    );
    await q("select hire_coach($1,'HC','jesse-minter')", [lid]);
    await q("select game_action($1,'ready')", [gid]);
    game = (await q("select game_snapshot($1) s", [gid]))[0].s;
    assert.equal(game.game.status, "queued");
    await assert.rejects(q("select * from game_jobs"), /permission/);
    await assert.rejects(
      q("select claim_simulations($1,$2)", [lid, friend]),
      /permission/,
    );
    await assert.rejects(
      q("select team_game_input($1,$2)", [lid, "BAL"]),
      /permission/,
    );
    await identity(outsider);
    await assert.rejects(
      q("select season_snapshot($1)", [lid]),
      /Access denied/,
    );
    await assert.rejects(q("select game_snapshot($1)", [gid]), /Access denied/);
    assert.equal(
      (await q("select * from season_games where league_id=$1", [lid])).length,
      0,
    );
    await db.exec("reset role");
    await db.exec("set role service_role");
    const batch = (
      await q("select claim_simulations($1,$2,null,$3) jobs", [lid, owner, gid])
    )[0].jobs;
    const job = batch.find((j: any) => j.id === gid);
    assert.ok(job);
    assert.equal(job.input.home.staff.HC, "Andy Reid");
    // Snapshot stays frozen when future-game settings change.
    await identity(owner);
    await q("select hire_coach($1,'HC','mike-vrabel')", [lid]);
    await db.exec("reset role");
    let frozen = (
      await q("select frozen from game_jobs where game_id=$1", [gid])
    )[0].frozen;
    assert.deepEqual(frozen, job.input);
    const result = simulateGame(job.input as GameInput);
    await db.exec("set role service_role");
    assert.equal(
      (
        await q("select commit_simulation($1,$2,$3) ok", [
          gid,
          job.lease,
          result,
        ])
      )[0].ok,
      true,
    );
    assert.equal(
      (
        await q("select commit_simulation($1,$2,$3) ok", [
          gid,
          job.lease,
          result,
        ])
      )[0].ok,
      false,
    );
    await identity(owner);
    game = (await q("select game_snapshot($1) s", [gid]))[0].s;
    assert.equal(game.game.status, "live");
    assert.equal(game.plays.length, 1);
    assert.equal(game.game.home_score, null);
    assert.equal(game.game.box, null);
    assert.equal(game.staff.home.HC, "Andy Reid");
    await q("select game_action($1,'pause')", [gid]);
    const paused = (await q("select game_snapshot($1) s", [gid]))[0].s;
    assert.equal(paused.game.status, "paused");
    await identity(friend);
    game = (await q("select game_snapshot($1) s", [gid]))[0].s;
    assert.equal(game.game.cursor, paused.game.cursor);
    await q("select game_action($1,'next')", [gid]);
    game = (await q("select game_snapshot($1) s", [gid]))[0].s;
    assert.equal(game.game.cursor, paused.game.cursor + 1);
    await q("select game_action($1,'resume')", [gid]);
    await q("select game_action($1,'speed',4)", [gid]);
    await q("select game_action($1,'finish')", [gid]);
    game = (await q("select game_snapshot($1) s", [gid]))[0].s;
    assert.equal(game.game.status, "final");
    assert.equal(game.plays.length, result.plays.length);
    assert.deepEqual(game.game.box, result.box);
    assert.equal(game.game.home_score, result.home_score);
    await q("select game_action($1,'ready')", [gid]);
    assert.deepEqual(
      (await q("select game_snapshot($1) s", [gid]))[0].s.game,
      game.game,
    );
    await identity(owner);
    await assert.rejects(
      q("select week_control($1,'advance','preseason',1)", [lid]),
      /Finish every game/,
    );
    await db.exec("reset role");
    await q("insert into game_worker_tickets(ticket) values($1)", [outsider]);
    await db.exec("set role service_role");
    await q("select claim_simulations(null,null,$1)", [outsider]);
    await assert.rejects(
      q("select claim_simulations(null,null,$1)", [outsider]),
      /Invalid worker ticket/,
    );
    // A stale lease cannot overwrite a recovered job.
    const other = batch.find((j: any) => j.id !== gid);
    await db.exec("reset role");
    await q(
      "update game_jobs set claimed_at=now()-interval '4 minutes' where game_id=$1",
      [other.id],
    );
    await db.exec("set role service_role");
    const reclaimed = (
      await q("select claim_simulations($1,$2,null,$3) jobs", [
        lid,
        owner,
        other.id,
      ])
    )[0].jobs.find((j: any) => j.id === other.id);
    assert.notEqual(reclaimed.lease, other.lease);
    assert.deepEqual(reclaimed.input, other.input);
    assert.equal(
      (
        await q("select commit_simulation($1,$2,$3) ok", [
          other.id,
          other.lease,
          result,
        ])
      )[0].ok,
      false,
    );
    await identity(owner);
    await q("select week_control($1,'simulate_unfinished','preseason',1)", [
      lid,
    ]);
    await db.exec("reset role");
    const all = await q(
      "select g.id,j.lease,j.frozen from season_games g join game_jobs j on j.game_id=g.id where g.league_id=$1 and g.phase='preseason' and g.week=1 and g.status<>'final'",
      [lid],
    );
    for (const j of all) {
      await q("update season_games set status='building' where id=$1", [j.id]);
      const lease = "10000000-0000-0000-0000-000000000004";
      await q("update game_jobs set lease=$2 where game_id=$1", [j.id, lease]);
      await q("select commit_simulation($1,$2,$3)", [
        j.id,
        lease,
        simulateGame(j.frozen),
      ]);
    }
    await identity(owner);
    await q("select week_control($1,'advance','preseason',1)", [lid]);
    await assert.rejects(
      q("select week_control($1,'advance','preseason',1)", [lid]),
      /Week changed/,
    );
    s = (await q("select season_snapshot($1) s", [lid]))[0].s;
    assert.equal(s.season.week, 2);
    assert.equal(
      s.games.filter(
        (g: any) =>
          g.phase === "preseason" && g.week === 1 && g.status === "final",
      ).length,
      16,
    );
    assert.ok(s.standings.some((t: any) => t.wins || t.losses || t.ties));
  } finally {
    await db.close();
  }
});
