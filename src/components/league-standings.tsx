"use client";
import { useState } from "react";
import type { Standing, Week } from "@/lib/season";
import { TeamLogo } from "./identity";

export function LeagueStandings({
  standings,
  team,
  phase,
}: {
  standings: Standing[];
  team: string;
  phase: Week["phase"];
}) {
  const [view, setView] = useState("divisions");
  const [conference, setConference] = useState("All");
  // Retain the authoritative snapshot's ordering within every group.
  const filtered = standings.filter(
    (s) => conference === "All" || s.conference === conference,
  );
  const groups =
    view === "league"
      ? [
          {
            title: conference === "All" ? "Whole league" : conference,
            rows: filtered,
          },
        ]
      : ["AFC", "NFC"]
          .flatMap((conf) =>
            ["East", "North", "South", "West"].map((division) => ({
              title: `${conf} ${division}`,
              rows: filtered.filter(
                (s) => s.conference === conf && s.division === division,
              ),
            })),
          )
          .filter((group) => group.rows.length);

  return (
    <section className="panel season-standings" aria-label="League standings">
      <div className="panel-heading">
        <h2>{phase === "preseason" ? "Preseason records" : "Standings"}</h2>
        <div className="standings-controls">
          <label>
            View
            <select
              aria-label="Standings view"
              value={view}
              onChange={(e) => setView(e.target.value)}
            >
              <option value="divisions">Divisions</option>
              <option value="league">Whole league</option>
            </select>
          </label>
          <label>
            Conference
            <select
              aria-label="Standings conference"
              value={conference}
              onChange={(e) => setConference(e.target.value)}
            >
              <option>All</option>
              <option>AFC</option>
              <option>NFC</option>
            </select>
          </label>
        </div>
      </div>
      <div
        className={
          view === "divisions"
            ? "division-standings-grid"
            : "league-standings-table"
        }
      >
        {groups.map(({ title, rows }) => (
          <div className="standings-group" key={title}>
            <h3>{title}</h3>
            <div className="table-wrap">
              <table aria-label={`${title} standings`}>
                <thead>
                  <tr>
                    <th scope="col">Team</th>
                    {view === "league" && <th scope="col">Division</th>}
                    <th scope="col">W</th>
                    <th scope="col">L</th>
                    <th scope="col">T</th>
                    <th scope="col">PF</th>
                    <th scope="col">PA</th>
                    <th scope="col">DIFF</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr
                      key={s.id}
                      className={s.id === team ? "your-standing" : undefined}
                    >
                      <td>
                        <span className="standing-team">
                          <TeamLogo id={s.id} />
                          {s.id}
                          {s.id === team ? " · YOU" : ""}
                        </span>
                      </td>
                      {view === "league" && (
                        <td>
                          {s.conference} {s.division}
                        </td>
                      )}
                      <td>{s.wins}</td>
                      <td>{s.losses}</td>
                      <td>{s.ties}</td>
                      <td>{s.points_for}</td>
                      <td>{s.points_against}</td>
                      <td>
                        {s.differential > 0 ? "+" : ""}
                        {s.differential}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
      {!filtered.length && (
        <p className="panel-copy">No standings available yet.</p>
      )}
      <p className="fineprint">
        Preseason results stay separate from regular-season records. Ordering
        here is by wins, then point differential; postseason tiebreakers arrive
        with playoffs.
      </p>
    </section>
  );
}
