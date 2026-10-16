import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import type { Snapshot, Player, Franchise } from "../src/lib/types";

test("draft interaction: visible selection, waiting-to-your-turn recovery, confirmation and failure retention", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    HTMLDialogElement: dom.window.HTMLDialogElement,
    MutationObserver: dom.window.MutationObserver,
  });
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  const { render, screen, fireEvent, cleanup, act } =
    await import("@testing-library/react");
  const { DraftRoom } = await import("../src/components/draft-room");
  const order = [
    "BUF",
    "BAL",
    ...Array.from({ length: 30 }, (_, i) => "CPU" + i),
  ];
  const snap: Snapshot = {
    league: {
      id: "league",
      name: "Test",
      commissioner: "owner",
      state: "running",
      next_pick: 0,
      revision: 1,
      draft_order: order,
      season: 1,
    },
    members: [{ user_id: "owner", franchise_id: "BAL" }],
    picks: [],
    invite: null,
    events: [],
  };
  const player: Player = {
    id: "player",
    name: "Test Receiver",
    position: "WR",
    age: 24,
    jersey: 11,
    overall: 85,
    attributes: { catching: 88 },
    salary: 1000000,
    height_inches: 73,
    weight_lbs: 200,
    development: "Star",
    source: "Original test rating",
    history: "Test fixture",
  };
  const teams: Franchise[] = ["BAL", "BUF"].map((id) => ({
    id,
    city: id,
    name: id,
    conference: "AFC",
    division: "North",
    color: "#fff",
  }));
  let accepted = false;
  const submissions: unknown[][] = [];
  const props = {
    snapshot: snap,
    players: [player],
    teams,
    userId: "owner",
    busy: false,
    queue: [],
    onQueue: async () => {},
    onControl: async () => {},
    onPick: async (...args: unknown[]) => {
      submissions.push(args);
      return accepted;
    },
  };
  const ui = render(React.createElement(DraftRoom, props));
  fireEvent.click(screen.getByRole("button", { name: "View Test Receiver" }));
  assert.equal(
    (
      screen.getByRole("button", {
        name: "Draft this player",
      }) as HTMLButtonElement
    ).disabled,
    true,
  );
  // Opening a profile before your turn must not strand it with a stale revision.
  const next = {
    ...snap,
    league: { ...snap.league, next_pick: 1, revision: 2 },
  };
  ui.rerender(React.createElement(DraftRoom, { ...props, snapshot: next }));
  assert.equal(
    (
      screen.getByRole("button", {
        name: "Draft this player",
      }) as HTMLButtonElement
    ).disabled,
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "Draft this player" }));
  assert.equal(
    submissions.length,
    0,
    "Reviewing a player must not submit a pick",
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Confirm draft pick" }));
  });
  assert.deepEqual(submissions[0], ["player", 1, 2]);
  assert.ok(
    screen.getByRole("dialog"),
    "A failed request keeps the player and confirmation visible",
  );
  const paused = {
    ...next,
    league: { ...next.league, state: "paused" as const, revision: 3 },
  };
  ui.rerender(React.createElement(DraftRoom, { ...props, snapshot: paused }));
  assert.equal(
    (
      screen.getByRole("button", {
        name: "Confirm draft pick",
      }) as HTMLButtonElement
    ).disabled,
    true,
  );
  const resumed = { ...next, league: { ...next.league, revision: 4 } };
  ui.rerender(React.createElement(DraftRoom, { ...props, snapshot: resumed }));
  assert.equal(
    (
      screen.getByRole("button", {
        name: "Confirm draft pick",
      }) as HTMLButtonElement
    ).disabled,
    true,
    "A stale confirmation cannot submit",
  );
  fireEvent.click(screen.getByRole("button", { name: "Go back" }));
  fireEvent.click(screen.getByRole("button", { name: "Draft this player" }));
  accepted = true;
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Confirm draft pick" }));
  });
  assert.deepEqual(submissions[1], ["player", 1, 4]);
  assert.equal(Boolean(screen.queryByRole("dialog")), false);
  cleanup();
  dom.window.close();
});
