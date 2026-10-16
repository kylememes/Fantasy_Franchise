import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { JSDOM } from "jsdom";
import type { Player, League, Management } from "../src/lib/types";
test("lineup promotions retain edits on refresh/failure; all units and trade/release staleness are visible", async () => {
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
  const { render, screen, fireEvent, cleanup, act, within } =
    await import("@testing-library/react");
  const { Lineup } = await import("../src/components/lineup");
  const { FreeAgency } = await import("../src/components/free-agency");
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
    name: "Starting Quarterback",
    position: "QB",
    age: 25,
    jersey: 12,
    overall: 96,
    attributes: { speed: 78, short_accuracy: 95 },
    salary: 1,
    height_inches: 73,
    weight_lbs: 220,
    development: "Franchise Superstar",
    source: "Fixture",
    history: "",
    attributes_source: "worksheet",
  };
  const players = [
    p,
    {
      ...p,
      id: "b",
      name: "Backup Quarterback",
      overall: 78,
      development: "Normal",
    },
    {
      ...p,
      id: "free",
      name: "Free Agent Receiver",
      position: "WR",
      overall: 83,
      development: "Star",
    },
  ];
  const data: Management = {
    ownership: [
      { player_id: "a", franchise_id: "BAL" },
      { player_id: "b", franchise_id: "BAL" },
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
        annual_salary: 1000000,
        years: 2,
        start_season: 1,
        draft_round: 20,
      },
    ],
    picks: [],
    trades: [],
    coaching: null,
    depth: { orders: { QB: ["a", "b"] }, version: 0 },
    free_agents: [{ player_id: "free", annual_salary: 4000000 }],
  };
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  let accepted = false;
  const props = {
    league,
    data,
    players,
    team: "BAL",
    teams: [],
    busy: false,
    mutate: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return accepted;
    },
  };
  const view = render(React.createElement(Lineup, props));
  assert.equal(
    screen
      .getByLabelText(/QB: Starting Quarterback/)
      .classList.contains("dev-franchise"),
    true,
  );
  fireEvent.click(screen.getByRole("button", { name: "Defense" }));
  assert.equal(screen.getAllByLabelText(/Edit depth chart/).length, 11);
  fireEvent.click(
    screen.getByRole("button", { name: "Special teams" }),
  );
  assert.equal(screen.getAllByLabelText(/Edit depth chart/).length, 4);
  fireEvent.click(screen.getByRole("button", { name: "Offense" }));
  assert.equal(screen.getAllByLabelText(/Edit depth chart/).length, 11);
  fireEvent.click(
    screen.getByRole("button", { name: "Promote Backup Quarterback to first" }),
  );
  view.rerender(React.createElement(Lineup, { ...props, data: { ...data } }));
  assert.equal(
    (
      screen.getByLabelText(
        "Depth rank for Backup Quarterback",
      ) as HTMLSelectElement
    ).value,
    "0",
  );
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Save QB depth chart" }),
    );
  });
  assert.deepEqual(calls[0].args.ordered_players, ["b", "a"]);
  assert.ok(screen.getByRole("button", { name: "Save QB depth chart" }));
  view.rerender(
    React.createElement(Lineup, {
      ...props,
      data: { ...data, depth: { orders: { QB: ["a"] }, version: 1 } },
    }),
  );
  assert.ok(screen.getByRole("alert").textContent?.includes("another session"));
  assert.equal(
    (
      screen.getByRole("button", {
        name: "Save QB depth chart",
      }) as HTMLButtonElement
    ).disabled,
    true,
  );
  fireEvent.click(screen.getByRole("button", { name: "Reload saved lineup" }));
  assert.equal(screen.queryByText("Backup Quarterback"), null);
  cleanup();
  const agency = render(React.createElement(FreeAgency, props));
  fireEvent.click(screen.getByRole("button", { name: "Review signing" }));
  assert.equal(calls.length, 1);
  let dialog = screen.getByRole("dialog");
  assert.ok(within(dialog).getByText(/1 year/));
  await act(async () => {
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm signing" }),
    );
  });
  assert.equal(calls[1].fn, "sign_free_agent");
  assert.equal(calls[1].args.expected_salary, 4000000);
  assert.ok(screen.getByRole("dialog"), "failed request keeps review open");
  agency.rerender(
    React.createElement(FreeAgency, {
      ...props,
      data: { ...data, free_agents: [] },
    }),
  );
  dialog = screen.getByRole("dialog");
  assert.ok(within(dialog).getByRole("alert"));
  assert.equal(
    (
      within(dialog).getByRole("button", {
        name: "Confirm signing",
      }) as HTMLButtonElement
    ).disabled,
    true,
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Go back" }));
  agency.rerender(React.createElement(FreeAgency, props));
  accepted = true;
  fireEvent.click(screen.getByRole("button", { name: "Review signing" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Confirm signing" }));
  });
  assert.equal(screen.queryByRole("dialog"), null);
  assert.ok(screen.getByText("Player signed."));
  cleanup();
  dom.window.close();
});
