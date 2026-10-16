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
