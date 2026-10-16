"use client";
import { useState } from "react";
import { Shirt, ChevronUp, Crown, Star } from "lucide-react";
import type { Player } from "@/lib/types";
import {
  developmentTier,
  formations,
  groupsByUnit,
  fallbackOrders,
} from "@/lib/lineup";
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
  const tier = developmentTier(player?.development || "Unrevealed");
  const content = (
    <>
      <div className="card-top">
        <span>{label}</span>
        <strong>
          {player?.overall ?? "—"}
          <small>OVR</small>
        </strong>
      </div>
      <div className="card-athlete" aria-hidden="true">
        <Shirt strokeWidth={0.8} />
        <b>{player?.jersey ?? "—"}</b>
      </div>
      <div className="card-name">{player?.name || "Open position"}</div>
      <div className="card-trait">
        {tier.key === "franchise" ? (
          <Crown />
        ) : tier.key === "normal" ? (
          <span>●</span>
        ) : (
          <Star />
        )}
        <span>{player ? tier.label : "Draft or sign a player"}</span>
      </div>
    </>
  );
  return onClick ? (
    <button
      type="button"
      aria-label={`${label}: ${player?.name || "Open position"}, ${player?.overall ?? "unrated"} overall. Edit depth chart`}
      aria-pressed={!!selected}
      disabled={disabled}
      onClick={onClick}
      className={`player-card dev-${tier.key} ${selected ? "selected" : ""}`}
    >
      {content}
    </button>
  ) : (
    <article className={`player-card dev-${tier.key}`}>{content}</article>
  );
}
export function Lineup(props: ManagementProps) {
  const { league, data, players, team, busy, mutate } = props;
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
  const ids = edit?.ids || orders[group] || [];
  const version = data.depth?.version || 0;
  const stale = !!edit && edit.version !== version;
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
    <section className="panel lineup-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">PERSONNEL / {team}</span>
          <h2>Your starting eleven.</h2>
        </div>
        <span>SAVED LINEUP</span>
      </div>
      <div className="lineup-tabs" role="group" aria-label="Lineup unit">
        {Object.keys(formations).map((u) => (
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
      <div className="lineup-context">
        <span>
          {unit === "Offense"
            ? "11 PERSONNEL · 3 WR / 1 TE / 1 HB"
            : unit === "Defense"
              ? "BASE 4–3 · 11 DEFENDERS"
              : "SPECIALISTS & RETURNERS"}
        </span>
        <small>Tap a card to manage its depth order</small>
      </div>
      <div className="lineup-field" aria-label={`${unit} starting lineup`}>
        {formations[unit].map((row, i) => (
          <div className={`formation-row row-${i}`} key={i}>
            {row.map((slot) => {
              const p = byId.get(orders[slot.group]?.[slot.rank]);
              return (
                <PlayerCard
                  key={slot.label}
                  label={slot.label}
                  player={p}
                  selected={group === slot.group}
                  disabled={busy || !!edit}
                  onClick={() => choose(slot.group)}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="depth-editor">
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
          <div>
            <strong>{group} depth order</strong>
            <small>
              {["KR", "PR"].includes(group)
                ? "Returners can also start on offense or defense."
                : "Top-ranked eligible players start. Remaining players are backups."}
            </small>
          </div>
        </div>
        <div className="mobile-starter">
          <PlayerCard player={byId.get(ids[0])} label={`${group}1 · STARTER`} />
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
                <b>
                  {p.overall}
                  <small>OVR</small>
                </b>
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
                    <ChevronUp size={16} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {!ids.length && (
          <p className="empty">
            No eligible players yet. Draft or sign players for this position.
          </p>
        )}
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
        {byId.get(ids[0]) && (
          <details className="lineup-attributes">
            <summary>View {byId.get(ids[0])!.name} attributes</summary>
            <p className="fineprint">
              {byId.get(ids[0])!.attributes_source
                ? "Skills from your uploaded worksheet."
                : "Skills are original estimates; no matched worksheet row."}
            </p>
            <div className="attribute-grid">
              {Object.entries(byId.get(ids[0])!.attributes).map(
                ([key, value]) => (
                  <div key={key}>
                    <span>{key.replaceAll("_", " ")}</span>
                    <strong>{value}</strong>
                    <progress max={99} value={value} />
                  </div>
                ),
              )}
            </div>
          </details>
        )}
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
      </div>
      <p className="fineprint">
        Card color = development trait · OVR = current ability. Development
        traits are game-assigned estimates. Saved lineups are ready for the
        upcoming simulation engine.
      </p>
    </section>
  );
}
