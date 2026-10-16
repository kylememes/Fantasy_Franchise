"use client";
import { useEffect, useState } from "react";
import { TeamLogo } from "./identity";
import { money } from "@/lib/types";
import { Lineup } from "./lineup";
import { FreeAgency } from "./free-agency";
import type { Management, League, Player, Franchise } from "@/lib/types";
export type ManagementProps = {
  league: League;
  data: Management;
  players: Player[];
  teams: Franchise[];
  team: string;
  busy: boolean;
  mutate: (fn: string, args: Record<string, unknown>) => Promise<boolean>;
};
type Props = ManagementProps;
export function RosterManagement(props: Props) {
  const { league, data, players, team } = props;
  const ids = new Set(
    data.ownership
      .filter((o) => o.franchise_id === team)
      .map((o) => o.player_id),
  );
  const contracts = new Map(data.contracts.map((c) => [c.player_id, c]));
  const roster = players
    .filter((p) => ids.has(p.id))
    .sort(
      (a, b) => a.position.localeCompare(b.position) || b.overall - a.overall,
    );
  const payroll = roster.reduce(
    (n, p) => n + (contracts.get(p.id)?.annual_salary || 0),
    0,
  );
  return (
    <>
      <Lineup key={`lineup:${league.id}:${team}`} {...props} />
      <section className="panel management-panel">
        <div className="panel-heading">
          <h2>
            <TeamLogo id={team} /> Your roster & contracts
          </h2>
          <span>{roster.length} players</span>
        </div>
        <div className="cap-summary">
          <div>
            <small>Annual payroll</small>
            <strong>{money(payroll)}</strong>
          </div>
          <div>
            <small>Fantasy salary cap</small>
            <strong>{money(league.salary_cap || 275000000)}</strong>
          </div>
          <div>
            <small>Available cap space</small>
            <strong>{money((league.salary_cap || 275000000) - payroll)}</strong>
          </div>
        </div>
        <p className="panel-copy">
          Draft contracts follow their original round and travel in trades. Free
          agents sign one-year deals. Equal annual cap hits; no bonuses or dead
          money in this version. Payroll grows as picks are made.
        </p>
        <div className="table-wrap">
          <table className="contract-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Position / OVR</th>
                <th>Annual salary</th>
                <th>Contract</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((p) => {
                const c = contracts.get(p.id);
                return (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.name}</strong>
                      <small>
                        Age {p.age} ·{" "}
                        {c?.origin === "free_agency"
                          ? "Free-agent contract"
                          : `Draft round ${c?.draft_round || "—"}`}{" "}
                        · {p.overall_source ? "Worksheet OVR" : "Estimated OVR"}
                      </small>
                    </td>
                    <td>
                      {p.position} <span className="rating">{p.overall}</span>
                    </td>
                    <td>{c ? money(c.annual_salary) : "Pending"}</td>
                    <td>
                      {c
                        ? `${Math.max(0, c.start_season + c.years - league.season)} years remaining`
                        : "—"}
                      <small>
                        {c
                          ? `Seasons ${c.start_season}–${c.start_season + c.years - 1}`
                          : ""}
                      </small>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!roster.length && (
          <p className="empty">
            Draft your first player to begin building your roster.
          </p>
        )}
      </section>
      <FreeAgency key={`agency:${league.id}:${team}`} {...props} />
    </>
  );
}
export { Trades } from "./trade-desk";
export const tendencies = [
  ["run_pass", "Run vs. pass", "Run-focused", "Pass-focused"],
  ["tempo", "Tempo", "Deliberate", "Up-tempo"],
  ["deep_pass", "Deep passing", "Conservative", "Frequent"],
  ["short_pass", "Short passing", "Less emphasis", "More emphasis"],
  ["play_action", "Play action", "Rare", "Frequent"],
  ["rpo", "RPO", "Rare", "Frequent"],
  ["fourth_down", "Fourth down", "Conservative", "Aggressive"],
  ["two_point", "Two-point attempts", "Conservative", "Aggressive"],
  ["red_zone", "Red-zone approach", "Run-focused", "Pass-focused"],
  ["blitz", "Blitz frequency", "Low", "High"],
  ["man_zone", "Coverage preference", "Zone", "Man"],
  ["aggression", "Defensive aggression", "Conservative", "Aggressive"],
  ["run_defense", "Run defense emphasis", "Low", "High"],
  ["pass_defense", "Pass defense emphasis", "Low", "High"],
  ["press", "Press coverage", "Rare", "Frequent"],
  ["prevent_big_plays", "Big-play prevention", "Low", "High"],
] as const;
export function CoachingSettings({ league, data, busy, mutate }: Props) {
  const saved = data.coaching;
  const defaults = () =>
    Object.fromEntries(tendencies.map(([key]) => [key, 50]));
  const [offense, setOffense] = useState(saved?.offense || "Balanced"),
    [defense, setDefense] = useState(saved?.defense || "Multiple"),
    [values, setValues] = useState(saved?.tendencies || defaults),
    [version, setVersion] = useState(saved?.version || 0),
    [dirty, setDirty] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    if (!dirty) {
      setOffense(saved?.offense || "Balanced");
      setDefense(saved?.defense || "Multiple");
      setValues(saved?.tendencies || defaults());
      setVersion(saved?.version || 0);
    }
  }, [saved, dirty]);
  const stale = dirty && (saved?.version || 0) !== version;
  return (
    <section className="panel management-panel">
      <div className="panel-heading">
        <h2>Your coaching identity</h2>
        <span>
          {dirty
            ? "UNSAVED CHANGES"
            : version
              ? "SAVED · VERSION " + version
              : "DEFAULTS · NOT SAVED"}
        </span>
      </div>
      <p className="panel-copy">
        Set your team’s philosophy. These are situational preferences, not fixed
        play percentages. Saved settings guide game decisions alongside down,
        distance, score, clock, and player matchups. Changes apply to games that
        have not kicked off.
      </p>
      {stale && (
        <p className="callout">
          Another session saved a newer version. Your edits are preserved.
          Reload saved settings before making a new change.
        </p>
      )}
      <div className="trade-tools">
        <label>
          Offensive scheme
          <select
            disabled={busy}
            value={offense}
            onChange={(e) => {
              setOffense(e.target.value);
              setDirty(true);
            }}
          >
            {[
              "West Coast",
              "Spread",
              "Power Run",
              "Air Raid",
              "Balanced",
              "Option",
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Defensive scheme
          <select
            disabled={busy}
            value={defense}
            onChange={(e) => {
              setDefense(e.target.value);
              setDirty(true);
            }}
          >
            {[
              "4–3",
              "3–4",
              "Nickel-heavy",
              "Multiple",
              "Man-heavy",
              "Zone-heavy",
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="coaching-grid">
        {tendencies.map(([key, label, low, high], i) => (
          <label className="tendency" key={key}>
            <span>
              <strong>{label}</strong>
              <output>{values[key]}</output>
            </span>
            <input
              type="range"
              aria-label={label}
              min={0}
              max={100}
              step={1}
              value={values[key]}
              disabled={busy}
              onChange={(e) => {
                setValues((v) => ({ ...v, [key]: Number(e.target.value) }));
                setDirty(true);
                setMessage("");
              }}
            />
            <small>
              <span>{low}</span>
              <span>{high}</span>
            </small>
            {i === 9 && <span className="sr-only">Defense settings</span>}
          </label>
        ))}
      </div>
      <div className="dialog-actions">
        <button
          className="primary"
          disabled={busy || stale}
          onClick={async () => {
            if (
              await mutate("save_coaching", {
                lid: league.id,
                offense_scheme: offense,
                defense_scheme: defense,
                settings: values,
                expected_version: version,
              })
            ) {
              setDirty(false);
              setMessage("Coaching philosophy saved.");
            }
          }}
        >
          Save coaching philosophy
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            setDirty(false);
            setMessage("Loaded saved settings.");
          }}
        >
          Reload saved settings
        </button>
      </div>
      <p role="status">{message}</p>
    </section>
  );
}
