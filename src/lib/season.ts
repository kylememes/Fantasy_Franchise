import type {
  GameResult,
  Play,
} from "../../supabase/functions/_shared/simulation";
export type Week = {
  league_id: string;
  season: number;
  year: number;
  phase: "preseason" | "regular";
  week: number;
  status: "setup" | "open" | "complete";
};
export type Fixture = {
  id: string;
  phase: Week["phase"];
  week: number;
  home: string;
  away: string;
  kickoff: string | null;
  status:
    "scheduled" | "queued" | "building" | "live" | "paused" | "final" | "error";
  home_score: number | null;
  away_score: number | null;
};
export type StaffHire = {
  league_id: string;
  franchise_id: string;
  role: "HC" | "OC" | "DC";
  coach_id: string;
};
export type Standing = {
  id: string;
  conference: string;
  division: string;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
  differential: number;
};
export type SeasonSnapshot = {
  season: Week;
  games: Fixture[];
  staff: StaffHire[];
  standings: Standing[];
};
export type GameSnapshot = {
  game: Fixture & {
    cursor: number;
    speed: number;
    box: GameResult["box"] | null;
    finalized_at: string | null;
  };
  ready: string[];
  owners: { team: string; user_id: string }[];
  players: GameResult["players"] | null;
  total_plays: number;
  plays: Play[];
  staff: { home: Record<string, string>; away: Record<string, string> } | null;
  coaching: {
    home: { offense: string; defense: string };
    away: { offense: string; defense: string };
  } | null;
};
export const weekLabel = (w: Pick<Week, "phase" | "week">) =>
  `${w.phase === "preseason" ? "Preseason" : "Regular season"} · Week ${w.week}`;
export function mergeGame(
  previous: GameSnapshot | null,
  incoming: GameSnapshot,
): GameSnapshot {
  if (previous?.game.id !== incoming.game.id) return incoming;
  const plays = new Map(previous.plays.map((p) => [p.index, p]));
  for (const p of incoming.plays) plays.set(p.index, p);
  return {
    ...incoming,
    players: incoming.players || previous.players,
    plays: [...plays.values()].sort((a, b) => a.index - b.index),
  };
}
