import type { TeamInput } from "../../supabase/functions/_shared/simulation";
export function syntheticTeam(id: string, rating = 80): TeamInput {
  const positions: Record<string, number> = {
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
  let n = 0;
  const players = Object.entries(positions).flatMap(([position, count]) =>
    Array.from({ length: count }, (_, i) => ({
      id: id + "-" + position + i,
      name: `${id} ${position} ${i + 1}`,
      position,
      jersey: ++n,
      overall: rating - i * 3,
      attributes: Object.fromEntries(
        [
          "speed",
          "acceleration",
          "awareness",
          "strength",
          "throw_power",
          "short_accuracy",
          "medium_accuracy",
          "deep_accuracy",
          "pressure_response",
          "mobility",
          "catching",
          "carrying",
          "vision",
          "agility",
          "power",
          "short_route",
          "medium_route",
          "deep_route",
          "release",
          "contested_catch",
          "run_blocking",
          "pass_blocking",
          "block_shedding",
          "tackling",
          "pursuit",
          "man_coverage",
          "zone_coverage",
          "press",
          "power_moves",
          "finesse_moves",
          "kick_power",
          "kick_accuracy",
        ].map((k) => [k, rating - i * 3]),
      ),
    })),
  );
  return {
    id,
    players,
    depth: Object.fromEntries(
      Object.keys(positions)
        .filter((k) => k !== "DE")
        .map((k) => [
          k,
          players
            .filter((p) =>
              k === "EDGE"
                ? ["EDGE", "DE"].includes(p.position)
                : p.position === k,
            )
            .map((p) => p.id),
        ]),
    ),
    coaching: { offense: "Balanced", defense: "4–3", tendencies: {} },
  };
}
