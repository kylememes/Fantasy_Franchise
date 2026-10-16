"use client";
// Temporary visual acceptance fixture. Synthetic data only; never contacts Supabase.
import { useEffect, useMemo, useRef, useState } from "react";
import { SeasonHub, CoachingStaff } from "@/components/season-hub";
import { FranchiseMark } from "@/components/identity";
import { simulateGame } from "../../../supabase/functions/_shared/simulation";
import { syntheticTeam } from "../../../tests/fixtures/football";
import type { League, Franchise } from "@/lib/types";
import type { supabase } from "@/lib/supabase";
const teams: Franchise[] = [
  {
    id: "BAL",
    city: "Baltimore",
    name: "Ravens",
    conference: "AFC",
    division: "North",
    color: "#6454ac",
  },
  {
    id: "PHI",
    city: "Philadelphia",
    name: "Eagles",
    conference: "NFC",
    division: "East",
    color: "#208c93",
  },
];
const league: League = {
  id: "synthetic-review",
  name: "DYNASTY LEAGUE",
  commissioner: "owner",
  state: "completed",
  next_pick: 1696,
  revision: 1,
  draft_order: [],
  season: 1,
};
export default function ReviewSeason() {
  const [view, setView] = useState("Dashboard"),
    [gameId, setGameId] = useState("review-game"),
    [phone, setPhone] = useState(false),
    [embedded, setEmbedded] = useState(false);
  useEffect(
    () => setEmbedded(new URLSearchParams(window.location.search).has("phone")),
    [],
  );
  const result = useMemo(
    () =>
      simulateGame({
        seed: 142,
        phase: "preseason",
        home: syntheticTeam("BAL", 86),
        away: syntheticTeam("PHI", 83),
      }),
    [],
  );
  const world = useRef({
    status: "paused",
    cursor: 8,
    speed: 1,
    ready: ["owner", "friend"],
    hires: [{ franchise_id: "BAL", role: "HC", coach_id: "andy-reid" }],
  });
  const season = () => ({
    season: {
      league_id: league.id,
      season: 1,
      year: 2026,
      phase: "preseason",
      week: 1,
      status: "open",
    },
    games: [
      {
        id: "review-game",
        phase: "preseason",
        week: 1,
        home: "BAL",
        away: "PHI",
        kickoff: "2026-08-15T23:00:00Z",
        status: world.current.status,
        home_score: world.current.status === "final" ? result.home_score : null,
        away_score: world.current.status === "final" ? result.away_score : null,
      },
    ],
    staff: [],
    standings: teams.map((t) => ({
      ...t,
      wins: 0,
      losses: 0,
      ties: 0,
      points_for: 0,
      points_against: 0,
      differential: 0,
    })),
  });
  const client = useMemo(
    () => ({
      from: () => ({
        select: () => ({
          eq: async () => ({ data: world.current.hires, error: null }),
        }),
      }),
      functions: {
        invoke: async () => ({ data: { processed: 0 }, error: null }),
      },
      rpc: async (name: string, args: any) => {
        if (name === "season_snapshot") return { data: season(), error: null };
        if (name === "game_snapshot") {
          const final = world.current.status === "final";
          return {
            data: {
              game: {
                ...season().games[0],
                cursor: world.current.cursor,
                speed: world.current.speed,
                box: final ? result.box : null,
              },
              ready: world.current.ready,
              owners: [
                { team: "BAL", user_id: "owner" },
                { team: "PHI", user_id: "friend" },
              ],
              players: args.after_play < 0 ? result.players : null,
              total_plays: result.plays.length,
              plays: result.plays.filter(
                (p) =>
                  p.index > (args.after_play ?? -1) &&
                  (final || p.index <= world.current.cursor),
              ),
              staff: {
                home: { HC: "Andy Reid" },
                away: { HC: "Nick Sirianni" },
              },
              coaching: {
                home: { offense: "Balanced", defense: "4–3" },
                away: { offense: "Spread", defense: "Nickel-heavy" },
              },
            },
            error: null,
          };
        }
        if (name === "game_action") {
          if (args.action === "pause") world.current.status = "paused";
          if (args.action === "resume") world.current.status = "live";
          if (args.action === "ready") world.current.status = "paused";
          if (args.action === "speed") world.current.speed = args.play_speed;
          if (args.action === "next")
            world.current.cursor = Math.min(
              result.plays.length - 1,
              world.current.cursor + 1,
            );
          if (args.action === "finish") {
            world.current.status = "final";
            world.current.cursor = result.plays.length - 1;
          }
          return { data: null, error: null };
        }
        if (name === "hire_coach") {
          world.current.hires = args.coach
            ? [
                {
                  franchise_id: "BAL",
                  role: args.staff_role,
                  coach_id: args.coach,
                },
              ]
            : [];
          return { data: null, error: null };
        }
        return { data: null, error: null };
      },
    }),
    [result],
  );
  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <FranchiseMark />
          </span>
          <span>
            FANTASY FRANCHISE<small>SYNTHETIC VISUAL REVIEW</small>
          </span>
        </div>
      </header>
      <main
        style={{
          maxWidth: 1280,
          margin: "auto",
          padding: embedded ? "12px" : "24px",
        }}
      >
        <nav className="tabs" style={{ marginBottom: 20 }}>
          {["Dashboard", "Game Center", "Coaching"].map((v) => (
            <button
              key={v}
              className={view === v ? "active" : ""}
              onClick={() => setView(v)}
            >
              {v}
            </button>
          ))}
          {!embedded && (
            <button onClick={() => setPhone((p) => !p)}>
              {phone ? "Desktop preview" : "Mobile preview"}
            </button>
          )}
        </nav>
        {phone && !embedded ? (
          <iframe
            title="Mobile season preview"
            src="/review-season?phone=1"
            width="390"
            height="844"
            style={{
              border: "1px solid #c9d1db",
              borderRadius: 18,
              maxWidth: "100%",
            }}
          />
        ) : view === "Coaching" ? (
          <CoachingStaff
            league={league}
            team="BAL"
            client={client as unknown as typeof supabase}
          />
        ) : (
          <SeasonHub
            league={league}
            team="BAL"
            userId="owner"
            teams={teams}
            players={[]}
            management={null}
            view={view}
            gameId={gameId}
            onGame={setGameId}
            onNavigate={setView}
            client={client as unknown as typeof supabase}
          />
        )}
      </main>
    </>
  );
}
