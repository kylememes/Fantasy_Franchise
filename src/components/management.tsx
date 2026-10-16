"use client";
import { useEffect, useMemo, useState } from "react";
import { TeamLogo } from "./identity";
import { money } from "@/lib/types";
import { Lineup } from "./lineup";
import { FreeAgency } from "./free-agency";
import type {
  Management,
  League,
  Player,
  Franchise,
  RookiePick,
} from "@/lib/types";
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
const pickLabel = (p: RookiePick) =>
  `Season ${p.season} · Round ${p.round} · ${p.original_franchise} original`;
export function Trades({
  league,
  data,
  players,
  teams,
  team,
  busy,
  mutate,
}: Props) {
  const [target, setTarget] = useState(
      teams.find((t) => t.id !== team)?.id || "ARI",
    ),
    [give, setGive] = useState<string[]>([]),
    [take, setTake] = useState<string[]>([]),
    [gp, setGp] = useState<string[]>([]),
    [tp, setTp] = useState<string[]>([]),
    [search, setSearch] = useState(""),
    [review, setReview] = useState(false);
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const contracts = new Map(data.contracts.map((c) => [c.player_id, c]));
  const owner = new Map(
    data.ownership.map((o) => [o.player_id, o.franchise_id]),
  );
  const list = (id: string) =>
    players
      .filter((p) => owner.get(p.id) === id)
      .sort((a, b) => b.overall - a.overall);
  const payroll = (id: string) =>
    list(id).reduce((n, p) => n + (contracts.get(p.id)?.annual_salary || 0), 0);
  const transfer = (ids: string[]) =>
    ids.reduce((n, id) => n + (contracts.get(id)?.annual_salary || 0), 0);
  const projected = payroll(team) - transfer(give) + transfer(take),
    opponentProjected = payroll(target) - transfer(take) + transfer(give);
  const cap = league.salary_cap || 275000000;
  const toggle = (
    id: string,
    selected: string[],
    set: (v: string[]) => void,
  ) => {
    set(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id],
    );
    setReview(false);
  };
  const picks = (id: string) =>
    data.picks.filter((p) => p.franchise_id === id && p.season > league.season);
  const summary = (ids: string[], ps: string[]) =>
    [
      ...ids.map((id) => byId.get(id)?.name || "Unavailable player"),
      ...ps.map((id) => {
        const p = data.picks.find((p) => p.id === id);
        return p ? pickLabel(p) : "Unavailable pick";
      }),
    ].join(", ");
  function side(
    id: string,
    selected: string[],
    set: (v: string[]) => void,
    selectedPicks: string[],
    setPicks: (v: string[]) => void,
  ) {
    return (
      <fieldset
        className="trade-side"
        disabled={busy || league.state !== "completed"}
      >
        <legend>
          <TeamLogo id={id} />
          {id === team ? "You give" : "You receive"}
        </legend>
        <div className="trade-assets">
          {list(id)
            .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
            .map((p) => (
              <label key={p.id} className="asset-option">
                <input
                  type="checkbox"
                  checked={selected.includes(p.id)}
                  onChange={() => toggle(p.id, selected, set)}
                />
                <span>
                  <strong>{p.name}</strong>
                  <small>
                    {p.position} · Age {p.age} ·{" "}
                    {money(contracts.get(p.id)?.annual_salary || 0)}/yr
                  </small>
                </span>
                <b className="rating">{p.overall}</b>
              </label>
            ))}
        </div>
        <details>
          <summary>
            Future rookie picks ({selectedPicks.length} selected)
          </summary>
          <div className="trade-pick-list">
            {picks(id).map((p) => (
              <label key={p.id}>
                <input
                  type="checkbox"
                  checked={selectedPicks.includes(p.id)}
                  onChange={() => toggle(p.id, selectedPicks, setPicks)}
                />
                {pickLabel(p)}
              </label>
            ))}
          </div>
        </details>
        <p>{selected.length + selectedPicks.length} assets selected</p>
      </fieldset>
    );
  }
  return (
    <>
      <section className="panel management-panel">
        <div className="panel-heading">
          <h2>Trade desk</h2>
          <span>PLAYERS + FUTURE PICKS</span>
        </div>
        <p className="panel-copy">
          Submitting is your acceptance. Human owners decide their incoming
          offers. CPU general managers require fair value, protect stars, and
          consider age, contracts and roster needs. All trades must fit both
          teams’ cap and retain eligible players at every position.
        </p>
        {league.state !== "completed" && (
          <p className="callout">
            Trades unlock when the fantasy draft is complete. You can browse
            rosters now.
          </p>
        )}
        <div className="trade-tools">
          <label>
            Trade partner
            <select
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                setGive([]);
                setTake([]);
                setGp([]);
                setTp([]);
                setReview(false);
              }}
            >
              {teams
                .filter((t) => t.id !== team)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.city} {t.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Find players
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Player name"
            />
          </label>
        </div>
        <div className="trade-columns">
          {side(team, give, setGive, gp, setGp)}
          {side(target, take, setTake, tp, setTp)}
        </div>
        <div className="cap-summary">
          <div>
            <small>Your payroll after trade</small>
            <strong>{money(projected)}</strong>
          </div>
          <div>
            <small>{target} payroll after trade</small>
            <strong>{money(opponentProjected)}</strong>
          </div>
          <div>
            <small>Cap per team</small>
            <strong>{money(cap)}</strong>
          </div>
        </div>
        {review ? (
          <div className="confirm-box" role="region" aria-label="Review trade">
            <strong>Review your offer to {target}</strong>
            <p>You give: {summary(give, gp)}</p>
            <p>You receive: {summary(take, tp)}</p>
            <p>
              A CPU may accept immediately. Human acceptance remains pending
              until the other owner responds.
            </p>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                if (
                  await mutate("propose_trade", {
                    lid: league.id,
                    target_team: target,
                    give_players: give,
                    take_players: take,
                    give_picks: gp,
                    take_picks: tp,
                  })
                ) {
                  setReview(false);
                  setGive([]);
                  setTake([]);
                  setGp([]);
                  setTp([]);
                }
              }}
            >
              Submit trade offer
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => setReview(false)}
            >
              Go back
            </button>
          </div>
        ) : (
          <button
            className="primary"
            disabled={
              busy ||
              league.state !== "completed" ||
              (!give.length && !gp.length) ||
              (!take.length && !tp.length) ||
              give.length + gp.length > 10 ||
              take.length + tp.length > 10 ||
              projected > cap ||
              opponentProjected > cap
            }
            onClick={() => setReview(true)}
          >
            Review trade offer
          </button>
        )}
      </section>
      <section className="panel management-panel">
        <div className="panel-heading">
          <h2>Trade inbox & activity</h2>
          <span>{data.trades.length} OFFERS</span>
        </div>
        {data.trades.length ? (
          data.trades.map((t) => (
            <article className="trade-offer" key={t.id}>
              <div className="panel-heading">
                <h3>
                  {t.from_team} → {t.to_team}
                </h3>
                <span className={"status " + t.status}>{t.status}</span>
              </div>
              <p>
                <strong>{t.from_team} gives:</strong>{" "}
                {summary(t.give_players, t.give_picks)}
              </p>
              <p>
                <strong>{t.to_team} gives:</strong>{" "}
                {summary(t.take_players, t.take_picks)}
              </p>
              <p className="fineprint">
                {t.reason || "Awaiting the receiving owner’s decision."}
              </p>
              {t.status === "rejected" && t.reason.startsWith("CPU") && (
                <p className="fineprint">
                  CPU value estimate: offered {t.give_value.toLocaleString()} ·
                  requested {t.take_value.toLocaleString()}. Improve the package
                  and submit a new offer.
                </p>
              )}
              {t.status === "pending" &&
                (t.to_team === team ? (
                  <div className="dialog-actions">
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Accept this trade and transfer the listed assets?",
                          )
                        )
                          void mutate("respond_trade", {
                            tid: t.id,
                            decision: "accept",
                          });
                      }}
                    >
                      Accept trade
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void mutate("respond_trade", {
                          tid: t.id,
                          decision: "reject",
                        })
                      }
                    >
                      Reject
                    </button>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => {
                        setTarget(t.from_team);
                        setGive(t.take_players);
                        setTake(t.give_players);
                        setGp(t.take_picks);
                        setTp(t.give_picks);
                        setReview(false);
                      }}
                    >
                      Build counteroffer
                    </button>
                  </div>
                ) : t.from_team === team ? (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void mutate("respond_trade", {
                        tid: t.id,
                        decision: "cancel",
                      })
                    }
                  >
                    Withdraw offer
                  </button>
                ) : null)}
            </article>
          ))
        ) : (
          <p className="empty">No trade offers yet. Build a package above.</p>
        )}
      </section>
    </>
  );
}
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
        play percentages. Settings are saved for the upcoming simulation engine;
        games are not implemented yet.
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
