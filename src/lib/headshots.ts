import headshots from "../../data/player-headshots.json";
import { developmentTier } from "./lineup";
import type { Player } from "./types";
const byIdentity = new Map(
  headshots.players.map((photo) => [photo.external_id, photo]),
);
/** Verified real players only; eligibility follows the player's current development tier. */
export function playerHeadshot(player?: Player): string | null {
  if (!player || player.is_fictional || !player.external_id) return null;
  const tier = developmentTier(player.development).key;
  if (tier !== "star" && tier !== "superstar" && tier !== "franchise")
    return null;
  const photo = byIdentity.get(player.external_id);
  return photo?.name === player.name ? photo.url : null;
}
