"use client";
import { useState, useRef, useEffect } from "react";
import { ChevronUp, Crown, Star, RotateCcw } from "lucide-react";
import type { Player } from "@/lib/types";
import {
  developmentTier,
  fieldSlots,
  groupsByUnit,
  fallbackOrders,
} from "@/lib/lineup";
import { TeamLogo } from "./identity";
import type { ManagementProps } from "./management";

export function PlayerCard({
  player,
  label,
  selected,
  onClick,
  disabled,
}: {
  player?: Player;
  label: string;
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const [flipped, setFlipped] = useState(false),
    [backTab, setBackTab] = useState<"ratings" | "statistics">("ratings");
  const frontRef = useRef<HTMLButtonElement>(null),
    backRef = useRef<HTMLButtonElement>(null),
    interacted = useRef(false);
  useEffect(() => {
    if (interacted.current) (flipped ? backRef : frontRef).current?.focus();
  }, [flipped]);
  const tier = developmentTier(player?.development || "Unrevealed");
  const name = player?.name || "Open position";
  const values =
    backTab === "ratings"
      ? Object.entries(player?.attributes || {})
      : Object.entries(player?.stats || {});
  return (
    <div
      className={`player-card flip-card dev-${tier.key} ${selected ? "selected" : ""} ${flipped ? "is-flipped" : ""}`}
    >
      <div className="card-inner">
        <button
          ref={frontRef}
          className="card-face card-front"
          type="button"
          aria-label={`${label}: ${name}, ${player?.overall ?? "unrated"} overall. Flip for ratings and statistics`}
          aria-expanded={flipped}
          disabled={disabled || !player}
          tabIndex={flipped ? -1 : 0}
          aria-hidden={flipped}
          onClick={() => {
            onClick?.();
            interacted.current = true;
            setFlipped(true);
          }}
        >
          <span className="card-top">
            <span>{label}</span>
            <strong>
              {player?.overall ?? "—"}
              <small>OVR</small>
            </strong>
          </span>
          <span className="portrait-art" aria-hidden="true">
            <svg
              className="player-silhouette"
              viewBox="0 0 360 333"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M180 12c-43 0-71 32-71 76v21c0 14 6 26 15 36v21l-25 15-40 13c-27 9-42 30-48 58L0 333h360l-11-81c-6-28-21-49-48-58l-40-13-25-15v-21c9-10 15-22 15-36V88c0-44-28-76-71-76Z" />
            </svg>
            <b className="portrait-jersey">#{player?.jersey ?? "—"}</b>
          </span>
          <span className="card-name">{name}</span>
          <span className="card-trait">
            {tier.key === "franchise" ? (
              <Crown />
            ) : tier.key === "normal" ? (
              <span>●</span>
            ) : (
              <Star />
            )}
            <span>{player ? tier.label : "Draft or sign a player"}</span>
          </span>
        </button>
        <div className="card-face card-back" aria-hidden={!flipped}>
          <div className="card-back-heading">
            <strong>{name}</strong>
            <span>
              {label} · {player?.overall} OVR
            </span>
          </div>
          <div
            className="card-back-tabs"
            role="group"
            aria-label={`${name} card details`}
          >
            <button
              ref={backRef}
              tabIndex={flipped ? 0 : -1}
              aria-pressed={backTab === "ratings"}
              onClick={() => setBackTab("ratings")}
            >
              Ratings
            </button>
            <button
              tabIndex={flipped ? 0 : -1}
              aria-pressed={backTab === "statistics"}
              onClick={() => setBackTab("statistics")}
            >
              Stats
            </button>
          </div>
          <div
            className="card-back-scroll"
            tabIndex={flipped ? 0 : -1}
            role="region"
            aria-label={`${name} ${backTab}`}
          >
            <small>
              {backTab === "ratings"
                ? player?.attributes_source
                  ? "Worksheet attributes"
                  : "Estimated attributes"
                : "NFL roster snapshot"}
            </small>
            {values.length ? (
              <dl>
                {values.map(([key, value]) => (
                  <div key={key}>
                    <dt>{key.replaceAll("_", " ")}</dt>
                    <dd>{value.toLocaleString()}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p>No statistics recorded.</p>
            )}
          </div>
          <button
            className="card-return"
            tabIndex={flipped ? 0 : -1}
            onClick={() => {
              interacted.current = true;
              setFlipped(false);
            }}
            aria-label={`Show front of ${name}`}
          >
            <RotateCcw size={11} /> Flip back
          </button>
        </div>
      </div>
    </div>
  );
}

export function Lineup({
  league,
  data,
  players,
  team,
  busy,
  mutate,
}: ManagementProps) {
  const [unit, setUnit] = useState("Offense"),
    [group, setGroup] = useState("QB");
  const [edit, setEdit] = useState<{ ids: string[]; version: number } | null>(
      null,
    ),
    [message, setMessage] = useState("");
  const mine = new Set(
    data.ownership
      .filter((o) => o.franchise_id === team)
      .map((o) => o.player_id),
  );
  const byId = new Map(
    players.filter((p) => mine.has(p.id)).map((p) => [p.id, p]),
  );
  const orders = data.depth?.orders || fallbackOrders([...byId.values()]);
  const version = data.depth?.version || 0,
    stale = !!edit && edit.version !== version;
  const ids = edit?.ids || orders[group] || [];
  const displayOrders =
    edit && !stale ? { ...orders, [group]: edit.ids } : orders;
  const choose = (next: string) => {
    if (edit) return;
    setGroup(next);
    setMessage("");
  };
  const swap = (id: string, rank: number) => {
    const next = [...ids],
      index = next.indexOf(id);
    if (index < 0 || index === rank) return;
    [next[rank], next[index]] = [next[index], next[rank]];
    setEdit({ ids: next, version: edit?.version ?? version });
    setMessage("");
  };
  return (
    <section className="panel lineup-panel formation-lineup">
      <div className="panel-heading lineup-heading">
        <div>
          <span className="eyebrow">
            <TeamLogo id={team} /> FANTASY FRANCHISE / PERSONNEL
          </span>
          <h2>
            Depth chart<span>BUILD YOUR STARTING ELEVEN</span>
          </h2>
        </div>
        <span
          className={edit ? "lineup-save-state pending" : "lineup-save-state"}
        >
          {edit ? "UNSAVED PREVIEW" : "SAVED LINEUP"}
        </span>
      </div>
      <div className="lineup-tabs" role="group" aria-label="Lineup unit">
        {Object.keys(fieldSlots).map((u) => (
          <button
            key={u}
            aria-pressed={unit === u}
            className={unit === u ? "active" : ""}
            disabled={busy || !!edit}
            onClick={() => {
              setUnit(u);
              setGroup(groupsByUnit[u][0]);
              setMessage("");
            }}
          >
            {u}
          </button>
        ))}
      </div>
      <div className="lineup-workspace">
        <div className="formation-main">
          <div className="lineup-context">
            <span>
              {unit === "Offense"
                ? "11 PERSONNEL · 3 WR / 1 TE / 1 HB"
                : unit === "Defense"
                  ? "BASE 4–3 · 11 DEFENDERS"
                  : "SPECIALISTS & RETURNERS"}
            </span>
            <small>Tap a card to flip</small>
          </div>
          <div
            className="formation-scroll"
            role="region"
            aria-label={`${unit} field formation`}
            tabIndex={0}
          >
            <div
              className={`lineup-field formation-canvas unit-${unit.replaceAll(" ", "-").toLowerCase()}`}
              aria-label={`${unit} starting lineup`}
            >
              <div className="field-brand" aria-hidden="true">
                FF
              </div>
              {[20, 30, 40, 50, 40, 30, 20].map((yard, i) => (
                <span
                  key={i}
                  className="field-yard"
                  aria-hidden="true"
                  style={{ top: `${10 + i * 13}%` }}
                >
                  {yard}
                  <i>{yard}</i>
                </span>
              ))}
              {fieldSlots[unit].map((slot) => {
                const p = byId.get(displayOrders[slot.group]?.[slot.rank]);
                return (
                  <div
                    key={slot.label}
                    className="formation-slot"
                    data-slot={slot.label}
                    style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
                  >
                    <PlayerCard
                      key={`${slot.label}:${p?.id || "empty"}`}
                      player={p}
                      label={slot.label}
                      selected={group === slot.group}
                      onClick={() => choose(slot.group)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
          <p className="formation-mobile-hint">
            Swipe across the field to view the full formation. Tap any player to
            flip their card.
          </p>
          <div className="formation-bench">
            <div className="bench-heading">
              <strong>{group} DEPTH</strong>
              <span>
                {edit
                  ? "Preview · save changes to commit"
                  : "Current depth order"}
              </span>
            </div>
            <div className="bench-cards">
              {(displayOrders[group] || []).map((id, i) => (
                <div key={id} className="bench-card">
                  <PlayerCard
                    player={byId.get(id)}
                    label={`${group}${i + 1}`}
                  />
                  <span>{i === 0 ? "FIRST CHOICE" : `DEPTH ${i + 1}`}</span>
                </div>
              ))}
              {!ids.length && <p className="empty">No eligible players yet.</p>}
            </div>
          </div>
        </div>
        <aside className="depth-editor" aria-label="Depth order editor">
          <span className="eyebrow">PERSONNEL CONTROL</span>
          <h3>Set your lineup</h3>
          <p className="depth-editor-copy">
            Choose a position and reorder players. Your changes appear on the
            field immediately.
          </p>
          <div className="depth-toolbar">
            <label>
              Position group
              <select
                aria-label="Position group"
                value={group}
                disabled={busy || !!edit}
                onChange={(e) => choose(e.target.value)}
              >
                {groupsByUnit[unit].map((g) => (
                  <option key={g} value={g}>
                    {g === "EDGE" ? "EDGE / DE" : g}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="depth-order-heading">
            <strong>{group} depth order</strong>
            <span>OVR</span>
          </div>
          <div className="depth-players">
            {ids.map((id, i) => {
              const p = byId.get(id);
              if (!p) return null;
              const tier = developmentTier(p.development);
              return (
                <div className={`depth-player dev-${tier.key}`} key={id}>
                  <span className="depth-rank">{i + 1}</span>
                  <div>
                    <strong>{p.name}</strong>
                    <small>
                      {p.position} · #{p.jersey} · {tier.label}
                    </small>
                  </div>
                  <b>{p.overall}</b>
                  <label>
                    <span className="sr-only">Depth rank for {p.name}</span>
                    <select
                      value={i}
                      disabled={busy || stale}
                      onChange={(e) => swap(id, Number(e.target.value))}
                    >
                      {ids.map((_, n) => (
                        <option key={n} value={n}>
                          {n + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                  {i > 0 && (
                    <button
                      title={`Promote ${p.name} to first`}
                      aria-label={`Promote ${p.name} to first`}
                      disabled={busy || stale}
                      onClick={() => swap(id, 0)}
                    >
                      <ChevronUp size={15} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {!ids.length && (
            <p className="empty">
              Draft or sign eligible players for this position.
            </p>
          )}
          <p className="fineprint">
            {["KR", "PR"].includes(group)
              ? "Returners can also start in another unit."
              : "Top-ranked eligible players fill the starting slots. The rest are backups."}
          </p>
          {stale && (
            <p className="callout" role="alert">
              Your roster or lineup changed in another session. Reload saved
              lineup before editing.
            </p>
          )}
          {edit && (
            <div className="dialog-actions">
              <button
                className="primary"
                disabled={busy || stale}
                onClick={async () => {
                  if (
                    await mutate("save_depth_order", {
                      lid: league.id,
                      position_key: group,
                      ordered_players: edit.ids,
                      expected_version: edit.version,
                    })
                  ) {
                    setEdit(null);
                    setMessage("Depth chart saved.");
                  }
                }}
              >
                Save {group} depth chart
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setEdit(null);
                  setMessage("Loaded saved lineup.");
                }}
              >
                Reload saved lineup
              </button>
            </div>
          )}
          <p role="status">{message}</p>
        </aside>
      </div>
      <div className="development-legend">
        {["Franchise Superstar", "Superstar", "Star", "Normal"].map((t) => {
          const tier = developmentTier(t);
          return (
            <span key={t} className={`dev-${tier.key}`}>
              <i />
              {t}
            </span>
          );
        })}
        <small>Color = development · OVR = current ability</small>
      </div>
      <p className="fineprint">
        Decorative player silhouettes, not individual player photographs.
        Development traits are game-assigned. Card backs show available ratings
        and NFL roster snapshot statistics; simulated season stats come with the
        game engine.
      </p>
    </section>
  );
}
