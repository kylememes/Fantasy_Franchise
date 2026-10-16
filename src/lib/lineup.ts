import type { Player } from "./types";
export type FormationSlot = {
  label: string;
  group: string;
  rank: number;
  x: number;
  y: number;
};
export const fieldSlots: Record<string, FormationSlot[]> = {
  Offense: [
    ...["LT", "LG", "C", "RG", "RT", "TE"].map((group, i) => ({
      label: group,
      group,
      rank: 0,
      x: 16 + i * 13.6,
      y: 20,
    })),
    { label: "WR1", group: "WR", rank: 0, x: 10, y: 57 },
    { label: "WR2", group: "WR", rank: 1, x: 90, y: 57 },
    { label: "QB", group: "QB", rank: 0, x: 50, y: 55 },
    { label: "HB", group: "RB", rank: 0, x: 30, y: 82 },
    { label: "SLOT", group: "WR", rank: 2, x: 70, y: 82 },
  ],
  Defense: [
    ...["EDGE1", "DT1", "DT2", "EDGE2"].map((label, i) => ({
      label,
      group: i === 0 || i === 3 ? "EDGE" : "DT",
      rank: i === 0 || i === 1 ? 0 : 1,
      x: 20 + i * 20,
      y: 22,
    })),
    ...[0, 1, 2].map((rank) => ({
      label: `LB${rank + 1}`,
      group: "LB",
      rank,
      x: 25 + rank * 25,
      y: 52,
    })),
    { label: "CB1", group: "CB", rank: 0, x: 10, y: 70 },
    { label: "CB2", group: "CB", rank: 1, x: 90, y: 70 },
    { label: "FS", group: "FS", rank: 0, x: 37, y: 84 },
    { label: "SS", group: "SS", rank: 0, x: 63, y: 84 },
  ],
  "Special teams": [
    { label: "KICKER", group: "K", rank: 0, x: 30, y: 30 },
    { label: "PUNTER", group: "P", rank: 0, x: 70, y: 30 },
    { label: "KICK RETURN", group: "KR", rank: 0, x: 30, y: 75 },
    { label: "PUNT RETURN", group: "PR", rank: 0, x: 70, y: 75 },
  ],
};
export const developmentTier = (trait: string) => {
  switch (trait.toLowerCase()) {
    case "franchise superstar":
    case "generational":
      return { key: "franchise", label: "Franchise Superstar", icon: "♛" };
    case "superstar":
      return { key: "superstar", label: "Superstar", icon: "✦" };
    case "star":
      return { key: "star", label: "Star", icon: "★" };
    case "normal":
      return { key: "normal", label: "Normal", icon: "●" };
    default:
      return { key: "hidden", label: "Unrevealed", icon: "?" };
  }
};
export const formations: Record<
  string,
  { label: string; group: string; rank: number }[][]
> = {
  Offense: [
    ["LT", "LG", "C", "RG", "RT", "TE"].map((group) => ({
      label: group,
      group,
      rank: 0,
    })),
    [
      { label: "WR1", group: "WR", rank: 0 },
      { label: "HB", group: "RB", rank: 0 },
      { label: "QB", group: "QB", rank: 0 },
      { label: "SLOT", group: "WR", rank: 2 },
      { label: "WR2", group: "WR", rank: 1 },
    ],
  ],
  Defense: [
    [
      { label: "EDGE1", group: "EDGE", rank: 0 },
      { label: "DT1", group: "DT", rank: 0 },
      { label: "DT2", group: "DT", rank: 1 },
      { label: "EDGE2", group: "EDGE", rank: 1 },
    ],
    [0, 1, 2].map((rank) => ({ label: `LB${rank + 1}`, group: "LB", rank })),
    [
      { label: "CB1", group: "CB", rank: 0 },
      { label: "FS", group: "FS", rank: 0 },
      { label: "SS", group: "SS", rank: 0 },
      { label: "CB2", group: "CB", rank: 1 },
    ],
  ],
  "Special teams": [
    [
      { label: "KICKER", group: "K", rank: 0 },
      { label: "PUNTER", group: "P", rank: 0 },
      { label: "KICK RETURN", group: "KR", rank: 0 },
      { label: "PUNT RETURN", group: "PR", rank: 0 },
    ],
  ],
};
export const groupsByUnit: Record<string, string[]> = {
  Offense: ["QB", "RB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT"],
  Defense: ["EDGE", "DT", "LB", "CB", "FS", "SS"],
  "Special teams": ["K", "P", "KR", "PR"],
};
export function fallbackOrders(players: Player[]) {
  return Object.fromEntries(
    [...new Set(Object.values(groupsByUnit).flat())].map((group) => [
      group,
      players
        .filter((p) =>
          group === "EDGE"
            ? ["EDGE", "DE"].includes(p.position)
            : ["KR", "PR"].includes(group)
              ? ["RB", "WR", "CB", "FS", "SS"].includes(p.position)
              : p.position === group,
        )
        .sort((a, b) => b.overall - a.overall || a.id.localeCompare(b.id))
        .map((p) => p.id),
    ]),
  );
}
