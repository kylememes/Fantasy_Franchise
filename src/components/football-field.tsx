"use client";
import { useEffect, useRef, useState } from "react";
import type { Franchise } from "@/lib/types";
import type {
  Play,
  GameResult,
} from "../../supabase/functions/_shared/simulation";
import {
  ballSpot,
  cameraBounds,
  carrierAt,
  playerSpot,
} from "@/lib/field-playback";

export function FootballField({
  play,
  players,
  home,
  away,
  playing,
  speed,
  onEnd,
  replayKey = 0,
  onMoment,
}: {
  play?: Play;
  players: GameResult["players"];
  home: Franchise;
  away: Franchise;
  playing: boolean;
  speed: number;
  onEnd?: () => void;
  replayKey?: number;
  onMoment?: (moment: {
    index: number;
    clock: number;
    resolved: boolean;
  }) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    progress = useRef(0),
    ended = useRef(false),
    onEndRef = useRef(onEnd);
  const [full, setFull] = useState(false),
    [names, setNames] = useState(true),
    [fatigue, setFatigue] = useState(false),
    [routes, setRoutes] = useState(true),
    [selected, setSelected] = useState("");
  const [phase, setPhase] = useState("Pre-snap");
  const [readout, setReadout] = useState({
    clock: play?.clock || 0,
    playClock: 40,
  });
  const hitTargets = useRef<{ id: string; x: number; y: number }[]>([]);
  onEndRef.current = onEnd;
  const momentRef = useRef(onMoment);
  momentRef.current = onMoment;
  useEffect(() => {
    progress.current = 0;
    ended.current = false;
    setPhase("Pre-snap");
    setSelected("");
  }, [play?.index, play?.offense, replayKey]);
  useEffect(() => {
    if (playing && ended.current) {
      progress.current = 0;
      ended.current = false;
      setPhase("Pre-snap");
    }
  }, [playing]);
  useEffect(() => {
    let frame = 0,
      last = 0,
      paint = 0;
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let reduced = media?.matches || false;
    const motion = (event: MediaQueryListEvent) => {
      reduced = event.matches;
    };
    media?.addEventListener?.("change", motion);
    const draw = (now: number) => {
      if (last && playing)
        progress.current = Math.min(
          1,
          progress.current + (Math.min(100, now - last) * speed) / 4000,
        );
      last = now;
      const el = canvas.current,
        ctx = el?.getContext("2d");
      if (el && ctx && now - paint >= 32) {
        paint = now;
        const t = reduced ? 1 : progress.current;
        const currentPhase =
          t < 0.12
            ? "Pre-snap"
            : t < 0.2
              ? "Snap"
              : t < 0.48
                ? "Developing"
                : t < 0.68 && play?.kind === "pass"
                  ? "Ball in flight"
                  : t < 0.86
                    ? "Live play"
                    : "Result";
        if (play)
          momentRef.current?.({
            index: play.index,
            clock: Math.round(
              play.clock +
                (play.endClock - play.clock) * Math.max(0, (t - 0.12) / 0.88),
            ),
            resolved: t >= 0.86,
          });
        setPhase((previous) =>
          previous === currentPhase ? previous : currentPhase,
        );
        const clock = play
          ? Math.round(
              play.clock +
                (play.endClock - play.clock) * Math.max(0, (t - 0.12) / 0.88),
            )
          : 0;
        const playClock =
          t < 0.12
            ? Math.max(1, (play?.playClock || 40) - Math.floor(t * 25))
            : 0;
        setReadout((previous) =>
          previous.clock === clock && previous.playClock === playClock
            ? previous
            : { clock, playClock },
        );
        const W = 700,
          H = 1000,
          left = 30,
          top = 28,
          width = 640,
          height = 944;
        const [lo, hi] = cameraBounds(play, t, full);
        const x = (across: number) => left + (across / 53.3) * width;
        const y = (yard: number) => top + ((hi - yard) / (hi - lo)) * height;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = "#080e20";
        ctx.fillRect(0, 0, W, H);
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        ctx.fillStyle = "#184637";
        ctx.fillRect(left, top, width, height);
        for (let yard = -10; yard < 110; yard += 5) {
          ctx.fillStyle = yard % 10 === 0 ? "#ffffff05" : "#00000016";
          ctx.fillRect(left, y(yard + 5), width, y(yard) - y(yard + 5));
        }
        for (const [yard, team] of [
          [-10, home],
          [100, away],
        ] as const) {
          ctx.fillStyle = team.color;
          ctx.globalAlpha = 0.65;
          ctx.fillRect(left, y(yard + 10), width, y(yard) - y(yard + 10));
          ctx.globalAlpha = 1;
          ctx.font = "bold 35px Arial";
          ctx.textAlign = "center";
          ctx.fillStyle = "#ffffffbb";
          ctx.fillText(team.id, x(26.65), y(yard + 5) + 12);
        }
        for (let yard = 0; yard <= 100; yard += 5) {
          ctx.strokeStyle = yard % 10 === 0 ? "#ffffff88" : "#ffffff33";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(left, y(yard));
          ctx.lineTo(left + width, y(yard));
          ctx.stroke();
          if (yard > 0 && yard < 100 && yard % 10 === 0) {
            ctx.font = "bold 24px Arial";
            ctx.textAlign = "center";
            ctx.fillStyle = "#ffffff88";
            ctx.fillText(String(Math.min(yard, 100 - yard)), x(3), y(yard) - 8);
            ctx.fillText(
              String(Math.min(yard, 100 - yard)),
              x(50),
              y(yard) - 8,
            );
          }
        }
        for (let yard = 1; yard < 100; yard++)
          for (const hash of [23.6, 29.7]) {
            ctx.strokeStyle = "#ffffff66";
            ctx.beginPath();
            ctx.moveTo(x(hash) - 4, y(yard));
            ctx.lineTo(x(hash) + 4, y(yard));
            ctx.stroke();
          }
        hitTargets.current = [];
        if (play) {
          for (const [yard, color] of [
            [play.spot, "#00e5ff"],
            [play.firstDown, "#f3cd67"],
          ] as const) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(left, y(yard));
            ctx.lineTo(left + width, y(yard));
            ctx.stroke();
          }
          if (routes && t < 0.12) {
            ctx.strokeStyle = "#8cecf5aa";
            ctx.lineWidth = 2;
            ctx.setLineDash([7, 6]);
            for (const a of play.agents.filter(
              (a) => a.team === play.offense && /^(WR|SLOT|TE)/.test(a.role),
            )) {
              ctx.beginPath();
              a.path.forEach((p, i) =>
                i ? ctx.lineTo(x(p[1]), y(p[0])) : ctx.moveTo(x(p[1]), y(p[0])),
              );
              ctx.stroke();
            }
            ctx.setLineDash([]);
          }
          const owner = carrierAt(play, t);
          for (const a of play.agents) {
            const player = players[a.id];
            if (!player) continue;
            const p = playerSpot(a, t),
              cx = x(p[1]),
              cy = y(p[0]);
            if (cy < top - 30 || cy > top + height + 30) continue;
            const team = a.team === home.id ? home : away;
            if (a.id === owner) {
              ctx.strokeStyle = "#ffdd72";
              ctx.lineWidth = 4;
              ctx.beginPath();
              ctx.arc(cx, cy, 23, 0, Math.PI * 2);
              ctx.stroke();
            }
            ctx.beginPath();
            ctx.arc(cx, cy, 17, 0, Math.PI * 2);
            ctx.fillStyle = team.color;
            ctx.fill();
            ctx.lineWidth = a.id === selected ? 4 : 2;
            ctx.strokeStyle = a.id === selected ? "#00e5ff" : "#f4f8ff";
            ctx.stroke();
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 17px Arial";
            ctx.textAlign = "center";
            ctx.lineWidth = 3;
            ctx.strokeStyle = "#000a";
            ctx.strokeText(String(player.jersey), cx, cy + 6);
            ctx.fillText(String(player.jersey), cx, cy + 6);
            if (names) {
              const label = player.name.split(" ").slice(-1)[0];
              const line = /^(LT|LG|C|RG|RT)$/.test(a.role);
              const offset = line
                ? a.role === "LG" || a.role === "RG"
                  ? -29
                  : 34
                : a.team === play.offense
                  ? 35
                  : -27;
              ctx.font = "bold 15px Arial";
              ctx.lineWidth = 4;
              ctx.strokeStyle = "#08121a";
              ctx.strokeText(label, cx, cy + offset);
              ctx.fillText(label, cx, cy + offset);
            }
            if (fatigue && a.fatigue !== undefined) {
              ctx.fillStyle = "#071018";
              ctx.fillRect(cx - 18, cy + 20, 36, 4);
              ctx.fillStyle =
                a.fatigue > 65
                  ? "#ff7a91"
                  : a.fatigue > 35
                    ? "#f3cd67"
                    : "#68e2a4";
              ctx.fillRect(cx - 18, cy + 20, 36 * (1 - a.fatigue / 100), 4);
            }
            hitTargets.current.push({ id: a.id, x: cx, y: cy });
          }
          const b = ballSpot(play, t),
            bx = x(b[1]),
            by = y(b[0]);
          const flight =
            (play.kind === "pass" ||
              ["punt", "field_goal", "extra_point"].includes(play.kind)) &&
            t > 0.48 &&
            t < 0.68;
          const air = flight ? Math.sin(((t - 0.48) / 0.2) * Math.PI) * 18 : 0;
          ctx.beginPath();
          ctx.ellipse(bx, by + 4, 8, 4, 0, 0, Math.PI * 2);
          ctx.fillStyle = "#0008";
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(bx, by - air, 9, 5, -0.6, 0, Math.PI * 2);
          ctx.fillStyle = "#b57a45";
          ctx.fill();
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(bx - 3, by - air);
          ctx.lineTo(bx + 3, by - air);
          ctx.stroke();
          if (t >= 0.86) {
            ctx.strokeStyle = play.scoring
              ? "#f3cd67"
              : play.turnover
                ? "#ff7a91"
                : "#ffffff99";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(bx, by, 28 + (t - 0.86) * 60, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        ctx.restore();
        ctx.strokeStyle = "#c9d1db88";
        ctx.lineWidth = 2;
        ctx.strokeRect(left, top, width, height);
      }
      if (progress.current >= 1 && !ended.current && playing) {
        ended.current = true;
        onEndRef.current?.();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      media?.removeEventListener?.("change", motion);
    };
  }, [
    play,
    players,
    home,
    away,
    playing,
    speed,
    full,
    names,
    fatigue,
    routes,
    selected,
    replayKey,
  ]);
  const result = phase === "Result";
  const clock = readout.clock;
  return (
    <div className="football-view vertical-football">
      <div className="field-view-tools">
        <button
          className="secondary"
          aria-pressed={!full}
          onClick={() => setFull((v) => !v)}
        >
          {full ? "Follow play" : "Full field"}
        </button>
        <button
          className="secondary"
          aria-pressed={names}
          onClick={() => setNames((v) => !v)}
        >
          Names
        </button>
        <button
          className="secondary"
          aria-pressed={routes}
          onClick={() => setRoutes((v) => !v)}
        >
          Routes
        </button>
        <button
          className="secondary"
          aria-pressed={fatigue}
          onClick={() => setFatigue((v) => !v)}
        >
          Energy
        </button>
      </div>
      <div className="field-live-strip" aria-label="On-field game situation">
        <strong>
          {play?.offense} · {play?.down} & {play?.distance}
        </strong>
        <span>
          {play?.quarter === 5 ? "OT" : `Q${play?.quarter || 1}`}{" "}
          {Math.floor(clock / 60)}:{String(clock % 60).padStart(2, "0")}
        </span>
        <span>
          {phase === "Pre-snap" ? `Play clock ${readout.playClock}` : phase}
        </span>
      </div>
      <div className="field-formation">
        <strong>{play?.formation || play?.call || "Saved formation"}</strong>
        <span>
          {play?.personnel || "11 on offense · 11 on defense"} ·{" "}
          {play?.coverage}
        </span>
      </div>
      <div className="football-stage">
        <canvas
          ref={canvas}
          width={700}
          height={1000}
          role="img"
          aria-label={`Vertical top-down football field. ${play?.description || "Waiting for a play."}`}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect(),
              x = ((e.clientX - rect.left) * 700) / rect.width,
              y = ((e.clientY - rect.top) * 1000) / rect.height;
            setSelected(
              hitTargets.current.find((p) => Math.hypot(p.x - x, p.y - y) < 25)
                ?.id || "",
            );
          }}
        />
      </div>
      <div
        className={`field-result ${result ? "is-visible" : ""} ${play?.turnover ? "turnover" : ""}`}
        aria-live="polite"
      >
        {result ? (
          <>
            <strong>
              {play?.scoring
                ? "SCORE"
                : play?.turnover
                  ? "TURNOVER"
                  : play?.kind === "sack"
                    ? "SACK"
                    : "PLAY COMPLETE"}
            </strong>
            <span>{play?.description}</span>
          </>
        ) : (
          <>
            <strong>{phase}</strong>
            <span>
              {play?.call} · {play?.coverage}
            </span>
          </>
        )}
      </div>
      <label className="field-player-picker">
        Inspect a player
        <select
          aria-label="Inspect a player on the field"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Select player</option>
          {play?.agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.team} · #{players[a.id]?.jersey} {players[a.id]?.name} ·{" "}
              {a.role}
            </option>
          ))}
        </select>
      </label>
      {selected && players[selected] && (
        <p className="field-selected-player">
          #{players[selected].jersey} {players[selected].name} ·{" "}
          {players[selected].position} · {players[selected].overall} OVR
          {play?.agents.find((a) => a.id === selected)?.fatigue !== undefined
            ? ` · Energy ${100 - (play.agents.find((a) => a.id === selected)?.fatigue || 0)}%`
            : ""}
        </p>
      )}
      <p className="fineprint">
        Cyan: scrimmage · Gold: first down · Gold halo: ball carrier.{" "}
        {fatigue ? "Energy bars show remaining stamina. " : ""}Reduced motion
        shows the resolved play.
      </p>
    </div>
  );
}
