import { test } from "node:test";
import assert from "node:assert/strict";
import {
  coachingReport,
  offensiveSchemes,
  schemeFit,
} from "../src/lib/coaching-center";
import type { Player } from "../src/lib/types";
import type { GameSnapshot } from "../src/lib/season";
import type {
  Play,
  TeamStats,
  StatLine,
} from "../supabase/functions/_shared/simulation";
const p = (overrides: Partial<Play>): Play =>
  ({
    offense: "HOME",
    kind: "run",
    quarter: 1,
    spot: 50,
    endSpot: 55,
    yards: 5,
    down: 1,
    distance: 10,
    scoring: false,
    turnover: false,
    coverage: "Zone coverage",
    ...overrides,
  }) as Play;
const teamStats = {
  rushing_yards: 40,
  passing_yards: 60,
  plays: 20,
  sacks: 2,
  third_conversions: 2,
  third_attempts: 5,
} as TeamStats;
const line = {
  rushing_attempts: 5,
  passing_attempts: 10,
  interceptions: 1,
  fumbles_lost: 0,
} as StatLine;
const game = (plays: Play[]): GameSnapshot =>
  ({
    game: {
      id: "g",
      home: "HOME",
      away: "AWAY",
      status: "final",
      box: {
        teams: { HOME: teamStats },
        players: { h: line, a: { ...line, fumbles_lost: 2 } },
      },
    },
    players: { h: { team: "HOME" }, a: { team: "AWAY" } },
    plays,
    total_plays: plays.length,
  }) as unknown as GameSnapshot;
test("coaching report uses final box totals, directional red zones, actual coverages, and recorded blitz denominators", () => {
  const g = game([
    p({ spot: 85, endSpot: 90 }),
    p({ spot: 90, endSpot: 100, scoring: true }),
    p({ kind: "extra_point", scoring: true }),
    p({
      offense: "AWAY",
      spot: 15,
      endSpot: 10,
      blitz: true,
      coverage: "Man coverage",
    }),
    p({
      offense: "AWAY",
      spot: 10,
      endSpot: 10,
      kind: "field_goal",
      scoring: true,
    }),
    p({ spot: 50, endSpot: 100, scoring: true }), // long TD is not a red-zone trip
    p({ offense: "AWAY", spot: 30, endSpot: 20, coverage: "Zone coverage" }), // legacy snap: no blitz flag
    p({
      offense: "AWAY",
      spot: 20,
      endSpot: 0,
      scoring: true,
      blitz: false,
      coverage: "Zone coverage",
    }),
  ]);
  const r = coachingReport(
    [g, { ...g, game: { ...g.game, status: "live" } }],
    "HOME",
  );
  assert.equal(r.games, 1);
  assert.equal(r.rushing + r.passing, 100);
  assert.equal(r.sacks, 2);
  assert.equal(r.runs, 5);
  assert.equal(r.passes, 10);
  assert.equal(r.thirds, 2);
  assert.equal(r.redTrips, 1);
  assert.equal(r.redTD, 1);
  assert.equal(r.defRedTrips, 2);
  assert.equal(r.defRedTD, 1);
  assert.equal(r.blitz, 1);
  assert.equal(r.blitzKnown, 2);
  assert.equal(r.defSnaps, 3);
  assert.equal(r.man, 1);
  assert.equal(r.zone, 2);
  assert.equal(r.fumbles, 2);
  assert.equal(r.interceptions, 1);
});
test("halftime closes red-zone possessions even when the same team receives after halftime", () => {
  const r = coachingReport(
    [
      game([
        p({ quarter: 2, spot: 85 }),
        p({ quarter: 3, spot: 85 }),
        p({ quarter: 3, spot: 90, endSpot: 100, scoring: true }),
      ]),
    ],
    "HOME",
  );
  assert.equal(r.redTrips, 2);
  assert.equal(r.redTD, 1);
});
test("fit accounts for missing personnel, real ratings and empty rosters", () => {
  const s = offensiveSchemes.find((s) => s.name === "West Coast")!;
  const player = (position: string, overall: number) =>
    ({ position, overall, attributes: {} }) as Player;
  assert.equal(schemeFit(s, []).score, null);
  const full = [
    player("QB", 90),
    player("WR", 90),
    player("WR", 90),
    player("WR", 90),
  ];
  assert.equal(schemeFit(s, full).score, 90);
  assert.ok(schemeFit(s, full.slice(0, 2)).score! < 90);
  assert.match(schemeFit(s, full.slice(0, 2)).reason, /depth/);
  assert.ok(
    schemeFit(
      s,
      full.map((p) => ({ ...p, overall: 60 })),
    ).score! < 90,
  );
});
