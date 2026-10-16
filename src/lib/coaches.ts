import definitions from "../../data/head-coach-bonuses.json";
import aliases from "../../data/attribute-aliases.json";
export type CoachBonus = {
  positions: string[];
  attributes: string[];
  label: string;
  amount: number;
};
export type HeadCoach = { id: string; name: string; bonuses: CoachBonus[] };
export type Boost = { base: number; bonus: number; value: number };
export const headCoachBonuses = definitions;
/** Same rules as boosted_game_profile: previews never mutate saved attributes. */
export function coachedRatings(
  player: {
    position: string;
    overall: number;
    attributes: Record<string, number>;
  },
  coach?: HeadCoach | null,
) {
  const attributes = { ...player.attributes },
    boosts: Record<string, Boost> = {};
  for (const perk of coach?.bonuses || []) {
    if (!perk.positions.includes(player.position)) continue;
    for (const key of perk.attributes) {
      const base =
        boosts[key]?.base ??
        Math.max(
          0,
          Math.min(
            99,
            [key, ...((aliases as Record<string, string[]>)[key] || [])]
              .map((k) => player.attributes[k])
              .find(Number.isFinite) ??
              Math.max(35, Math.min(90, player.overall)),
          ),
        );
      const value = Math.min(
        99,
        base + Math.min(3, (boosts[key]?.bonus || 0) + perk.amount),
      );
      attributes[key] = value;
      boosts[key] = { base, bonus: value - base, value };
    }
  }
  return { attributes, boosts };
}
export const attributeLabels: Record<string, string> = {
  short_accuracy: "Short accuracy",
  medium_accuracy: "Medium accuracy",
  deep_accuracy: "Deep accuracy",
  throw_power: "Throw power",
  pressure_response: "Under pressure",
  vision: "Ballcarrier vision",
  power_moves: "Power rush",
  finesse_moves: "Finesse rush",
  short_route: "Short routes",
  medium_route: "Medium routes",
  deep_route: "Deep routes",
  contested_catch: "Contested catch",
};
export const attributeLabel = (key: string) =>
  attributeLabels[key] || key.replaceAll("_", " ");
