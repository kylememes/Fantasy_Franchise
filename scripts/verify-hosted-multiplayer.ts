// Explicit test workflow only. Fixture accounts must be provisioned and removed by an operator.
// Never pass production-user credentials. Output excludes passwords, tokens and invitations.
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";
async function main() {
  const [fixtureFile, reportFile] = process.argv.slice(2);
  if (!fixtureFile || !reportFile)
    throw Error(
      "Usage: verify-hosted-multiplayer.ts PRIVATE_FIXTURE.json REPORT.json",
    );
  const fixture = JSON.parse(await readFile(fixtureFile, "utf8"));
  const { url, key, users, league_id: providedLeague } = fixture;
  if (
    !Array.isArray(users) ||
    users.length !== 2 ||
    users.some((u: any) => !u.email?.endsWith("@example.invalid"))
  )
    throw Error("Disposable fixture accounts only");
  const client = () =>
    createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  const a = client(),
    b = client();
  const eventsA: any[] = [],
    eventsB: any[] = [];
  const wait = async (check: () => Promise<boolean> | boolean, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw Error("Timed out waiting for synchronized state");
  };
  async function rpc(c: any, fn: string, args: any) {
    const { data, error } = await c.rpc(fn, args);
    if (error) throw Error(fn + ": " + error.message);
    return data;
  }
  const report: any = { started_at: new Date().toISOString(), checks: [] };
  let lid = providedLeague;
  try {
    for (const [i, c] of [a, b].entries()) {
      const { error } = await c.auth.signInWithPassword({
        email: users[i].email,
        password: users[i].password,
      });
      if (error) throw Error("Fixture sign-in failed: " + error.message);
    }
    report.checks.push("Two distinct live Supabase Auth sessions signed in");
    // The operator creates a waiting fixture league and arranges BAL, KC as the first two teams.
    if (!lid) throw Error("A dedicated waiting fixture league is required");
    const initial = await rpc(a, "league_snapshot", { lid });
    assert.equal(initial.league.state, "waiting");
    assert.equal(initial.league.draft_order[0], "BAL");
    assert.equal(initial.league.draft_order[1], "KC");
    const preview = await rpc(b, "invite_preview", {
      invite_token: initial.invite,
    });
    assert.ok(preview.taken.includes("BAL"));
    await rpc(b, "join_league", { invite_token: initial.invite, team: "KC" });
    assert.equal((await rpc(a, "league_snapshot", { lid })).members.length, 2);
    report.checks.push("Invitation preview and second-owner join succeeded");
    const subscribe = (c: any, events: any[], label: string) =>
      new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(Error("Realtime subscription timed out: " + label)),
          20000,
        );
        c.channel("verify-" + label + "-" + lid)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "leagues",
              filter: "id=eq." + lid,
            },
            (e: any) => events.push({ table: "leagues", ...e }),
          )
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "draft_picks",
              filter: "league_id=eq." + lid,
            },
            (e: any) => events.push({ table: "draft_picks", ...e }),
          )
          .subscribe((s: string) => {
            if (s === "SUBSCRIBED") {
              clearTimeout(timeout);
              resolve();
            }
            if (s === "CHANNEL_ERROR") {
              clearTimeout(timeout);
              reject(Error("Realtime channel error: " + label));
            }
          });
      });
    await Promise.all([
      subscribe(a, eventsA, "commissioner"),
      subscribe(b, eventsB, "owner"),
    ]);
    for (const action of ["start", "pause", "resume", "simulate_all"]) {
      const { error } = await b.rpc("draft_control", { lid, action });
      assert.ok(error, "Non-commissioner control must fail");
    }
    report.checks.push(
      "Second owner cannot start, pause, resume or simulate the draft",
    );
    await rpc(a, "draft_control", { lid, action: "start" });
    const pool = await a
      .from("league_players")
      .select("player_id")
      .eq("league_id", lid)
      .eq("profile->>position", "QB")
      .limit(2);
    if (pool.error) throw pool.error;
    for (const [i, c] of [a, b].entries()) {
      const snap = await rpc(c, "league_snapshot", { lid });
      assert.equal(snap.league.next_pick, i);
      await rpc(c, "submit_pick", {
        lid,
        pid: pool.data![i].player_id,
        expected_pick: i,
        expected_revision: snap.league.revision,
      });
    }
    await wait(
      () =>
        eventsA.filter((e) => e.table === "draft_picks").length >= 2 &&
        eventsB.filter((e) => e.table === "draft_picks").length >= 2,
    );
    const [sa, sb] = await Promise.all([
      rpc(a, "league_snapshot", { lid }),
      rpc(b, "league_snapshot", { lid }),
    ]);
    assert.deepEqual(sa.picks, sb.picks);
    assert.equal(sa.picks.length, 2);
    report.checks.push(
      "Two human picks synchronized via actual Realtime subscriptions and matching snapshots",
    );
    await rpc(a, "draft_control", { lid, action: "pause" });
    const paused = await rpc(a, "league_snapshot", { lid });
    await new Promise((r) => setTimeout(r, 6200));
    const unchanged = await rpc(b, "league_snapshot", { lid });
    assert.equal(unchanged.league.next_pick, paused.league.next_pick);
    assert.equal(unchanged.league.state, "paused");
    report.checks.push(
      "Pause preserved the pick through active cron cycles for more than six seconds",
    );
    await rpc(a, "draft_control", { lid, action: "resume" });
    await wait(async () => {
      const s = await rpc(b, "league_snapshot", { lid });
      return s.league.next_pick > paused.league.next_pick;
    }, 20000);
    await rpc(a, "draft_control", { lid, action: "pause" });
    report.checks.push(
      "Commissioner resume restarted CPU selections and synchronized the second owner",
    );
    report.status = "PASS";
  } catch (error) {
    report.status = "FAIL";
    report.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
  } finally {
    await Promise.allSettled([a.removeAllChannels(), b.removeAllChannels()]);
    await Promise.allSettled([a.auth.signOut(), b.auth.signOut()]);
    a.realtime.disconnect();
    b.realtime.disconnect();
    report.finished_at = new Date().toISOString();
    await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n", {
      mode: 0o600,
    });
    console.log(JSON.stringify(report));
  }
}
void main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
