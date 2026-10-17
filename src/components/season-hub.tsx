"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Play,
  Pause,
  SkipForward,
  RotateCcw,
  FastForward,
  BarChart3,
  Users,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import { supabase as db } from "@/lib/supabase";
import type { Franchise, League, Player, Management } from "@/lib/types";
import {
  type SeasonSnapshot,
  type GameSnapshot,
  type Fixture,
  mergeGame,
  weekLabel,
} from "@/lib/season";
import { FootballField } from "./football-field";
import { nextDriveIndex } from "@/lib/field-playback";
import { LeagueStandings } from "./league-standings";
import { TeamLogo } from "./identity";
import coachCatalog from "../../data/coaches-2026.json";
import { headCoachBonuses } from "@/lib/coaches";
const staffLabels = {
  HC: "Head coach",
  OC: "Offensive coordinator",
  DC: "Defensive coordinator",
} as const;
export function CoachingStaff({
  league,
  team,
  client = db,
}: {
  league: League;
  team: string;
  client?: typeof db;
}) {
  const [hires, setHires] = useState<
      { franchise_id: string; role: string; coach_id: string }[]
    >([]),
    [choices, setChoices] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    const load = async () => {
      const r = await client!
        .from("franchise_staff")
        .select("franchise_id,role,coach_id")
        .eq("league_id", league.id);
      if (!active) return;
      if (r.error) setMessage(r.error.message);
      else setHires(r.data || []);
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [league.id, client]);
  async function applyHire(role: string, coach: string | null) {
    setBusy(true);
    setMessage("");
    try {
      const r = await client!.rpc("hire_coach", {
        lid: league.id,
        staff_role: role,
        coach,
      });
      if (r.error) throw r.error;
      const result = await client!
        .from("franchise_staff")
        .select("franchise_id,role,coach_id")
        .eq("league_id", league.id);
      if (result.error) throw result.error;
      setHires(result.data || []);
      setChoices((c) => ({ ...c, [role]: "" }));
      setMessage("Coaching staff saved. Your tendencies are unchanged.");
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : (e as { message?: string }).message || "Unable to save staff",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel staff-panel">
      <div className="panel-heading">
        <h2>Your coaching staff</h2>
        <span>REAL NFL NAMES · YOUR PHILOSOPHY</span>
      </div>
      <p className="panel-copy">
        Head coaches give targeted player attribute bonuses; you still control
        every scheme and tendency. Coordinators personalize your staff without
        extra bonuses. Hires have no salary-cap charge. Human owners choose
        first: CPU teams hire remaining head coaches when the commissioner
        advances to Preseason Week 2.
      </p>
      <div className="staff-grid">
        {Object.entries(staffLabels).map(([role, label]) => {
          const hire = hires.find(
              (h) => h.franchise_id === team && h.role === role,
            ),
            current = coachCatalog.find((c) => c.id === hire?.coach_id),
            choice = choices[role] || "";
          const specialty =
            role === "HC"
              ? headCoachBonuses.find((c) => c.id === (choice || current?.id))
              : null;
          return (
            <div key={role} className="staff-slot">
              <span className="eyebrow">{label}</span>
              <strong>{current?.name || "Position vacant"}</strong>
              <dl className="coach-contract">
                <div>
                  <dt>Cap charge</dt>
                  <dd>{current ? "$0" : "—"}</dd>
                </div>
                <div>
                  <dt>Contract term</dt>
                  <dd>{current ? "Open-ended" : "—"}</dd>
                </div>
                <div>
                  <dt>Salary / years remaining</dt>
                  <dd>Not tracked</dd>
                </div>
              </dl>
              <label>
                Available coaches
                <select
                  value={choice}
                  disabled={busy}
                  aria-label={`Choose ${label.toLowerCase()}`}
                  onChange={(e) =>
                    setChoices((c) => ({ ...c, [role]: e.target.value }))
                  }
                >
                  <option value="">Select a coach</option>
                  {coachCatalog
                    .filter((c) => c.role === role && c.id !== hire?.coach_id)
                    .map((c) => {
                      const taken = hires.some((h) => h.coach_id === c.id);
                      return (
                        <option key={c.id} value={c.id} disabled={taken}>
                          {c.name}
                          {taken ? " · hired" : ""}
                        </option>
                      );
                    })}
                </select>
              </label>
              {specialty && (
                <div className="coach-specialties">
                  <strong>
                    {choice ? "Preview specialties" : "Active specialties"}
                  </strong>
                  <ul>
                    {specialty.bonuses.map((b) => (
                      <li key={b.label}>
                        <b>+{b.amount}</b> {b.label}
                      </li>
                    ))}
                  </ul>
                  <small>
                    Original game bonuses · attributes cap at 99 · apply at
                    kickoff
                  </small>
                </div>
              )}
              <div className="dialog-actions">
                <button
                  className="primary"
                  disabled={!choice || busy}
                  onClick={() => void applyHire(role, choice)}
                >
                  {current ? "Replace" : "Hire"} {role}
                </button>
                {current && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void applyHire(role, null)}
                  >
                    Release
                  </button>
                )}
              </div>
              {current && (
                <a href={current.source} target="_blank" rel="noreferrer">
                  Coach reference ↗
                </a>
              )}
            </div>
          );
        })}
      </div>
      <p role="status" className="staff-message">
        {message}
      </p>
    </section>
  );
}
export function SeasonHub({
  league,
  team,
  userId,
  teams,
  players,
  management,
  view,
  gameId,
  onGame,
  onNavigate,
  client = db,
}: {
  league: League;
  team: string;
  userId: string;
  teams: Franchise[];
  players: Player[];
  management: Management | null;
  view: string;
  gameId: string;
  onGame: (id: string) => void;
  onNavigate: (view: string) => void;
  client?: typeof db;
}) {
  const [season, setSeason] = useState<SeasonSnapshot | null>(null),
    [game, setGame] = useState<GameSnapshot | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [replayIndex, setReplayIndex] = useState(0),
    [liveReplayIndex, setLiveReplayIndex] = useState<number | null>(null),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1),
    [replayKey, setReplayKey] = useState(0),
    [moment, setMoment] = useState<{
      game: string;
      index: number;
      clock: number;
      resolved: boolean;
    } | null>(null),
    [showStats, setShowStats] = useState(false),
    [schedulePhase, setSchedulePhase] = useState(""),
    [scheduleWeek, setScheduleWeek] = useState(0);
  const gameRef = useRef<GameSnapshot | null>(null),
    generation = useRef(0),
    request = useRef(false);
  const commissioner = league.commissioner === userId;
  const load = useCallback(async () => {
    if (!client || request.current) return;
    request.current = true;
    const gen = generation.current;
    try {
      const [s, g] = await Promise.all([
        client.rpc("season_snapshot", { lid: league.id }),
        gameId && view === "Game Center"
          ? client.rpc("game_snapshot", {
              gid: gameId,
              after_play:
                gameRef.current?.game.id === gameId
                  ? (gameRef.current.plays.at(-1)?.index ?? -1)
                  : -1,
            })
          : Promise.resolve(null),
      ]);
      if (gen !== generation.current) return;
      if (s.error) throw s.error;
      setSeason(s.data);
      if (g) {
        if (g.error) throw g.error;
        const next = mergeGame(gameRef.current, g.data);
        gameRef.current = next;
        setGame(next);
      }
    } catch (e) {
      if (gen === generation.current)
        setError(
          (e as { message?: string }).message ||
            "Unable to synchronize the season",
        );
    } finally {
      request.current = false;
    }
  }, [league.id, gameId, view, client]);
  useEffect(() => {
    generation.current++;
    gameRef.current = null;
    setGame(null);
    setReplayIndex(0);
    setLiveReplayIndex(null);
    setPlaying(false);
    setError("");
    request.current = false;
    void load();
    const timer = setInterval(
      () => void load(),
      view === "Game Center" ? 1800 : 5000,
    );
    return () => {
      generation.current++;
      clearInterval(timer);
    };
  }, [load, view]);
  const currentGames =
    season?.games.filter(
      (g) => g.phase === season.season.phase && g.week === season.season.week,
    ) || [];
  const mine = currentGames.find((g) => [g.home, g.away].includes(team));
  useEffect(() => {
    if (view === "Game Center" && !gameId && mine) onGame(mine.id);
  }, [view, gameId, mine, onGame]);
  const wake = async (gid?: string) => {
    if (!client) return;
    const r = await client.functions.invoke("game-worker", {
      body: { league_id: league.id, ...(gid ? { game_id: gid } : {}) },
    });
    if (r.error)
      setError(
        "Game is queued. The background worker will retry; use Refresh if it stays queued.",
      );
  };
  async function mutate(
    name: string,
    args: Record<string, unknown>,
    wakeGame?: string,
  ) {
    if (!client) return;
    setBusy(true);
    setError("");
    try {
      const r = await client.rpc(name, args);
      if (r.error) throw r.error;
      if (
        name === "week_control" ||
        args.action === "ready" ||
        args.action === "retry"
      )
        await wake(wakeGame);
      await load();
    } catch (e) {
      setError((e as { message?: string }).message || "Unable to update game");
    } finally {
      setBusy(false);
    }
  }
  const openGame = (g: Fixture) => {
    onGame(g.id);
    onNavigate("Game Center");
  };
  const lookup = (id: string) => teams.find((t) => t.id === id)!;
  const record = (id: string) => {
    const s = season?.standings.find((t) => t.id === id);
    return s ? `${s.wins}–${s.losses}${s.ties ? `–${s.ties}` : ""}` : "0–0";
  };
  const overall = (id: string, unit: string) => {
    const ids = new Set(
      management?.ownership
        .filter((o) => o.franchise_id === id)
        .map((o) => o.player_id),
    );
    const unitPlayers = players.filter(
      (p) =>
        ids.has(p.id) &&
        (unit === "offense"
          ? ["QB", "RB", "WR", "TE", "LT", "LG", "C", "RG", "RT"].includes(
              p.position,
            )
          : unit === "defense"
            ? ["EDGE", "DE", "DT", "LB", "CB", "FS", "SS"].includes(p.position)
            : ["K", "P"].includes(p.position)),
    );
    return unitPlayers.length
      ? Math.round(
          unitPlayers.reduce((n, p) => n + p.overall, 0) / unitPlayers.length,
        )
      : "—";
  };
  const active = game?.game;
  const final = active?.status === "final";
  const watchingReplay = final || liveReplayIndex !== null;
  const play =
    game?.plays[
      final
        ? Math.min(replayIndex, game.plays.length - 1)
        : (liveReplayIndex ??
          Math.min(
            active?.cursor ?? 0,
            Math.max(0, (game?.plays.length ?? 1) - 1),
          ))
    ];
  const currentMoment =
    moment?.game === active?.id && moment?.index === play?.index
      ? moment
      : null;
  const previousPlay = play
    ? game?.plays.find((p) => p.index === play.index - 1)
    : undefined;
  const displayedHome = currentMoment?.resolved
    ? play?.homeScore
    : (play?.homeScoreBefore ?? previousPlay?.homeScore ?? 0);
  const displayedAway = currentMoment?.resolved
    ? play?.awayScore
    : (play?.awayScoreBefore ?? previousPlay?.awayScore ?? 0);
  const displayedClock = currentMoment?.clock ?? play?.clock ?? 900;
  const previousStatus = useRef<{ id: string; status: string } | null>(null);
  useEffect(() => {
    if (
      active?.status === "final" &&
      previousStatus.current?.id === active.id &&
      previousStatus.current.status !== "final"
    ) {
      setReplayIndex(Math.max(0, (game?.plays.length || 1) - 1));
      setLiveReplayIndex(null);
      setPlaying(false);
    }
    previousStatus.current = active
      ? { id: active.id, status: active.status }
      : null;
  }, [active?.id, active?.status, game?.plays.length]);
  const onCurrentWeek =
    !!active &&
    !!season &&
    active.phase === season.season.phase &&
    active.week === season.season.week &&
    season.season.status === "open";
  const participant = !!active && [active.home, active.away].includes(team),
    control = participant && onCurrentWeek;
  const livePlaying = active?.status === "live";
  async function gameControl(action: string, n = 1) {
    if (!active) return;
    await mutate(
      "game_action",
      { gid: active.id, action, play_speed: n },
      active.id,
    );
  }
  const [confirmEnd, setConfirmEnd] = useState(false);
  const listed =
    season?.games.filter(
      (g) =>
        g.phase === (schedulePhase || season.season.phase) &&
        g.week === (scheduleWeek || season.season.week),
    ) || [];
  if (!season)
    return (
      <section className="panel season-loading">
        <h2>Preparing your season hub…</h2>
        <p>{error || "Loading the 2026 schedule and saved league results."}</p>
        <button onClick={() => void load()}>Retry</button>
      </section>
    );
  const w = season.season,
    completed = currentGames.filter((g) => g.status === "final").length;
  return (
    <div className="season-hub">
      {error && (
        <div className="season-error" role="alert">
          {error}
          <button
            aria-label="Dismiss season message"
            onClick={() => setError("")}
          >
            ×
          </button>
        </div>
      )}
      {view !== "Game Center" && (
        <>
          <section className="panel week-matchup">
            <div className="week-matchup-top">
              <span className="eyebrow">
                {w.year} · {weekLabel(w)}
              </span>
              <span className="status">
                {w.status === "setup"
                  ? "ROSTERS SETTLING"
                  : w.status === "complete"
                    ? "REGULAR SEASON COMPLETE"
                    : `${completed} / ${currentGames.length} GAMES FINAL`}
              </span>
            </div>
            {mine ? (
              <>
                <div className="matchup-teams">
                  <div>
                    <TeamLogo id={mine.away} />
                    <small>AWAY · {record(mine.away)}</small>
                    <h2>{lookup(mine.away).name}</h2>
                  </div>
                  <div className="matchup-middle">
                    {mine.status === "final" ? (
                      <strong>
                        {mine.away_score} <span>–</span> {mine.home_score}
                      </strong>
                    ) : (
                      <strong>VS</strong>
                    )}
                    <span>{mine.status.replaceAll("_", " ")}</span>
                  </div>
                  <div>
                    <TeamLogo id={mine.home} />
                    <small>HOME · {record(mine.home)}</small>
                    <h2>{lookup(mine.home).name}</h2>
                  </div>
                </div>
                <div className="matchup-actions">
                  <button className="primary" onClick={() => openGame(mine)}>
                    {mine.status === "final"
                      ? "View final / Watch replay"
                      : mine.status === "scheduled"
                        ? "Enter game"
                        : "Rejoin game"}{" "}
                    <ArrowRight size={17} />
                  </button>
                  <button
                    className="secondary"
                    onClick={() => onNavigate("Roster")}
                  >
                    Set lineup
                  </button>
                  <button
                    className="secondary"
                    onClick={() => onNavigate("Coaching")}
                  >
                    Coaching & staff
                  </button>
                </div>
                <p className="fineprint">
                  Schedule date:{" "}
                  {mine.kickoff
                    ? new Date(mine.kickoff).toLocaleDateString(undefined, {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })
                    : "To be announced"}{" "}
                  · League weeks move at the commissioner’s pace.
                </p>
                <div className="matchup-grades">
                  {["offense", "defense", "special teams"].map((unit) => (
                    <div key={unit}>
                      <b>{overall(mine.away, unit)}</b>
                      <span>
                        {unit}
                        <small>Roster average OVR</small>
                      </span>
                      <b>{overall(mine.home, unit)}</b>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="bye-week">
                <h2>Your bye week.</h2>
                <p>
                  Review your roster, coaching staff and upcoming schedule while
                  the rest of the league plays.
                </p>
                <button
                  className="secondary"
                  onClick={() => onNavigate("Roster")}
                >
                  Manage roster
                </button>
              </div>
            )}
            {w.status === "setup" && (
              <p className="week-staging-note">
                The fantasy draft is complete. Settle your lineup and coaching
                philosophy. The commissioner opens Preseason Week 1 when the
                league is ready.
              </p>
            )}
            {w.status === "complete" && (
              <p className="week-staging-note">
                Regular-season results and replays are saved. Playoffs and the
                offseason are the next development phase.
              </p>
            )}
          </section>
          {commissioner && (
            <section className="panel week-office">
              <div>
                <span className="eyebrow">COMMISSIONER OFFICE</span>
                <h3>{weekLabel(w)}</h3>
                <p>
                  {w.status === "setup"
                    ? "Open the week to begin CPU matchups and allow owners to start games."
                    : "Advance after all games are final, or simulate unfinished matchups first."}
                </p>
              </div>
              <div className="dialog-actions">
                {w.status === "setup" ? (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Open Preseason Week 1? CPU games will simulate automatically. Human games still require owners to ready.",
                        )
                      )
                        void mutate("week_control", {
                          lid: league.id,
                          action: "open",
                          expected_phase: w.phase,
                          expected_week: w.week,
                        });
                    }}
                  >
                    Open preseason
                  </button>
                ) : (
                  w.status === "open" && (
                    <>
                      <button
                        className="secondary"
                        disabled={busy || completed === currentGames.length}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Simulate every unfinished game this week, including human matchups? These results will be permanent.",
                            )
                          )
                            void mutate("week_control", {
                              lid: league.id,
                              action: "simulate_unfinished",
                              expected_phase: w.phase,
                              expected_week: w.week,
                            });
                        }}
                      >
                        Simulate unfinished
                      </button>
                      <button
                        className="primary"
                        disabled={busy || completed !== currentGames.length}
                        onClick={() => {
                          if (
                            window.confirm(
                              w.phase === "regular" && w.week === 18
                                ? "Close the completed regular season?"
                                : "Advance the league and open the next week?",
                            )
                          )
                            void mutate("week_control", {
                              lid: league.id,
                              action: "advance",
                              expected_phase: w.phase,
                              expected_week: w.week,
                            });
                        }}
                      >
                        {w.phase === "regular" && w.week === 18
                          ? "Complete regular season"
                          : "Advance week"}{" "}
                        <ArrowRight size={16} />
                      </button>
                    </>
                  )
                )}
              </div>
            </section>
          )}
        </>
      )}
      {view === "Game Center" && (
        <section className="panel game-center">
          <div className="panel-heading">
            <h2>Game Center</h2>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void load()}
            >
              <RefreshCw size={15} /> Refresh
            </button>
          </div>
          <label className="game-picker">
            Matchup
            <select value={gameId} onChange={(e) => onGame(e.target.value)}>
              <option value="">Choose a game</option>
              {season.games.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.phase === "preseason" ? "PRE" : "REG"} {g.week} · {g.away}{" "}
                  at {g.home} · {g.status}
                  {g.status === "final"
                    ? ` ${g.away_score}–${g.home_score}`
                    : ""}
                </option>
              ))}
            </select>
          </label>
          {active && game ? (
            <>
              <div className="broadcast-scoreboard">
                <div>
                  <TeamLogo id={active.away} />
                  <span>{active.away}</span>
                  <strong>
                    {play ? displayedAway : (active.away_score ?? 0)}
                  </strong>
                </div>
                <div className="broadcast-clock">
                  <span>
                    {final ? "SAVED REPLAY" : active.status.toUpperCase()}
                  </span>
                  <strong>
                    {play
                      ? `${play.quarter === 5 ? "OT" : `Q${play.quarter}`} ${Math.floor(displayedClock / 60)}:${String(displayedClock % 60).padStart(2, "0")}`
                      : "15:00"}
                  </strong>
                  <small>
                    {play
                      ? `${play.offense} BALL · ${play.down}${play.down === 1 ? "st" : play.down === 2 ? "nd" : play.down === 3 ? "rd" : "th"} & ${play.distance}`
                      : weekLabel(active)}
                  </small>
                </div>
                <div>
                  <strong>
                    {play ? displayedHome : (active.home_score ?? 0)}
                  </strong>
                  <span>{active.home}</span>
                  <TeamLogo id={active.home} />
                </div>
              </div>
              {final && (
                <p className="official-final">
                  Official final: {active.away} {active.away_score} —{" "}
                  {active.home} {active.home_score}
                </p>
              )}
              <div className="broadcast-timeouts">
                <span>
                  {active.away} timeouts:{" "}
                  {currentMoment?.resolved
                    ? play?.awayTimeouts
                    : (play?.awayTimeoutsBefore ??
                      previousPlay?.awayTimeouts ??
                      3)}
                </span>
                <span>
                  {active.home} timeouts:{" "}
                  {currentMoment?.resolved
                    ? play?.homeTimeouts
                    : (play?.homeTimeoutsBefore ??
                      previousPlay?.homeTimeouts ??
                      3)}
                </span>
              </div>
              {["scheduled", "queued", "building", "error"].includes(
                active.status,
              ) ? (
                <div className="game-lobby">
                  <Users size={35} />
                  <h2>
                    {active.status === "scheduled"
                      ? "Meet at midfield."
                      : active.status === "error"
                        ? "The worker needs another attempt."
                        : "Preparing the simulation…"}
                  </h2>
                  <p>
                    {active.status === "scheduled"
                      ? game.owners.length === 2
                        ? "Both owners must join and select Ready. Your lineups and coaching settings freeze when both are ready."
                        : "Select Ready to start your matchup against the CPU. Your saved lineup and tendencies will be used."
                      : "The server is preparing one saved game. Leaving this screen will not lose progress."}
                  </p>
                  <div className="lobby-owners">
                    {[active.away, active.home].map((id) => {
                      const owner = game.owners.find((o) => o.team === id);
                      return (
                        <div key={id}>
                          <TeamLogo id={id} />
                          <strong>{id}</strong>
                          <span>
                            {!owner
                              ? "CPU · Ready"
                              : game.ready.includes(owner.user_id)
                                ? "Owner ready"
                                : "Waiting for owner"}
                          </span>
                          {(!owner || game.ready.includes(owner.user_id)) && (
                            <CheckCircle2 size={18} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {control && active.status === "scheduled" && (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        void gameControl(
                          game.ready.includes(userId) ? "unready" : "ready",
                        )
                      }
                    >
                      {game.ready.includes(userId)
                        ? "Cancel ready"
                        : "Ready — start when owners are ready"}{" "}
                      <Play size={16} />
                    </button>
                  )}
                  {control && active.status === "error" && (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => void gameControl("retry")}
                    >
                      Retry simulation
                    </button>
                  )}
                  {!onCurrentWeek && (
                    <p>
                      This matchup becomes available when the commissioner opens
                      its week.
                    </p>
                  )}
                  {!participant && <p>You are spectating this matchup.</p>}
                </div>
              ) : (
                <>
                  <FootballField
                    key={active.id}
                    replayKey={replayKey}
                    onMoment={(next) =>
                      setMoment((old) =>
                        old?.game === active.id &&
                        old.index === next.index &&
                        old.clock === next.clock &&
                        old.resolved === next.resolved
                          ? old
                          : { ...next, game: active.id },
                      )
                    }
                    play={play}
                    players={game.players || {}}
                    home={lookup(active.home)}
                    away={lookup(active.away)}
                    playing={watchingReplay ? playing : livePlaying}
                    speed={watchingReplay ? speed : active.speed}
                    onEnd={
                      final
                        ? () => {
                            if (replayIndex < game.plays.length - 1)
                              setReplayIndex((i) => i + 1);
                            else setPlaying(false);
                          }
                        : liveReplayIndex !== null
                          ? () => setPlaying(false)
                          : undefined
                    }
                  />
                  <div className="game-controls">
                    <button
                      className="secondary"
                      disabled={busy || (!watchingReplay && !control)}
                      onClick={() => {
                        if (watchingReplay) setPlaying((p) => !p);
                        else void gameControl(livePlaying ? "pause" : "resume");
                      }}
                    >
                      {(watchingReplay ? playing : livePlaying) ? (
                        <Pause size={16} />
                      ) : (
                        <Play size={16} />
                      )}{" "}
                      {(watchingReplay ? playing : livePlaying)
                        ? "Pause"
                        : "Play"}
                    </button>
                    {(watchingReplay ? [0.25, 0.5, 1, 2, 4] : [1, 2, 4]).map(
                      (n) => (
                        <button
                          key={n}
                          aria-pressed={
                            (watchingReplay ? speed : active.speed) === n
                          }
                          disabled={busy || (!watchingReplay && !control)}
                          onClick={() =>
                            watchingReplay
                              ? setSpeed(n)
                              : void gameControl("speed", n)
                          }
                        >
                          {n}×
                        </button>
                      ),
                    )}
                    <button
                      className="secondary"
                      disabled={busy || (!watchingReplay && !control)}
                      onClick={() => {
                        if (final)
                          setReplayIndex((i) =>
                            Math.min(game.plays.length - 1, i + 1),
                          );
                        else if (liveReplayIndex !== null) {
                          setLiveReplayIndex((i) =>
                            Math.min(game.plays.length - 1, (i || 0) + 1),
                          );
                        } else void gameControl("next");
                      }}
                    >
                      <SkipForward size={16} /> Next play
                    </button>
                    <button
                      className="secondary"
                      disabled={busy || (!watchingReplay && !control)}
                      onClick={() => {
                        setPlaying(false);
                        if (final)
                          setReplayIndex(
                            nextDriveIndex(game.plays, replayIndex),
                          );
                        else if (liveReplayIndex !== null)
                          setLiveReplayIndex(
                            nextDriveIndex(game.plays, liveReplayIndex),
                          );
                        else void gameControl("next_drive");
                      }}
                    >
                      <FastForward size={16} /> Next drive
                    </button>
                    <button
                      className="secondary"
                      disabled={!game.plays.length}
                      onClick={() => {
                        if (final) setReplayIndex((i) => Math.max(0, i - 1));
                        else
                          setLiveReplayIndex(
                            Math.max(0, (active.cursor || 0) - 1),
                          );
                        setReplayKey((k) => k + 1);
                        setPlaying(true);
                      }}
                    >
                      <RotateCcw size={16} /> Replay
                    </button>
                    <button
                      className="secondary"
                      disabled={busy || (!final && !control)}
                      onClick={() => {
                        if (final) {
                          setReplayIndex(game.plays.length - 1);
                          setPlaying(false);
                        } else setConfirmEnd(true);
                      }}
                    >
                      <FastForward size={16} />{" "}
                      {final ? "Jump to final" : "Simulate to end"}
                    </button>
                    <button
                      className="secondary"
                      aria-pressed={showStats}
                      onClick={() => setShowStats((v) => !v)}
                    >
                      <BarChart3 size={16} /> Statistics
                    </button>
                  </div>
                  {liveReplayIndex !== null && !final && (
                    <div className="local-replay-note">
                      <span>Instant replay · your view only</span>
                      <button
                        className="primary"
                        onClick={() => {
                          setLiveReplayIndex(null);
                          setPlaying(false);
                        }}
                      >
                        Return to live game
                      </button>
                    </div>
                  )}
                  {confirmEnd && (
                    <div className="game-confirm" role="alert">
                      <p>
                        Finish this official game now? The result will be
                        permanent and everyone will see the final.
                      </p>
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => {
                          setConfirmEnd(false);
                          void gameControl("finish");
                        }}
                      >
                        Finish official game
                      </button>
                      <button
                        className="secondary"
                        onClick={() => setConfirmEnd(false)}
                      >
                        Keep watching
                      </button>
                    </div>
                  )}
                  {final && (
                    <label className="replay-scrubber">
                      Play {replayIndex + 1} of {game.plays.length}
                      <input
                        type="range"
                        min={0}
                        max={Math.max(0, game.plays.length - 1)}
                        value={replayIndex}
                        onChange={(e) => {
                          setReplayIndex(Number(e.target.value));
                          setPlaying(false);
                        }}
                      />
                    </label>
                  )}
                  <div className="play-description" aria-live="polite">
                    <span>
                      {play?.call} · {play?.coverage}
                    </span>
                    <strong>
                      {play?.description || "Waiting for the next snap."}
                    </strong>
                  </div>
                  <p className="fineprint">
                    {final
                      ? "Replay controls are yours alone. The official result cannot change."
                      : "Live controls are shared by participating owners. Disconnecting never erases the game. Lineups, staff, and coaching were frozen at kickoff."}
                  </p>
                  {showStats && <GameStatistics snapshot={game} />}
                  <details className="game-timeline">
                    <summary>
                      Play-by-play · {game.plays.length} events available
                    </summary>
                    <ol>
                      {game.plays.map((p, i) => (
                        <li key={p.index}>
                          <button
                            onClick={() => {
                              if (final) {
                                setReplayIndex(i);
                                setPlaying(false);
                              }
                            }}
                            disabled={!final}
                          >
                            <small>
                              {p.quarter === 5 ? "OT" : `Q${p.quarter}`}{" "}
                              {Math.floor(p.clock / 60)}:
                              {String(p.clock % 60).padStart(2, "0")} ·{" "}
                              {p.offense}
                            </small>
                            {p.description}
                          </button>
                        </li>
                      ))}
                    </ol>
                  </details>
                </>
              )}
              {game.staff && (
                <div className="game-staff-snapshot">
                  {(["away", "home"] as const).map((side) => (
                    <div key={side}>
                      <h3>{active[side]} at kickoff</h3>
                      <p>
                        {Object.entries(game.staff![side])
                          .map(([role, name]) => `${role}: ${name}`)
                          .join(" · ") || "Generic coaching staff"}
                      </p>
                      <small>
                        {game.coaching?.[side]?.offense} offense ·{" "}
                        {game.coaching?.[side]?.defense} defense
                      </small>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="panel-copy">
              Choose a matchup to enter its lobby or watch a saved replay.
            </p>
          )}
        </section>
      )}
      {view !== "Game Center" && (
        <>
          <section className="panel weekly-scoreboard">
            <div className="panel-heading">
              <h2>League scoreboard</h2>
              <span>
                {listed.filter((g) => g.status === "final").length} FINAL
              </span>
            </div>
            <div className="schedule-filters">
              <label>
                Season phase
                <select
                  value={schedulePhase || w.phase}
                  onChange={(e) => {
                    setSchedulePhase(e.target.value);
                    setScheduleWeek(1);
                  }}
                >
                  <option value="preseason">Preseason</option>
                  <option value="regular">Regular season</option>
                </select>
              </label>
              <label>
                Week
                <select
                  value={scheduleWeek || w.week}
                  onChange={(e) => setScheduleWeek(Number(e.target.value))}
                >
                  {Array.from(
                    {
                      length:
                        (schedulePhase || w.phase) === "preseason" ? 3 : 18,
                    },
                    (_, i) => (
                      <option key={i} value={i + 1}>
                        Week {i + 1}
                      </option>
                    ),
                  )}
                </select>
              </label>
            </div>
            <div className="weekly-games">
              {listed.map((g) => (
                <button
                  key={g.id}
                  className={`weekly-game ${[g.home, g.away].includes(team) ? "my-game" : ""}`}
                  onClick={() => openGame(g)}
                >
                  <span>
                    <TeamLogo id={g.away} />
                    <b>{g.away}</b>
                    <strong>{g.status === "final" ? g.away_score : "—"}</strong>
                  </span>
                  <span>
                    <TeamLogo id={g.home} />
                    <b>{g.home}</b>
                    <strong>{g.status === "final" ? g.home_score : "—"}</strong>
                  </span>
                  <small>
                    {g.status === "scheduled"
                      ? "Enter lobby"
                      : g.status === "final"
                        ? "Final · replay available"
                        : g.status.replaceAll("_", " ")}
                  </small>
                </button>
              ))}
            </div>
          </section>
          <LeagueStandings
            standings={season.standings}
            team={team}
            phase={w.phase}
          />
        </>
      )}
    </div>
  );
}
function GameStatistics({ snapshot }: { snapshot: GameSnapshot }) {
  const box = snapshot.game.box;
  const [category, setCategory] = useState<
    "passing" | "rushing" | "receiving" | "defense" | "kicking"
  >("passing");
  const columns: Record<typeof category, [string, string][]> = {
    passing: [
      ["completions", "CMP"],
      ["passing_attempts", "ATT"],
      ["passing_yards", "YDS"],
      ["passing_touchdowns", "TD"],
      ["interceptions_thrown", "INT"],
    ],
    rushing: [
      ["rushing_attempts", "ATT"],
      ["rushing_yards", "YDS"],
      ["rushing_touchdowns", "TD"],
    ],
    receiving: [
      ["targets", "TGT"],
      ["receptions", "REC"],
      ["receiving_yards", "YDS"],
      ["receiving_touchdowns", "TD"],
    ],
    defense: [
      ["tackles", "TKL"],
      ["sacks", "SACK"],
      ["interceptions", "INT"],
    ],
    kicking: [
      ["field_goals_made", "FGM"],
      ["field_goals_attempted", "FGA"],
      ["extra_points_made", "XPM"],
      ["punts", "PUNT"],
      ["punt_yards", "YDS"],
    ],
  };
  if (!box)
    return (
      <section className="game-statistics">
        <h3>Live summary</h3>
        <p>
          {snapshot.plays.length} plays revealed ·{" "}
          {snapshot.plays.filter((p) => p.turnover).length} turnovers ·{" "}
          {snapshot.plays.filter((p) => p.scoring).length} scoring plays. Full
          player and team box scores become official at the final whistle.
        </p>
      </section>
    );
  const keys = columns[category],
    rows = Object.entries(box.players)
      .filter(([, s]) =>
        keys.some(([k]) => (s as unknown as Record<string, number>)[k] > 0),
      )
      .sort(
        ([, a], [, b]) =>
          (b as unknown as Record<string, number>)[keys[0][0]] -
          (a as unknown as Record<string, number>)[keys[0][0]],
      );
  return (
    <section className="game-statistics">
      <h3>Official box score</h3>
      <div className="box-teams">
        {Object.entries(box.teams).map(([team, s]) => (
          <div key={team}>
            <strong>
              {team} · {s.score}
            </strong>
            <p>
              {s.passing_yards + s.rushing_yards} total yards · {s.plays} plays
              · {s.turnovers} turnovers
            </p>
            <p>
              {s.third_conversions}/{s.third_attempts} third downs ·{" "}
              {s.fourth_conversions}/{s.fourth_attempts} fourth downs
            </p>
            <small>
              {s.passing_yards} net passing · {s.rushing_yards} rushing ·{" "}
              {s.sacks} sacks allowed · {Math.floor(s.time_of_possession / 60)}:
              {String(s.time_of_possession % 60).padStart(2, "0")} possession
            </small>
          </div>
        ))}
      </div>
      <div className="tabs">
        {(
          ["passing", "rushing", "receiving", "defense", "kicking"] as const
        ).map((k) => (
          <button
            key={k}
            className={category === k ? "active" : ""}
            onClick={() => setCategory(k)}
          >
            {k}
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Player</th>
              {keys.map(([k, label]) => (
                <th key={k}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([id, s]) => (
              <tr key={id}>
                <td>
                  {snapshot.players?.[id]?.name || id}
                  <small> · {snapshot.players?.[id]?.team}</small>
                </td>
                {keys.map(([k]) => (
                  <td key={k}>{(s as unknown as Record<string, number>)[k]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
