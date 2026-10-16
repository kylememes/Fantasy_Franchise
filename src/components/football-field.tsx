"use client";
import { useEffect, useRef, useState } from "react";
import type { Franchise } from "@/lib/types";
import type {
  Play,
  GameResult,
  Spot,
} from "../../supabase/functions/_shared/simulation";
function point(path: Spot[], t: number): Spot {
  const n = (path.length - 1) * Math.min(1, Math.max(0, t)),
    i = Math.min(path.length - 2, Math.floor(n)),
    f = n - i;
  return [
    path[i][0] + (path[i + 1][0] - path[i][0]) * f,
    path[i][1] + (path[i + 1][1] - path[i][1]) * f,
  ];
}
export function FootballField({
  play,
  players,
  home,
  away,
  playing,
  speed,
  onEnd,
}: {
  play?: Play;
  players: GameResult["players"];
  home: Franchise;
  away: Franchise;
  playing: boolean;
  speed: number;
  onEnd?: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null),
    progress = useRef(0),
    last = useRef(0),
    ended = useRef(false),
    onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const [zoom, setZoom] = useState(false),
    [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    progress.current = 0;
    ended.current = false;
  }, [play?.index]);
  useEffect(() => {
    const el = stage.current;
    if (!el || !play || el.scrollWidth <= el.clientWidth) return;
    const lo = zoom ? Math.max(0, Math.min(60, play.spot - 20)) : 0;
    const relative = (play.spot + 10 - lo) / (zoom ? 60 : 120);
    el.scrollLeft = Math.max(0, relative * el.scrollWidth - el.clientWidth / 2);
  }, [play?.index, zoom]);
  useEffect(() => {
    let frame = 0,
      paint = 0;
    last.current = 0;
    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const draw = (now: number) => {
      const el = canvas.current,
        ctx = el?.getContext("2d");
      if (!el || !ctx) return;
      if (last.current && playing)
        progress.current = Math.min(
          1,
          progress.current + ((now - last.current) * speed) / 4000,
        );
      last.current = now;
      if (now - paint > 32) {
        paint = now;
        const W = 1200,
          H = 650;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = "#080e20";
        ctx.fillRect(0, 0, W, H);
        const left = 45,
          top = 44,
          width = 1110,
          height = 550;
        const lo = zoom && play ? Math.max(0, Math.min(60, play.spot - 20)) : 0,
          hi = zoom ? lo + 60 : 120;
        const x = (yards: number) =>
            left + ((yards + 10 - lo) / (hi - lo)) * width,
          y = (yards: number) => top + (yards / 53.3) * height;
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        ctx.fillStyle = "#132e2e";
        ctx.fillRect(left, top, width, height);
        for (let yard = -10; yard < 110; yard += 5) {
          ctx.fillStyle = (yard / 5) % 2 ? "#ffffff04" : "#00000012";
          ctx.fillRect(x(yard), top, x(yard + 5) - x(yard), height);
        }
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = home.color;
        ctx.fillRect(x(-10), top, x(0) - x(-10), height);
        ctx.fillStyle = away.color;
        ctx.fillRect(x(100), top, x(110) - x(100), height);
        ctx.globalAlpha = 1;
        for (let yard = 0; yard <= 100; yard += 5) {
          ctx.strokeStyle = yard % 10 === 0 ? "#c9d1db88" : "#c9d1db38";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x(yard), top);
          ctx.lineTo(x(yard), top + height);
          ctx.stroke();
          if (yard % 10 === 0 && yard > 0 && yard < 100) {
            ctx.fillStyle = "#c9d1db99";
            ctx.font = "italic 20px Arial";
            ctx.textAlign = "center";
            ctx.fillText(String(Math.min(yard, 100 - yard)), x(yard), y(5));
            ctx.fillText(String(Math.min(yard, 100 - yard)), x(yard), y(50));
          }
        }
        for (let yard = 1; yard < 100; yard++) {
          for (const line of [23.6, 29.7]) {
            ctx.strokeStyle = "#c9d1db66";
            ctx.beginPath();
            ctx.moveTo(x(yard), y(line));
            ctx.lineTo(x(yard), y(line) + 5);
            ctx.stroke();
          }
        }
        const t = reduced ? 1 : progress.current;
        if (play) {
          for (const [yard, color] of [
            [play.spot, "#00e5ff"],
            [play.firstDown, "#f3cd67"],
          ] as const) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x(yard), top);
            ctx.lineTo(x(yard), top + height);
            ctx.stroke();
          }
          if (t < 0.15) {
            ctx.setLineDash([6, 5]);
            ctx.strokeStyle = "#00e5ff55";
            for (const a of play.agents.filter(
              (a) => a.team === play.offense && /WR|SLOT|TE/.test(a.role),
            )) {
              ctx.beginPath();
              a.path.forEach((p, i) =>
                i ? ctx.lineTo(x(p[0]), y(p[1])) : ctx.moveTo(x(p[0]), y(p[1])),
              );
              ctx.stroke();
            }
            ctx.setLineDash([]);
          }
          const located = play.agents.map((a) => ({ a, p: point(a.path, t) }));
          for (const { a, p } of located) {
            const player = players[a.id];
            if (!player) continue;
            const cx = x(p[0]),
              cy = y(p[1]),
              team = a.team === home.id ? home : away;
            const rating =
              player.overall >= 90
                ? "#f3cd67"
                : player.overall >= 80
                  ? "#00e5ff"
                  : player.overall >= 70
                    ? "#c9d1db"
                    : "#78859e";
            ctx.beginPath();
            ctx.arc(cx, cy, 11, 0, Math.PI * 2);
            ctx.fillStyle = team.color;
            ctx.fill();
            ctx.lineWidth = a.id === selected ? 4 : 2;
            ctx.strokeStyle = a.id === selected ? "#f4f8ff" : rating;
            ctx.stroke();
            ctx.font = "bold 10px Arial";
            ctx.textAlign = "center";
            ctx.fillStyle = "#f4f8ff";
            ctx.shadowColor = "#000";
            ctx.shadowBlur = 3;
            ctx.fillText(String(player.jersey), cx, cy + 3.5);
            ctx.shadowBlur = 0;
            const name = player.name.split(" ").slice(-1).join(" ");
            ctx.font = "10px Arial";
            const offset =
              /LT|LG|C|RG|RT/.test(a.role) && a.team === play.offense
                ? -17
                : 20;
            ctx.lineWidth = 3;
            ctx.strokeStyle = "#080e20";
            ctx.strokeText(name, cx, cy + offset);
            ctx.fillStyle = "#f4f8ff";
            ctx.fillText(name, cx, cy + offset);
          }
          const bt =
            t < 0.26
              ? point(play.ball.slice(0, 2), t / 0.26)
              : t < 0.68
                ? point(play.ball.slice(1, 3), (t - 0.26) / 0.42)
                : point(play.ball.slice(2), Math.min(1, (t - 0.68) / 0.32));
          const air =
            (play.kind === "pass" ||
              ["punt", "field_goal", "extra_point"].includes(play.kind)) &&
            t > 0.26 &&
            t < 0.68
              ? Math.sin(((t - 0.26) / 0.42) * Math.PI) * 14
              : 0;
          ctx.fillStyle = "#0007";
          ctx.beginPath();
          ctx.ellipse(x(bt[0]), y(bt[1]) + 4, 5, 2, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#b97d42";
          ctx.strokeStyle = "#fff3";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.ellipse(x(bt[0]), y(bt[1]) - air, 6, 3, -0.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          if (
            t > 0.88 &&
            (play.turnover ||
              play.scoring ||
              ["run", "sack"].includes(play.kind))
          ) {
            const end = play.ball.at(-1)!;
            ctx.strokeStyle = play.scoring
              ? "#f3cd67"
              : play.turnover
                ? "#ff7a91"
                : "#f4f8ff";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x(end[0]), y(end[1]), 17 + (t - 0.88) * 35, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        ctx.restore();
        ctx.strokeStyle = "#c9d1db88";
        ctx.lineWidth = 2;
        ctx.strokeRect(left, top, width, height);
        ctx.fillStyle = "#c9d1db";
        ctx.font = "bold 12px Arial";
        ctx.textAlign = "left";
        ctx.fillText(`${home.id} END ZONE`, left, 25);
        ctx.textAlign = "right";
        ctx.fillText(`${away.id} END ZONE`, W - left, 25);
      }
      if (progress.current >= 1 && !ended.current && playing) {
        ended.current = true;
        onEndRef.current?.();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [play, players, home, away, playing, speed, zoom, selected]);
  return (
    <div className="football-view">
      <div className="field-view-tools">
        <button className="secondary" onClick={() => setZoom((v) => !v)}>
          {zoom ? "Show full field" : "Closer view"}
        </button>
        <span>
          Circle = team · Ring: gold 90+ / cyan 80–89 / chrome 70–79 / slate
          below 70
        </span>
      </div>
      <div className="football-stage" ref={stage}>
        <canvas
          ref={canvas}
          width={1200}
          height={650}
          aria-label="Animated top-down football field. Jersey numbers and player names identify the saved lineup."
          role="img"
          onClick={(e) => {
            if (!play) return;
            const rect = e.currentTarget.getBoundingClientRect(),
              px = ((e.clientX - rect.left) * 1200) / rect.width,
              py = ((e.clientY - rect.top) * 650) / rect.height;
            const lo = zoom ? Math.max(0, Math.min(60, play.spot - 20)) : 0,
              hi = zoom ? lo + 60 : 120;
            const a = play.agents.find((a) => {
              const p = point(a.path, progress.current);
              return (
                Math.hypot(
                  45 + ((p[0] + 10 - lo) / (hi - lo)) * 1110 - px,
                  44 + (p[1] / 53.3) * 550 - py,
                ) < 18
              );
            });
            setSelected(a?.id || null);
          }}
        />
      </div>
      <label className="field-player-picker">
        Inspect a player
        <select
          aria-label="Inspect a player on the field"
          value={selected || ""}
          onChange={(e) => setSelected(e.target.value || null)}
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
        </p>
      )}
      <p className="fineprint">
        Cyan line: scrimmage · Gold line: first down. Reduced-motion settings
        show resolved positions. Swipe the field sideways on smaller screens.
      </p>
    </div>
  );
}
