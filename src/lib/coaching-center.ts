import type { Player } from "./types";
import type { GameSnapshot } from "./season";
export type Scheme = {
  name: string;
  strength: string;
  personnel: string;
  plays: string;
  needs: {
    positions: string[];
    count: number;
    attributes: string[];
    label: string;
  }[];
};
const need = (
  positions: string,
  count: number,
  attributes: string,
  label: string,
) => ({
  positions: positions.split(","),
  count,
  attributes: attributes.split(","),
  label,
});
const qb = need("QB", 1, "short_accuracy,medium_accuracy", "QB accuracy");
const wr = need("WR", 3, "catching,route_running,speed", "receiver quality");
const line = need(
  "LT,LG,C,RG,RT,OT,OG",
  5,
  "run_blocking,strength",
  "run blocking",
);
const rb = need("HB,RB", 1, "carrying,speed,vision", "running backs");
const cb = need("CB", 3, "man_coverage,speed", "man coverage");
const zone = need("CB,FS,SS,S", 5, "zone_coverage,awareness", "zone coverage");
const front = need(
  "LE,RE,DE,DT,EDGE",
  4,
  "block_shedding,strength",
  "defensive front",
);
const lb = need(
  "LOLB,MLB,ROLB,OLB,ILB,LB",
  3,
  "tackling,pursuit",
  "linebackers",
);
export const offensiveSchemes: Scheme[] = [
  {
    name: "Balanced",
    strength: "Mix the run and pass to stay flexible.",
    personnel: "A capable QB, receiving group, and running game.",
    plays: "Inside runs, intermediate passes, and play action.",
    needs: [qb, wr, rb, line],
  },
  {
    name: "West Coast",
    strength:
      "Build steady drives with shorter throws and yards after the catch.",
    personnel: "Accurate QB and reliable receivers.",
    plays: "Quick throws, crossing routes, screens, and play action.",
    needs: [qb, wr],
  },
  {
    name: "Spread",
    strength: "Create space and stretch the defense across the field.",
    personnel: "Several capable receivers and an accurate QB.",
    plays: "Spread passing, screens, and runs against lighter boxes.",
    needs: [wr, qb],
  },
  {
    name: "Power Run",
    strength: "Lean on the ground game and control possession.",
    personnel: "Strong run blockers and a dependable back.",
    plays: "Power, inside runs, outside runs, and play action.",
    needs: [line, rb],
  },
  {
    name: "Air Raid",
    strength: "Favor passing and attack through the air.",
    personnel: "Deep receiving group, pass protection, and a strong passer.",
    plays: "Crossers, intermediate throws, screens, and deep shots.",
    needs: [
      wr,
      need(
        "QB",
        1,
        "deep_accuracy,medium_accuracy,throw_power",
        "downfield passing",
      ),
      need("LT,LG,C,RG,RT,OT,OG", 5, "pass_blocking", "pass protection"),
    ],
  },
  {
    name: "Option",
    strength: "Bring the quarterback into the running game.",
    personnel: "Mobile QB, capable back, and run blockers.",
    plays: "QB keepers, option runs, RPOs, and complementary passes.",
    needs: [need("QB", 1, "speed,carrying", "QB mobility"), rb, line],
  },
];
export const defensiveSchemes: Scheme[] = [
  {
    name: "4–3",
    strength: "Build around four linemen and a balanced front.",
    personnel: "Four defensive linemen and three linebackers.",
    plays: "Four-man fronts, coverage, and situational pressure.",
    needs: [front, lb],
  },
  {
    name: "3–4",
    strength: "Put more linebackers on the field for flexible pressure.",
    personnel: "Three linemen and four capable linebackers.",
    plays: "Three-man fronts and pressure from linebacker alignments.",
    needs: [
      { ...front, count: 3 },
      { ...lb, count: 4 },
    ],
  },
  {
    name: "Nickel-heavy",
    strength: "Add an extra defensive back to match passing threats.",
    personnel: "Cornerback depth and a strong defensive front.",
    plays: "Five-DB personnel, coverage, and situational blitzes.",
    needs: [cb, front],
  },
  {
    name: "Multiple",
    strength: "Keep a flexible defensive identity.",
    personnel: "Balanced talent across the front and secondary.",
    plays: "A mix of coverage and pressure based on your tendencies.",
    needs: [front, lb, zone],
  },
  {
    name: "Man-heavy",
    strength: "Favor individual coverage matchups.",
    personnel: "Fast corners with strong man-coverage skills.",
    plays: "Man coverage, safety help, and selected blitzes.",
    needs: [cb, need("FS,SS,S", 2, "speed,man_coverage", "safety help")],
  },
  {
    name: "Zone-heavy",
    strength: "Favor defenders covering areas of the field.",
    personnel: "Aware defensive backs and disciplined linebackers.",
    plays: "Zone coverage, underneath support, and selected pressure.",
    needs: [zone, lb],
  },
];
/** Roster rating heuristic, not a win probability. Missing required slots score zero. */
export function schemeFit(scheme: Scheme, roster: Player[]) {
  if (!roster.length)
    return {
      score: null,
      reason: "Draft or acquire players to see your team fit.",
    };
  const groups = scheme.needs.map((n) => {
    const scores = roster
      .filter((p) => n.positions.includes(p.position))
      .map(
        (p) =>
          n.attributes.reduce((v, k) => v + (p.attributes[k] ?? p.overall), 0) /
          n.attributes.length,
      )
      .sort((a, b) => b - a)
      .slice(0, n.count);
    return {
      label: n.label,
      score: scores.reduce((a, b) => a + b, 0) / n.count,
      missing: scores.length < n.count,
    };
  });
  const score = Math.round(
    groups.reduce((a, g) => a + g.score, 0) / groups.length,
  );
  const weakest = [...groups].sort((a, b) => a.score - b.score)[0];
  const strongest = [...groups].sort((a, b) => b.score - a.score)[0];
  return {
    score: Math.max(0, Math.min(100, score)),
    reason: weakest.missing
      ? `More depth in ${weakest.label} would improve this fit.`
      : score >= 80
        ? `Strong ${strongest.label} helps make this a good fit.`
        : `Improving ${weakest.label} would make this scheme a better fit.`,
  };
}
export const percentage = (n: number, d: number) =>
  d ? `${Math.round((n / d) * 100)}%` : "—";
