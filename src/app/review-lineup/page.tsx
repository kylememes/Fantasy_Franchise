"use client";
// Temporary preview-only visual acceptance fixture. No user data, Auth or database calls.
import { useState } from "react";
import { Lineup } from "../../components/lineup";
import { limits, type Player, type League } from "../../lib/types";
import { fallbackOrders } from "../../lib/lineup";
const names = [
  "M. Bennett",
  "A. Williams",
  "T. Walker",
  "J. Coleman",
  "E. Carter",
  "D. Walker",
  "M. Hayes",
  "C. Reed",
  "J. Brooks",
  "T. Grant",
  "D. Price",
];
const players: Player[] = Object.entries(limits).flatMap(
  ([position, count], n) =>
    Array.from({ length: count }, (_, i) => ({
      id: `${position}-${i}`,
      name: `${names[n % names.length]}${i ? " Jr. " + i : ""}`,
      position,
      age: 25 + i,
      jersey: 10 + n + i,
      overall: Math.max(68, 98 - (n % 7) - i * 8),
      attributes: {
        speed: 86,
        acceleration: 84,
        awareness: 91,
        catching: 80,
        short_accuracy: 92,
        throw_power: 94,
      },
      stats: { passing_yards: 1234, passing_tds: 10 },
      salary: 1000000,
      height_inches: 74,
      weight_lbs: 220,
      development: ["Franchise Superstar", "Superstar", "Star", "Normal"][
        n % 4
      ],
      source: "Synthetic visual review fixture",
      history: "",
    })),
);
const league: League = {
  id: "review",
  name: "Visual review",
  commissioner: "fixture",
  state: "completed",
  next_pick: 1696,
  revision: 1,
  draft_order: [],
  season: 1,
};
export default function Review() {
  const [depth, setDepth] = useState({
    orders: fallbackOrders(players),
    version: 0,
  });
  return (
    <main style={{ maxWidth: 1600, margin: "0 auto", padding: 20 }}>
      <p>VISUAL ACCEPTANCE — SYNTHETIC PLAYERS / NO SAVED LEAGUE ACTIONS</p>
      <Lineup
        league={league}
        data={{
          ownership: players.map((p) => ({
            player_id: p.id,
            franchise_id: "BAL",
          })),
          contracts: [],
          picks: [],
          trades: [],
          coaching: null,
          depth,
        }}
        players={players}
        teams={[]}
        team="BAL"
        busy={false}
        mutate={async (fn, args) => {
          if (
            fn !== "save_depth_order" ||
            args.expected_version !== depth.version
          )
            return false;
          setDepth({
            orders: {
              ...depth.orders,
              [args.position_key as string]: args.ordered_players as string[],
            },
            version: depth.version + 1,
          });
          return true;
        }}
      />
    </main>
  );
}
