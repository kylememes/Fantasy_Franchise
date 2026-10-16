"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, Search, UserRound } from "lucide-react";
import { supabase as db } from "@/lib/supabase";
import {
  money,
  limits,
  type Player,
  type TradeOffer,
  type TradePreview,
} from "@/lib/types";
import { developmentTier } from "@/lib/lineup";
import { playerHeadshot } from "@/lib/headshots";
import {
  findTradePartners,
  pickLabel,
  pickTradeValue,
  playerTradeValue,
  salaryEffects,
} from "@/lib/trades";
import type { ManagementProps } from "./management";
import { PlayerCard } from "./lineup";
import { TeamLogo } from "./identity";

function TradePortrait({ player }: { player: Player }) {
  const url = playerHeadshot(player);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span className="trade-portrait" aria-hidden="true">
      {url && failed !== url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(url)}
        />
      ) : (
        <UserRound size={23} />
      )}
    </span>
  );
}
function SalaryImpact({
  label,
  impact,
}: {
  label: string;
  impact: ReturnType<typeof salaryEffects>;
}) {
  return (
    <div className="trade-salary-side">
      <h3>{label}</h3>
      <dl>
        <div>
          <dt>Salary sent</dt>
          <dd>{money(impact.sent)}</dd>
        </div>
        <div>
          <dt>Salary received</dt>
          <dd>{money(impact.received)}</dd>
        </div>
        <div>
          <dt>Net salary change</dt>
          <dd>
            {impact.change > 0 ? "+" : ""}
            {money(impact.change)}
          </dd>
        </div>
        <div className={impact.capSpace < 0 ? "over-cap" : ""}>
          <dt>Remaining cap space</dt>
          <dd>{money(impact.capSpace)}</dd>
        </div>
      </dl>
    </div>
  );
}
export function Trades({
  league,
  data,
  players,
  teams,
  team,
  busy,
  mutate,
  client = db,
}: ManagementProps & { client?: Pick<NonNullable<typeof db>, "rpc"> | null }) {
  const [target, setTarget] = useState(
    teams.find((t) => t.id !== team)?.id || "",
  );
  const [give, setGive] = useState<string[]>([]),
    [take, setTake] = useState<string[]>([]);
  const [gp, setGp] = useState<string[]>([]),
    [tp, setTp] = useState<string[]>([]);
  const [search, setSearch] = useState(""),
    [position, setPosition] = useState("");
  const [reviewKey, setReviewKey] = useState(""),
    [parent, setParent] = useState<TradeOffer | null>(null);
  const [tab, setTab] = useState("incoming"),
    [expanded, setExpanded] = useState<string | null>(null);
  const [finderPosition, setFinderPosition] = useState(""),
    [offeredId, setOfferedId] = useState("");
  const [showPartners, setShowPartners] = useState(false),
    [previewError, setPreviewError] = useState("");
  const [evaluation, setEvaluation] = useState<{
    key: string;
    value: TradePreview;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const builder = useRef<HTMLElement>(null);
  const inboxRef = useRef<HTMLElement>(null);
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const contracts = useMemo(
    () => new Map(data.contracts.map((c) => [c.player_id, c])),
    [data.contracts],
  );
  const owners = useMemo(
    () => new Map(data.ownership.map((o) => [o.player_id, o.franchise_id])),
    [data.ownership],
  );
  const roster = (id: string) =>
    players
      .filter((p) => owners.get(p.id) === id)
      .sort((a, b) => b.overall - a.overall || a.name.localeCompare(b.name));
  const picks = (id: string) =>
    data.picks.filter((p) => p.franchise_id === id && p.season > league.season);
  const cap = league.salary_cap || 275000000;
  const mine = salaryEffects(data, team, give, take, cap),
    theirs = salaryEffects(data, target, take, give, cap);
  const stale =
    give.some((id) => owners.get(id) !== team || !contracts.has(id)) ||
    take.some((id) => owners.get(id) !== target || !contracts.has(id)) ||
    gp.some((id) => !picks(team).some((p) => p.id === id)) ||
    tp.some((id) => !picks(target).some((p) => p.id === id));
  const draftKey = JSON.stringify([
    target,
    give,
    take,
    gp,
    tp,
    parent?.id,
    mine,
    theirs,
    stale,
    league.state,
  ]);
  const requestKey = JSON.stringify([draftKey, data.revision, retry]);
  const preview = evaluation?.key === requestKey ? evaluation.value : null;
  const hasAssets = give.length + take.length + gp.length + tp.length > 0;
  const ready =
    league.state === "completed" &&
    give.length + gp.length > 0 &&
    take.length + tp.length > 0 &&
    give.length + gp.length <= 10 &&
    take.length + tp.length <= 10 &&
    !stale &&
    mine.capSpace >= 0 &&
    theirs.capSpace >= 0;
  const checking =
    !!client &&
    hasAssets &&
    league.state === "completed" &&
    !preview &&
    !previewError;
  const canReview = ready && !busy && (!client || !!preview?.valid);
  const queryArgs = {
    lid: league.id,
    target_team: target,
    give_players: give,
    take_players: take,
    give_picks: gp,
    take_picks: tp,
  };
  useEffect(() => {
    let active = true;
    setPreviewError("");
    if (!client || !hasAssets || league.state !== "completed") return;
    const timer = setTimeout(async () => {
      try {
        const r = await client.rpc("trade_preview", queryArgs);
        if (!active) return;
        if (r.error) throw r.error;
        setEvaluation({ key: requestKey, value: r.data as TradePreview });
      } catch (e) {
        if (active)
          setPreviewError(
            (e as { message?: string }).message ||
              "Unable to check this offer.",
          );
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // requestKey includes every asset, salary/ownership change and snapshot revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, requestKey, league.id, league.state, hasAssets]);
  function clear(next = target) {
    setTarget(next);
    setGive([]);
    setTake([]);
    setGp([]);
    setTp([]);
    setParent(null);
    setReviewKey("");
  }
  function toggle(
    id: string,
    selected: string[],
    set: (ids: string[]) => void,
  ) {
    set(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id],
    );
  }
  const summary = (ids: string[], ps: string[]) =>
    [
      ...ids.map((id) => byId.get(id)?.name || "Unavailable player"),
      ...ps.map((id) => {
        const p = data.picks.find((p) => p.id === id);
        return p ? pickLabel(p) : "Unavailable pick";
      }),
    ].join(", ");
  const estimate = (ids: string[], ps: string[]) =>
    ids.reduce((v, id) => {
      const p = byId.get(id);
      return (
        v + (p ? playerTradeValue(p, contracts.get(id), league.season) : 0)
      );
    }, 0) +
    ps.reduce((v, id) => {
      const p = data.picks.find((p) => p.id === id);
      return v + (p ? pickTradeValue(p, league.season) : 0);
    }, 0);
  const giveValue = preview?.give_value ?? estimate(give, gp),
    takeValue = preview?.take_value ?? estimate(take, tp);
  const valueShare =
    giveValue + takeValue ? (giveValue / (giveValue + takeValue)) * 100 : 50;
  function side(
    id: string,
    selected: string[],
    set: (ids: string[]) => void,
    selectedPicks: string[],
    setPicks: (ids: string[]) => void,
  ) {
    const available = roster(id).filter(
      (p) =>
        (!position || p.position === position) &&
        p.name.toLowerCase().includes(search.toLowerCase()),
    );
    return (
      <section
        className="trade-desk-side"
        aria-label={id === team ? "Your trade assets" : "Partner trade assets"}
      >
        <div className="trade-team-heading">
          <TeamLogo id={id} />
          <div>
            <small>{id === team ? "YOUR FRANCHISE" : "TRADE PARTNER"}</small>
            <h3>{teams.find((t) => t.id === id)?.name || id}</h3>
            <p>
              {id === team ? "They receive" : "You receive"} ·{" "}
              {selected.length + selectedPicks.length}/10 assets
            </p>
          </div>
        </div>
        <div className="trade-selected-cards">
          {selected.map((pid) => {
            const p = byId.get(pid);
            return (
              <div className="trade-selected-player" key={pid}>
                <PlayerCard player={p} label={p?.position || "Player"} />
                <small>
                  {money(contracts.get(pid)?.annual_salary || 0)}/yr ·{" "}
                  {p?.age ?? "—"} yrs old ·{" "}
                  {Math.max(
                    0,
                    (contracts.get(pid)?.start_season || league.season) +
                      (contracts.get(pid)?.years || 0) -
                      league.season,
                  )}{" "}
                  yrs left
                </small>
                <button
                  className="text-button"
                  disabled={busy}
                  aria-label={`Remove ${p?.name || "player"} from offer`}
                  onClick={() => toggle(pid, selected, set)}
                >
                  Remove
                </button>
              </div>
            );
          })}
          {!selected.length && (
            <p className="trade-selection-empty">
              Select players below. Tap a selected card to inspect it.
            </p>
          )}
        </div>
        <fieldset
          className="trade-roster-picker"
          disabled={busy || league.state !== "completed"}
        >
          <legend>{id === team ? "Your players" : `${id} players`}</legend>
          <div className="trade-assets">
            {available.map((p) => {
              const tier = developmentTier(p.development);
              return (
                <label
                  className={`asset-option ${selected.includes(p.id) ? "asset-selected" : ""}`}
                  key={p.id}
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(p.id)}
                    onChange={() => toggle(p.id, selected, set)}
                  />
                  <TradePortrait player={p} />
                  <span>
                    <strong>{p.name}</strong>
                    <small>
                      {p.position} · Age {p.age} ·{" "}
                      {money(contracts.get(p.id)?.annual_salary || 0)}/yr
                    </small>
                    <em className={`trade-development dev-${tier.key}`}>
                      {tier.label}
                    </em>
                  </span>
                  <b className="rating">{p.overall}</b>
                </label>
              );
            })}
            {!available.length && (
              <p className="panel-copy">No matching players.</p>
            )}
          </div>
          <details className="trade-picks">
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
              {!picks(id).length && <p>No future picks available.</p>}
            </div>
          </details>
        </fieldset>
      </section>
    );
  }
  function offerAssets(id: string, ids: string[], pickIds: string[]) {
    return (
      <section aria-label={`Offer assets from ${id}`}>
        <h4>{id} sends</h4>
        {!!ids.length && (
          <div className="trade-selected-cards">
            {ids.map((pid) => {
              const p = byId.get(pid),
                contract = contracts.get(pid);
              return (
                <div className="trade-selected-player" key={pid}>
                  <PlayerCard player={p} label={p?.position || "Player"} />
                  <small>
                    {contract
                      ? `${money(contract.annual_salary)}/yr`
                      : "Contract unavailable"}
                  </small>
                </div>
              );
            })}
          </div>
        )}
        {!!pickIds.length && <p>{summary([], pickIds)}</p>}
      </section>
    );
  }
  const partners = showPartners
    ? findTradePartners(players, data, teams, team, finderPosition, offeredId)
    : [];
  const latest = new Map<string, TradeOffer>();
  for (const t of [...data.trades].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  )) {
    const key = t.thread_id || t.id;
    if (!latest.has(key)) latest.set(key, t);
  }
  const groups = [...latest.values()];
  const inbox = groups.filter((t) =>
    tab === "incoming"
      ? t.status === "pending" && t.to_team === team
      : tab === "sent"
        ? t.status === "pending" && t.from_team === team
        : !["pending", "countered"].includes(t.status),
  );
  function revise(t: TradeOffer) {
    const incoming = t.to_team === team;
    setTarget(incoming ? t.from_team : t.to_team);
    setGive(incoming ? t.take_players : t.give_players);
    setTake(incoming ? t.give_players : t.take_players);
    setGp(incoming ? t.take_picks : t.give_picks);
    setTp(incoming ? t.give_picks : t.take_picks);
    setParent(t);
    setReviewKey("");
    builder.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }
  return (
    <div className="trade-desk">
      <section className="panel trade-builder" ref={builder}>
        <div className="panel-heading">
          <h2>
            <ArrowLeftRight size={20} />
            Trade desk
          </h2>
          <span>BUILD · NEGOTIATE · AGREE</span>
        </div>
        <p className="panel-copy">
          Build a deal with players and future picks. Submitting is your
          acceptance; human owners decide their offers and CPU teams evaluate
          the package.
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
              disabled={busy}
              onChange={(e) => clear(e.target.value)}
            >
              {teams
                .filter((t) => t.id !== team)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.city} {t.name}
                    {data.human_teams
                      ? data.human_teams.includes(t.id)
                        ? " · Human"
                        : " · CPU"
                      : ""}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Find players
            <input
              placeholder="Player name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label>
            Position
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value)}
            >
              <option value="">All positions</option>
              {Object.keys(limits).map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => clear()}
          >
            Clear offer
          </button>
        </div>
        {parent && (
          <div className="trade-counter-banner">
            {parent.to_team === team ? "Countering" : "Revising"}{" "}
            {parent.from_team} → {parent.to_team}. The previous offer is
            replaced only when you submit.
            <button
              className="text-button"
              disabled={busy}
              onClick={() => setParent(null)}
            >
              Make a separate offer
            </button>
          </div>
        )}
        <div className="trade-columns">
          {side(team, give, setGive, gp, setGp)}
          {side(target, take, setTake, tp, setTp)}
        </div>
        <section className="trade-salary" aria-label="Trade salary effects">
          <h2>Salary effects</h2>
          <div className="trade-salary-grid">
            <SalaryImpact label="Your franchise" impact={mine} />
            <SalaryImpact label={target} impact={theirs} />
          </div>
        </section>
        <section className="trade-evaluation" aria-label="Trade evaluation">
          <div className="trade-value-heading">
            <h3>Estimated value comparison</h3>
            <span>
              You send {Math.round(giveValue).toLocaleString()} · You receive{" "}
              {Math.round(takeValue).toLocaleString()}
            </span>
          </div>
          <div className="trade-value-bar" aria-hidden="true">
            <span style={{ width: `${valueShare}%` }} />
          </div>
          <p className="fineprint">
            Ability, age, development, contracts and future picks shape
            estimated value. Team needs can influence CPU interest.
          </p>
          {checking && <p role="status">Checking this package…</p>}
          {previewError && (
            <p role="alert">
              {previewError}{" "}
              <button
                className="text-button"
                onClick={() => setRetry((n) => n + 1)}
              >
                Retry evaluation
              </button>
            </p>
          )}
          {preview?.is_cpu && (
            <div className="cpu-interest">
              <div>
                <strong>CPU trade interest</strong>
                <span>
                  {preview.interest === null
                    ? "Choose assets"
                    : `${preview.interest}/100 · ${preview.interest < 30 ? "Very low" : preview.interest < 55 ? "Low" : preview.interest < 75 ? "Close" : preview.interest < 90 ? "Interested" : "Strong interest"}`}
                </span>
              </div>
              <div
                className="cpu-interest-track"
                role="meter"
                aria-label="CPU trade interest"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={preview.interest ?? 0}
                aria-valuetext={
                  preview.cpu_accepts
                    ? "Interested in this package"
                    : "Improve this package"
                }
              >
                <i
                  style={{
                    left: `${Math.min(100, Math.max(0, preview.interest ?? 0))}%`,
                  }}
                />
              </div>
              <div className="cpu-interest-labels">
                <span>Low interest</span>
                <span>High interest</span>
              </div>
              <p className="fineprint">
                Interest reflects this package; ownership and trade rules are
                checked again when submitted.
              </p>
            </div>
          )}
          {preview && !preview.is_cpu && (
            <p className="fineprint">
              Human-controlled franchise · the other owner decides whether to
              accept.
            </p>
          )}
          {preview?.feedback.length ? (
            <ul className="trade-feedback">
              {preview.feedback.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          ) : null}
          {preview?.problems.map((text) => (
            <p className="callout" key={text}>
              {text}
            </p>
          ))}
          {stale && (
            <p className="callout">
              Ownership or a contract changed. Remove unavailable assets and
              review the current package.
            </p>
          )}
          {(mine.capSpace < 0 || theirs.capSpace < 0) && (
            <p className="callout">
              Both teams must stay within the salary cap.
            </p>
          )}
        </section>
        {reviewKey === draftKey ? (
          <div className="confirm-box" role="region" aria-label="Review trade">
            <strong>Review your offer to {target}</strong>
            <p>You give: {summary(give, gp)}</p>
            <p>You receive: {summary(take, tp)}</p>
            <p>
              A CPU may accept immediately. Human offers wait for the receiving
              owner's response.
            </p>
            <button
              className="primary"
              disabled={!canReview}
              onClick={async () => {
                const args = parent
                  ? {
                      tid: parent.id,
                      give_players: give,
                      take_players: take,
                      give_picks: gp,
                      take_picks: tp,
                    }
                  : queryArgs;
                if (
                  await mutate(parent ? "counter_trade" : "propose_trade", args)
                ) {
                  clear();
                  setTab(preview?.is_cpu ? "completed" : "sent");
                  inboxRef.current?.scrollIntoView?.({
                    behavior: "smooth",
                    block: "start",
                  });
                }
              }}
            >
              Submit trade offer
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => setReviewKey("")}
            >
              Go back
            </button>
          </div>
        ) : (
          <button
            className="primary trade-review-button"
            disabled={!canReview}
            onClick={() => setReviewKey(draftKey)}
          >
            Review trade offer
          </button>
        )}
      </section>
      <section className="panel trade-finder">
        <div className="panel-heading">
          <h2>
            <Search size={19} />
            Find a trade partner
          </h2>
        </div>
        <p className="panel-copy">
          Choose a player to offer, a position to target, or both. Suggestions
          identify roster fits, not guaranteed deals.
        </p>
        <div className="trade-tools">
          <label>
            Player to offer
            <select
              value={offeredId}
              onChange={(e) => {
                setOfferedId(e.target.value);
                setShowPartners(false);
              }}
            >
              <option value="">No specific player</option>
              {roster(team).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.position} · {p.overall}
                </option>
              ))}
            </select>
          </label>
          <label>
            Position to target
            <select
              value={finderPosition}
              onChange={(e) => {
                setFinderPosition(e.target.value);
                setShowPartners(false);
              }}
            >
              <option value="">Any position</option>
              {Object.keys(limits).map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <button
            className="secondary"
            disabled={!offeredId && !finderPosition}
            onClick={() => setShowPartners(true)}
          >
            Find partners
          </button>
        </div>
        <div className="trade-partner-results">
          {partners.map((r) => (
            <article key={r.team.id}>
              <TeamLogo id={r.team.id} />
              <div>
                <strong>
                  {r.team.city} {r.team.name}
                </strong>
                <p>{r.reason}</p>
                {finderPosition && (
                  <small>
                    Candidate: {r.candidate.name} · {r.candidate.overall} OVR
                  </small>
                )}
              </div>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  clear(r.team.id);
                  setGive(offeredId ? [offeredId] : []);
                  setTake(finderPosition ? [r.candidate.id] : []);
                  builder.current?.scrollIntoView?.({ behavior: "smooth" });
                }}
              >
                Build with {r.team.id}
              </button>
            </article>
          ))}
        </div>
      </section>
      <section className="panel trade-inbox" ref={inboxRef}>
        <div className="panel-heading">
          <h2>Trade inbox</h2>
          <span>{data.unread_trade_ids?.length || 0} UNREAD</span>
        </div>
        <nav className="trade-inbox-tabs" aria-label="Trade inbox filters">
          {["incoming", "sent", "completed"].map((t) => (
            <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)}
              {t === "incoming" && !!data.unread_trade_ids?.length && (
                <span className="trade-unread-badge">
                  {data.unread_trade_ids.length}
                </span>
              )}
            </button>
          ))}
        </nav>
        {!inbox.length && <p className="empty">No {tab} offers.</p>}
        {inbox.map((t) => {
          const open = expanded === t.id;
          const thread = data.trades
            .filter((o) => (o.thread_id || o.id) === (t.thread_id || t.id))
            .sort((a, b) => a.created_at.localeCompare(b.created_at));
          return (
            <article className="trade-offer" key={t.id}>
              <div className="trade-offer-heading">
                <TeamLogo id={t.from_team} />
                <strong>
                  {t.from_team} → {t.to_team}
                </strong>
                <span className={`status ${t.status}`}>{t.status}</span>
                {data.unread_trade_ids?.includes(t.id) && (
                  <span className="trade-unread-badge">New</span>
                )}
                <button
                  className="secondary"
                  aria-expanded={open}
                  onClick={() => {
                    setExpanded(open ? null : t.id);
                    if (!open && data.unread_trade_ids?.includes(t.id))
                      void mutate("mark_trade_read", { tid: t.id });
                  }}
                >
                  {open ? "Close offer" : "View offer"}
                </button>
              </div>
              {open && (
                <>
                  <div className="trade-offer-package">
                    {offerAssets(t.from_team, t.give_players, t.give_picks)}
                    {offerAssets(t.to_team, t.take_players, t.take_picks)}
                  </div>
                  <p className="fineprint">
                    {t.reason || "Awaiting the receiving owner's decision."}
                  </p>
                  {t.status === "pending" && (
                    <div className="dialog-actions">
                      {t.to_team === team ? (
                        <>
                          <button
                            className="primary"
                            disabled={busy || league.state !== "completed"}
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
                            className="secondary"
                            disabled={busy}
                            onClick={() => revise(t)}
                          >
                            Build counteroffer
                          </button>
                        </>
                      ) : t.from_team === team ? (
                        <>
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() => revise(t)}
                          >
                            Revise offer
                          </button>
                          <button
                            className="text-button"
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
                        </>
                      ) : null}
                    </div>
                  )}
                  {t.status === "rejected" && t.from_team === team && (
                    <button
                      className="secondary"
                      disabled={busy || league.state !== "completed"}
                      onClick={() => revise(t)}
                    >
                      Improve this offer
                    </button>
                  )}
                  {thread.length > 1 && (
                    <details className="trade-history">
                      <summary>
                        Negotiation history ({thread.length} offers)
                      </summary>
                      <ol>
                        {thread.map((o) => (
                          <li key={o.id}>
                            <strong>
                              {o.from_team} → {o.to_team} · {o.status}
                            </strong>
                            <p>
                              {o.from_team}:{" "}
                              {summary(o.give_players, o.give_picks)}
                            </p>
                            <p>
                              {o.to_team}:{" "}
                              {summary(o.take_players, o.take_picks)}
                            </p>
                            <small>{o.reason || "Awaiting response"}</small>
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                </>
              )}
            </article>
          );
        })}
      </section>
    </div>
  );
}
