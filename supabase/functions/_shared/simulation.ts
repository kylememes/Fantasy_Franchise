/** Pure authoritative football engine. No browser, database, clock or unseeded randomness. */
export const ENGINE_VERSION = "ff-football-1";
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
};
export type GameInput = {
  seed: number;
  phase: "preseason" | "regular";
  home: TeamInput;
  away: TeamInput;
};
export type Spot = [number, number];
export type Agent = { id: string; team: string; role: string; path: Spot[] };
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
    const offense = selectPersonnel(
        team,
        "offense",
        quarter,
        input.phase === "preseason",
      ),
      defense = selectPersonnel(
        def,
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
    const runBlock = mean(
        ol.map((p) => skill(p, "run_blocking", ["run_block", "blocking"])),
      ),
      passBlock = mean(
        ol.map((p) => skill(p, "pass_blocking", ["pass_block", "blocking"])),
      ),
      rush = mean(
        dl.map((p) =>
          Math.max(
            skill(p, "power_moves", ["pass_rush"]),
            skill(p, "finesse_moves", ["pass_rush"]),
          ),
        ),
      ),
      shed = mean(dl.map((p) => skill(p, "block_shedding", ["tackling"]))),
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
    const deficit = ds.score - ts.score,
      seconds = quarter >= 4 ? clock : 9999;
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
        down < 4
      ) {
        kind = "kneel";
        gain = -1;
        carrier = qb;
        description = `${qb.name} takes a knee.`;
        call = "Victory formation";
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
            cov = skill(corner, man ? "man_coverage" : "zone_coverage", [
              "coverage",
            ]);
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
          if (random() < sackChance) {
            kind = "sack";
            sacked = true;
            gain = -Math.round(3 + random() * 7);
            const rusher = dl[Math.floor(random() * dl.length)];
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
          const vision = skill(carrier, "ball_carrier_vision", [
              "vision",
              "awareness",
            ]),
            power = skill(carrier, "trucking", ["strength"]),
            speed = skill(carrier, "speed");
          let average =
            3.6 +
            (runBlock - shed) * 0.075 +
            (vision - pursuit) * 0.036 +
            (power - 75) * 0.012 -
            (tendency(def, "run_defense") - 0.5) * 1.2 +
            (rpo ? 0.3 : 0);
          gain = Math.round(average + normal() * 2.8);
          if (random() < clamp(0.035 + (speed - 80) * 0.0015, 0.01, 0.08))
            gain += Math.round(9 + random() * 28);
          gain = Math.min(100 - spot, Math.max(-6, gain));
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
          const tackler = defenders[Math.floor(random() * defenders.length)];
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
    if (quarter >= 4 && clock < 180 && deficit > 0)
      runoff = Math.min(runoff, 7);
    if (
      quarter >= 4 &&
      clock < 120 &&
      deficit < 0 &&
      timeouts[1 - off] > 0 &&
      !stopped
    ) {
      timeouts[1 - off]--;
      runoff = 0;
      description += ` ${def.id} timeout.`;
    }
    liveSeconds = conversion ? 0 : Math.round(5 + random() * 5);
    let elapsed = Math.min(clock, liveSeconds + runoff);
    if ([2, 4].includes(quarter) && clock > 120 && clock - elapsed < 120)
      elapsed = clock - 120;
    clock = Math.max(0, clock - elapsed);
    ts.time_of_possession += elapsed;
    const actualEndSpot = clamp(startSpot + gain, 0, 100);
    plays.push({
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
    });
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
    engine_version: ENGINE_VERSION,
    plays,
    players: catalog,
    box: { teams: stats, players: ps },
    home_score: stats[teams[0].id].score,
    away_score: stats[teams[1].id].score,
  };
}
