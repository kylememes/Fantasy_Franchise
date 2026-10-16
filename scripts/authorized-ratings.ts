import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { Player } from "../src/lib/types";

type Rating = {
  external_id: string;
  overall: number;
  attributes: Record<string, number>;
};
type Permission = {
  provider: string;
  edition: string;
  permission_reference: string;
  redistribution_authorized: boolean;
};
export function applyAuthorizedRatings(
  base: (Player & { external_id: string })[],
  ratings: Rating[],
  permission: Permission,
) {
  if (
    !permission.redistribution_authorized ||
    !permission.permission_reference?.trim() ||
    !permission.provider?.trim() ||
    !permission.edition?.trim()
  )
    throw new Error(
      "A documented redistribution authorization is required. Public web access is not authorization.",
    );
  const rows = new Map<string, Rating>();
  const known = new Set(
    base.filter((p) => !p.is_fictional).map((p) => p.external_id),
  );
  for (const r of ratings) {
    if (!known.has(r.external_id) || rows.has(r.external_id))
      throw new Error("Unknown or duplicate external player ID");
    if (!r.attributes || !Object.keys(r.attributes).length)
      throw new Error("Position attributes are required");
    for (const n of [r.overall, ...Object.values(r.attributes)])
      if (!Number.isInteger(n) || n < 0 || n > 99)
        throw new Error("Ratings must be integers from 0 to 99");
    rows.set(r.external_id, r);
  }
  const dataset = `authorized-${permission.provider}-${permission.edition}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-");
  return base.map((p) => {
    const r = rows.get(p.external_id);
    const hex = createHash("sha256")
      .update(dataset + ":" + p.external_id)
      .digest("hex");
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    return {
      ...p,
      id,
      dataset,
      ...(r
        ? {
            overall: r.overall,
            attributes: r.attributes,
            rating_source: `${permission.provider} ${permission.edition} (authorized)`,
            source: `Roster: nflverse CC BY 4.0. Ratings: ${permission.provider} ${permission.edition}; permission ${permission.permission_reference}. Contracts remain original game estimates.`,
          }
        : {}),
    };
  });
}
async function main() {
  const [input, permissionFile, output] = process.argv.slice(2);
  if (!input || !permissionFile || !output)
    throw new Error(
      "Usage: node --import tsx scripts/authorized-ratings.ts RATINGS.json PERMISSION.json OUTPUT.json",
    );
  const base = JSON.parse(await readFile("data/nfl-2026-pool.json", "utf8"));
  const result = applyAuthorizedRatings(
    base,
    JSON.parse(await readFile(input, "utf8")),
    JSON.parse(await readFile(permissionFile, "utf8")),
  );
  await writeFile(output, JSON.stringify(result) + "\n");
  console.log(
    "Created a separate dataset. Existing leagues and original player snapshots were not changed.",
  );
}
if (process.argv[1]?.endsWith("authorized-ratings.ts")) void main();
