// Runs against an isolated disposable PostgreSQL instance in CI.
// PGlite is single-connection; this suite verifies actual concurrent transactions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";
const url = process.env.TEST_DATABASE_URL;
test(
  "PostgreSQL: simultaneous picks and pause lock ordering",
  { skip: !url },
  async () => {
    const pool = new pg.Pool({ connectionString: url, max: 5 });
    const user = "10000000-0000-0000-0000-000000000001";
    try {
      await pool.query(
        `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth,public to authenticated,anon;insert into auth.users values('${user}');`,
      );
      await pool.query(
        await readFile("supabase/migrations/001_franchise.sql", "utf8"),
      );
      await pool.query(
        await readFile(
          "supabase/migrations/20261015214620_mobile_draft_pacing.sql",
          "utf8",
        ),
      );
      await pool.query(
        await readFile(
          "supabase/migrations/20261016022903_franchise_management.sql",
          "utf8",
        ),
      );
      async function request(sql: string, args: unknown[] = [], actor = user) {
        const c = await pool.connect();
        try {
          await c.query("begin");
          await c.query("select set_config('request.jwt.claim.sub',$1,true)", [
            actor,
          ]);
          await c.query("set local role authenticated");
          const r = await c.query(sql, args);
          await c.query("commit");
          return r;
        } catch (e) {
          await c.query("rollback");
          throw e;
        } finally {
          c.release();
        }
      }
      const lid = (
        await request("select create_league('Concurrency League','BAL') id")
      ).rows[0].id;
      // Deterministic test arrangement only: place the human first.
      await pool.query(
        "update leagues set draft_order=array['BAL']||(select array_agg(id order by id) from franchises where id<>'BAL') where id=$1",
        [lid],
      );
      await request("select draft_control($1,'start')", [lid]);
      const player = (
        await pool.query(
          "select player_id from league_players where league_id=$1 limit 1",
          [lid],
        )
      ).rows[0].player_id;
      const revision = (
        await pool.query("select revision from leagues where id=$1", [lid])
      ).rows[0].revision;
      const results = await Promise.allSettled([
        request("select submit_pick($1,$2,0,$3)", [lid, player, revision]),
        request("select submit_pick($1,$2,0,$3)", [lid, player, revision]),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(
        (
          await pool.query(
            "select count(*)::int n from draft_picks where league_id=$1",
            [lid],
          )
        ).rows[0].n,
        1,
      );
      const pause = await pool.connect();
      try {
        await pause.query("begin");
        await pause.query(
          "select set_config('request.jwt.claim.sub',$1,true)",
          [user],
        );
        await pause.query("set local role authenticated");
        await pause.query("select draft_control($1,'pause')", [lid]);
        // This worker must skip the league while the pause transaction holds its lock.
        assert.equal(
          (await request("select cpu_tick($1) n", [lid])).rows[0].n,
          0,
        );
        await pause.query("commit");
      } catch (e) {
        await pause.query("rollback");
        throw e;
      } finally {
        pause.release();
      }
      const before = (
        await pool.query("select next_pick from leagues where id=$1", [lid])
      ).rows[0].next_pick;
      const workers = await Promise.all(
        Array.from({ length: 5 }, () =>
          request("select cpu_tick($1) n", [lid]),
        ),
      );
      for (const result of workers) assert.equal(result.rows[0].n, 0);
      assert.equal(
        (await pool.query("select next_pick from leagues where id=$1", [lid]))
          .rows[0].next_pick,
        before,
      );
      await request("select draft_control($1,'resume')", [lid]);
      await pool.query(
        "update leagues set next_cpu_pick_at=clock_timestamp()-interval '1 second' where id=$1",
        [lid],
      );
      const paced = await Promise.all(
        Array.from({ length: 5 }, () =>
          request("select cpu_tick($1) n", [lid]),
        ),
      );
      assert.equal(
        paced.reduce((n, r) => n + r.rows[0].n, 0),
        1,
        "Concurrent workers may make only one paced CPU pick",
      );
      assert.equal(
        (await request("select cpu_tick($1) n", [lid])).rows[0].n,
        0,
        "Pacing cannot be bypassed by repeat requests",
      );
      const totals = (
        await pool.query(
          "select count(*)::int n,count(distinct player_id)::int unique_players,count(distinct pick)::int unique_picks from draft_picks where league_id=$1",
          [lid],
        )
      ).rows[0];
      assert.equal(totals.n, totals.unique_players);
      assert.equal(totals.n, totals.unique_picks);

      const friend = "10000000-0000-0000-0000-000000000002";
      await pool.query("insert into auth.users values($1)", [friend]);
      const tradeLeague = (
        await request("select create_league('Concurrent trades','BAL') id")
      ).rows[0].id;
      await pool.query("insert into memberships values($1,$2,'KC')", [
        tradeLeague,
        friend,
      ]);
      await pool.query("update leagues set state='completed' where id=$1", [
        tradeLeague,
      ]);
      await pool.query(
        `with ranked as(select p.player_id,lim.maximum,row_number() over(partition by profile->>'position' order by player_id) rn from league_players p join position_limits lim on lim.position=p.profile->>'position' where league_id=$1)
      update league_players p set franchise_id=case when r.rn<=r.maximum then 'BAL' else 'KC' end from ranked r where p.league_id=$1 and p.player_id=r.player_id and r.rn<=r.maximum*2`,
        [tradeLeague],
      );
      await pool.query(
        "insert into player_contracts select league_id,player_id,1000000,2,1,20 from league_players where league_id=$1 and franchise_id is not null",
        [tradeLeague],
      );
      const assets = (
        await pool.query(
          "select franchise_id,player_id from league_players where league_id=$1 and profile->>'position'='QB' and franchise_id is not null order by franchise_id,player_id",
          [tradeLeague],
        )
      ).rows;
      const from = assets.find((x) => x.franchise_id === "BAL").player_id,
        to = assets.find((x) => x.franchise_id === "KC").player_id;
      const offer = (
        await request(
          "select propose_trade($1,'KC',$2::uuid[],$3::uuid[]) id",
          [tradeLeague, [from], [to]],
        )
      ).rows[0].id;
      const acceptances = await Promise.all(
        Array.from({ length: 5 }, () =>
          request("select respond_trade($1,'accept') status", [offer], friend),
        ),
      );
      assert.ok(acceptances.every((r) => r.rows[0].status === "accepted"));
      assert.equal(
        (
          await pool.query(
            "select count(*)::int n from league_events where league_id=$1 and message like 'Trade completed:%'",
            [tradeLeague],
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await pool.query(
            "select franchise_id from league_players where league_id=$1 and player_id=$2",
            [tradeLeague, from],
          )
        ).rows[0].franchise_id,
        "KC",
      );
    } finally {
      await pool.end();
    }
  },
);
