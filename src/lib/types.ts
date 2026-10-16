export type DraftState =
  | "waiting"
  | "running"
  | "paused"
  | "awaiting_completion"
  | "completing"
  | "completed";
export type League = {
  id: string;
  name: string;
  commissioner: string;
  state: DraftState;
  next_pick: number;
  revision: number;
  draft_order: string[];
  season: number;
  dataset?: string;
  next_cpu_pick_at?: string;
  salary_cap?: number;
  full_draft_sim?: boolean;
};
export type Franchise = {
  id: string;
  city: string;
  name: string;
  conference: string;
  division: string;
  color: string;
};
export type Player = {
  id: string;
  name: string;
  position: string;
  age: number;
  jersey: number;
  overall: number;
  attributes: Record<string, number>;
  salary: number;
  height_inches: number;
  weight_lbs: number;
  development: string;
  source: string;
  history: string;
  dataset?: string;
  external_id?: string;
  nfl_team?: string | null;
  rating_source?: string;
  overall_source?: string;
  overall_source_row?: number;
  attributes_source?: string;
  attributes_source_row?: number;
  development_source?: string;
  is_fictional?: boolean;
  stats?: Record<string, number>;
};
export type Pick = { pick: number; player_id: string; franchise_id: string };
export type Member = { user_id: string; franchise_id: string };
export type Snapshot = {
  league: League;
  members: Member[];
  picks: Pick[];
  invite: string | null;
  events: { message: string; created_at: string }[];
};
export const limits: Record<string, number> = {
  QB: 3,
  RB: 3,
  FB: 1,
  WR: 6,
  TE: 3,
  LT: 2,
  LG: 2,
  C: 2,
  RG: 2,
  RT: 2,
  EDGE: 4,
  DE: 2,
  DT: 4,
  LB: 5,
  CB: 6,
  FS: 2,
  SS: 2,
  K: 1,
  P: 1,
};
export function onClock(order: string[], pick: number) {
  return order[Math.floor(pick / 32) % 2 === 0 ? pick % 32 : 31 - (pick % 32)];
}
export const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);

export type DraftContract = {
  player_id: string;
  annual_salary: number;
  years: number;
  start_season: number;
  draft_round: number | null;
  origin?: "draft" | "free_agency";
};
export type RookiePick = {
  id: string;
  franchise_id: string;
  original_franchise: string;
  season: number;
  round: number;
};
export type TradeOffer = {
  id: string;
  from_team: string;
  to_team: string;
  give_players: string[];
  take_players: string[];
  give_picks: string[];
  take_picks: string[];
  status: string;
  reason: string;
  give_value: number;
  take_value: number;
  created_at: string;
  resolved_at?: string | null;
  counter_of?: string | null;
  thread_id?: string | null;
  evaluation?: TradePreview;
};
export type TradePreview = {
  valid: boolean;
  is_cpu: boolean;
  cpu_accepts: boolean;
  interest: number | null;
  feedback: string[];
  problems: string[];
  give_value: number;
  take_value: number;
};
export type Coaching = {
  offense: string;
  defense: string;
  tendencies: Record<string, number>;
  version: number;
};
export type Management = {
  head_coach?: import("./coaches").HeadCoach | null;
  revision?: number;
  ownership: { player_id: string; franchise_id: string }[];
  contracts: DraftContract[];
  picks: RookiePick[];
  trades: TradeOffer[];
  human_teams?: string[];
  unread_trade_ids?: string[];
  coaching: Coaching | null;
  depth?: { orders: Record<string, string[]>; version: number };
  free_agents?: { player_id: string; annual_salary: number }[];
};
export function draftContract(round: number) {
  const first = [30, 20, 16, 14, 12, 10, 9, 8, 7, 6, 5, 4.5, 4, 3.5, 3];
  return {
    annual_salary:
      round <= 15
        ? first[round - 1] * 1000000
        : round <= 30
          ? 2750000 - (round - 16) * 100000
          : Math.max(750000, 1250000 - (round - 31) * 25000),
    years:
      round <= 5 ? 5 : round <= 10 ? 4 : round <= 15 ? 3 : round <= 35 ? 2 : 1,
  };
}
