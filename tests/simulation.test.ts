import { test } from "node:test";
import assert from "node:assert/strict";
import {
  simulateGame,
  selectPersonnel,
  passProbability,
  type TeamInput,
  type GameInput,
} from "../supabase/functions/_shared/simulation";
import schedule from "../data/schedule-2026.json";
import { syntheticTeam } from "./fixtures/football";
test("2026 schedule: 320 official fixtures, unique teams weekly, all regular byes and 17 games", () => {
  assert.equal(schedule.games.length, 320);
  const ids = new Set(),
    weekly = new Set();
  const totals: Record<string, number> = {};
  for (const g of schedule.games) {
    assert.notEqual(g.home, g.away);
    assert.ok(!ids.has(g.source_game_id));
    ids.add(g.source_game_id);
    for (const t of [g.home, g.away]) {
      const key = [g.phase, g.week, t].join(":");
      assert.ok(!weekly.has(key));
      weekly.add(key);
      if (g.phase === "regular") totals[t] = (totals[t] || 0) + 1;
    }
  }
  assert.equal(Object.keys(totals).length, 32);
  assert.ok(Object.values(totals).every((n) => n === 17));
  assert.ok(
    schedule.games.some(
      (g) =>
        g.phase === "preseason" &&
        g.week === 1 &&
        g.home === "BAL" &&
        g.away === "PHI",
    ),
  );
});
test("engine deterministic, legal clocks/fields, exact personnel, saved starters and immutable input", () => {
  const home = syntheticTeam("H"),
    away = syntheticTeam("A");
  home.depth.QB.reverse();
  const input = { seed: 12345, phase: "regular", home, away } as GameInput;
  const before = JSON.stringify(input);
  const r = simulateGame(input);
  assert.deepEqual(r, simulateGame(input));
  assert.equal(JSON.stringify(input), before);
  assert.ok(
    r.plays.some((p) => p.agents.some((a) => a.id === home.depth.QB[0])),
  );
  assert.ok(r.plays.length > 80 && r.plays.length < 240);
  for (const p of r.plays) {
    assert.equal(p.agents.length, 22);
    assert.equal(new Set(p.agents.map((a) => a.id)).size, 22);
    assert.ok(p.clock >= 0 && p.clock <= 900);
    assert.ok(p.endClock >= 0 && p.endClock <= p.clock);
    assert.ok(p.spot >= 0 && p.spot <= 100);
    assert.ok(p.endSpot >= 0 && p.endSpot <= 100);
    assert.ok(p.down >= 1 && p.down <= 4);
    for (const a of p.agents) assert.ok(r.players[a.id]);
  }
  const last = r.plays.at(-1)!;
  assert.equal(last.homeScore, r.home_score);
  assert.equal(last.awayScore, r.away_score);
  for (const s of Object.values(r.box.players)) {
    assert.ok(s.completions <= s.passing_attempts);
    assert.ok(s.receptions <= s.targets);
  }
});
test("schemes retain 11 unique players, preseason rotates backups, decisions use situation", () => {
  const t = syntheticTeam("T");
  for (const defense of [
    "4–3",
    "3–4",
    "Nickel-heavy",
    "Multiple",
    "Man-heavy",
    "Zone-heavy",
  ]) {
    t.coaching.defense = defense;
    const a = selectPersonnel(t, "defense");
    assert.equal(a.length, 11);
    assert.equal(new Set(a.map((x) => x.p.id)).size, 11);
  }
  assert.notEqual(
    selectPersonnel(t, "offense", 1, true)[0].p.id,
    selectPersonnel(t, "offense", 3, true)[0].p.id,
  );
  const early = passProbability(t, {
    down: 1,
    distance: 10,
    spot: 30,
    seconds: 300,
    deficit: 0,
  });
  const late = passProbability(t, {
    down: 3,
    distance: 12,
    spot: 30,
    seconds: 90,
    deficit: 10,
  });
  assert.ok(late > early + 0.2);
});
test("ensemble has plausible football totals and player matchup/coaching effects", () => {
  let scores = 0,
    plays = 0,
    yards = 0,
    att = 0,
    comp = 0;
  const h = syntheticTeam("H"),
    a = syntheticTeam("A");
  let eliteWins = 0,
    runCarries = 0,
    passCarries = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const r = simulateGame({ seed, phase: "regular", home: h, away: a });
    scores += r.home_score + r.away_score;
    plays += r.box.teams.H.plays + r.box.teams.A.plays;
    yards +=
      r.box.teams.H.passing_yards +
      r.box.teams.H.rushing_yards +
      r.box.teams.A.passing_yards +
      r.box.teams.A.rushing_yards;
    for (const s of Object.values(r.box.players)) {
      att += s.passing_attempts;
      comp += s.completions;
    }
    if (seed <= 30) {
      const elite = simulateGame({
        seed,
        phase: "regular",
        home: syntheticTeam("E", 96),
        away: syntheticTeam("W", 62),
      });
      if (elite.home_score > elite.away_score) eliteWins++;
      const run = syntheticTeam("R"),
        pass = syntheticTeam("R");
      run.coaching.offense = "Power Run";
      run.coaching.tendencies.run_pass = 0;
      pass.coaching.offense = "Air Raid";
      pass.coaching.tendencies.run_pass = 100;
      for (const s of Object.values(
        simulateGame({ seed, phase: "regular", home: run, away: a }).box
          .players,
      ))
        runCarries += s.rushing_attempts;
      for (const s of Object.values(
        simulateGame({ seed, phase: "regular", home: pass, away: a }).box
          .players,
      ))
        passCarries += s.rushing_attempts;
    }
  }
  console.log({
    points_per_team: scores / 160,
    plays_per_game: plays / 80,
    yards_per_team: yards / 160,
    completion: comp / att,
    eliteWins,
    runCarries,
    passCarries,
  });
  assert.ok(scores / 160 > 14 && scores / 160 < 36);
  assert.ok(plays / 80 > 95 && plays / 80 < 165);
  assert.ok(yards / 160 > 220 && yards / 160 < 460);
  assert.ok(comp / att > 0.48 && comp / att < 0.77);
  assert.ok(eliteWins >= 24);
  assert.ok(runCarries > passCarries * 1.15);
});

