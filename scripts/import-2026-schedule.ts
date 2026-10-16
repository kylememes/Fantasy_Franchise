/** Normalize official NFL weekly HTML snapshots. Scores and records are deliberately discarded. */
import { JSDOM } from "jsdom";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
async function main() {
  const dir = process.argv[2];
  if (!dir)
    throw Error("Provide a directory of official NFL weekly HTML snapshots");
  const games: {
    phase: string;
    week: number;
    home: string;
    away: string;
    kickoff: string | null;
    source_game_id: string;
    source_url: string;
  }[] = [];
  const normalize = (s: string) =>
    s === "AZ" ? "ARI" : s === "LA" ? "LAR" : s === "JAC" ? "JAX" : s;
  const manifest = [];
  for (const phase of ["preseason", "regular"])
    for (let week = 1; week <= (phase === "preseason" ? 3 : 18); week++) {
      const html = await readFile(`${dir}/${phase}-${week}.html`, "utf8");
      const document = new JSDOM(html).window.document;
      const source_url = `https://www.nfl.com/schedules/2026/by-week/${phase === "preseason" ? "preseason-" : ""}week-${week}`;
      let count = 0;
      for (const a of document.querySelectorAll("a[data-analytics]")) {
        const analytics = JSON.parse(a.getAttribute("data-analytics")!);
        if (analytics.linkModule !== "Game Card") continue;
        const card = a.parentElement!;
        const logos = [...card.querySelectorAll("img")]
          .map(
            (i) => i.getAttribute("src")?.match(/clubs\/logos\/([A-Z]+)/)?.[1],
          )
          .filter(Boolean) as string[];
        if (logos.length !== 2) throw Error("Missing teams on " + source_url);
        const kickoff =
          card.querySelector("time")?.getAttribute("datetime") ?? null;
        games.push({
          phase,
          week,
          away: normalize(logos[0]),
          home: normalize(logos[1]),
          kickoff,
          source_game_id: analytics.gameId,
          source_url,
        });
        count++;
      }
      if (count < 10 || count > 16)
        throw Error(`Unexpected ${phase} ${week} game count ${count}`);
      manifest.push({
        phase,
        week,
        count,
        source_url,
        sha256: createHash("sha256").update(html).digest("hex"),
      });
    }
  const ids = new Set<string>();
  const weekly = new Set<string>();
  const counts: Record<string, number> = {};
  for (const g of games) {
    if (ids.has(g.source_game_id)) throw Error("Duplicate source game");
    ids.add(g.source_game_id);
    for (const team of [g.home, g.away]) {
      const key = `${g.phase}-${g.week}-${team}`;
      if (weekly.has(key)) throw Error("Team twice in week " + key);
      weekly.add(key);
      if (g.phase === "regular") counts[team] = (counts[team] || 0) + 1;
    }
  }
  if (
    games.filter((g) => g.phase === "regular").length !== 272 ||
    Object.keys(counts).length !== 32 ||
    Object.values(counts).some((n) => n !== 17) ||
    games.filter((g) => g.phase === "preseason").length !== 48
  )
    throw Error("Schedule totals do not match 2026 NFL season");
  await writeFile(
    "data/schedule-2026.json",
    JSON.stringify(
      { year: 2026, hall_of_fame_included: false, games },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    "data/schedule-2026-sources.json",
    JSON.stringify({ year: 2026, sources: manifest }, null, 2) + "\n",
  );
  console.log({ games: games.length, regular: 272, preseason: 48, teams: 32 });
}
void main();
