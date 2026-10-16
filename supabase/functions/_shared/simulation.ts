/** Pure authoritative football engine. No browser, database, clock or unseeded randomness. */
export const ENGINE_VERSION = "ff-football-2";
export type FootballPlayer = {
  id: string;
  name: string;
  position: string;
  jersey: number;
  overall: number;
  attributes: Record<string, number>;
};
export type TeamInput = {
  id: string;
  players: FootballPlayer[];
  depth: Record<string, string[]>;
  coaching: {
    offense: string;
    defense: string;
    tendencies: Record<string, number>;
  };
  staff?: Record<string, string>;
  coach_bonus_version?: number;
  gameplay_version?: 3;
};
export type GameInput = {
  seed: number;
  phase: "preseason" | "regular";
  home: TeamInput;
  away: TeamInput;
};
export type Spot = [number, number];
export type Agent = {
  id: string;
  team: string;
  role: string;
  path: Spot[];
  at?: number[];
  fatigue?: number;
};
export type Play = {
  index: number;
  quarter: number;
  clock: number;
  endClock: number;
  offense: string;
  kind: string;
  description: string;
  down: number;
  distance: number;
  spot: number;
  endSpot: number;
  yards: number;
  homeScore: number;
  awayScore: number;
  homeTimeouts: number;
  awayTimeouts: number;
  firstDown: number;
  agents: Agent[];
  ball: Spot[];
  ballAt: number[];
  turnover: boolean;
  scoring: boolean;
  target?: string;
  carrier?: string;
  coverage: string;
  call: string;
  formation?: string;
  personnel?: string;
  tackler?: string;
  recovery?: string;
  brokenTackle?: boolean;
  blitz?: boolean;
  possession?: { at: number; id: string | null }[];
  homeScoreBefore?: number;
  awayScoreBefore?: number;
  homeTimeoutsBefore?: number;
  awayTimeoutsBefore?: number;
  playClock?: number;
  explanation?: string;
};
export type StatLine = {
  passing_attempts: number;
  completions: number;
  passing_yards: number;
  passing_touchdowns: number;
  interceptions_thrown: number;
  rushing_attempts: number;
  rushing_yards: number;
  rushing_touchdowns: number;
  targets: number;
  receptions: number;
  receiving_yards: number;
  receiving_touchdowns: number;
  tackles: number;
  sacks: number;
  interceptions: number;
  fumbles_lost: number;
  field_goals_made: number;
  field_goals_attempted: number;
  extra_points_made: number;
  extra_points_attempted: number;
  punts: number;
  punt_yards: number;
};
export type TeamStats = {
  score: number;
  plays: number;
  passing_yards: number;
  rushing_yards: number;
  turnovers: number;
  first_downs: number;
  sacks: number;
  time_of_possession: number;
  third_attempts: number;
  third_conversions: number;
  fourth_attempts: number;
  fourth_conversions: number;
};
export type GameResult = {
  engine_version: string;
  plays: Play[];
  players: Record<string, FootballPlayer & { team: string }>;
  box: { teams: Record<string, TeamStats>; players: Record<string, StatLine> };
  home_score: number;
  away_score: number;
};
export const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
function generator(seed: number) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function skill(p: FootballPlayer, key: string, aliases: string[] = []) {
  for (const k of [key, ...aliases])
    if (Number.isFinite(p.attributes[k])) return p.attributes[k];
  return clamp(p.overall, 35, 90);
}
const mean = (a: number[]) =>
  a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const stat = (): StatLine => ({
  passing_attempts: 0,
  completions: 0,
  passing_yards: 0,
  passing_touchdowns: 0,
  interceptions_thrown: 0,
  rushing_attempts: 0,
  rushing_yards: 0,
  rushing_touchdowns: 0,
  targets: 0,
  receptions: 0,
  receiving_yards: 0,
  receiving_touchdowns: 0,
  tackles: 0,
  sacks: 0,
  interceptions: 0,
  fumbles_lost: 0,
  field_goals_made: 0,
  field_goals_attempted: 0,
  extra_points_made: 0,
  extra_points_attempted: 0,
  punts: 0,
  punt_yards: 0,
});
const teamStat = (): TeamStats => ({
  score: 0,
  plays: 0,
  passing_yards: 0,
  rushing_yards: 0,
  turnovers: 0,
  first_downs: 0,
  sacks: 0,
  time_of_possession: 0,
  third_attempts: 0,
  third_conversions: 0,
  fourth_attempts: 0,
  fourth_conversions: 0,
});
export function selectPersonnel(
  team: TeamInput,
  side: "offense" | "defense",
  quarter = 1,
  preseason = false,
) {
  const used = new Set<string>();
  function get(group: string, rank = 0) {
    const eligible = (p: FootballPlayer) =>
      group === "EDGE"
        ? ["EDGE", "DE"].includes(p.position)
        : p.position === group;
    let ids =
      team.depth[group] ||
      team.players
        .filter(eligible)
        .sort((a, b) => b.overall - a.overall || a.id.localeCompare(b.id))
        .map((p) => p.id);
    const rotation =
      preseason && quarter > 1 && !["K", "P"].includes(group)
        ? Math.min(quarter - 1, Math.max(0, ids.length - 1 - rank))
        : 0;
    const preferred = ids[rank + rotation];
    const p =
      team.players.find(
        (p) => p.id === preferred && !used.has(p.id) && eligible(p),
      ) ||
      ids
        .map((id) => team.players.find((p) => p.id === id))
        .find((p) => p && !used.has(p.id) && eligible(p)) ||
      team.players.find((p) => eligible(p) && !used.has(p.id));
    if (!p) throw Error(`Incomplete ${team.id} ${group} depth chart`);
    used.add(p.id);
    return p;
  }
  const roles: [string, string, number][] =
    side === "offense"
      ? [
          ["QB", "QB", 0],
          ["HB", "RB", 0],
          ["WR1", "WR", 0],
          ["WR2", "WR", 1],
          ["SLOT", "WR", 2],
          ["TE", "TE", 0],
          ...["LT", "LG", "C", "RG", "RT"].map(
            (p) => [p, p, 0] as [string, string, number],
          ),
        ]
      : team.coaching.defense === "3–4"
        ? [
            ["EDGE1", "EDGE", 0],
            ["DT1", "DT", 0],
            ["EDGE2", "EDGE", 1],
            ...Array.from(
              { length: 4 },
              (_, i) => [`LB${i + 1}`, "LB", i] as [string, string, number],
            ),
            ["CB1", "CB", 0],
            ["CB2", "CB", 1],
            ["FS", "FS", 0],
            ["SS", "SS", 0],
          ]
        : [
            ["EDGE1", "EDGE", 0],
            ["DT1", "DT", 0],
            ["DT2", "DT", 1],
            ["EDGE2", "EDGE", 1],
            ["LB1", "LB", 0],
            ["LB2", "LB", 1],
            ...(team.coaching.defense === "Nickel-heavy"
              ? [["CB3", "CB", 2] as [string, string, number]]
              : [["LB3", "LB", 2] as [string, string, number]]),
            ["CB1", "CB", 0],
            ["CB2", "CB", 1],
            ["FS", "FS", 0],
            ["SS", "SS", 0],
          ];
  return roles.map(([role, group, rank]) => ({ role, p: get(group, rank) }));
}
export function passProbability(
  team: TeamInput,
  situation: {
    down: number;
    distance: number;
    spot: number;
    seconds: number;
    deficit: number;
  },
) {
  const t = (k: string) => (team.coaching.tendencies[k] ?? 50) / 100;
  let p = 0.35 + 0.42 * t("run_pass");
  p +=
    (
      {
        "Air Raid": 0.13,
        Spread: 0.07,
        "West Coast": 0.04,
        "Power Run": -0.14,
        Option: -0.1,
      } as Record<string, number>
    )[team.coaching.offense] || 0;
  if (situation.down >= 3)
    p +=
      situation.distance >= 6 ? 0.23 : situation.distance <= 2 ? -0.16 : 0.04;
  if (situation.spot >= 80) p += (t("red_zone") - 0.5) * 0.28;
  if (situation.seconds < 180)
    p += situation.deficit > 0 ? 0.3 : situation.deficit < 0 ? -0.3 : 0;
  return clamp(p, 0.12, 0.96);
}
export function simulateGame(input: GameInput): GameResult {
  if (input.home.id === input.away.id) throw Error("Teams must differ");
  // New matchups consume all coach specialties; previously frozen inputs retain V1 behavior.
  const coachRules =
    input.home.coach_bonus_version === 1 ||
    input.away.coach_bonus_version === 1;
  const modern =
    input.home.gameplay_version === 3 && input.away.gameplay_version === 3;
  const fatigue: Record<string, number> = {};
  const random = generator(input.seed),
    normal = () =>
      (random() + random() + random() + random() + random() + random() - 3) *
      1.414;
  const teams = [input.home, input.away],
    stats: Record<string, TeamStats> = {},
    ps: Record<string, StatLine> = {},
    catalog: GameResult["players"] = {};
  for (const team of teams) {
    stats[team.id] = teamStat();
    for (const p of team.players) {
      if (catalog[p.id]) throw Error("Duplicate player across teams");
      catalog[p.id] = { ...p, team: team.id };
      ps[p.id] = stat();
    }
  }
  const plays: Play[] = [];
  let off = random() < 0.5 ? 0 : 1;
  const opening = off;
  let quarter = 1,
    clock = 900,
    spot = 35,
    down = 1,
    distance = 10,
    tdPending = false,
    ot = false;
  let timeouts = [3, 3],
    otHad = [false, false];
  const switchPossession = (newSpot: number) => {
    if (ot) otHad[off] = true;
    off = 1 - off;
    spot = clamp(Math.round(newSpot), 1, 99);
    down = 1;
    distance = Math.min(10, 100 - spot);
  };
  const tendency = (team: TeamInput, key: string) =>
    (team.coaching.tendencies[key] ?? 50) / 100;
  const kicker = (t: TeamInput, position: string) => {
    const ids = t.depth[position] || [];
    return (
      t.players.find((p) => p.id === ids[0] && p.position === position) ||
      t.players.find((p) => p.position === position)
    );
  };
  for (let count = 0; count < 450; count++) {
    if (clock <= 0 && !tdPending) {
      if (quarter === 2) {
        off = 1 - opening;
        spot = 35;
        down = 1;
        distance = 10;
        timeouts = [3, 3];
      }
      if (quarter === 4) {
        if (
          stats[teams[0].id].score !== stats[teams[1].id].score ||
          input.phase === "preseason"
        )
          break;
        ot = true;
        quarter = 5;
        clock = 600;
        off = random() < 0.5 ? 0 : 1;
        spot = 35;
        down = 1;
        distance = 10;
        timeouts = [2, 2];
      } else if (quarter === 5) break;
      else {
        quarter++;
        clock = 900;
      }
    }
    const team = teams[off],
      def = teams[1 - off],
      ts = stats[team.id],
      ds = stats[def.id],
      startSpot = spot,
      startDown = down,
      startDistance = distance,
      startClock = clock;
    const beforeScores = [stats[teams[0].id].score, stats[teams[1].id].score];
    const beforeTimeouts = [...timeouts];
    const fresh = (t: TeamInput) => (modern ? restedTeam(t, fatigue) : t);
    const offense = selectPersonnel(
        fresh(team),
        "offense",
        quarter,
        input.phase === "preseason",
      ),
      defense = selectPersonnel(
        fresh(def),
        "defense",
        quarter,
        input.phase === "preseason",
      );
    const qb = offense[0].p,
      rb = offense[1].p,
      receivers = offense.slice(2, 6),
      ol = offense.slice(6).map((x) => x.p),
      dl = defense
        .filter((x) => ["EDGE1", "EDGE2", "DT1", "DT2"].includes(x.role))
        .map((x) => x.p);
    const corners = defense
        .filter((x) => x.role.startsWith("CB"))
        .map((x) => x.p),
      defenders = defense.map((x) => x.p);
    const blitz =
      random() <
      clamp(
        0.1 +
          tendency(def, "blitz") * 0.42 +
          (down === 3 && distance > 5 ? 0.08 : 0),
        0.05,
        0.7,
      );
    const man =
      random() <
      clamp(
        tendency(def, "man_zone") +
          (def.coaching.defense === "Man-heavy"
            ? 0.2
            : def.coaching.defense === "Zone-heavy"
              ? -0.2
              : 0),
        0.08,
        0.92,
      );
    const runBlock = mean([
        ...ol.map((p) => skill(p, "run_blocking", ["run_block", "blocking"])),
        ...(coachRules
          ? offense
              .filter((x) => x.p.position === "TE")
              .map((x) => skill(x.p, "run_blocking", ["run_block", "blocking"]))
          : []),
      ]),
      passBlock = mean(
        ol.map((p) => skill(p, "pass_blocking", ["pass_block", "blocking"])),
      ),
      rush = mean(
        dl.map(
          (p) =>
            Math.max(
              skill(p, "power_moves", ["pass_rush"]),
              skill(p, "finesse_moves", ["pass_rush"]),
            ) *
              (coachRules ? 0.9 : 1) +
            (coachRules ? skill(p, "strength") * 0.1 : 0),
        ),
      ),
      shed = mean(
        dl.map(
          (p) =>
            skill(p, "block_shedding", ["tackling"]) * (coachRules ? 0.85 : 1) +
            (coachRules ? skill(p, "strength") * 0.15 : 0),
        ),
      ),
      pursuit = mean(defenders.map((p) => skill(p, "pursuit", ["tackling"])));
    let kind = "run",
      description = "",
      gain = 0,
      turnover = false,
      scoring = false,
      carrier: FootballPlayer = rb,
      target: FootballPlayer | undefined,
      coverage = man ? "Man coverage" : "Zone coverage",
      call = "",
      liveSeconds = 6,
      stopped = false,
      conversion = false;
    let ballStart: Spot = [spot - 4, 26.65],
      ballEnd: Spot = [spot, 26.65];
    let passDepth = 0,
      completed = false,
      sacked = false,
      interceptor: FootballPlayer | undefined,
      td = false;
    let tackler: FootballPlayer | undefined;
    let design = "",
      explanation = "",
      brokenTackle = false;
    const deficit = ds.score - ts.score,
      seconds = quarter >= 4 || (modern && quarter === 2) ? clock : 9999;
    if (tdPending) {
      tdPending = false;
      const two =
        (quarter >= 4 && [2, 5, 8, 10, 13, 16].includes(deficit)) ||
        random() < 0.025 + 0.08 * tendency(team, "two_point");
      kind = two ? "two_point" : "extra_point";
      carrier = two ? rb : kicker(team, "K") || rb;
      const good =
        random() <
        (two
          ? clamp(0.47 + (runBlock - shed) / 400, 0.25, 0.7)
          : clamp(
              0.92 + (skill(carrier, "kick_accuracy") - 75) / 700,
              0.8,
              0.99,
            ));
      if (!two) {
        ps[carrier.id].extra_points_attempted++;
        if (good) ps[carrier.id].extra_points_made++;
      }
      if (good) ts.score += two ? 2 : 1;
      scoring = good;
      description = `${team.id} ${two ? "two-point conversion" : "extra point"} ${good ? "good" : "no good"}.`;
      conversion = true;
      liveSeconds = 0;
      spot = 98;
      ballStart = [98, 26.65];
      ballEnd = [100, 26.65];
      call = two ? "Goal-line conversion" : "PAT";
    } else {
      const go =
        down === 4 &&
        ((seconds < 180 && deficit > 3) ||
          (distance <= 2 &&
            spot > 43 &&
            random() < 0.15 + 0.7 * tendency(team, "fourth_down")));
      const lateFieldGoal =
        [2, 4, 5].includes(quarter) &&
        clock < 12 &&
        deficit >= 0 &&
        deficit <= 3 &&
        100 - spot + 17 <= 58;
      if ((down === 4 && !go) || lateFieldGoal) {
        const k = kicker(team, "K"),
          fgDistance = 100 - spot + 17;
        if (
          k &&
          fgDistance <= clamp(53 + (skill(k, "kick_power") - 70) * 0.35, 48, 66)
        ) {
          kind = "field_goal";
          carrier = k;
          ps[k.id].field_goals_attempted++;
          const probability = clamp(
            0.97 -
              Math.max(0, fgDistance - 30) * 0.013 +
              (skill(k, "kick_accuracy") - 80) * 0.004,
            0.12,
            0.99,
          );
          const good = random() < probability;
          if (good) {
            ts.score += 3;
            ps[k.id].field_goals_made++;
            scoring = true;
          }
          description = `${k.name} ${fgDistance}-yard field goal ${good ? "GOOD" : "missed"}.`;
          ballStart = [spot - 7, 26.65];
          ballEnd = [100, 26.65];
          call = "Field goal";
          stopped = true;
        } else {
          kind = "punt";
          carrier = kicker(team, "P") || rb;
          const yards = Math.round(
            clamp(
              43 + (skill(carrier, "kick_power") - 75) * 0.2 + normal() * 6,
              24,
              64,
            ),
          );
          gain = Math.min(100 - spot, yards);
          ps[carrier.id].punts++;
          ps[carrier.id].punt_yards += gain;
          description = `${carrier.name} punts ${gain} yards${spot + gain >= 100 ? " for a touchback" : ""}.`;
          ballStart = [spot - 12, 26.65];
          ballEnd = [Math.min(100, spot + gain), 20 + random() * 12];
          call = "Punt";
          stopped = true;
        }
      } else if (
        seconds < 100 &&
        deficit < 0 &&
        timeouts[1 - off] === 0 &&
        clock > 0 &&
        down < 4 &&
        (!modern || clock <= (4 - down) * 40)
      ) {
        kind = "kneel";
        gain = -1;
        carrier = qb;
        description = `${qb.name} takes a knee.`;
        call = "Victory formation";
      } else if (
        modern &&
        [2, 4].includes(quarter) &&
        clock > 12 &&
        clock < 18 &&
        down < 4 &&
        timeouts[off] === 0 &&
        deficit >= 0 &&
        plays.at(-1)?.offense === team.id &&
        (plays.at(-1)?.kind === "run" ||
          plays.at(-1)?.description.includes("completes to"))
      ) {
        kind = "spike";
        carrier = qb;
        gain = 0;
        stopped = true;
        call = "Clock spike";
        ts.plays++;
        description = `${qb.name} spikes the ball to stop the clock.`;
      } else {
        ts.plays++;
        if (down === 3) ts.third_attempts++;
        if (down === 4) ts.fourth_attempts++;
        const passing =
          random() <
          passProbability(team, { down, distance, spot, seconds, deficit });
        if (passing) {
          kind = "pass";
          carrier = qb;
          let weights = receivers.map((x) =>
            Math.exp((skill(x.p, "catching") - 75) / 23),
          );
          let draw = random() * weights.reduce((a, b) => a + b, 0);
          let ri = 0;
          while (ri < weights.length - 1 && (draw -= weights[ri]) > 0) ri++;
          target = receivers[ri].p;
          const corner = corners[ri % corners.length],
            cov =
              skill(corner, man ? "man_coverage" : "zone_coverage", [
                "coverage",
              ]) *
                (coachRules ? 0.8 : 1) +
              (coachRules
                ? mean(
                    defenders
                      .filter((p) => ["FS", "SS"].includes(p.position))
                      .map((p) =>
                        skill(p, man ? "man_coverage" : "zone_coverage", [
                          "coverage",
                        ]),
                      ),
                  ) * 0.2
                : 0);
          passDepth =
            random() <
            clamp(
              0.1 +
                0.25 * tendency(team, "deep_pass") -
                0.14 * tendency(def, "prevent_big_plays") +
                (down >= 3 && distance > 12 ? 0.1 : 0),
              0.04,
              0.45,
            )
              ? 25
              : random() <
                  clamp(
                    0.33 +
                      0.45 * tendency(team, "short_pass") +
                      (team.coaching.offense === "West Coast" ? 0.12 : 0),
                    0.15,
                    0.9,
                  )
                ? 5
                : 12;
          passDepth = Math.min(passDepth, 100 - spot + 2);
          const pa = random() < tendency(team, "play_action") * 0.24,
            rpo = random() < tendency(team, "rpo") * 0.16;
          if (modern) {
            const concept = random();
            design = rpo
              ? "RPO slant"
              : pa
                ? "Play action cross"
                : passDepth > 18
                  ? "Four verticals"
                  : concept < 0.22
                    ? "Tunnel screen"
                    : concept < 0.5
                      ? "Mesh crossers"
                      : concept < 0.75
                        ? "Stick spacing"
                        : "Flood";
            if (concept > 0.985 && down <= 2 && spot < 65 && seconds > 180)
              design = "Flea flicker";
            if (design === "Tunnel screen") passDepth = Math.min(2, 100 - spot);
            if (design === "Flea flicker") passDepth = Math.min(28, 100 - spot);
          }
          const route = skill(
            target,
            passDepth > 18
              ? "deep_route"
              : passDepth < 8
                ? "short_route"
                : "medium_route",
            ["route_running"],
          );
          const separation =
            (route - cov) * 0.06 +
            (skill(target, "speed") - skill(corner, "speed")) * 0.04 +
            (skill(target, "release") - skill(corner, "press")) *
              0.025 *
              tendency(def, "press");
          const protection = passBlock - rush - (blitz ? 9 : 0) + (pa ? 2 : 0),
            pressure = clamp(0.26 - protection * 0.007, 0.06, 0.68);
          const sackChance = clamp(
            0.055 -
              protection * 0.0018 +
              (blitz ? 0.022 : 0) -
              (skill(qb, "speed") - 65) * 0.0006,
            0.015,
            0.19,
          );
          call = `${rpo ? "RPO " : pa ? "Play action " : ""}${passDepth > 18 ? "Deep concept" : passDepth < 8 ? "Quick concept" : "Intermediate concept"}${blitz ? " vs. blitz" : ""}`;
          if (modern) {
            call = design + (blitz ? " vs. blitz" : "");
            explanation =
              protection < -5
                ? "Pressure forces an early decision."
                : protection > 8
                  ? "Excellent protection gives the quarterback time."
                  : separation > 1
                    ? `${target.name} creates separation with his route and speed.`
                    : `Safety help closes the throwing window for ${target.name}.`;
          }
          if (random() < sackChance) {
            kind = "sack";
            sacked = true;
            gain = -Math.round(3 + random() * 7);
            const rusher = dl[Math.floor(random() * dl.length)];
            tackler = rusher;
            ps[rusher.id].sacks++;
            ps[rusher.id].tackles++;
            ts.sacks++;
            ts.passing_yards += gain;
            description = `${rusher.name} sacks ${qb.name} for ${-gain} yards.`;
          } else {
            ps[qb.id].passing_attempts++;
            ps[target.id].targets++;
            const accuracy = skill(
              qb,
              passDepth > 18
                ? "deep_accuracy"
                : passDepth < 8
                  ? "short_accuracy"
                  : "medium_accuracy",
              ["accuracy"],
            );
            const intChance = clamp(
              0.017 +
                (cov - accuracy) * 0.00045 +
                pressure * 0.02 +
                (passDepth > 18 ? 0.012 : 0) -
                (skill(qb, "awareness") - 75) * 0.00025,
              0.006,
              0.075,
            );
            if (random() < intChance) {
              turnover = true;
              interceptor = corner;
              ps[qb.id].interceptions_thrown++;
              ps[corner.id].interceptions++;
              gain = Math.min(
                100 - spot,
                Math.max(0, Math.round(passDepth + normal() * 3)),
              );
              carrier = corner;
              description = `${corner.name} intercepts ${qb.name}'s pass intended for ${target.name}.`;
              stopped = true;
            } else {
              const completeChance = clamp(
                0.71 +
                  (accuracy - 80) * 0.005 +
                  (skill(target, "catching") - 80) * 0.003 +
                  (coachRules && (passDepth > 18 || separation < 1)
                    ? (skill(target, "contested_catch", ["catching"]) - 80) *
                      0.0015
                    : 0) +
                  separation * 0.026 -
                  pressure *
                    clamp(
                      0.13 -
                        (skill(qb, "pressure_response", ["awareness"]) - 80) *
                          0.001,
                      0.05,
                      0.22,
                    ) -
                  (passDepth > 18
                    ? 0.21 - (skill(qb, "throw_power") - 80) * 0.002
                    : passDepth >= 8
                      ? 0.07
                      : 0) +
                  (rpo ? 0.02 : 0),
                0.22,
                0.91,
              );
              if (random() < completeChance) {
                completed = true;
                gain = Math.round(
                  Math.max(
                    0,
                    passDepth +
                      normal() * 2 +
                      Math.max(
                        -2,
                        normal() * 3 +
                          (skill(target, "speed") - pursuit) * 0.06,
                      ),
                  ),
                );
                if (random() < 0.035) gain += Math.round(8 + random() * 24);
                if (
                  modern &&
                  random() <
                    clamp(
                      0.06 +
                        (skill(target, "agility") - skill(corner, "tackling")) *
                          0.003,
                      0.01,
                      0.2,
                    )
                ) {
                  brokenTackle = true;
                  gain += Math.round(2 + random() * 4);
                }
                gain = Math.min(100 - spot, gain);
                ps[qb.id].completions++;
                ps[qb.id].passing_yards += gain;
                ps[target.id].receptions++;
                ps[target.id].receiving_yards += gain;
                ts.passing_yards += gain;
                carrier = target;
                description = `${qb.name} completes to ${target.name} for ${gain} yards.`;
              } else {
                gain = 0;
                stopped = true;
                description = `${qb.name}'s pass to ${target.name} is incomplete.`;
              }
            }
          }
        } else {
          const option = team.coaching.offense === "Option" && random() < 0.28,
            rpo = random() < tendency(team, "rpo") * 0.12;
          carrier = option ? qb : rb;
          const runConcept = modern ? random() : 0;
          const vision = skill(
              carrier,
              coachRules ? "vision" : "ball_carrier_vision",
              coachRules
                ? ["ball_carrier_vision", "awareness"]
                : ["vision", "awareness"],
            ),
            power = skill(
              carrier,
              coachRules ? "power" : "trucking",
              coachRules ? ["trucking", "strength"] : ["strength"],
            ),
            speed = skill(carrier, "speed");
          let average =
            3.6 +
            (runBlock - shed) * 0.075 +
            (vision - pursuit) * 0.036 +
            (coachRules
              ? (75 - mean(defenders.map((p) => skill(p, "tackling")))) *
                  0.025 +
                (75 -
                  mean(
                    defenders
                      .filter((p) => p.position === "LB")
                      .map((p) => skill(p, "awareness")),
                  )) *
                  0.012
              : 0) +
            (power - 75) * 0.012 -
            (tendency(def, "run_defense") - 0.5) * 1.2 +
            (rpo ? 0.3 : 0);
          if (modern)
            average +=
              runConcept < 0.24
                ? blitz
                  ? 1
                  : -0.25
                : runConcept < 0.5
                  ? (speed - pursuit) * 0.025
                  : runConcept < 0.72
                    ? (power - shed) * 0.018
                    : 0;
          gain = Math.round(average + normal() * 2.8);
          if (random() < clamp(0.035 + (speed - 80) * 0.0015, 0.01, 0.08))
            gain += Math.round(9 + random() * 28);
          gain = Math.min(100 - spot, Math.max(-6, gain));
          if (
            modern &&
            gain > 0 &&
            random() <
              clamp(
                0.07 +
                  (power - mean(defenders.map((p) => skill(p, "tackling")))) *
                    0.003,
                0.015,
                0.22,
              )
          ) {
            brokenTackle = true;
            gain = Math.min(100 - spot, gain + Math.round(2 + random() * 5));
          }
          ps[carrier.id].rushing_attempts++;
          ps[carrier.id].rushing_yards += gain;
          ts.rushing_yards += gain;
          call = option
            ? "Read option"
            : rpo
              ? "RPO handoff"
              : runBlock > shed
                ? "Inside zone"
                : "Outside zone";
          if (modern) {
            const concept = runConcept;
            call = option
              ? "Read option"
              : rpo
                ? "RPO handoff"
                : concept < 0.24
                  ? "Draw"
                  : concept < 0.5
                    ? "Outside stretch"
                    : concept < 0.72
                      ? "Power counter"
                      : "Inside zone";
            explanation =
              runBlock > shed + 5
                ? "The offensive line opens a running lane."
                : shed > runBlock + 5
                  ? "The defensive front sheds blocks and squeezes the lane."
                  : "The runner follows his blockers into the second level.";
          }
          description = `${carrier.name} runs for ${gain} yards.`;
        }
        if (
          !turnover &&
          (kind === "run" || completed) &&
          random() <
            clamp(
              0.009 +
                (80 - skill(carrier, "carrying")) * 0.00035 +
                tendency(def, "aggression") * 0.003,
              0.003,
              0.04,
            )
        ) {
          turnover = true;
          ps[carrier.id].fumbles_lost++;
          description += " Fumble recovered by the defense!";
          stopped = true;
        }
        if (turnover) {
          ts.turnovers++;
        }
        const end = spot + gain;
        if (!turnover && end >= 100) {
          td = true;
          tdPending = true;
          ts.score += 6;
          scoring = true;
          if (completed && target) {
            ps[qb.id].passing_touchdowns++;
            ps[target.id].receiving_touchdowns++;
          } else ps[carrier.id].rushing_touchdowns++;
          description += " TOUCHDOWN!";
          stopped = true;
        } else if (!turnover && end <= 0) {
          ds.score += 2;
          scoring = true;
          description += " SAFETY!";
          stopped = true;
        } else if (
          !turnover &&
          kind !== "sack" &&
          (kind === "run" || completed)
        ) {
          tackler = defenders[Math.floor(random() * defenders.length)];
          ps[tackler.id].tackles++;
        }
        if (!turnover && end > 0 && (gain >= distance || td)) {
          ts.first_downs++;
          if (down === 3) ts.third_conversions++;
          if (down === 4) ts.fourth_conversions++;
        }
        if (completed && random() < 0.12 && clock < 120) stopped = true;
      }
    }
    // Timeline geometry uses the same carrier, target, result, and field location as resolution.
    const dir = off === 0 ? 1 : -1,
      global = (x: number) => (off === 0 ? x : 100 - x);
    const offensiveY: Record<string, number> = {
      QB: 26.65,
      HB: 30,
      WR1: 4,
      WR2: 49,
      SLOT: 13,
      TE: 37,
      LT: 21,
      LG: 24,
      C: 26.65,
      RG: 29,
      RT: 32,
    };
    const defensiveY: Record<string, number> = {
      EDGE1: 18,
      DT1: 24,
      DT2: 29,
      EDGE2: 35,
      LB1: 15,
      LB2: 26.65,
      LB3: 39,
      LB4: 34,
      CB1: 4,
      CB2: 49,
      CB3: 13,
      FS: 20,
      SS: 35,
    };
    const endX = clamp(startSpot + gain, 0, 100),
      targetRole = offense.find((x) => x.p.id === target?.id)?.role || "HB",
      endY = clamp(
        (offensiveY[targetRole] ?? 30) + (random() - 0.5) * 8,
        3,
        50,
      );
    const end: Spot = [global(endX), endY];
    let agents: Agent[] = offense.map(({ role, p }) => {
      let x = startSpot - (role === "QB" ? 5 : role === "HB" ? 7 : 0),
        y = offensiveY[role] ?? 26.65;
      let finish: Spot =
        role === "QB"
          ? [global(startSpot - 7), 26.65]
          : role === "HB"
            ? [
                global(startSpot + (kind === "run" ? gain : 2)),
                kind === "run" ? endY : 32,
              ]
            : role.startsWith("WR") || ["SLOT", "TE"].includes(role)
              ? [
                  global(
                    clamp(
                      startSpot +
                        Math.max(3, passDepth) +
                        (role === "WR2" ? 4 : 0),
                      0,
                      100,
                    ),
                  ),
                  y + (y < 26 ? 4 : -4),
                ]
              : [global(startSpot + 1), y];
      if (p.id === carrier.id && !turnover && !sacked) finish = end;
      if (role === "QB" && sacked) finish = end;
      if (p.id === target?.id && kind === "pass")
        return {
          id: p.id,
          team: team.id,
          role,
          path: [
            [global(x), y],
            [global(startSpot + 3), y],
            [global(clamp(startSpot + passDepth, 0, 100)), endY],
            completed
              ? end
              : [global(clamp(startSpot + passDepth, 0, 100)), endY],
          ],
        };
      if (p.id === carrier.id && kind === "run")
        return {
          id: p.id,
          team: team.id,
          role,
          path: [
            [global(x), y],
            [global(startSpot - 3), 26.65],
            [global(startSpot + gain * 0.4), endY],
            end,
          ],
        };
      return {
        id: p.id,
        team: team.id,
        role,
        path: [
          [global(x), y],
          [global(x + (role === "QB" ? -2 : 2)), y],
          finish,
        ],
      };
    });
    agents.push(
      ...defense.map(({ role, p }, i): Agent => {
        const y = defensiveY[role] ?? 7 + i * 4,
          x =
            startSpot +
            (role.startsWith("CB")
              ? 2
              : ["FS", "SS"].includes(role)
                ? 13
                : role.startsWith("LB")
                  ? 5
                  : 1.5);
        let finish: Spot =
          role.startsWith("EDGE") || role.startsWith("DT")
            ? [global(startSpot - (kind === "pass" || sacked ? 5 : 0)), y]
            : [global(startSpot + Math.max(4, passDepth)), y];
        if (turnover && p.id === interceptor?.id) finish = end;
        else if ((kind === "run" || completed || sacked) && i % 3 === 0)
          finish = [
            end[0] + dir * (i % 2 ? 1 : -1),
            clamp(endY + (i % 2 ? 1.5 : -1.5), 1, 52),
          ];
        if (man && role.startsWith("CB"))
          finish = [
            global(clamp(startSpot + Math.max(4, passDepth), 0, 100)),
            y + (y < 26 ? 4 : -4),
          ];
        return {
          id: p.id,
          team: def.id,
          role,
          path: [[global(x), y], [global(x - 1), y], finish],
        };
      }),
    );
    if (["field_goal", "punt", "extra_point"].includes(kind)) {
      agents[0] = {
        id: carrier.id,
        team: team.id,
        role: kind === "punt" ? "P" : "K",
        path: [
          [global(startSpot - 9), 26.65],
          [global(startSpot - 7), 26.65],
          [global(startSpot - 5), 26.65],
        ],
      };
      ballStart = [startSpot - 7, 26.65];
    }
    if (kind === "pass" || turnover) {
      ballEnd = [
        clamp(startSpot + (turnover ? gain : passDepth), 0, 100),
        endY,
      ];
    } else if (!["field_goal", "punt", "extra_point"].includes(kind)) {
      ballEnd = [endX, endY];
    }
    const ball: Spot[] = [
      [global(ballStart[0]), ballStart[1]],
      [global(startSpot - (kind === "pass" ? 7 : 3)), 26.65],
      [global(ballEnd[0]), ballEnd[1]],
      completed || kind === "run" ? end : [global(ballEnd[0]), ballEnd[1]],
    ];
    let runoff = conversion
      ? 0
      : kind === "kneel"
        ? 39
        : stopped
          ? 0
          : Math.round(24 + (1 - tendency(team, "tempo")) * 12);
    if (
      ((quarter >= 4 && deficit > 0) ||
        (modern && quarter === 2 && clock < 90)) &&
      clock < 180
    )
      runoff = Math.min(runoff, 7);
    if (
      (quarter >= 4 || (modern && quarter === 2)) &&
      clock < 120 &&
      deficit < 0 &&
      timeouts[1 - off] > 0 &&
      !stopped
    ) {
      timeouts[1 - off]--;
      runoff = 0;
      description += ` ${def.id} timeout.`;
    }
    if (
      modern &&
      [2, 4].includes(quarter) &&
      clock < 90 &&
      (deficit >= 0 || quarter === 2) &&
      !stopped &&
      timeouts[off] > 0 &&
      clock - runoff < 15
    ) {
      timeouts[off]--;
      runoff = 0;
      description += ` ${team.id} timeout to preserve the clock.`;
    }
    liveSeconds = conversion
      ? 0
      : modern && kind === "spike"
        ? 2
        : Math.round(5 + random() * 5);
    let elapsed = Math.min(clock, liveSeconds + runoff);
    if ([2, 4].includes(quarter) && clock > 120 && clock - elapsed < 120)
      elapsed = clock - 120;
    clock = Math.max(0, clock - elapsed);
    ts.time_of_possession += elapsed;
    const actualEndSpot = clamp(startSpot + gain, 0, 100);
    const recorded: Play = {
      index: plays.length,
      quarter,
      clock: startClock,
      endClock: clock,
      offense: team.id,
      kind,
      description,
      down: startDown,
      distance: startDistance,
      spot: global(startSpot),
      endSpot: global(actualEndSpot),
      yards: gain,
      homeScore: stats[teams[0].id].score,
      awayScore: stats[teams[1].id].score,
      homeTimeouts: timeouts[0],
      awayTimeouts: timeouts[1],
      firstDown: global(Math.min(100, startSpot + startDistance)),
      agents,
      ball,
      ballAt: [0, 0.26, 0.68, 1],
      turnover,
      scoring,
      target: target?.id,
      carrier: carrier.id,
      coverage,
      call,
    };
    if (modern) {
      Object.assign(recorded, {
        tackler: tackler?.id,
        brokenTackle,
        blitz,
        homeScoreBefore: beforeScores[0],
        awayScoreBefore: beforeScores[1],
        homeTimeoutsBefore: beforeTimeouts[0],
        awayTimeoutsBefore: beforeTimeouts[1],
        playClock: stopped ? 25 : 40,
        explanation,
      });
      buildModernTimeline(
        recorded,
        offense,
        defense,
        catalog,
        fatigue,
        input.seed,
      );
      for (const p of [...offense, ...defense])
        fatigue[p.p.id] = clamp(
          (fatigue[p.p.id] || 0) +
            (["RB", "EDGE", "DE", "DT"].includes(p.p.position) ? 13 : 5),
          0,
          100,
        );
      const used = new Set([...offense, ...defense].map((x) => x.p.id));
      for (const id of Object.keys(fatigue))
        if (!used.has(id)) fatigue[id] = Math.max(0, fatigue[id] - 18);
      if (stopped || conversion)
        for (const id of Object.keys(fatigue))
          fatigue[id] = Math.max(0, fatigue[id] - 7);
    }
    plays.push(recorded);
    if (conversion) {
      switchPossession(35);
    } else if (kind === "field_goal") {
      switchPossession(scoring ? 35 : Math.max(20, 100 - (startSpot - 7)));
    } else if (kind === "punt") {
      switchPossession(
        startSpot + gain >= 100
          ? 20
          : Math.max(1, 100 - (startSpot + gain) + Math.round(random() * 8)),
      );
    } else if (turnover) {
      switchPossession(actualEndSpot >= 100 ? 20 : 100 - actualEndSpot);
    } else if (td) {
      spot = 98;
      down = 1;
      distance = 2;
    } else if (actualEndSpot <= 0) {
      switchPossession(35);
    } else if (gain >= distance) {
      spot = actualEndSpot;
      down = 1;
      distance = Math.min(10, 100 - spot);
    } else if (down === 4) {
      switchPossession(100 - actualEndSpot);
    } else {
      spot = actualEndSpot;
      down++;
      distance = Math.min(100 - spot, distance - gain);
    }
    if (ot && scoring && actualEndSpot <= 0) break;
    if (
      ot &&
      otHad.every(Boolean) &&
      stats[teams[0].id].score !== stats[teams[1].id].score &&
      !tdPending
    )
      break;
  }
  if (plays.length >= 450) throw Error("Simulation exceeded play guard");
  return {
    engine_version: modern
      ? "ff-football-3"
      : coachRules
        ? ENGINE_VERSION
        : "ff-football-1",
    plays,
    players: catalog,
    box: { teams: stats, players: ps },
    home_score: stats[teams[0].id].score,
    away_score: stats[teams[1].id].score,
  };
}