test("coach-aware games use secondary coverage, tackling, line strength and TE blocking while legacy frozen games retain their exact result", async () => {
  const { createHash } = await import("node:crypto");
  const legacy = {
    seed: 12345,
    phase: "regular" as const,
    home: syntheticTeam("H"),
    away: syntheticTeam("A"),
  };
  assert.equal(
    createHash("sha256")
      .update(JSON.stringify(simulateGame(legacy)))
      .digest("hex"),
    "a46d24945119bcca622cc840f4e98df3107569da6078f55078c84bb2278f30f2",
  );
  const make = () => {
    const home = syntheticTeam("H", 82),
      away = syntheticTeam("A", 82);
    home.coach_bonus_version = 1;
    away.coach_bonus_version = 1;
    return { home, away };
  };
  let points = 0,
    plays = 0,
    completions = 0,
    attempts = 0;
  for (let seed = 0; seed < 50; seed++) {
    const { home, away } = make();
    const game = simulateGame({ seed, phase: "regular", home, away });
    assert.equal(game.engine_version, "ff-football-2");
    points += game.home_score + game.away_score;
    plays += game.plays.filter(
      (p) => p.kind === "pass" || p.kind === "run" || p.kind === "sack",
    ).length;
    for (const p of Object.values(game.box.players)) {
      completions += p.completions;
      attempts += p.passing_attempts;
    }
  }
  assert.ok(points / 100 > 12 && points / 100 < 36);
  assert.ok(plays / 50 > 90 && plays / 50 < 160);
  assert.ok(completions / attempts > 0.45 && completions / attempts < 0.78);
  const metrics = (
    kind: "coverage" | "run-defense" | "blocking",
    high: boolean,
  ) => {
    let yards = 0,
      complete = 0;
    for (let seed = 100; seed < 130; seed++) {
      const { home, away } = make();
      const value = high ? 98 : 40;
      if (kind === "coverage") {
        home.coaching.tendencies.run_pass = 95;
        for (const p of away.players)
          if (["FS", "SS"].includes(p.position))
            p.attributes.zone_coverage = p.attributes.man_coverage = value;
      } else {
        home.coaching.tendencies.run_pass = 5;
        if (kind === "run-defense")
          for (const p of away.players) {
            p.attributes.tackling = value;
            if (p.position === "LB") p.attributes.awareness = value;
            if (["DT", "EDGE", "DE"].includes(p.position))
              p.attributes.strength = value;
          }
        else
          for (const p of home.players)
            if (p.position === "TE") p.attributes.run_blocking = value;
      }
      const r = simulateGame({ seed, phase: "regular", home, away });
      yards += r.box.teams.H.rushing_yards;
      for (const p of home.players) complete += r.box.players[p.id].completions;
    }
    return { yards, complete };
  };
  assert.ok(
    metrics("coverage", true).complete < metrics("coverage", false).complete,
  );
  assert.ok(
    metrics("run-defense", true).yards < metrics("run-defense", false).yards,
  );
  assert.ok(metrics("blocking", true).yards > metrics("blocking", false).yards);
});
