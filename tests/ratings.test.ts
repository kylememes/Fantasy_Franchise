import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAuthorizedRatings } from "../scripts/authorized-ratings";
import type { Player } from "../src/lib/types";
const player = {
  id: "original",
  external_id: "gsis-test",
  is_fictional: false,
  overall: 75,
  attributes: { catching: 75 },
  dataset: "original",
  name: "Fixture Player",
  position: "WR",
  age: 24,
  jersey: 11,
  salary: 750000,
  height_inches: 72,
  weight_lbs: 200,
  development: "Normal",
  source: "Test fixture",
  history: "Test fixture",
} as Player & { external_id: string };
const permission = {
  provider: "EA",
  edition: "Madden 27",
  permission_reference: "test-only-authorization-fixture",
  redistribution_authorized: true,
};
test("authorized ratings require rights, stable player IDs and valid values; source snapshots remain unchanged", () => {
  const rating = {
    external_id: "gsis-test",
    overall: 90,
    attributes: { catching: 92 },
  };
  assert.throws(
    () =>
      applyAuthorizedRatings([player], [rating], {
        ...permission,
        redistribution_authorized: false,
      }),
    /authorization/,
  );
  assert.throws(
    () =>
      applyAuthorizedRatings(
        [player],
        [{ ...rating, external_id: "unknown" }],
        permission,
      ),
    /Unknown/,
  );
  assert.throws(
    () =>
      applyAuthorizedRatings(
        [player],
        [{ ...rating, overall: 100 }],
        permission,
      ),
    /0 to 99/,
  );
  assert.throws(
    () => applyAuthorizedRatings([player], [rating, rating], permission),
    /duplicate/,
  );
  const next = applyAuthorizedRatings([player], [rating], permission)[0];
  assert.equal(next.overall, 90);
  assert.notEqual(next.id, player.id);
  assert.equal(player.overall, 75);
  assert.match(next.rating_source!, /authorized/);
});
