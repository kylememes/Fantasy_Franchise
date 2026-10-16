"use client";
import { useState, useEffect, useRef } from "react";
import { money, limits } from "@/lib/types";
import type { ManagementProps } from "./management";
import type { Player } from "@/lib/types";
import { PlayerCard } from "./lineup";
export function FreeAgency({
  league,
  data,
  players,
  team,
  busy,
  mutate,
}: ManagementProps) {
  const [mode, setMode] = useState("Free agents"),
    [search, setSearch] = useState(""),
    [position, setPosition] = useState("ALL");
  const [selected, setSelected] = useState<{
      id: string;
      action: "sign" | "release";
      salary: number;
    } | null>(null),
    [message, setMessage] = useState(""),
    [page, setPage] = useState(0);
  const owned = new Map(
    data.ownership.map((o) => [o.player_id, o.franchise_id]),
  );
  const contracts = new Map(data.contracts.map((c) => [c.player_id, c]));
  const asking = new Map(
    (data.free_agents || []).map((p) => [p.player_id, p.annual_salary]),
  );
  const roster = players.filter((p) => owned.get(p.id) === team);
  const payroll = roster.reduce(
      (sum, p) => sum + (contracts.get(p.id)?.annual_salary || 0),
      0,
    ),
    cap = league.salary_cap || 275000000;
  const available = players
    .filter((p) =>
      mode === "Free agents"
        ? asking.has(p.id) && !owned.has(p.id)
        : owned.get(p.id) === team,
    )
    .filter(
      (p) =>
        (position === "ALL" || p.position === position) &&
        p.name.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => b.overall - a.overall || a.name.localeCompare(b.name));
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selected) return;
    const previous = document.activeElement as HTMLElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, [selected]);
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(available.length / 20) - 1),
  );
  const chosen = selected
    ? players.find((p) => p.id === selected.id)
    : undefined;
  const valid =
    !!selected &&
    (selected.action === "sign"
      ? asking.get(selected.id) === selected.salary && !owned.has(selected.id)
      : owned.get(selected.id) === team &&
        contracts.get(selected.id)?.annual_salary === selected.salary);
  function releaseProblem(p: Player) {
    if (roster.length <= 46) return "Minimum roster: 46 players";
    const minimum: Record<string, number> = {
      WR: 3,
      EDGE: 2,
      DT: 2,
      LB: 3,
      CB: 3,
    };
    if (
      roster.filter((r) => r.position === p.position).length <=
      (minimum[p.position] || 1)
    )
      return `Keep enough ${p.position} players`;
    return "";
  }
  return (
    <section className="panel management-panel free-agency-panel">
      <div className="panel-heading">
        <h2>Free agency</h2>
        <span>{money(cap - payroll)} CAP SPACE</span>
      </div>
      <p className="panel-copy">
        Sign available players to one-year deals at their listed asking price.
        Releases free their full annual cap hit; no dead money. Keep 46–60
        players and coverage at every position. A released drafted player keeps
        a price floor from their original draft round.
      </p>
      {league.state !== "completed" && (
        <p className="callout">
          Signings and releases unlock when the fantasy draft is complete.
        </p>
      )}
      <div
        className="lineup-tabs"
        role="group"
        aria-label="Roster transactions"
      >
        {["Free agents", "Release players"].map((m) => (
          <button
            key={m}
            aria-pressed={mode === m}
            className={mode === m ? "active" : ""}
            disabled={busy}
            onClick={() => {
              setMode(m);
              setSelected(null);
              setPage(0);
              setMessage("");
            }}
          >
            {m}
          </button>
        ))}
      </div>
      <div className="trade-tools">
        <label>
          Search players
          <input
            value={search}
            placeholder="Player name"
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <label>
          Filter position
          <select
            value={position}
            onChange={(e) => {
              setPosition(e.target.value);
              setPage(0);
            }}
          >
            <option value="ALL">All positions</option>
            {Object.keys(limits).map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="fineprint">
        {available.length} players · Your roster: {roster.length}/60
      </p>
      <div className="free-agent-list">
        {available.slice(currentPage * 20, currentPage * 20 + 20).map((p) => {
          const price =
            mode === "Free agents"
              ? asking.get(p.id)!
              : contracts.get(p.id)?.annual_salary;
          const problem =
            mode === "Free agents"
              ? roster.length >= 60
                ? "Roster full"
                : payroll + (price || 0) > cap
                  ? "Insufficient cap space"
                  : ""
              : releaseProblem(p);
          return (
            <article key={p.id} className="free-agent-row">
              <div>
                <strong>{p.name}</strong>
                <small>
                  {p.position} · Age {p.age} ·{" "}
                  {p.attributes_source
                    ? "Worksheet skills"
                    : "Estimated skills"}
                </small>
              </div>
              <b className="rating">{p.overall}</b>
              <div>
                <strong>{money(price || 0)}</strong>
                <small>
                  {mode === "Free agents"
                    ? "per year · 1 year"
                    : "annual cap savings"}
                </small>
              </div>
              <button
                className="secondary"
                disabled={
                  busy || league.state !== "completed" || !!problem || !price
                }
                onClick={() => {
                  setSelected({
                    id: p.id,
                    action: mode === "Free agents" ? "sign" : "release",
                    salary: price!,
                  });
                  setMessage("");
                }}
              >
                {mode === "Free agents" ? "Review signing" : "Review release"}
              </button>
              {problem && (
                <small className="transaction-reason">{problem}</small>
              )}
            </article>
          );
        })}
      </div>
      {!available.length && (
        <p className="empty">No players match these filters.</p>
      )}
      {available.length > 20 && (
        <div className="dialog-actions">
          <button
            className="secondary"
            disabled={!currentPage}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous
          </button>
          <span>
            Page {currentPage + 1} / {Math.ceil(available.length / 20)}
          </span>
          <button
            className="secondary"
            disabled={(currentPage + 1) * 20 >= available.length}
            onClick={() => setPage(currentPage + 1)}
          >
            Next
          </button>
        </div>
      )}
      {selected && chosen && (
        <div className="transaction-overlay">
          <div
            className="transaction-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="transaction-title"
            onKeyDown={(e) => {
              if (e.key === "Escape" && !busy) setSelected(null);
              if (e.key === "Tab") {
                const buttons = [
                  ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
                    'button:not(:disabled):not([tabindex="-1"])',
                  ),
                ];
                const first = buttons[0],
                  last = buttons.at(-1);
                if (
                  e.shiftKey &&
                  (document.activeElement === first ||
                    document.activeElement === e.currentTarget)
                ) {
                  e.preventDefault();
                  last?.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first?.focus();
                }
              }
            }}
            tabIndex={-1}
            ref={dialogRef}
          >
            <h3 id="transaction-title">
              {selected.action === "sign" ? "Review signing" : "Review release"}
            </h3>
            <PlayerCard player={chosen} label={chosen.position} />
            <p>
              {chosen.name} · {money(selected.salary)}
              {selected.action === "sign"
                ? " per year · 1 year"
                : " annual cap savings"}
            </p>
            <p>
              Projected cap space:{" "}
              <strong>
                {money(
                  cap -
                    payroll +
                    (selected.action === "sign"
                      ? -selected.salary
                      : selected.salary),
                )}
              </strong>
            </p>
            {selected.action === "release" && (
              <p>
                The player becomes available to every franchise. Their draft
                history stays saved.
              </p>
            )}
            {!valid && (
              <p role="alert" className="callout">
                This player or contract changed. Close this review and choose
                again.
              </p>
            )}
            <div className="dialog-actions">
              <button
                className="primary"
                disabled={busy || !valid || league.state !== "completed"}
                onClick={async () => {
                  if (
                    await mutate(
                      selected.action === "sign"
                        ? "sign_free_agent"
                        : "release_player",
                      {
                        lid: league.id,
                        pid: selected.id,
                        expected_salary: selected.salary,
                      },
                    )
                  ) {
                    setSelected(null);
                    setMessage(
                      selected.action === "sign"
                        ? "Player signed."
                        : "Player released.",
                    );
                  }
                }}
              >
                Confirm {selected.action === "sign" ? "signing" : "release"}
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setSelected(null)}
              >
                Go back
              </button>
            </div>
          </div>
        </div>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
