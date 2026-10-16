import type {
  DraftContract,
  Franchise,
  Management,
  Player,
  RookiePick,
} from "./types";

export const pickLabel = (p: RookiePick) =>
  `Season ${p.season} · Round ${p.round} · ${p.original_franchise} original`;
export function playerTradeValue(
  p: Player,
  c: DraftContract | undefined,
  season: number,
) {
  if (!c) return 0;
  const tier = p.development.toLowerCase();
  const development = ["franchise superstar", "generational"].includes(tier)
    ? 1.2
    : tier === "superstar"
      ? 1.12
      : tier === "star"
        ? 1.05
        : 1;
  const years = Math.max(1, c.start_season + c.years - season);
  return (
    Math.max(1, p.overall - 45) ** 2 *
    (p.position === "QB"
      ? 1.2
      : ["K", "P", "FB"].includes(p.position)
        ? 0.45
        : 1) *
    Math.max(0.65, 1.15 - Math.max(0, p.age - 24) * 0.035) *
    (1 + 0.04 * (years - 1)) *
    Math.max(0.8, 1.08 - c.annual_salary / 150000000) *
    development
  );
}
export function pickTradeValue(p: RookiePick, season: number) {
  return (
    ([1400, 650, 300, 150, 80, 40, 20][p.round - 1] || 0) *
    0.85 ** (p.season - season - 1)
  );
}
export function salaryEffects(
  data: Management,
  team: string,
  give: string[],
  take: string[],
  cap: number,
) {
  const contracts = new Map(
    data.contracts.map((c) => [c.player_id, c.annual_salary]),
  );
  const sum = (ids: string[]) =>
    ids.reduce((total, id) => total + (contracts.get(id) || 0), 0);
  const before = sum(
    data.ownership
      .filter((p) => p.franchise_id === team)
      .map((p) => p.player_id),
  );
  const sent = sum(give),
    received = sum(take),
    change = received - sent;
  return {
    sent,
    received,
    change,
    before,
    after: before + change,
    capSpace: cap - before - change,
  };
}
export function findTradePartners(
  players: Player[],
  data: Management,
  teams: Franchise[],
  mine: string,
  position: string,
  offeredId: string,
) {
  const owner = new Map(
    data.ownership.map((p) => [p.player_id, p.franchise_id]),
  );
  const offered = players.find(
    (p) => p.id === offeredId && owner.get(p.id) === mine,
  );
  return teams
    .filter((t) => t.id !== mine)
    .map((t) => {
      const roster = players.filter((p) => owner.get(p.id) === t.id);
      const candidates = roster
        .filter((p) => !position || p.position === position)
        .sort((a, b) => b.overall - a.overall);
      const candidate = candidates[0];
      const bestAtOfferedPosition = offered
        ? Math.max(
            0,
            ...roster
              .filter((p) => p.position === offered.position)
              .map((p) => p.overall),
          )
        : 0;
      const upgrade = offered ? offered.overall - bestAtOfferedPosition : 0;
      const score =
        (position ? Math.min(candidates.length, 4) * 8 : 0) +
        (candidate?.overall || 0) / 5 +
        upgrade * 3;
      return {
        team: t,
        candidate,
        score,
        reason:
          offered && upgrade > 0
            ? `${offered.name} would improve their top ${offered.position} rating by ${upgrade}.`
            : position
              ? `${candidates.length} ${position} players on their roster to explore.`
              : "Explore their players and future picks.",
      };
    })
    .filter((r) => r.candidate)
    .sort((a, b) => b.score - a.score || a.team.id.localeCompare(b.team.id))
    .slice(0, 5);
}
