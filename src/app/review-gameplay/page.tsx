"use client";
import { useMemo, useState } from "react";
import { FootballField } from "@/components/football-field";
import { simulateGame } from "../../../supabase/functions/_shared/simulation";
import { syntheticTeam } from "../../../tests/fixtures/football";
const home = {
  id: "BAL",
  city: "Baltimore",
  name: "Ravens",
  color: "#6454ac",
  conference: "AFC",
  division: "North",
};
const away = {
  id: "PHI",
  city: "Philadelphia",
  name: "Eagles",
  color: "#208c93",
  conference: "NFC",
  division: "East",
};
export default function Review() {
  const game = useMemo(() => {
    const h = syntheticTeam("BAL"),
      a = syntheticTeam("PHI");
    h.gameplay_version = a.gameplay_version = 3;
    h.coach_bonus_version = a.coach_bonus_version = 1;
    for (const t of [h, a])
      t.players.forEach(
        (p, i) =>
          (p.name = `Alex ${["Carter", "Jackson", "Reed", "Walker", "Jones", "Brooks", "Davis", "Smith"][i % 8]}`),
      );
    return simulateGame({ seed: 12, phase: "regular", home: h, away: a });
  }, []);
  const [i, setI] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1),
    [restart, setRestart] = useState(0);
  return (
    <main style={{ maxWidth: 900, margin: "auto", padding: "16px" }}>
      <h1>Gameplay preview</h1>
      <p>Synthetic test roster</p>
      <div className="game-controls">
        <button onClick={() => setPlaying((p) => !p)}>
          {playing ? "Pause" : "Play"}
        </button>
        <button
          onClick={() => {
            setRestart((r) => r + 1);
            setPlaying(true);
          }}
        >
          Restart
        </button>
        <select
          aria-label="Choose play"
          value={i}
          onChange={(e) => {
            setI(Number(e.target.value));
            setPlaying(false);
          }}
        >
          {game.plays.map((p, j) => (
            <option key={j} value={j}>
              {j + 1} {p.offense} {p.kind}: {p.description}
            </option>
          ))}
        </select>
        <select
          aria-label="Playback speed"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
        >
          {[0.25, 0.5, 1, 2, 4].map((n) => (
            <option key={n} value={n}>
              {n}×
            </option>
          ))}
        </select>
      </div>
      <FootballField
        play={game.plays[i]}
        players={game.players}
        home={home}
        away={away}
        playing={playing}
        speed={speed}
        replayKey={restart}
        onEnd={() => setPlaying(false)}
      />
    </main>
  );
}