export function coachingReport(games: GameSnapshot[], team: string) {
  const r = {
    games: 0,
    runs: 0,
    passes: 0,
    rushing: 0,
    passing: 0,
    plays: 0,
    sacks: 0,
    thirds: 0,
    thirdAttempts: 0,
    redTrips: 0,
    redTD: 0,
    defRedTrips: 0,
    defRedTD: 0,
    blitz: 0,
    blitzKnown: 0,
    defSnaps: 0,
    man: 0,
    zone: 0,
    coverageKnown: 0,
    interceptions: 0,
    fumbles: 0,
  };
  for (const g of games) {
    if (
      g.game.status !== "final" ||
      ![g.game.home, g.game.away].includes(team) ||
      !g.game.box
    )
      continue;
    r.games++;
    const stats = g.game.box.teams[team];
    if (stats) {
      r.rushing += stats.rushing_yards;
      r.passing += stats.passing_yards;
      r.plays += stats.plays;
      r.sacks += stats.sacks;
      r.thirds += stats.third_conversions;
      r.thirdAttempts += stats.third_attempts;
    }
    for (const [id, stats] of Object.entries(g.game.box.players)) {
      const owner = g.players?.[id]?.team;
      if (owner === team) {
        r.runs += stats.rushing_attempts;
        r.passes += stats.passing_attempts;
        r.interceptions += stats.interceptions;
      } else if (owner) r.fumbles += stats.fumbles_lost;
    }
    let drive: { offense: string; red: boolean; td: boolean } | null = null;
    let prevQuarter = 0;
    const finish = () => {
      if (drive?.red) {
        if (drive.offense === team) {
          r.redTrips++;
          r.redTD += Number(drive.td);
        } else {
          r.defRedTrips++;
          r.defRedTD += Number(drive.td);
        }
      }
      drive = null;
    };
    for (const p of g.plays) {
      if (
        drive &&
        (drive.offense !== p.offense ||
          (prevQuarter <= 2 && p.quarter >= 3) ||
          (prevQuarter <= 4 && p.quarter >= 5))
      )
        finish();
      prevQuarter = p.quarter;
      if (["extra_point", "two_point"].includes(p.kind)) continue;
      drive ??= { offense: p.offense, red: false, td: false };
      const spot = p.offense === g.game.home ? p.spot : 100 - p.spot;
      // A red-zone possession needs a snap inside the 20, not a long TD from outside it.
      if (spot >= 80) drive.red = true;
      const end = p.offense === g.game.home ? p.endSpot : 100 - p.endSpot;
      if (
        p.scoring &&
        end >= 100 &&
        !p.turnover &&
        ["run", "pass"].includes(p.kind)
      )
        drive.td = true;
      if (p.offense !== team && ["run", "pass", "sack"].includes(p.kind)) {
        r.defSnaps++;
        if (typeof p.blitz === "boolean") {
          r.blitzKnown++;
          r.blitz += Number(p.blitz);
        }
        if (p.coverage.startsWith("Man")) {
          r.man++;
          r.coverageKnown++;
        } else if (p.coverage.startsWith("Zone")) {
          r.zone++;
          r.coverageKnown++;
        }
      }
      if (
        p.turnover ||
        p.scoring ||
        ["punt", "field_goal"].includes(p.kind) ||
        (p.down === 4 && p.yards < p.distance)
      )
        finish();
    }
    finish();
  }
  return r;
}
