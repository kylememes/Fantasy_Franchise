import trial from "../../data/qb-headshots.json";
import { developmentTier } from "./lineup";
import type { Player } from "./types";
/** Trial is restricted to verified real QBs, matched by stable identity, never by fuzzy name. */
export function playerHeadshot(player?: Player): string | null {
  if (!player || player.is_fictional || player.position !== "QB") return null;
  const tier = developmentTier(player.development).key;
  if (tier !== "superstar" && tier !== "franchise") return null;
  const photo = trial.players.find(
    (p) => p.external_id === player.external_id && p.name === player.name,
  );
  return photo?.url || null;
}
