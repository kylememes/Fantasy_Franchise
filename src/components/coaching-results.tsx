"use client";
import { useEffect, useState } from "react";
import { supabase as db } from "@/lib/supabase";
import type { League } from "@/lib/types";
import type { GameSnapshot, SeasonSnapshot } from "@/lib/season";
import { coachingReport, percentage } from "@/lib/coaching-center";
export function CoachingResults({
  league,
  team,
  client = db,
}: {
  league: League;
  team: string;
  client?: typeof db;
}) {
  const [phase, setPhase] = useState("regular");
  const [games, setGames] = useState<GameSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setGames([]);
    async function load() {
      try {
        if (!client) throw new Error("Connection unavailable.");
        const result = await client.rpc("season_snapshot", { lid: league.id });
        if (result.error) throw result.error;
        const season = result.data as SeasonSnapshot | null;
        if (!season) return;
        const finals = season.games.filter(
          (g) =>
            g.phase === phase &&
            g.status === "final" &&
            [g.home, g.away].includes(team),
        );
        const loaded: GameSnapshot[] = [];
        // Avoid a burst of 17 simultaneous requests; only fetch finalized games.
        for (let i = 0; i < finals.length; i += 3) {
          if (!active) return;
          const batch = await Promise.all(
            finals.slice(i, i + 3).map(async (g) => {
              const res = await client.rpc("game_snapshot", {
                gid: g.id,
                after_play: -1,
              });
              if (res.error) throw res.error;
              const snapshot = res.data as GameSnapshot;
              if (
                snapshot.game.status !== "final" ||
                snapshot.plays.length !== snapshot.total_plays ||
                !snapshot.game.box ||
                !snapshot.players
              )
                throw new Error(
                  "A completed game report is unavailable. Please refresh.",
                );
              return snapshot;
            }),
          );
          loaded.push(...batch);
        }
        if (active) setGames(loaded);
      } catch (e) {
        if (active)
          setError(
            (e as { message?: string }).message ||
              "Unable to load coaching results.",
          );
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [league.id, league.season, team, phase, refresh, client]);
  const r = coachingReport(games, team);
  const rate = (n: number, d: number) => `${percentage(n, d)} (${n}/${d})`;
  const offensive = [
    [
      "Run / pass split",
      `${percentage(r.runs, r.runs + r.passes)} / ${percentage(r.passes, r.runs + r.passes)}`,
      `${r.runs} rushes · ${r.passes} pass attempts`,
    ],
    [
      "Total yards",
      (r.rushing + r.passing).toLocaleString(),
      `${r.rushing} rushing · ${r.passing} passing`,
    ],
    [
      "Yards per play",
      r.plays ? ((r.rushing + r.passing) / r.plays).toFixed(1) : "—",
      `${r.plays} offensive plays`,
    ],
    ["Sacks allowed", String(r.sacks), "Total across selected games"],
    [
      "Third-down conversions",
      rate(r.thirds, r.thirdAttempts),
      "Conversions / attempts",
    ],
    [
      "Red-zone TD efficiency",
      rate(r.redTD, r.redTrips),
      "Touchdowns / red-zone possessions",
    ],
  ];
  const defensive = [
    [
      "Blitz rate",
      percentage(r.blitz, r.blitzKnown),
      `${r.blitzKnown} of ${r.defSnaps} defensive snaps recorded`,
    ],
    [
      "Zone / man coverage",
      `${percentage(r.zone, r.coverageKnown)} / ${percentage(r.man, r.coverageKnown)}`,
      `${r.coverageKnown} run/pass/sack snaps recorded`,
    ],
    ["Fumble recoveries", String(r.fumbles), "Opponent fumbles recovered"],
    [
      "Interceptions",
      String(r.interceptions),
      "Passes intercepted by your defense",
    ],
    [
      "Red-zone stop rate",
      rate(r.defRedTrips - r.defRedTD, r.defRedTrips),
      "Possessions held without a TD / opponent red-zone possessions",
    ],
  ];
  return (
    <section className="panel management-panel coaching-results">
      <div className="panel-heading">
        <h2>Coaching results</h2>
        <span>
          {r.games} completed {r.games === 1 ? "game" : "games"}
        </span>
      </div>
      <div className="trade-tools">
        <label>
          Season {league.season}
          <select value={phase} onChange={(e) => setPhase(e.target.value)}>
            <option value="regular">Regular season</option>
            <option value="preseason">Preseason</option>
          </select>
        </label>
        <button
          className="secondary"
          disabled={loading}
          onClick={() => setRefresh((v) => v + 1)}
        >
          Refresh results
        </button>
      </div>
      {loading ? (
        <p role="status">Loading completed games…</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : !r.games ? (
        <p className="empty">
          Results appear after your first completed{" "}
          {phase === "regular" ? "regular-season" : "preseason"} game.
        </p>
      ) : (
        <>
          <div className="coaching-report-columns">
            {[
              ["Offense", offensive],
              ["Defense", defensive],
            ].map(([title, rows]) => (
              <div key={title as string}>
                <h3>{title as string}</h3>
                <dl className="coaching-metrics">
                  {(rows as string[][]).map(([label, value, note]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                      <small>{note}</small>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
          <p className="panel-copy">
            Actual results from finalized games. Run/pass split uses rushing and
            passing attempts. Red-zone possessions begin with a snap inside the
            opponent’s 20; field goals count as defensive stops. Blitz rate
            excludes older plays without recorded blitz data. — means no
            recorded opportunities.
          </p>
        </>
      )}
    </section>
  );
}
