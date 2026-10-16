import type {
  Play,
  Spot,
  Agent,
} from "../../supabase/functions/_shared/simulation";

export function samplePath(path: Spot[], t: number, times?: number[]): Spot {
  if (!path.length) return [50, 26.65];
  if (path.length === 1 || t <= 0) return path[0];
  if (t >= 1) return path[path.length - 1];
  const at =
    times?.length === path.length
      ? times
      : path.map((_, i) => i / (path.length - 1));
  const i = Math.max(
    0,
    at.findIndex(
      (value, i) => i < at.length - 1 && t >= value && t < at[i + 1],
    ),
  );
  const f = Math.max(
    0,
    Math.min(1, (t - at[i]) / Math.max(0.001, at[i + 1] - at[i])),
  );
  return [
    path[i][0] + (path[i + 1][0] - path[i][0]) * f,
    path[i][1] + (path[i + 1][1] - path[i][1]) * f,
  ];
}
export function playerSpot(agent: Agent, t: number) {
  return samplePath(agent.path, t, agent.at);
}
export function ballSpot(play: Play, t: number) {
  return samplePath(play.ball, t, play.ballAt);
}
export function carrierAt(play: Play, t: number): string | null {
  if (play.possession)
    return [...play.possession].reverse().find((p) => p.at <= t)?.id || null;
  if (t < 0.26)
    return (
      play.agents.find((a) => a.team === play.offense && a.role === "QB")?.id ||
      null
    );
  if (t < 0.68 && play.kind === "pass") return null;
  if (
    play.kind === "pass" &&
    !play.description.includes("completes") &&
    !play.turnover
  )
    return null;
  return ["punt", "field_goal", "extra_point"].includes(play.kind)
    ? null
    : play.carrier || null;
}
export function cameraBounds(
  play: Play | undefined,
  t: number,
  full: boolean,
): [number, number] {
  if (!play || full) return [-10, 110];
  const ball = ballSpot(play, t);
  const span = 58;
  const center = Math.max(-10 + span / 2, Math.min(110 - span / 2, ball[0]));
  return [center - span / 2, center + span / 2];
}
export function nextDriveIndex(plays: Play[], index: number) {
  const current = plays[index];
  if (!current) return index;
  const next = plays.findIndex(
    (p, i) =>
      i > index &&
      (p.offense !== current.offense ||
        (p.quarter === 3 && current.quarter < 3) ||
        (current.scoring &&
          p.down === 1 &&
          !["extra_point", "two_point"].includes(p.kind))),
  );
  return next < 0 ? Math.max(0, plays.length - 1) : next;
}
