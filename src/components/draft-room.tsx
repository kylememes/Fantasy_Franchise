"use client";
import { useState, useMemo, useRef, useEffect } from "react";
import {
  Search,
  Pause,
  Play,
  FastForward,
  Plus,
  Check,
  ChevronLeft,
  ChevronRight,
  X,
  Clock3,
} from "lucide-react";
import { limits, onClock, money } from "@/lib/types";
import type { Snapshot, Player, Franchise } from "@/lib/types";
type Props = {
  snapshot: Snapshot;
  players: Player[];
  teams: Franchise[];
  userId: string;
  busy: boolean;
  queue: string[];
  onQueue: (id: string) => Promise<void>;
  onControl: (a: string) => Promise<void>;
  onPick: (id: string, pick: number, revision: number) => Promise<void>;
};
export function DraftRoom({
  snapshot: s,
  players,
  teams,
  userId,
  busy,
  queue,
  onQueue,
  onControl,
  onPick,
}: Props) {
  const [position, setPosition] = useState("ALL"),
    [query, setQuery] = useState(""),
    [sort, setSort] = useState("overall"),
    [tab, setTab] = useState("players"),
    [boardRound, setBoardRound] = useState(1),
    [chosen, setChosen] = useState<{
      player: Player;
      pick: number;
      revision: number;
    } | null>(null),
    [confirming, setConfirming] = useState(false);
  const [visibleCount, setVisibleCount] = useState(100);
  useEffect(() => setVisibleCount(100), [position, query, sort, tab]);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (chosen) dialog.current?.showModal();
    else dialog.current?.close();
    setConfirming(false);
  }, [chosen]);
  const l = s.league,
    teamId = onClock(l.draft_order, l.next_pick),
    team = teams.find((t) => t.id === teamId),
    me = s.members.find((m) => m.user_id === userId),
    commissioner = l.commissioner === userId,
    round = Math.min(53, Math.floor(l.next_pick / 32) + 1),
    myTurn = me?.franchise_id === teamId && l.state === "running";
  const picked = useMemo(
      () => new Map(s.picks.map((p) => [p.player_id, p])),
      [s.picks],
    ),
    byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const roster = players.filter(
      (p) => picked.get(p.id)?.franchise_id === me?.franchise_id,
    ),
    counts = Object.fromEntries(
      Object.keys(limits).map((pos) => [
        pos,
        roster.filter((p) => p.position === pos).length,
      ]),
    );
  const filtered = useMemo(
    () =>
      players
        .filter(
          (p) =>
            !picked.has(p.id) &&
            (position === "ALL" || p.position === position) &&
            p.name.toLowerCase().includes(query.toLowerCase()) &&
            (tab !== "queue" || queue.includes(p.id)),
        )
        .sort((a, b) =>
          sort === "age"
            ? a.age - b.age
            : sort === "position"
              ? a.position.localeCompare(b.position) || b.overall - a.overall
              : sort === "salary"
                ? a.salary - b.salary
                : b.overall - a.overall || a.name.localeCompare(b.name),
        ),
    [players, picked, position, query, sort, tab, queue],
  );
  const upcoming = Array.from(
    { length: Math.min(7, 1696 - l.next_pick) },
    (_, i) => ({
      pick: l.next_pick + i,
      team: onClock(l.draft_order, l.next_pick + i),
    }),
  );
  function open(p: Player) {
    setChosen({ player: p, pick: l.next_pick, revision: l.revision });
  }
  const canPick =
    chosen &&
    myTurn &&
    chosen.pick === l.next_pick &&
    chosen.revision === l.revision &&
    !picked.has(chosen.player.id) &&
    counts[chosen.player.position] < limits[chosen.player.position];
  return (
    <>
      <section className="draft-scoreboard">
        <div className="round-cell">
          <small>ROUND</small>
          <strong>
            {round.toString().padStart(2, "0")}
            <span>/53</span>
          </strong>
        </div>
        <div className="clock-team">
          <span className="team-tile" style={{ background: team?.color }}>
            {l.state === "completed" ? "✓" : teamId}
          </span>
          <div>
            <small>
              {l.state === "completed"
                ? "DRAFT COMPLETE"
                : l.state === "waiting"
                  ? "FIRST ON THE CLOCK"
                  : "ON THE CLOCK"}
            </small>
            <h2>
              {l.state === "completed"
                ? "Your franchises are built."
                : team?.city + " " + team?.name}
            </h2>
            <p>
              {l.state === "completed"
                ? "All 1,696 selections saved."
                : `Pick ${l.next_pick + 1} overall · ${s.members.some((m) => m.franchise_id === teamId) ? "Human owner" : "CPU general manager"}`}
            </p>
          </div>
        </div>
        <div className="draft-clock">
          <Clock3 size={21} />
          <strong>
            {l.state === "paused"
              ? "PAUSED"
              : l.state === "waiting"
                ? "NOT STARTED"
                : l.state === "awaiting_completion"
                  ? "CHECKPOINT"
                  : l.state === "completed"
                    ? "FINISHED"
                    : "NO TIMER"}
          </strong>
          <small>
            {myTurn
              ? "Your pick. Take your time."
              : "Commissioner-controlled draft"}
          </small>
        </div>
      </section>
      <div className="pick-strip">
        {upcoming.map((p, i) => (
          <div key={p.pick} className={i === 0 ? "current" : ""}>
            <small>{i === 0 ? "UP NOW" : `PICK ${p.pick + 1}`}</small>
            <b style={{ color: teams.find((t) => t.id === p.team)?.color }}>
              {p.team}
            </b>
            <span>
              {s.members.some((m) => m.franchise_id === p.team)
                ? "HUMAN"
                : "CPU"}
            </span>
          </div>
        ))}
      </div>
      <div className="draft-message">
        <div>
          <span className="live-dot" />
          {l.state === "waiting"
            ? "Draft order is set. Invite your owners, then start when everyone is ready."
            : l.state === "paused"
              ? "All selections are paused. Your draft will stay here until the commissioner resumes."
              : l.state === "awaiting_completion"
                ? "Round 15 is complete. The commissioner can now authorize the remaining 38 rounds."
                : l.state === "completed"
                  ? "Draft complete. Open Roster to review your team."
                  : myTurn
                    ? "You’re on the clock. Select a player to review and confirm your pick."
                    : "The board updates automatically. Human owners have unlimited time."}
        </div>
        {commissioner && (
          <div className="commissioner-actions">
            {l.state === "waiting" && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => void onControl("start")}
              >
                <Play size={15} />
                Start draft
              </button>
            )}
            {["running", "completing"].includes(l.state) && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void onControl("pause")}
              >
                <Pause size={15} />
                Pause
              </button>
            )}
            {l.state === "paused" && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => void onControl("resume")}
              >
                <Play size={15} />
                Resume
              </button>
            )}
            {l.state === "awaiting_completion" && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "Automatically draft rounds 16–53 for every team? You can still pause at any time.",
                    )
                  )
                    void onControl("complete");
                }}
              >
                <FastForward size={15} />
                Complete rosters
              </button>
            )}
          </div>
        )}
      </div>
      <div className="draft-layout">
        <section className="panel player-panel">
          <div className="tabs draft-tabs">
            {[
              ["players", "Available players"],
              ["board", "Draft board"],
              ["queue", `My queue (${queue.length})`],
            ].map(([key, label]) => (
              <button
                key={key}
                className={tab === key ? "active" : ""}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "board" ? (
            <>
              <div className="board-controls">
                <button
                  aria-label="Previous round"
                  disabled={boardRound <= 1}
                  onClick={() => setBoardRound((r) => r - 1)}
                >
                  <ChevronLeft size={18} />
                </button>
                <h3>Round {boardRound}</h3>
                <button
                  aria-label="Next round"
                  disabled={boardRound >= 53}
                  onClick={() => setBoardRound((r) => r + 1)}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
              <div className="board-grid">
                {Array.from({ length: 32 }, (_, i) => {
                  const n = (boardRound - 1) * 32 + i,
                    id = onClock(l.draft_order, n),
                    pick = s.picks.find((p) => p.pick === n),
                    player = pick && byId.get(pick.player_id);
                  return (
                    <div
                      className={
                        "board-pick " + (n === l.next_pick ? "on-clock" : "")
                      }
                      key={n}
                    >
                      <small>
                        #{n + 1} ·{" "}
                        <b
                          style={{
                            color: teams.find((t) => t.id === id)?.color,
                          }}
                        >
                          {id}
                        </b>
                      </small>
                      <strong>{player?.name || "—"}</strong>
                      <span>
                        {player
                          ? player.position + " · " + player.overall + " OVR"
                          : n === l.next_pick
                            ? "On the clock"
                            : "Awaiting pick"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <div className="filters">
                <label className="search-field">
                  <Search size={17} />
                  <input
                    aria-label="Search players"
                    placeholder="Search player name…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <select
                  aria-label="Filter by position"
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                >
                  <option value="ALL">All positions</option>
                  {Object.keys(limits).map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
                <select
                  aria-label="Sort players"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="overall">Overall rating</option>
                  <option value="age">Youngest first</option>
                  <option value="position">Position</option>
                  <option value="salary">Salary</option>
                </select>
              </div>
              <div className="table-caption">
                <span>{filtered.length} AVAILABLE · PROVISIONAL TEST POOL</span>
                <small>OVR: 0–99 original rating scale</small>
              </div>
              <div className="table-wrap player-list">
                <table>
                  <thead>
                    <tr>
                      <th>PLAYER</th>
                      <th>POS</th>
                      <th>OVR</th>
                      <th>AGE</th>
                      <th>SALARY</th>
                      <th>QUEUE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, visibleCount).map((p) => (
                      <tr key={p.id}>
                        <td>
                          <button
                            className="player-name"
                            onClick={() => open(p)}
                          >
                            <span className="jersey">{p.jersey}</span>
                            <span>
                              {p.name}
                              <small>
                                {p.development} development · Fictional
                              </small>
                            </span>
                          </button>
                        </td>
                        <td>
                          <span className="position-tag">{p.position}</span>
                        </td>
                        <td>
                          <span
                            className={
                              "rating " +
                              (p.overall >= 90
                                ? "elite"
                                : p.overall >= 80
                                  ? "strong"
                                  : "")
                            }
                          >
                            {p.overall}
                          </span>
                        </td>
                        <td>{p.age}</td>
                        <td>{money(p.salary)}</td>
                        <td>
                          <button
                            className={
                              "queue-button " +
                              (queue.includes(p.id) ? "queued" : "")
                            }
                            disabled={busy}
                            aria-label={
                              (queue.includes(p.id) ? "Remove " : "Queue ") +
                              p.name
                            }
                            onClick={() => void onQueue(p.id)}
                          >
                            {queue.includes(p.id) ? (
                              <Check size={16} />
                            ) : (
                              <Plus size={16} />
                            )}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filtered.length > visibleCount && (
                  <button
                    className="text-button"
                    onClick={() => setVisibleCount((n) => n + 100)}
                  >
                    Load next 100 players ({filtered.length - visibleCount}{" "}
                    more)
                  </button>
                )}
                {players.length === 0 ? (
                  <p className="empty">Loading the player pool…</p>
                ) : filtered.length === 0 ? (
                  <p className="empty">
                    {tab === "queue"
                      ? "Add players with the + button to build your shortlist."
                      : "No players match these filters."}
                  </p>
                ) : null}
              </div>
            </>
          )}
        </section>
        <aside className="draft-aside">
          <section className="panel">
            <div className="panel-heading">
              <h3>Roster blueprint</h3>
              <span>{roster.length}/53</span>
            </div>
            <p className="aside-copy">{me?.franchise_id} · Position slots</p>
            <div className="needs">
              {Object.entries(limits).map(([p, max]) => (
                <button
                  key={p}
                  className={counts[p] >= max ? "filled" : ""}
                  onClick={() => {
                    setPosition(p);
                    setTab("players");
                  }}
                >
                  <span>{p}</span>
                  <i>
                    <b style={{ width: `${(counts[p] / max) * 100}%` }} />
                  </i>
                  <small>
                    {counts[p]}/{max}
                  </small>
                </button>
              ))}
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h3>Latest selections</h3>
              <span>LIVE BOARD</span>
            </div>
            {s.picks
              .slice(-6)
              .reverse()
              .map((p) => (
                <button
                  className="recent-pick"
                  key={p.pick}
                  onClick={() => {
                    const x = byId.get(p.player_id);
                    if (x) open(x);
                  }}
                >
                  <span className="pick-number">{p.pick + 1}</span>
                  <div>
                    <strong>
                      {byId.get(p.player_id)?.name || "Loading player…"}
                    </strong>
                    <small>
                      {p.franchise_id} · {byId.get(p.player_id)?.position}
                    </small>
                  </div>
                  <b>{byId.get(p.player_id)?.overall}</b>
                </button>
              ))}
            {!s.picks.length && (
              <p className="empty small">
                The first chapter is still unwritten.
              </p>
            )}
          </section>
        </aside>
      </div>
      <dialog
        ref={dialog}
        className="player-dialog"
        onCancel={() => setChosen(null)}
        onClick={(e) => {
          if (e.target === dialog.current) setChosen(null);
        }}
      >
        {chosen && (
          <>
            <button
              className="dialog-close icon-button"
              aria-label="Close player profile"
              onClick={() => setChosen(null)}
            >
              <X />
            </button>
            <span className="eyebrow">
              PLAYER PROFILE · FICTIONAL TEST DATA
            </span>
            <div className="profile-title">
              <span className="profile-jersey">{chosen.player.jersey}</span>
              <div>
                <h2>{chosen.player.name}</h2>
                <p>
                  {chosen.player.position} · Age {chosen.player.age} ·{" "}
                  {Math.floor(chosen.player.height_inches / 12)}′
                  {chosen.player.height_inches % 12}″ ·{" "}
                  {chosen.player.weight_lbs} lbs
                </p>
              </div>
              <span className="rating elite large">
                {chosen.player.overall}
              </span>
            </div>
            <div className="profile-meta">
              <span>{chosen.player.development} potential</span>
              <span>
                {money(chosen.player.salary)} provisional annual salary
              </span>
            </div>
            <div className="attribute-grid">
              {Object.entries(chosen.player.attributes).map(([k, v]) => (
                <div key={k}>
                  <span>{k}</span>
                  <strong>{v}</strong>
                  <progress max={99} value={v} />
                </div>
              ))}
            </div>
            <p>{chosen.player.history}</p>
            <p className="fineprint">{chosen.player.source}</p>
            {picked.has(chosen.player.id) ? (
              <div className="callout">
                Drafted by {picked.get(chosen.player.id)?.franchise_id}
              </div>
            ) : (
              <>
                <div className="dialog-actions">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void onQueue(chosen.player.id)}
                  >
                    {queue.includes(chosen.player.id)
                      ? "Remove from queue"
                      : "Add to queue"}
                  </button>
                  <button
                    className="primary"
                    disabled={busy || !canPick}
                    onClick={() => setConfirming(true)}
                  >
                    Select player
                  </button>
                </div>
                {!canPick && (
                  <small className="fineprint">
                    {counts[chosen.player.position] >=
                    limits[chosen.player.position]
                      ? "Your roster slots at this position are full."
                      : chosen.revision !== l.revision
                        ? "Draft state changed. Close and reopen this player before selecting."
                        : "You can select when the draft is running and your team is on the clock."}
                  </small>
                )}
                {confirming && (
                  <div className="confirm-box">
                    <strong>
                      Draft {chosen.player.name} to {me?.franchise_id}?
                    </strong>
                    <p>This will permanently use pick #{chosen.pick + 1}.</p>
                    <button
                      className="primary"
                      disabled={busy || !canPick}
                      onClick={async () => {
                        await onPick(
                          chosen.player.id,
                          chosen.pick,
                          chosen.revision,
                        );
                        setChosen(null);
                      }}
                    >
                      Confirm draft pick
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setConfirming(false)}
                    >
                      Go back
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </dialog>
    </>
  );
}
