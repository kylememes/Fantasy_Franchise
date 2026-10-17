import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import type { Management, League, Player, Franchise } from "../src/lib/types";
test("trade review, current ownership, contract display and coaching save survive background refresh", async () => {
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
  const { render, screen, fireEvent, cleanup, act } =
    await import("@testing-library/react");
  const { Trades, RosterManagement, CoachingSettings } =
    await import("../src/components/management");
  const league: League = {
    id: "l",
    name: "Test",
    commissioner: "u",
    state: "completed",
    next_pick: 1696,
    revision: 1,
    draft_order: [],
    season: 1,
    salary_cap: 275000000,
  };
  const p: Player = {
    id: "a",
    name: "Home Quarterback",
    position: "QB",
    age: 25,
    jersey: 1,
    overall: 90,
    attributes: {},
    salary: 1,
    height_inches: 73,
    weight_lbs: 220,
    development: "Normal",
    source: "Fixture",
    history: "",
  };
  const players = [p, { ...p, id: "b", name: "Away Quarterback" }];
  const teams: Franchise[] = ["BAL", "KC"].map((id) => ({
    id,
    city: id,
    name: id,
    conference: "AFC",
    division: "North",
    color: "#fff",
  }));
  const data: Management = {
    ownership: [
      { player_id: "a", franchise_id: "BAL" },
      { player_id: "b", franchise_id: "KC" },
    ],
    contracts: [
      {
        player_id: "a",
        annual_salary: 30000000,
        years: 5,
        start_season: 1,
        draft_round: 1,
      },
      {
        player_id: "b",
        annual_salary: 20000000,
        years: 5,
        start_season: 1,
        draft_round: 2,
      },
    ],
    picks: [],
    trades: [],
    coaching: null,
  };
  let calls: { fn: string; args: Record<string, unknown> }[] = [];
  const props = {
    league,
    data,
    players,
    teams,
    team: "BAL",
    busy: false,
    mutate: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return true;
    },
  };
  const ui = render(React.createElement(Trades, props));
  fireEvent.click(screen.getByRole("checkbox", { name: /Home Quarterback/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Away Quarterback/ }));
  fireEvent.click(screen.getByRole("button", { name: "Review trade offer" }));
  assert.equal(calls.length, 0);
  assert.ok(screen.getByRole("region", { name: "Review trade" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Submit trade offer" }));
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].fn, "propose_trade");
  assert.deepEqual(calls[0].args.give_players, ["a"]);
  cleanup();
  render(
    React.createElement(RosterManagement, {
      ...props,
      data: {
        ...data,
        ownership: [
          { player_id: "a", franchise_id: "KC" },
          { player_id: "b", franchise_id: "BAL" },
        ],
      },
    }),
  );
  assert.ok(screen.getAllByText("Away Quarterback").length > 0);
  assert.equal(screen.queryByText("Home Quarterback"), null);
  assert.ok(screen.getAllByText(/^\$20(?:\.0)?M$/).length >= 1);
  cleanup();
  const coach = render(React.createElement(CoachingSettings, props));
  fireEvent.change(screen.getByRole("slider", { name: "Blitz frequency" }), {
    target: { value: "72" },
  });
  coach.rerender(
    React.createElement(CoachingSettings, { ...props, data: { ...data } }),
  );
  assert.equal(
    (
      screen.getByRole("slider", {
        name: "Blitz frequency",
      }) as HTMLInputElement
    ).value,
    "72",
  );
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Save coaching philosophy" }),
    );
  });
  assert.equal(calls[1].fn, "save_coaching");
  assert.equal((calls[1].args.settings as Record<string, number>).blitz, 72);
  assert.equal(calls[1].args.expected_version, 0);
  cleanup();
  const failing = render(
    React.createElement(CoachingSettings, {
      ...props,
      mutate: async () => false,
    }),
  );
  fireEvent.change(screen.getByLabelText("Play balance"), {
    target: { value: "75" },
  });
  assert.ok(screen.getByText("Unsaved changes"));
  fireEvent.change(screen.getByLabelText("Offensive scheme"), {
    target: { value: "West Coast" },
  });
  assert.ok(
    screen.getByText(
      "Quick throws, crossing routes, screens, and play action.",
    ),
  );
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Save coaching philosophy" }),
    );
  });
  assert.ok(screen.getByText(/Could not save/));
  assert.equal(
    (screen.getByLabelText("Play balance") as HTMLSelectElement).value,
    "75",
  );
  failing.rerender(
    React.createElement(CoachingSettings, {
      ...props,
      data: {
        ...data,
        coaching: {
          offense: "Balanced",
          defense: "Multiple",
          version: 2,
          tendencies: { run_pass: 25 },
        },
      },
      mutate: async () => false,
    }),
  );
  assert.ok(screen.getByText(/Another session saved a newer version/));
  assert.equal(
    (
      screen.getByRole("button", {
        name: "Save coaching philosophy",
      }) as HTMLButtonElement
    ).disabled,
    true,
  );
  assert.equal(
    (screen.getByLabelText("Play balance") as HTMLSelectElement).value,
    "75",
  );
  cleanup();
  dom.window.close();
});
