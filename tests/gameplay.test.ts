import { test } from "node:test";
import assert from "node:assert/strict";
import {
  simulateGame,
  type GameInput,
} from "../supabase/functions/_shared/simulation";
import { syntheticTeam } from "./fixtures/football";
import {
  ballSpot,
  playerSpot,
  carrierAt,
  cameraBounds,
  nextDriveIndex,
  samplePath,
} from "../src/lib/field-playback";
function input(seed = 12): GameInput {
  const home = syntheticTeam("H"),
    away = syntheticTeam("A");
  home.coach_bonus_version = away.coach_bonus_version = 1;
  home.gameplay_version = away.gameplay_version = 3;
  return { seed, phase: "regular", home, away };
}
test("V3 preserves immutable inputs, rotates tired personnel, and synchronizes carrier/ball and actual tackles", () => {
  const fixture = input(),
    before = JSON.stringify(fixture),
    result = simulateGame(fixture);
  assert.equal(result.engine_version, "ff-football-3");
  assert.deepEqual(result, simulateGame(fixture));
  assert.equal(JSON.stringify(fixture), before);
  const backs = new Set<string>(),
    fronts = new Set<string>();
  for (const p of result.plays) {
    assert.equal(p.agents.length, 22);
    assert.equal(new Set(p.agents.map((a) => a.id)).size, 22);
    assert.ok(p.formation && p.personnel);
    assert.ok(p.homeScoreBefore !== undefined);
    assert.ok(p.clock >= p.endClock);
    assert.ok(p.homeTimeouts >= 0 && p.homeTimeouts <= 3);
    if (p.offense === "H" && !/punt|field_goal|extra_point/.test(p.kind))
      p.agents.filter((a) => a.role === "HB").forEach((a) => backs.add(a.id));
    p.agents
      .filter((a) => a.team === "H" && /EDGE|DT/.test(a.role))
      .forEach((a) => fronts.add(a.id));
    for (const a of p.agents) {
      assert.equal(a.at?.length, a.path.length);
      assert.ok((a.fatigue || 0) >= 0 && (a.fatigue || 0) <= 100);
      for (const [x, y] of a.path) {
        assert.ok(Number.isFinite(x) && x >= -10 && x <= 110);
        assert.ok(Number.isFinite(y) && y >= 0 && y <= 53.3);
      }
    }
    for (const t of [0.22, 0.32, 0.47, 0.7, 0.78, 0.85]) {
      const owner = carrierAt(p, t);
      if (!owner) continue;
      const agent = p.agents.find((a) => a.id === owner);
      assert.ok(agent, `${p.kind}: missing carrier`);
      const a = playerSpot(agent, t),
        b = ballSpot(p, t);
      assert.ok(
        Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.02,
        `${p.index} ${p.kind} carrier/ball drift at ${t}: ${a} / ${b}`,
      );
    }
    if (p.tackler && !p.scoring && !p.turnover) {
      const a = p.agents.find((a) => a.id === p.tackler)!;
      assert.deepEqual(a.path.at(-1), p.ball.at(-1));
    }
    for (const t of [0, 0.5, 1]) {
      const [lo, hi] = cameraBounds(p, t, false);
      const b = ballSpot(p, t);
      assert.ok(b[0] >= lo && b[0] <= hi);
      assert.ok(lo >= -10 && hi <= 110);
    }
  }
  assert.ok(backs.size >= 2, "RB relief must appear in regular-season play");
  assert.ok(fronts.size > 4, "defensive front must rotate");
});
test("V3 ensemble has varied calls, defenses, correct turnover possession and plausible football", () => {
  const calls = new Set<string>(),
    coverage = new Set<string>();
  let points = 0,
    plays = 0,
    attempts = 0,
    completions = 0,
    broken = 0,
    interceptions = 0,
    fumbles = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const r = simulateGame(input(seed));
    points += r.home_score + r.away_score;
    plays += r.plays.length;
    for (const stat of Object.values(r.box.players)) {
      attempts += stat.passing_attempts;
      completions += stat.completions;
    }
    for (const p of r.plays) {
      calls.add(p.call.replace(" vs. blitz", ""));
      coverage.add(p.coverage);
      if (p.brokenTackle) broken++;
      if (p.turnover && p.description.includes("intercepts")) {
        interceptions++;
        assert.equal(carrierAt(p, 0.7), p.carrier);
        assert.deepEqual(
          playerSpot(
            p.agents.find((a) => a.id === p.carrier)!,
            1,
          ),
          ballSpot(p, 1),
        );
      }
      if (p.recovery) {
        fumbles++;
        assert.equal(carrierAt(p, 0.9), null);
        assert.equal(carrierAt(p, 1), p.recovery);
        assert.deepEqual(
          playerSpot(
            p.agents.find((a) => a.id === p.recovery)!,
            1,
          ),
          ballSpot(p, 1),
        );
      }
    }
  }
  for (const name of [
    "Tunnel screen",
    "Draw",
    "Play action cross",
    "Outside stretch",
    "Mesh crossers",
    "Four verticals",
    "Flea flicker",
  ])
    assert.ok(calls.has(name), name);
  assert.ok(coverage.size >= 4);
  assert.ok(broken > 0 && interceptions > 0 && fumbles > 0);
  console.log({
    pointsPerTeam: points / 100,
    playsPerGame: plays / 50,
    completion: completions / attempts,
  });
  assert.ok(points / 100 > 12 && points / 100 < 38);
  assert.ok(plays / 50 > 95 && plays / 50 < 185);
  assert.ok(completions / attempts > 0.45 && completions / attempts < 0.8);
});
test("playback supports bounded sampling, a full vertical field and drive navigation without mutating events", () => {
  assert.deepEqual(samplePath([], 0), [50, 26.65]);
  assert.deepEqual(samplePath([[1, 2]], 0.4), [1, 2]);
  assert.deepEqual(
    samplePath(
      [
        [0, 0],
        [10, 10],
      ],
      0.5,
      [0, 1],
    ),
    [5, 5],
  );
  const r = simulateGame(input(6)),
    before = JSON.stringify(r);
  assert.deepEqual(cameraBounds(r.plays[0], 0, true), [-10, 110]);
  const i = nextDriveIndex(r.plays, 0);
  assert.ok(i > 0);
  assert.notEqual(r.plays[0].offense, r.plays[i].offense);
  assert.equal(nextDriveIndex(r.plays, r.plays.length - 1), r.plays.length - 1);
  assert.equal(JSON.stringify(r), before);
});

test("previously frozen coach-aware V2 inputs retain their exact result", async () => {
  const { createHash } = await import("node:crypto");
  const fixture = input(12345);
  delete fixture.home.gameplay_version;
  delete fixture.away.gameplay_version;
  assert.equal(
    createHash("sha256")
      .update(JSON.stringify(simulateGame(fixture)))
      .digest("hex"),
    "37426c2d7b2380144966cb83aee73cd51787cf991dc755184edfdf68f8edc89b",
  );
});
