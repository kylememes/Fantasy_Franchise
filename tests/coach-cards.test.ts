import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { JSDOM } from "jsdom";
import { coachedRatings, headCoachBonuses } from "../src/lib/coaches";
import { cardValues } from "../src/lib/card-details";
import { playerHeadshot } from "../src/lib/headshots";
import type { Player } from "../src/lib/types";
const qb: Player = {
  id: "qb",
  external_id: "00-0033873",
  name: "Patrick Mahomes",
  position: "QB",
  age: 30,
  jersey: 15,
  overall: 90,
  attributes: {
    speed: 80,
    throw_power: 95,
    short_accuracy: 85,
    medium_accuracy: 88,
    deep_accuracy: 87,
    strength: 70,
    tackling: 30,
    pass_blocking: 20,
  },
  salary: 1,
  height_inches: 74,
  weight_lbs: 225,
  development: "Superstar",
  source: "Synthetic test values",
  history: "",
  stats: { passing_yards: 1234, passing_tds: 12, def_sacks: 3 },
};
const andy = headCoachBonuses.find((c) => c.id === "andy-reid")!;
test("coach packages have position-specific effects, caps, and immutable base ratings; headshots require exact real QB identity", () => {
  assert.equal(headCoachBonuses.length, 32);
  for (const c of headCoachBonuses)
    assert.deepEqual(
      c.bonuses.map((b) => b.amount),
      [2, 1],
    );
  const before = structuredClone(qb);
  const rated = coachedRatings(qb, andy);
  assert.equal(rated.attributes.short_accuracy, 87);
  assert.deepEqual(qb, before);
  assert.equal(rated.attributes.tackling, 30);
  assert.equal(rated.boosts.short_accuracy.base, 85);
  const capped = coachedRatings(
    { ...qb, attributes: { ...qb.attributes, short_accuracy: 98 } },
    andy,
  );
  assert.deepEqual(capped.boosts.short_accuracy, {
    base: 98,
    bonus: 1,
    value: 99,
  });
  assert.deepEqual(coachedRatings({ ...qb, position: "CB" }, andy).boosts, {});
  assert.equal(
    coachedRatings({ ...qb, attributes: {} }, andy).attributes.short_accuracy,
    92,
  );
  assert.deepEqual(
    cardValues(
      "LT",
      {
        speed: 60,
        strength: 90,
        pass_blocking: 88,
        run_blocking: 87,
        short_accuracy: 90,
        tackling: 50,
      },
      "ratings",
    ).map((v) => v[0]),
    ["speed", "strength", "pass_blocking", "run_blocking"],
  );
  assert.deepEqual(
    cardValues("QB", qb.stats!, "statistics").map((v) => v[0]),
    ["passing_yards", "passing_tds"],
  );
  assert.match(playerHeadshot(qb)!, /3139477\.png$/);
  for (const p of [
    { ...qb, position: "WR" },
    { ...qb, development: "Star" },
    { ...qb, is_fictional: true },
    { ...qb, external_id: undefined },
    { ...qb, name: "Different person" },
  ])
    assert.equal(playerHeadshot(p), null);
});
test("player cards show position-first details and real coach deltas; failed or ineligible QB photos revert to silhouettes", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    MutationObserver: dom.window.MutationObserver,
  });
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  const { render, screen, fireEvent, within, cleanup } =
    await import("@testing-library/react");
  const { PlayerCard } = await import("../src/components/lineup");
  try {
    const view = render(
      React.createElement(PlayerCard, {
        player: qb,
        label: "QB",
        headCoach: andy,
      }),
    );
    const image = view.container.querySelector("img.player-headshot")!;
    assert.ok(image);
    assert.equal(image.getAttribute("referrerpolicy"), "no-referrer");
    fireEvent.error(image);
    assert.equal(view.container.querySelector("img.player-headshot"), null);
    assert.ok(view.container.querySelector("svg.player-silhouette"));
    fireEvent.click(
      screen.getByRole("button", { name: /QB: Patrick Mahomes/ }),
    );
    const ratings = within(
      screen.getByRole("region", { name: "Patrick Mahomes ratings" }),
    );
    assert.ok(ratings.getByText("Throw power"));
    assert.equal(ratings.queryByText("strength"), null);
    assert.equal(ratings.queryByText("tackling"), null);
    assert.ok(ratings.getByLabelText("85 base, plus 2 coaching, 87 effective"));
    fireEvent.click(screen.getByRole("button", { name: "Stats" }));
    const stats = within(
      screen.getByRole("region", { name: "Patrick Mahomes statistics" }),
    );
    assert.ok(stats.getByText("1,234"));
    assert.equal(stats.queryByText("def sacks"), null);
    view.rerender(
      React.createElement(PlayerCard, {
        player: { ...qb, development: "Normal" },
        label: "QB",
      }),
    );
    assert.equal(view.container.querySelector("img.player-headshot"), null);
  } finally {
    cleanup();
    dom.window.close();
  }
});
