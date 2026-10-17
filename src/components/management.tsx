"use client";
import { useEffect, useState } from "react";
import {
  offensiveSchemes,
  defensiveSchemes,
  schemeFit,
} from "@/lib/coaching-center";
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
export function CoachingSettings({
  league,
  data,
  players,
  team,
  busy,
  mutate,
}: Props) {
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
  const owned = new Set(
    data.ownership
      .filter((o) => o.franchise_id === team)
      .map((o) => o.player_id),
  );
  const roster = players.filter((p) => owned.has(p.id));
  const groups = [
    {
      name: "Offense",
      keys: [
        "run_pass",
        "deep_pass",
        "short_pass",
        "play_action",
        "rpo",
        "red_zone",
      ],
      simple: [
        {
          key: "run_pass",
          label: "Play balance",
          options: ["Run-heavy", "Balanced", "Pass-heavy"],
        },
        {
          key: "deep_pass",
          label: "Passing depth",
          options: ["Short-focused", "Balanced", "Deep-focused"],
        },
      ],
    },
    {
      name: "Defense",
      keys: [
        "blitz",
        "man_zone",
        "aggression",
        "run_defense",
        "pass_defense",
        "press",
        "prevent_big_plays",
      ],
      simple: [
        {
          key: "blitz",
          label: "Pressure",
          options: ["Low blitz", "Balanced", "Frequent blitz"],
        },
        {
          key: "man_zone",
          label: "Coverage",
          options: ["Zone-heavy", "Balanced", "Man-heavy"],
        },
      ],
    },
    {
      name: "Game Management",
      keys: ["tempo", "fourth_down", "two_point"],
      simple: [
        {
          key: "tempo",
          label: "Game tempo",
          options: ["Deliberate", "Balanced", "Up-tempo"],
        },
        {
          key: "fourth_down",
          label: "Fourth-down decisions",
          options: ["Conservative", "Balanced", "Aggressive"],
        },
        {
          key: "two_point",
          label: "Two-point decisions",
          options: ["Conservative", "Balanced", "Aggressive"],
        },
      ],
    },
  ];
  function change(key: string, value: number) {
    setValues((v) => ({ ...v, [key]: value }));
    setDirty(true);
    setMessage("");
  }
  const stale = dirty && (saved?.version || 0) !== version;
  return (
    <section className="panel management-panel">
      <div className="panel-heading">
        <h2>Your coaching identity</h2>
        <span>
          {dirty
            ? "Unsaved changes"
            : version
              ? "Saved"
              : "Defaults · not saved"}
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
      <div className="playbook-columns">
        {[
          {
            title: "Offensive scheme",
            selected: offense,
            set: setOffense,
            schemes: offensiveSchemes,
          },
          {
            title: "Defensive scheme",
            selected: defense,
            set: setDefense,
            schemes: defensiveSchemes,
          },
        ].map((side) => (
          <div key={side.title}>
            <label>
              {side.title}
              <select
                disabled={busy}
                value={side.selected}
                onChange={(e) => {
                  side.set(e.target.value);
                  setDirty(true);
                  setMessage("");
                }}
              >
                {side.schemes.map((s) => (
                  <option key={s.name}>{s.name}</option>
                ))}
              </select>
            </label>
            {side.schemes
              .filter((s) => s.name === side.selected)
              .map((s) => {
                const fit = schemeFit(s, roster);
                return (
                  <article className="playbook-card" key={s.name}>
                    <h3>{s.name}</h3>
                    <p>{s.strength}</p>
                    <dl>
                      <dt>Preferred personnel</dt>
                      <dd>{s.personnel}</dd>
                      <dt>Typical plays</dt>
                      <dd>{s.plays}</dd>
                    </dl>
                    <div className="fit-heading">
                      <strong>Team fit</strong>
                      <span>
                        {fit.score === null
                          ? "Awaiting roster"
                          : `${fit.score}/100`}
                      </span>
                    </div>
                    {fit.score !== null && (
                      <meter
                        min={0}
                        max={100}
                        low={60}
                        high={80}
                        optimum={100}
                        value={fit.score}
                        aria-label={`${s.name} team fit`}
                      />
                    )}
                    <p>{fit.reason}</p>
                    <small>
                      Roster-rating estimate, not a predicted win rate.
                    </small>
                  </article>
                );
              })}
          </div>
        ))}
      </div>
      <div className="tendency-groups">
        {groups.map((group) => (
          <section className="tendency-group" key={group.name}>
            <h3>{group.name}</h3>
            <div className="coaching-simple">
              {group.simple.map((control) => {
                const value = values[control.key] ?? 50;
                const preset = [25, 50, 75].includes(value)
                  ? String(value)
                  : "custom";
                return (
                  <label key={control.key}>
                    {control.label}
                    <select
                      disabled={busy}
                      value={preset}
                      onChange={(e) =>
                        change(control.key, Number(e.target.value))
                      }
                    >
                      {preset === "custom" && (
                        <option value="custom" disabled>
                          Custom ({value})
                        </option>
                      )}
                      {control.options.map((label, i) => (
                        <option key={label} value={[25, 50, 75][i]}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
            <details className="advanced-coaching">
              <summary>Advanced {group.name.toLowerCase()} sliders</summary>
              <div className="coaching-grid">
                {tendencies
                  .filter(([key]) => group.keys.includes(key))
                  .map(([key, label, low, high]) => (
                    <label className="tendency" key={key}>
                      <span>
                        <strong>{label}</strong>
                        <output>{values[key] ?? 50}</output>
                      </span>
                      <input
                        type="range"
                        aria-label={label}
                        min={0}
                        max={100}
                        step={1}
                        value={values[key] ?? 50}
                        disabled={busy}
                        onChange={(e) => change(key, Number(e.target.value))}
                      />
                      <small>
                        <span>{low}</span>
                        <span>{high}</span>
                      </small>
                    </label>
                  ))}
              </div>
            </details>
          </section>
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
            } else {
              setMessage(
                "Could not save. Your unsaved changes are preserved; try again.",
              );
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
