import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { JSDOM } from "jsdom";
import { simulateGame } from "../supabase/functions/_shared/simulation";
import { syntheticTeam } from "./fixtures/football";
import type { League, Franchise } from "../src/lib/types";
test("season UI: commissioner gating, shared readiness/controls, saved independent replay and real-name staff hires", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    MutationObserver: dom.window.MutationObserver,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
  });
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  dom.window.HTMLCanvasElement.prototype.getContext = () => null;
  dom.window.confirm = () => true;
  const { render, screen, fireEvent, act, cleanup } =
    await import("@testing-library/react");
  const { SeasonHub, CoachingStaff } =
    await import("../src/components/season-hub");
  const league: League = {
    id: "league",
    name: "Test",
    commissioner: "owner",
    state: "completed",
    next_pick: 1696,
    revision: 1,
    draft_order: [],
    season: 1,
  };
  const teams: Franchise[] = [
    {
      id: "BAL",
      city: "Baltimore",
      name: "Ravens",
      color: "#6454ac",
      conference: "AFC",
      division: "North",
    },
    {
      id: "PHI",
      city: "Philadelphia",
      name: "Eagles",
      color: "#208c93",
      conference: "NFC",
      division: "East",
    },
  ];
  const result = simulateGame({
    seed: 5,
    phase: "preseason",
    home: syntheticTeam("BAL"),
    away: syntheticTeam("PHI"),
  });
  let calls: { name: string; args: any }[] = [],
    hires: any[] = [];
  let season: any = {
    season: {
      league_id: "league",
      season: 1,
      year: 2026,
      phase: "preseason",
      week: 1,
      status: "setup",
    },
    games: [
      {
        id: "game",
        phase: "preseason",
        week: 1,
        home: "BAL",
        away: "PHI",
        kickoff: "2026-08-15T23:00:00Z",
        status: "scheduled",
        home_score: null,
        away_score: null,
      },
    ],
    staff: [],
    standings: teams.map((t) => ({
      ...t,
      wins: 0,
      losses: 0,
      ties: 0,
      points_for: 0,
      points_against: 0,
      differential: 0,
    })),
  };
  let game: any = {
    game: { ...season.games[0], cursor: 0, speed: 1, box: null },
    ready: [],
    owners: [
      { team: "BAL", user_id: "owner" },
      { team: "PHI", user_id: "friend" },
    ],
    players: result.players,
    total_plays: result.plays.length,
    plays: [],
    staff: null,
    coaching: null,
  };
  const client: any = {
    from: () => ({
      select: () => ({ eq: async () => ({ data: hires, error: null }) }),
    }),
    functions: {
      invoke: async () => ({ data: { processed: 0 }, error: null }),
    },
    rpc: async (name: string, args: any) => {
      calls.push({ name, args });
      if (name === "season_snapshot")
        return { data: structuredClone(season), error: null };
      if (name === "game_snapshot") {
        const value = structuredClone(game);
        value.plays = value.plays.filter(
          (p: any) => p.index > (args.after_play ?? -1),
        );
        if (args.after_play >= 0) value.players = null;
        return { data: value, error: null };
      }
      if (name === "week_control") {
        season.season.status = "open";
        return { data: null, error: null };
      }
      if (name === "game_action") {
        if (args.action === "ready") game.ready = ["owner"];
        if (args.action === "pause") game.game.status = "paused";
        if (args.action === "resume") game.game.status = "live";
        if (args.action === "speed") game.game.speed = args.play_speed;
        if (args.action === "next") {
          game.game.cursor++;
          game.plays = result.plays.slice(0, game.game.cursor + 1);
        }
        if (args.action === "finish") {
          game.game.status = "final";
          game.game.home_score = result.home_score;
          game.game.away_score = result.away_score;
          game.game.box = result.box;
          game.plays = result.plays;
        }
        return { data: null, error: null };
      }
      if (name === "hire_coach") {
        hires = args.coach
          ? [
              {
                franchise_id: "BAL",
                role: args.staff_role,
                coach_id: args.coach,
              },
            ]
          : [];
        return { data: null, error: null };
      }
      return { data: null, error: null };
    },
  };
  let navigated = "",
    chosen = "";
  const props = {
    league,
    team: "BAL",
    userId: "owner",
    teams,
    players: [],
    management: null,
    view: "Dashboard",
    gameId: "",
    onGame: (id: string) => {
      chosen = id;
    },
    onNavigate: (v: string) => {
      navigated = v;
    },
    client,
  };
  try {
    const v = render(React.createElement(SeasonHub, props));
    await screen.findByRole("button", { name: "Open preseason" });
    fireEvent.click(screen.getByRole("button", { name: "Enter game" }));
    assert.equal(chosen, "game");
    assert.equal(navigated, "Game Center");
    fireEvent.click(screen.getByRole("button", { name: "Open preseason" }));
    await screen.findByRole("button", { name: "Advance week" });
    assert.equal(
      (
        screen.getByRole("button", {
          name: "Advance week",
        }) as HTMLButtonElement
      ).disabled,
      true,
    );
    v.rerender(React.createElement(SeasonHub, { ...props, userId: "friend" }));
    assert.equal(screen.queryByRole("button", { name: "Advance week" }), null);
    v.rerender(
      React.createElement(SeasonHub, {
        ...props,
        view: "Game Center",
        gameId: "game",
      }),
    );
    await screen.findByRole("button", { name: /Ready —/ });
    fireEvent.click(screen.getByRole("button", { name: /Ready —/ }));
    await screen.findByRole("button", { name: "Cancel ready" });
    assert.equal(
      game.game.status,
      "scheduled",
      "one owner cannot start the match",
    );
    game.game.status = "live";
    game.plays = result.plays.slice(0, 1);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByRole("button", { name: "Pause" });
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await screen.findByRole("button", { name: "Play" });
    fireEvent.click(screen.getByRole("button", { name: "Next play" }));
    await act(async () => {});
    assert.equal(game.game.cursor, 1);
    fireEvent.click(screen.getByRole("button", { name: "Simulate to end" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Finish official game" }),
    );
    await screen.findByRole("button", { name: "Jump to final" });
    await screen.findByText(/Official final:/);
    fireEvent.click(screen.getByRole("button", { name: "Statistics" }));
    await screen.findByText("Official box score");
    const mutations = calls.filter((c) => c.name === "game_action").length;
    fireEvent.click(screen.getByRole("button", { name: /^Replay$/ }));
    fireEvent.click(screen.getByRole("button", { name: "2×" }));
    fireEvent.click(screen.getByRole("button", { name: "Next play" }));
    assert.equal(
      calls.filter((c) => c.name === "game_action").length,
      mutations,
      "replay must not write official game state",
    );
    v.unmount();
    render(React.createElement(CoachingStaff, { league, team: "BAL", client }));
    await act(async () => {});
    fireEvent.change(
      screen.getByRole("combobox", { name: "Choose head coach" }),
      { target: { value: "andy-reid" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Hire HC" }));
    await screen.findByText("Andy Reid", { selector: "strong" });
    assert.equal(calls.at(-1)?.name, "hire_coach");
    assert.equal(
      calls.some((c) => c.name === "save_coaching"),
      false,
    );
  } finally {
    cleanup();
    dom.window.close();
  }
});
