"use client";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ArrowRight,
  Shield,
  Plus,
  LogOut,
  Users,
  Trophy,
  LayoutDashboard,
  ListOrdered,
  SlidersHorizontal,
  ArrowLeftRight,
  ScanSearch,
  Globe,
  MonitorPlay,
  Copy,
  RefreshCw,
} from "lucide-react";
import { supabase as db } from "@/lib/supabase";
import type {
  League,
  Franchise,
  Player,
  Snapshot,
  Management,
} from "@/lib/types";
import { RosterManagement, Trades, CoachingSettings } from "./management";
import { DraftRoom } from "./draft-room";
import { FranchiseMark, TeamLogo } from "./identity";
const navigation = [
  ["Dashboard", LayoutDashboard],
  ["Roster", Users],
  ["Coaching", SlidersHorizontal],
  ["Trades", ArrowLeftRight],
  ["Draft", ListOrdered],
  ["Scouting", ScanSearch],
  ["League", Globe],
  ["Game Center", MonitorPlay],
] as const;
export default function FranchiseApp() {
  const [session, setSession] = useState<Session | null>(null),
    [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [signup, setSignup] = useState(false),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [management, setManagement] = useState<Management | null>(null);
  const [leagues, setLeagues] = useState<League[]>([]),
    [teams, setTeams] = useState<Franchise[]>([]),
    [selected, setSelected] = useState(""),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [players, setPlayers] = useState<Player[]>([]),
    [view, setView] = useState("Dashboard");
  const [name, setName] = useState(""),
    [team, setTeam] = useState("BAL"),
    [token, setToken] = useState(""),
    [preview, setPreview] = useState<{
      name: string;
      state: string;
      taken: string[];
    } | null>(null),
    [joining, setJoining] = useState(false),
    [queue, setQueue] = useState<string[]>([]),
    [sync, setSync] = useState("Connecting");
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  useEffect(() => {
    if (!db) {
      setAuthReady(true);
      return;
    }
    void db.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = db.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setAuthReady(true);
    });
    const t = new URLSearchParams(window.location.search).get("invite");
    if (t) {
      setToken(t);
      setJoining(true);
    }
    return () => data.subscription.unsubscribe();
  }, []);
  const loadHome = useCallback(async () => {
    if (!db) return;
    const [a, b] = await Promise.all([
      db.from("leagues").select("*").order("created_at", { ascending: false }),
      db.from("franchises").select("*").order("city"),
    ]);
    if (a.error || b.error) {
      setNotice(a.error?.message || b.error?.message || "Unable to load");
      return;
    }
    setLeagues(a.data || []);
    setTeams(b.data || []);
  }, []);
  useEffect(() => {
    if (session) void loadHome();
    else {
      setSelected("");
      setSnapshot(null);
      setPlayers([]);
      setLeagues([]);
    }
  }, [session, loadHome]);
  const refresh = useCallback(async () => {
    if (!db || !selected) return;
    const [snapshotResult, managementResult] = await Promise.all([
      db.rpc("league_snapshot", { lid: selected }),
      db.rpc("management_snapshot", { lid: selected }),
    ]);
    const { data, error } = snapshotResult;
    if (selectedRef.current !== selected) return;
    if (error) {
      setSync("Connection issue");
      setNotice(error.message);
      if (error.message.includes("access denied")) {
        setSelected("");
        void loadHome();
      }
      return;
    }
    setSnapshot((old) =>
      old &&
      old.league.id === data.league.id &&
      old.league.revision > data.league.revision
        ? old
        : data,
    );
    if (managementResult.error) setNotice(managementResult.error.message);
    else setManagement(managementResult.data);
    setSync("Synced");
  }, [selected, loadHome]);
  useEffect(() => {
    if (!db || !selected || !session) return;
    let active = true;
    setSnapshot(null);
    setPlayers([]);
    setQueue([]);
    setManagement(null);
    void refresh();
    void (async () => {
      const all: Player[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await db!
          .from("league_players")
          .select("profile")
          .eq("league_id", selected)
          .order("player_id")
          .range(offset, offset + 999);
        if (!active) return;
        if (error) {
          setNotice(error.message);
          return;
        }
        all.push(...data.map((p) => p.profile as Player));
        if (data.length < 1000) break;
      }
      setPlayers(all);
      const q = await db!
        .from("draft_queue")
        .select("player_id")
        .eq("league_id", selected)
        .eq("user_id", session.user.id)
        .order("rank");
      if (active) setQueue(q.data?.map((x) => x.player_id) || []);
    })();
    let timer: ReturnType<typeof setTimeout>;
    const channel = db
      .channel("league-" + selected)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "leagues",
          filter: "id=eq." + selected,
        },
        () => {
          clearTimeout(timer);
          timer = setTimeout(() => void refresh(), 150);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "memberships",
          filter: "league_id=eq." + selected,
        },
        () => void refresh(),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setSync("Live");
      });
    const poll = setInterval(() => void refresh(), 5000);
    return () => {
      active = false;
      clearTimeout(timer);
      clearInterval(poll);
      void db!.removeChannel(channel);
    };
  }, [selected, session, refresh]);
  useEffect(() => {
    if (
      !db ||
      !selected ||
      !snapshot ||
      !["running", "completing"].includes(snapshot.league.state)
    )
      return;
    let stopped = false,
      inFlight = false;
    const tick = async () => {
      if (inFlight || stopped) return;
      inFlight = true;
      const { error } = await db!.rpc("cpu_tick", { lid: selected });
      inFlight = false;
      if (!stopped) {
        if (error) setNotice(error.message);
        else void refresh();
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 1000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [selected, snapshot?.league.state, refresh]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setNotice(
        e && typeof e === "object" && "message" in e
          ? String(e.message)
          : String(e),
      );
    } finally {
      setBusy(false);
    }
  }
  async function rpc(fn: string, args: Record<string, unknown>) {
    const { data, error } = await db!.rpc(fn, args);
    if (error) throw error;
    return data;
  }
  async function authenticate() {
    if (!db) return;
    await action(async () => {
      const { data, error } = signup
        ? await db!.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: window.location.origin + window.location.search,
            },
          })
        : await db!.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (signup && !data.session)
        setNotice("Check your email to confirm your account, then sign in.");
    });
  }
  async function createOrJoin() {
    await action(async () => {
      const id = joining
        ? await rpc("join_league", { invite_token: token, team })
        : await rpc("create_league", { league_name: name, team });
      await loadHome();
      setSelected(id);
      setView("Draft");
      setPreview(null);
      window.history.replaceState({}, "", window.location.pathname);
    });
  }
  async function changeQueue(pid: string) {
    await action(async () => {
      if (queue.includes(pid)) {
        const { error } = await db!
          .from("draft_queue")
          .delete()
          .eq("league_id", selected)
          .eq("user_id", session!.user.id)
          .eq("player_id", pid);
        if (error) throw error;
        setQueue((q) => q.filter((x) => x !== pid));
      } else {
        const { error } = await db!.from("draft_queue").insert({
          league_id: selected,
          user_id: session!.user.id,
          player_id: pid,
          rank: Date.now() % 2147483647,
        });
        if (error) throw error;
        setQueue((q) => [...q, pid]);
      }
    });
  }
  const me = snapshot?.members.find((m) => m.user_id === session?.user.id),
    myTeam = teams.find((t) => t.id === me?.franchise_id),
    commissioner = snapshot?.league.commissioner === session?.user.id;
  const activePicks = new Set(snapshot?.picks.map((p) => p.player_id) || []);
  const myIds = useMemo(
    () =>
      new Set(
        management
          ? management.ownership
              .filter((p) => p.franchise_id === me?.franchise_id)
              .map((p) => p.player_id)
          : snapshot?.picks
              .filter((p) => p.franchise_id === me?.franchise_id)
              .map((p) => p.player_id),
      ),
    [management, snapshot?.picks, me?.franchise_id],
  );
  const myRoster = players.filter((p) => myIds.has(p.id));
  return (
    <div className="app">
      <header className="topbar">
        <button
          className="brand"
          onClick={() => setSelected("")}
          aria-label="Fantasy Franchise home"
        >
          <span className="brand-mark">
            <FranchiseMark />
          </span>
          <span>
            FANTASY <strong>FRANCHISE</strong>
            <small>DRAFT YOUR TEAM. BUILD YOUR DYNASTY.</small>
          </span>
        </button>
        <div className="top-actions">
          <span className="edition">INAUGURAL EDITION · PHASE 1</span>
          {session && (
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={() => void db!.auth.signOut()}
            >
              <LogOut size={18} />
            </button>
          )}
        </div>
      </header>
      {notice && (
        <div className="notice" role="status">
          {notice}
          <button aria-label="Dismiss message" onClick={() => setNotice("")}>
            ×
          </button>
        </div>
      )}
      {!authReady ? (
        <main className="loading">Connecting to your franchise…</main>
      ) : !db ? (
        <main className="welcome">
          <Intro />
          <section className="panel auth-panel">
            <span className="eyebrow">BACKEND CONNECTION REQUIRED</span>
            <h2>Your league starts here.</h2>
            <p>
              This build needs its Supabase project connected before accounts
              and persistent leagues can be used.
            </p>
            <p>
              The database setup and deployment instructions are included in the
              repository README.
            </p>
            <div className="callout">
              Phase 1 · Accounts, private leagues and the fantasy draft
            </div>
          </section>
        </main>
      ) : !session ? (
        <main className="welcome">
          <Intro />
          <form
            className="panel auth-panel"
            onSubmit={(e) => {
              e.preventDefault();
              void authenticate();
            }}
          >
            <span className="eyebrow">ENTER THE FRONT OFFICE</span>
            <h2>{signup ? "Build your legacy." : "Welcome back, coach."}</h2>
            <p>
              {joining
                ? "Sign in to accept your league invitation."
                : "Your franchise is waiting. Make every pick count."}
            </p>
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete={signup ? "new-password" : "current-password"}
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button disabled={busy} className="primary">
              {busy ? "Connecting…" : signup ? "Create account" : "Sign in"}
              <ArrowRight size={17} />
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setSignup(!signup)}
            >
              {signup
                ? "Already a member? Sign in"
                : "New here? Create an account"}
            </button>
            <small>Private leagues. Unlimited time on the clock.</small>
          </form>
        </main>
      ) : !selected ? (
        <main className="lobby">
          <div className="page-heading">
            <div>
              <span className="eyebrow">THE FRONT OFFICE</span>
              <h1>Your next dynasty.</h1>
              <p>
                Create a league, bring your friends, and make your first move.
              </p>
            </div>
            <Trophy className="hero-icon" size={68} />
          </div>
          <div className="lobby-grid">
            <section>
              <h2>
                Your leagues{" "}
                <span className="muted">
                  / {leagues.length.toString().padStart(2, "0")}
                </span>
              </h2>
              {leagues.length === 0 ? (
                <div className="panel empty">
                  <Shield size={40} />
                  <h3>A clean slate. Endless possibilities.</h3>
                  <p>
                    Your leagues will appear here after you create one or join a
                    friend.
                  </p>
                </div>
              ) : (
                leagues.map((l) => (
                  <button
                    key={l.id}
                    className="league-card panel"
                    onClick={() => {
                      setSelected(l.id);
                      setView("Dashboard");
                    }}
                  >
                    <span className="league-emblem">
                      <Shield />
                    </span>
                    <span>
                      <small>
                        SEASON {l.season} ·{" "}
                        {l.state.replaceAll("_", " ").toUpperCase()}
                      </small>
                      <h3>{l.name}</h3>
                      <p>32 franchises · Snake draft</p>
                    </span>
                    <ArrowRight />
                  </button>
                ))
              )}
            </section>
            <form
              className="panel create-panel"
              onSubmit={(e) => {
                e.preventDefault();
                void createOrJoin();
              }}
            >
              <div className="tabs">
                <button
                  type="button"
                  className={!joining ? "active" : ""}
                  onClick={() => setJoining(false)}
                >
                  Create league
                </button>
                <button
                  type="button"
                  className={joining ? "active" : ""}
                  onClick={() => setJoining(true)}
                >
                  Join league
                </button>
              </div>
              <h2>{joining ? "Join the competition." : "Set the stage."}</h2>
              {joining ? (
                <>
                  <label>
                    Invitation link or code
                    <input
                      required
                      value={token}
                      onChange={(e) => {
                        const v = e.target.value;
                        try {
                          setToken(new URL(v).searchParams.get("invite") || v);
                        } catch {
                          setToken(v);
                        }
                        setPreview(null);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || !token}
                    onClick={() =>
                      void action(async () => {
                        const p = await rpc("invite_preview", {
                          invite_token: token,
                        });
                        setPreview(p);
                        setTeam(
                          teams.find((t) => !p.taken.includes(t.id))?.id || "",
                        );
                      })
                    }
                  >
                    Check invitation
                  </button>
                  {preview && (
                    <p>
                      {preview.name} ·{" "}
                      {preview.state === "waiting"
                        ? "Open for owners"
                        : "Draft already started"}
                    </p>
                  )}
                </>
              ) : (
                <label>
                  League name
                  <input
                    placeholder="Sunday Night Dynasty"
                    minLength={3}
                    maxLength={60}
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
              )}
              <label>
                Your franchise
                <select value={team} onChange={(e) => setTeam(e.target.value)}>
                  {teams
                    .filter((t) => !joining || !preview?.taken.includes(t.id))
                    .map((t) => (
                      <option value={t.id} key={t.id}>
                        {t.city} {t.name}
                      </option>
                    ))}
                </select>
              </label>
              <div className="selected-franchise">
                <TeamLogo id={team} />
                <span>
                  {teams.find((t) => t.id === team)?.city}{" "}
                  {teams.find((t) => t.id === team)?.name}
                </span>
              </div>
              <button
                className="primary"
                disabled={
                  busy ||
                  (joining &&
                    (!preview || preview.state !== "waiting" || !team))
                }
              >
                {joining ? "Claim franchise" : "Create private league"}
                <Plus size={17} />
              </button>
              <p className="fineprint">
                32 teams. Unclaimed teams are CPU-managed. Your commissioner
                decides when the draft begins.
              </p>
            </form>
          </div>
          <div className="data-note">
            NFL roster data: nflverse (CC BY 4.0). Ratings, attributes and
            contracts are original provisional estimates, not EA/Madden ratings.
            New NFL pools include clearly labeled fictional depth reserves where
            needed.
          </div>
        </main>
      ) : (
        <div className="workspace">
          <aside className="sidebar">
            <div
              className="team-identity"
              style={{ "--team-color": myTeam?.color } as React.CSSProperties}
            >
              <TeamLogo id={myTeam?.id || "BAL"} className="franchise-avatar" />
              <small>YOUR FRANCHISE</small>
              <h3>{myTeam?.name || "Loading…"}</h3>
              <p>{commissioner ? "Commissioner" : "General manager"}</p>
            </div>
            <nav aria-label="League navigation">
              <button
                className="mobile-leagues"
                onClick={() => setSelected("")}
              >
                ← Leagues
              </button>
              {navigation.map(([label, Icon]) => {
                const available = [
                  "Dashboard",
                  "Roster",
                  "Draft",
                  "League",
                  "Trades",
                  "Coaching",
                ].includes(label);
                return (
                  <button
                    key={label}
                    disabled={!available}
                    className={view === label ? "active" : ""}
                    onClick={() => setView(label)}
                  >
                    <Icon size={18} />
                    {label}
                    {!available && <small>SOON</small>}
                  </button>
                );
              })}
            </nav>
            <button className="switch-league" onClick={() => setSelected("")}>
              ← All leagues
            </button>
            <div className="sidebar-bottom">
              <span className="live-dot" />
              {sync}
              <small>FANTASY FRANCHISE / 01</small>
            </div>
          </aside>
          <main className="main-content">
            {!snapshot ? (
              <p>Loading your league…</p>
            ) : (
              <>
                <div className="league-heading">
                  <div>
                    <span className="eyebrow">
                      {snapshot.league.name}{" "}
                      <span>
                        / SEASON{" "}
                        {snapshot.league.season.toString().padStart(2, "0")}
                      </span>
                    </span>
                    <h1>
                      {view === "Draft"
                        ? "The draft room."
                        : view === "Roster"
                          ? "Your foundation."
                          : view === "Trades"
                            ? "Make your next move."
                            : view === "Coaching"
                              ? "Set your identity."
                              : view === "League"
                                ? "The league office."
                                : "Build something legendary."}
                    </h1>
                  </div>
                  <span className={"status " + snapshot.league.state}>
                    <span />
                    {snapshot.league.state.replaceAll("_", " ")}
                  </span>
                </div>
                {view === "Draft" ? (
                  <DraftRoom
                    snapshot={snapshot}
                    players={players}
                    teams={teams}
                    userId={session.user.id}
                    busy={busy}
                    queue={queue.filter((id) => !activePicks.has(id))}
                    onQueue={changeQueue}
                    onControl={(a) =>
                      action(async () => {
                        await rpc("draft_control", {
                          lid: selected,
                          action: a,
                        });
                        await refresh();
                      })
                    }
                    onPick={async (id, pick, revision) => {
                      let accepted = false;
                      await action(async () => {
                        await rpc("submit_pick", {
                          lid: selected,
                          pid: id,
                          expected_pick: pick,
                          expected_revision: revision,
                        });
                        accepted = true;
                        await refresh();
                      });
                      return accepted;
                    }}
                  />
                ) : ["Roster", "Trades", "Coaching"].includes(view) ? (
                  management && me ? (
                    (() => {
                      const props = {
                        league: snapshot.league,
                        data: management,
                        players,
                        teams,
                        team: me.franchise_id,
                        busy,
                        mutate: async (
                          fn: string,
                          args: Record<string, unknown>,
                        ) => {
                          let success = false;
                          await action(async () => {
                            await rpc(fn, args);
                            await refresh();
                            success = true;
                          });
                          return success;
                        },
                      };
                      return view === "Roster" ? (
                        <RosterManagement {...props} />
                      ) : view === "Trades" ? (
                        <Trades {...props} />
                      ) : (
                        <CoachingSettings {...props} />
                      );
                    })()
                  ) : (
                    <p>Loading franchise management…</p>
                  )
                ) : view === "League" ? (
                  <>
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>Ownership directory</h2>
                        <span>
                          {snapshot.members.length} HUMAN /{" "}
                          {32 - snapshot.members.length} CPU
                        </span>
                      </div>
                      {commissioner && (
                        <div className="invite-bar">
                          <p>Invite your owners before starting the draft.</p>
                          <button
                            className="secondary"
                            onClick={() =>
                              void action(async () => {
                                await navigator.clipboard.writeText(
                                  window.location.origin +
                                    "/?invite=" +
                                    snapshot.invite,
                                );
                                setNotice("Invitation link copied.");
                              })
                            }
                          >
                            <Copy size={15} /> Copy invite
                          </button>
                          <button
                            className="icon-button"
                            aria-label="Replace invitation link"
                            onClick={() =>
                              void action(async () => {
                                await rpc("rotate_invite", { lid: selected });
                                await refresh();
                                setNotice(
                                  "New invitation created. Previous link no longer works.",
                                );
                              })
                            }
                          >
                            <RefreshCw size={16} />
                          </button>
                        </div>
                      )}
                      <div className="ownership-grid">
                        {teams.map((t) => {
                          const owner = snapshot.members.find(
                            (m) => m.franchise_id === t.id,
                          );
                          return (
                            <div key={t.id} className="ownership">
                              <TeamLogo id={t.id} />
                              <div>
                                {t.city} {t.name}
                                <small>
                                  {owner
                                    ? owner.user_id === session.user.id
                                      ? "YOU"
                                      : owner.user_id ===
                                          snapshot.league.commissioner
                                        ? "COMMISSIONER"
                                        : "HUMAN OWNER"
                                    : "CPU GENERAL MANAGER"}
                                </small>
                              </div>
                              {commissioner &&
                                owner &&
                                owner.user_id !== session.user.id &&
                                snapshot.league.state === "waiting" && (
                                  <button
                                    onClick={() => {
                                      if (
                                        window.confirm(
                                          "Return " +
                                            t.name +
                                            " to CPU control?",
                                        )
                                      )
                                        void action(async () => {
                                          await rpc("manage_member", {
                                            lid: selected,
                                            member_id: owner.user_id,
                                          });
                                          await refresh();
                                        });
                                    }}
                                  >
                                    Remove
                                  </button>
                                )}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  </>
                ) : (
                  <>
                    <section className="dashboard-hero">
                      <div>
                        <span className="eyebrow">
                          YOUR DYNASTY BEGINS WITH A DECISION
                        </span>
                        <h2>
                          One league.
                          <br />
                          Thirty-two ambitions.
                        </h2>
                        <p>Your roster is a blank canvas. Build it your way.</p>
                        <button
                          className="primary"
                          onClick={() => setView("Draft")}
                        >
                          Enter draft room <ArrowRight size={18} />
                        </button>
                      </div>
                      <div className="hero-shield">
                        <FranchiseMark />
                      </div>
                    </section>
                    <div className="metric-grid">
                      <div className="panel metric">
                        <small>YOUR ROSTER</small>
                        <b>
                          {myRoster.length}
                          <em>/ 53</em>
                        </b>
                        <p>Every pick shapes your future</p>
                      </div>
                      <div className="panel metric">
                        <small>LEAGUE OWNERS</small>
                        <b>
                          {snapshot.members.length}
                          <em>/ 32</em>
                        </b>
                        <p>{32 - snapshot.members.length} CPU franchises</p>
                      </div>
                      <div className="panel metric">
                        <small>DRAFT PROGRESS</small>
                        <b>
                          {snapshot.picks.length}
                          <em>/ 1,696</em>
                        </b>
                        <p>15 manual rounds · 38 auto rounds</p>
                      </div>
                    </div>
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>League activity</h2>
                        <span>FRONT OFFICE WIRE</span>
                      </div>
                      {snapshot.events.map((e, i) => (
                        <div className="event" key={i}>
                          <span className="live-dot" />
                          {e.message}
                          <time>
                            {new Date(e.created_at).toLocaleDateString()}
                          </time>
                        </div>
                      ))}
                    </section>
                  </>
                )}
                <footer className="data-note">
                  {players.some((p) => p.is_fictional === false)
                    ? "NFL roster: nflverse · CC BY 4.0. Original provisional ratings and game contracts, not EA/Madden. Includes labeled fictional depth reserves."
                    : "Saved fictional test pool · Original provisional ratings and contracts. Create a new league to use the NFL player pool."}
                </footer>
              </>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
function Intro() {
  return (
    <section className="intro">
      <span className="eyebrow">32 FRANCHISES. YOUR LEGACY.</span>
      <h1>
        Draft your team.
        <br />
        Build your <em>dynasty.</em>
      </h1>
      <p>
        The front office is yours. Bring your friends, build your roster, and
        write the first chapter.
      </p>
      <div className="intro-features">
        <span>
          <Shield size={18} /> Private leagues
        </span>
        <span>
          <ListOrdered size={18} /> Live snake draft
        </span>
        <span>
          <Users size={18} /> Human + CPU owners
        </span>
      </div>
      <div className="field-art" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
        <span>FANTASY FRANCHISE</span>
      </div>
    </section>
  );
}