/** Fatigue belongs to this seeded game only; base player profiles are never edited. */
function restedTeam(
  team: TeamInput,
  fatigue: Record<string, number>,
): TeamInput {
  const depth = { ...team.depth };
  for (const group of ["RB", "EDGE", "DT"]) {
    const ids = depth[group];
    if (!ids) continue;
    depth[group] = [...ids].sort((a, b) => {
      const score = (id: string) => {
        const p = team.players.find((p) => p.id === id);
        return (p?.overall || 0) - Math.max(0, (fatigue[id] || 0) - 25) * 0.38;
      };
      return score(b) - score(a) || ids.indexOf(a) - ids.indexOf(b);
    });
  }
  return {
    ...team,
    depth,
    players: team.players.map((p) => {
      const penalty = Math.max(0, (fatigue[p.id] || 0) - 30) * 0.12;
      return {
        ...p,
        attributes: Object.fromEntries(
          Object.entries(p.attributes).map(([k, v]) => [
            k,
            clamp(v - penalty, 1, 99),
          ]),
        ),
      };
    }),
  };
}

/** All coordinates and possession changes below describe the already resolved play. */
function buildModernTimeline(
  play: Play,
  offense: ReturnType<typeof selectPersonnel>,
  defense: ReturnType<typeof selectPersonnel>,
  catalog: GameResult["players"],
  fatigue: Record<string, number>,
  seed: number,
) {
  const random = generator(seed ^ Math.imul(play.index + 1, 0x9e3779b1));
  const direction =
    play.offense === catalog[offense[0].p.id].team &&
    play.agents[0].path[0][0] < play.spot
      ? 1
      : -1;
  const d = direction;
  const forward = (yards: number) => play.spot + d * yards;
  const safe = (p: Spot): Spot => [clamp(p[0], -9, 109), clamp(p[1], 1, 52.3)];
  const at = [0, 0.12, 0.2, 0.48, 0.68, 0.86, 1];
  const kick = ["punt", "field_goal", "extra_point"].includes(play.kind);
  const passing = play.kind === "pass";
  const sack = play.kind === "sack";
  const fumble = play.description.includes("Fumble");
  const interception = passing && play.turnover && !fumble;
  const complete = passing && play.description.includes("completes to");
  const run = ["run", "two_point", "kneel"].includes(play.kind);
  const originalEnd = play.ball.at(-1)!;
  const end: Spot = [
    play.kind === "two_point" && play.scoring
      ? d > 0
        ? 100
        : 0
      : play.endSpot,
    originalEnd[1],
  ];
  const target = offense.find((x) => x.p.id === play.target);
  const qb = offense[0].p;
  const rb = offense[1].p;
  const shotgun = /screen|Mesh|Four|RPO|Flood|Stick/i.test(play.call);
  play.formation = kick
    ? "Special teams"
    : play.kind === "kneel"
      ? "Victory"
      : /Play action|Power|flicker/i.test(play.call)
        ? "Singleback"
        : shotgun
          ? "Shotgun trips"
          : "Singleback spread";
  play.personnel = kick ? "Kicking unit" : "11 personnel · 1 RB · 1 TE · 3 WR";
  play.coverage = kick
    ? "Kick defense"
    : `${play.coverage}${play.call.includes("blitz") ? " · pressure" : ""}`;
  const blitz = play.blitz === true;
  if (blitz && !kick) play.coverage += " · LB blitz";
  if (!blitz && !kick)
    play.coverage += play.coverage.startsWith("Man")
      ? " · two-high help"
      : " · Cover 3 shell";
  const yByRole: Record<string, number> = {
    QB: 26.65,
    HB: 32,
    WR1: 5,
    WR2: 48,
    SLOT: shotgun ? 40 : 13,
    TE: 36,
    LT: 21,
    LG: 24,
    C: 26.65,
    RG: 29,
    RT: 32,
  };
  const defenderY: Record<string, number> = {
    EDGE1: 18,
    DT1: 24,
    DT2: 29,
    EDGE2: 35,
    LB1: 13,
    LB2: 26,
    LB3: 40,
    LB4: 34,
    CB1: 5,
    CB2: 48,
    CB3: 40,
    FS: 18,
    SS: 36,
  };
  const snap: Spot = [play.spot, 26.65];
  const qbStart: Spot = [forward(shotgun ? -5 : -1.5), 26.65];
  const pocket: Spot = [forward(-7), 26.65];
  const targetStartY = yByRole[target?.role || "HB"] || 32;
  const catchSpot: Spot =
    complete || interception
      ? safe([play.ball[2][0], end[1]])
      : safe([play.ball[2][0], targetStartY + (random() - 0.5) * 6]);
  // A completion cannot be caught beyond the recorded final spot.
  if (complete && d * (catchSpot[0] - end[0]) > 0) catchSpot[0] = end[0];
  if (interception) {
    catchSpot[0] = end[0];
    catchSpot[1] = end[1];
  }
  const handoff: Spot = [forward(-3), 28];
  const lane = /Outside|stretch/i.test(play.call)
    ? random() < 0.5
      ? 9
      : 44
    : /counter/i.test(play.call)
      ? 20
      : 28;
  if (run)
    end[1] =
      play.kind === "kneel" ? 26.65 : clamp(lane + (random() - 0.5) * 8, 3, 50);
  if (sack) end[1] = 26.65;
  const middle: Spot = [play.spot + (end[0] - play.spot) * 0.45, lane];
  const routes = new Map<string, Spot[]>();
  const build = (
    id: string,
    team: string,
    role: string,
    path: Spot[],
  ): Agent => ({
    id,
    team,
    role,
    path: path.map(safe),
    at: [...at],
    fatigue: Math.round(fatigue[id] || 0),
  });
  const agents: Agent[] = offense.map(({ role, p }, i) => {
    const y = yByRole[role] || 26.65;
    const start: Spot =
      role === "QB"
        ? qbStart
        : role === "HB"
          ? [forward(-6), 32]
          : [forward(role === "SLOT" ? -1 : 0), y];
    let path: Spot[];
    if (role === "QB")
      path = [
        start,
        start,
        qbStart,
        pocket,
        sack ? end : pocket,
        sack ? end : pocket,
        sack ? end : pocket,
      ];
    else if (["LT", "LG", "C", "RG", "RT"].includes(role)) {
      const opponentRole: Record<string, string> = {
        LT: "EDGE1",
        LG: "DT1",
        RG: "DT2",
        RT: "EDGE2",
      };
      const opponent = defense.find((x) => x.role === opponentRole[role]);
      const push =
        run && opponent
          ? (skill(p, "run_blocking") - skill(opponent.p, "block_shedding")) *
            0.035
          : 0;
      const edge: Spot = [
        forward(passing || sack ? -1 : 1.8 + push),
        opponent ? defenderY[opponent.role] : y,
      ];
      path = [start, start, start, edge, edge, edge, edge];
    } else if (role === "HB") {
      path = [
        start,
        start,
        handoff,
        run ? handoff : [forward(-4), 30],
        run ? middle : [forward(2), 34],
        run ? end : [forward(4), 36],
        run ? end : [forward(4), 36],
      ];
    } else {
      const speed = skill(p, "speed");
      const depth = /Four|flicker/i.test(play.call)
        ? 25
        : /screen/i.test(play.call)
          ? 2
          : 8 + (speed - 75) * 0.15;
      const cross = /cross|Mesh|slant/i.test(play.call);
      const bend: Spot = [
        forward(cross ? 4 : depth * 0.5),
        cross ? y + (y < 26 ? 8 : -8) : y,
      ];
      const destination: Spot = [
        forward(depth),
        cross ? 53.3 - y : y + (y < 26 ? 3 : -3),
      ];
      path = [
        start,
        start,
        [forward(1), y],
        bend,
        destination,
        destination,
        destination,
      ];
    }
    if (p.id === play.target && passing)
      path = [
        start,
        start,
        [forward(1), y],
        [
          play.spot + (catchSpot[0] - play.spot) * 0.5,
          (y + catchSpot[1]) * 0.5,
        ],
        catchSpot,
        complete ? end : catchSpot,
        complete ? end : catchSpot,
      ];
    if (p.id === play.carrier && run)
      path = [
        start,
        start,
        p.id === qb.id ? qbStart : handoff,
        handoff,
        middle,
        end,
        end,
      ];
    routes.set(role, path);
    return build(p.id, play.offense, role, path);
  });
  const defenseTeam = play.agents.find((a) => a.team !== play.offense)!.team;
  const targetRole = target?.role || "WR1";
  const paired: Record<string, string> = {
    CB1: "WR1",
    CB2: "WR2",
    CB3: "SLOT",
    SS: "TE",
    LB1: "HB",
  };
  const man = play.coverage.startsWith("Man");
  const recoveryPlayer = fumble
    ? defense.find((x) => x.role.startsWith("LB")) || defense[0]
    : undefined;
  if (recoveryPlayer) play.recovery = recoveryPlayer.p.id;
  const interceptAgent = interception
    ? defense.find((x) => x.p.id === play.carrier)
    : undefined;
  for (const { role, p } of defense) {
    const y = defenderY[role] || 26.65;
    const line = /EDGE|DT/.test(role);
    const start: Spot = [
      forward(
        line ? 1.5 : /FS|SS/.test(role) ? 14 : role.startsWith("CB") ? 3 : 5,
      ),
      y,
    ];
    const rush = line || (blitz && role === "LB2");
    const coverRole = paired[role] || targetRole;
    const receiverRoute = routes.get(coverRole)!;
    let path: Spot[];
    if (rush) {
      const engagement: Spot = [forward(passing || sack ? -1 : 1.8), y];
      const blockerRole: Record<string, string> = {
        EDGE1: "LT",
        DT1: "LG",
        DT2: "RG",
        EDGE2: "RT",
      };
      const blocker = offense.find((x) => x.role === blockerRole[role]);
      const wins = blocker
        ? Math.max(skill(p, "power_moves"), skill(p, "finesse_moves")) -
          skill(blocker.p, "pass_blocking")
        : 10;
      const breakthrough: Spot =
        sack && p.id === play.tackler
          ? end
          : wins > 3
            ? [forward(-4), y + (26 - y) * 0.25]
            : engagement;
      path = [
        start,
        start,
        start,
        engagement,
        passing || sack ? breakthrough : [forward(2), y],
        breakthrough,
        breakthrough,
      ];
    } else if (man && paired[role] && passing) {
      const lag = clamp(
        (skill(
          catalog[offense.find((x) => x.role === coverRole)!.p.id],
          "speed",
        ) -
          skill(p, "speed")) *
          0.04 +
          0.8,
        0.2,
        3,
      );
      path = receiverRoute.map((point, i) =>
        i < 3
          ? start
          : ([point[0] - d * lag, point[1] + (y < 26 ? -1 : 1)] as Spot),
      );
    } else {
      const zone: Spot = [
        forward(/FS|SS/.test(role) ? 20 : role.startsWith("CB") ? 12 : 7),
        y,
      ];
      path = [start, start, start, zone, zone, zone, zone];
    }
    if ((run || complete || sack) && !play.scoring && !play.turnover) {
      const finish: Spot =
        p.id === play.tackler
          ? end
          : [
              end[0] - d * (2 + random() * 5),
              clamp(end[1] + (y < end[1] ? -1 : 1) * (2 + random() * 4), 1, 52),
            ];
      if (!line || p.id === play.tackler) {
        path[5] = finish;
        path[6] = finish;
      }
    }
    if (interceptAgent?.p.id === p.id) {
      path[4] = catchSpot;
      path[5] = catchSpot;
      path[6] = catchSpot;
    }
    if (recoveryPlayer?.p.id === p.id) {
      path[5] = [end[0] - d, end[1] + 1];
      path[6] = [end[0] + d * 0.5, end[1] + 0.7];
    }
    agents.push(build(p.id, defenseTeam, role, path));
  }
  // Align the participant awarded the tackle/sack exactly with the recorded carrier endpoint.
  if (play.brokenTackle && !play.turnover) {
    const missed = agents.find(
      (a) =>
        a.team !== play.offense &&
        a.id !== play.tackler &&
        a.role.startsWith("LB"),
    );
    if (missed) {
      missed.path[4] = safe(middle);
      missed.path[5] = safe([middle[0] - d, middle[1] + 2]);
      missed.path[6] = missed.path[5];
    }
    play.description += " He breaks a tackle for extra yards.";
  }
  if (play.tackler && !play.scoring && !play.turnover) {
    const a = agents.find((a) => a.id === play.tackler);
    if (a) {
      a.path[5] = safe(end);
      a.path[6] = safe(end);
    }
  }
  if (kick) {
    const kickerStart: Spot = [forward(-10), 26.65],
      contact: Spot = [forward(-7), 26.65];
    agents[0] = build(
      play.carrier!,
      play.offense,
      play.kind === "punt" ? "P" : "K",
      [
        kickerStart,
        kickerStart,
        kickerStart,
        kickerStart,
        contact,
        contact,
        contact,
      ],
    );
    const kickEnd: Spot =
      play.kind === "punt"
        ? originalEnd
        : [d > 0 ? 105 : -5, play.scoring ? 26.65 : 36];
    play.ball = [
      snap,
      snap,
      play.kind === "punt" ? kickerStart : contact,
      play.kind === "punt" ? kickerStart : contact,
      kickEnd,
      kickEnd,
      kickEnd,
    ].map(safe);
    play.possession = [
      { at: 0, id: null },
      { at: 0.2, id: play.kind === "punt" ? play.carrier! : null },
      { at: 0.48, id: null },
    ];
  } else {
    const receiver = play.target || play.carrier!;
    const incompleteEnd: Spot = [
      catchSpot[0] +
        d *
          clamp(
            (100 - skill(qb, "medium_accuracy", ["accuracy"])) / 12,
            0.7,
            4,
          ),
      clamp(
        catchSpot[1] + (100 - skill(qb, "medium_accuracy", ["accuracy"])) / 10,
        1,
        52,
      ),
    ];
    play.ball = [
      snap,
      snap,
      qbStart,
      pocket,
      passing
        ? complete || interception
          ? catchSpot
          : incompleteEnd
        : sack
          ? end
          : middle,
      passing
        ? complete
          ? end
          : interception
            ? catchSpot
            : incompleteEnd
        : end,
      passing
        ? complete
          ? end
          : interception
            ? catchSpot
            : incompleteEnd
        : end,
    ].map(safe);
    if (run) {
      play.ball[3] = safe(handoff);
      play.ball[2] = safe(play.carrier === qb.id ? qbStart : handoff);
    }
    if (play.kind === "kneel") {
      const a = agents.find((a) => a.id === qb.id)!;
      a.path = [qbStart, qbStart, qbStart, end, end, end, end].map(safe);
      play.ball = [snap, snap, qbStart, end, end, end, end].map(safe);
    }
    if (play.kind === "spike") {
      const a = agents.find((a) => a.id === qb.id)!;
      a.path = [
        qbStart,
        qbStart,
        qbStart,
        qbStart,
        qbStart,
        qbStart,
        qbStart,
      ].map(safe);
      play.ball = (
        [
          snap,
          snap,
          qbStart,
          qbStart,
          [qbStart[0], 28],
          [qbStart[0], 28],
          [qbStart[0], 28],
        ] as Spot[]
      ).map(safe);
    }
    play.possession = [
      { at: 0, id: null },
      { at: 0.2, id: run ? play.carrier! : qb.id },
      { at: 0.48, id: passing ? null : play.carrier! },
      {
        at: 0.68,
        id: passing
          ? complete || interception
            ? interception
              ? play.carrier!
              : receiver
            : null
          : play.carrier!,
      },
    ];
    if (/Play action/i.test(play.call) && (passing || sack)) {
      const a = agents.find(a => a.id === qb.id)!;
      a.path[2] = safe(handoff);
      play.ball[2] = safe(handoff);
    }
    if (/Flea flicker/i.test(play.call) && passing) {
      const q = agents.find(a => a.id === qb.id)!, r = agents.find(a => a.id === rb.id)!;
      q.path = [qbStart,qbStart,handoff,pocket,pocket,pocket,pocket,pocket,pocket].map(safe);
      q.at = [0,.12,.2,.32,.42,.48,.68,.86,1];
      r.path[2] = safe(handoff); r.path[3] = safe(handoff);
      const landing = complete || interception ? catchSpot : incompleteEnd;
      play.ball = [snap,snap,handoff,handoff,pocket,pocket,landing,complete ? end : landing,complete ? end : landing].map(safe);
      play.possession = [{at:0,id:null},{at:.2,id:rb.id},{at:.32,id:null},{at:.42,id:qb.id},{at:.48,id:null},{at:.68,id:complete || interception ? play.carrier! : null}];
    }
    if (play.kind === "spike")
      play.possession = [
        { at: 0, id: null },
        { at: 0.2, id: qb.id },
        { at: 0.48, id: null },
      ];
    if (fumble) {
      play.ball[play.ball.length - 1] = safe([end[0] + d * 0.5, end[1] + 0.7]);
      play.possession.push(
        { at: 0.86, id: null },
        { at: 1, id: play.recovery! },
      );
    }
  }
  play.ballAt = play.ball.length === 9 ? [0,.12,.2,.32,.42,.48,.68,.86,1] : [...at];
  play.agents = agents;
  if (play.tackler && !play.scoring && !play.turnover)
    play.description += ` Tackled by ${catalog[play.tackler].name}.`;
  if (fumble && play.recovery)
    play.description += ` ${catalog[play.recovery].name} recovers.`;
  if (play.explanation) play.description += ` ${play.explanation}`;
}
