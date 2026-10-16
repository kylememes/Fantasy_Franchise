import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { JSDOM } from "jsdom";
import type { Management, League, Player, Franchise } from "../src/lib/types";

test("trade desk: salary-only impact, CPU interest, stale preview suppression, counters, inbox and partner finder", async () => {
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
  const { render, screen, fireEvent, within, act, cleanup } =
    await import("@testing-library/react");
  const { Trades } = await import("../src/components/trade-desk");
  const league: League = {
    id: "league",
    name: "Trades",
    commissioner: "owner",
    state: "completed",
    next_pick: 1696,
    revision: 1,
    draft_order: [],
    season: 1,
    salary_cap: 10000000,
  };
  const base: Player = {
    id: "a",
    name: "Patrick Mahomes",
    external_id: "00-0033873",
    position: "QB",
    age: 25,
    jersey: 15,
    overall: 90,
    attributes: { throw_power: 95 },
    salary: 1,
    height_inches: 74,
    weight_lbs: 220,
    development: "Star",
    source: "Fixture",
    history: "",
  };
  const players = [
    base,
    {
      ...base,
      id: "a2",
      name: "Home Receiver",
      external_id: undefined,
      position: "WR",
    },
    { ...base, id: "b", name: "Away Quarterback", external_id: undefined },
    {
      ...base,
      id: "b2",
      name: "Away Receiver",
      external_id: undefined,
      position: "WR",
    },
    { ...base, id: "c", name: "CPU Quarterback", external_id: undefined },
    {
      ...base,
      id: "c2",
      name: "CPU Receiver",
      external_id: undefined,
      position: "WR",
    },
  ];
  const teams: Franchise[] = ["BAL", "KC", "ARI"].map((id) => ({
    id,
    city: id,
    name: id,
    conference: "AFC",
    division: "North",
    color: "#fff",
  }));
  const incoming = {
    id: "incoming",
    from_team: "KC",
    to_team: "BAL",
    give_players: ["b"],
    take_players: ["a"],
    give_picks: [],
    take_picks: [],
    status: "pending",
    reason: "",
    give_value: 100,
    take_value: 100,
    created_at: "2026-10-16T12:00:00Z",
    thread_id: "incoming",
  };
  const data: Management = {
    revision: 1,
    human_teams: ["BAL", "KC"],
    unread_trade_ids: ["incoming"],
    ownership: players.map((p) => ({
      player_id: p.id,
      franchise_id: p.id.startsWith("a")
        ? "BAL"
        : p.id.startsWith("b")
          ? "KC"
          : "ARI",
    })),
    contracts: players.map((p) => ({
      player_id: p.id,
      annual_salary: p.id === "a" ? 2000000 : 1000000,
      years: 2,
      start_season: 1,
      draft_round: 20,
    })),
    picks: [],
    trades: [incoming],
    coaching: null,
  };
  const mutations: { name: string; args: any }[] = [];
  let succeed = false,
    delay = false,
    release: (() => void) | undefined;
  const client: any = {
    rpc: async (name: string, args: any) => {
      assert.equal(name, "trade_preview");
      const result = {
        data: {
          valid: true,
          is_cpu: args.target_team === "ARI",
          cpu_accepts: true,
          interest: args.target_team === "ARI" ? 85 : null,
          feedback: ["This package improves their quarterback options."],
          problems: [],
          give_value: 200,
          take_value: 150,
        },
        error: null,
      };
      if (delay) {
        delay = false;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return result;
    },
  };
  const props = {
    league,
    data,
    players,
    teams,
    team: "BAL",
    busy: false,
    client,
    mutate: async (name: string, args: any) => {
      mutations.push({ name, args });
      return succeed;
    },
  };
  try {
    const v = render(React.createElement(Trades, props));
    fireEvent.change(screen.getByRole("combobox", { name: "Trade partner" }), {
      target: { value: "ARI" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Patrick Mahomes/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /CPU Quarterback/ }));
    await screen.findByRole("meter", { name: "CPU trade interest" });
    assert.equal(screen.getByRole("meter").getAttribute("aria-valuenow"), "85");
    assert.ok(
      v.container.querySelector(".trade-selected-cards .player-headshot"),
      "selected players use their real cards",
    );
    const salary = within(
      screen.getByRole("region", { name: "Trade salary effects" }),
    );
    assert.ok(salary.getByText(/^\$8(?:\.0)?M$/));
    assert.equal(salary.getAllByText("Net salary change").length, 2);
    assert.equal(
      salary.queryByText(/projected starters|positional depth/i),
      null,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review trade offer" }));
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Submit trade offer" }),
      );
    });
    assert.equal(mutations[0].name, "propose_trade");
    assert.ok(
      screen.getByRole("region", { name: "Review trade" }),
      "failed submit retains review",
    );
    v.rerender(
      React.createElement(Trades, { ...props, data: { ...data, revision: 2 } }),
    );
    await screen.findByRole("meter", { name: "CPU trade interest" });
    assert.ok(
      screen.getByRole("region", { name: "Review trade" }),
      "background refresh retains draft",
    );
    delay = true;
    fireEvent.click(screen.getByRole("checkbox", { name: /CPU Receiver/ }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });
    assert.equal(
      screen.queryByRole("meter"),
      null,
      "old interest is hidden during re-evaluation",
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Trade partner" }), {
      target: { value: "KC" },
    });
    await act(async () => {
      release?.();
    });
    assert.equal(
      screen.queryByRole("meter"),
      null,
      "late CPU result cannot leak into a human negotiation",
    );
    fireEvent.click(screen.getByRole("button", { name: /^Incoming/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "View offer" }));
    });
    assert.ok(
      within(
        screen.getByRole("region", { name: "Offer assets from BAL" }),
      ).getByRole("button", { name: /Patrick Mahomes.*Flip/ }),
    );
    assert.ok(
      mutations.some(
        (m) => m.name === "mark_trade_read" && m.args.tid === "incoming",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Build counteroffer" }));
    await screen.findByText(
      "Human-controlled franchise · the other owner decides whether to accept.",
    );
    assert.equal(
      incoming.status,
      "pending",
      "building a counter never cancels the original",
    );
    assert.equal(
      (
        screen.getByRole("checkbox", {
          name: /Patrick Mahomes/,
        }) as HTMLInputElement
      ).checked,
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review trade offer" }));
    succeed = true;
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Submit trade offer" }),
      );
    });
    const counter = mutations.find((m) => m.name === "counter_trade");
    assert.ok(counter);
    assert.equal(counter.args.tid, "incoming");
    assert.deepEqual(counter.args.give_players, ["a"]);
    assert.deepEqual(counter.args.take_players, ["b"]);
    const child = {
      ...incoming,
      id: "counter",
      from_team: "BAL",
      to_team: "KC",
      give_players: ["a"],
      take_players: ["b"],
      counter_of: incoming.id,
      created_at: "2026-10-16T12:05:00Z",
    };
    v.rerender(
      React.createElement(Trades, {
        ...props,
        data: {
          ...data,
          revision: 3,
          unread_trade_ids: [],
          trades: [{ ...incoming, status: "countered" }, child],
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "View offer" }));
    assert.ok(screen.getByText("Negotiation history (2 offers)"));
    assert.equal(v.container.querySelectorAll(".trade-history li").length, 2);
    fireEvent.change(
      screen.getByRole("combobox", { name: "Player to offer" }),
      { target: { value: "a" } },
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Position to target" }),
      { target: { value: "QB" } },
    );
    const before = mutations.length;
    fireEvent.click(screen.getByRole("button", { name: "Find partners" }));
    fireEvent.click(screen.getByRole("button", { name: "Build with ARI" }));
    assert.equal(
      mutations.length,
      before,
      "partner finder never submits offers",
    );
    await screen.findByRole("meter", { name: "CPU trade interest" });
    assert.equal(
      (
        screen.getByRole("checkbox", {
          name: /CPU Quarterback/,
        }) as HTMLInputElement
      ).checked,
      true,
    );
    v.rerender(
      React.createElement(Trades, {
        ...props,
        data: {
          ...data,
          revision: 4,
          ownership: data.ownership.map((o) =>
            o.player_id === "a" ? { ...o, franchise_id: "KC" } : o,
          ),
        },
      }),
    );
    assert.ok(screen.getByText(/Ownership or a contract changed/));
    assert.equal(
      (
        screen.getByRole("button", {
          name: "Review trade offer",
        }) as HTMLButtonElement
      ).disabled,
      true,
    );
  } finally {
    cleanup();
    dom.window.close();
  }
});
