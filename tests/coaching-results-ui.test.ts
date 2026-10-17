import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import type { League } from "../src/lib/types";
test("results only request team finals in the selected phase and show errors rather than partial totals", async () => {
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
  const { render, screen, fireEvent, waitFor, cleanup } =
    await import("@testing-library/react");
  const { CoachingResults } =
    await import("../src/components/coaching-results");
  const league = { id: "l", season: 1 } as League;
  const calls: string[] = [];
  let fail = false;
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "season_snapshot")
        return {
          data: {
            games: [
              {
                id: "final",
                home: "HOME",
                away: "AWAY",
                status: "final",
                phase: "regular",
              },
              {
                id: "live",
                home: "HOME",
                away: "AWAY",
                status: "live",
                phase: "regular",
              },
              {
                id: "other",
                home: "X",
                away: "Y",
                status: "final",
                phase: "regular",
              },
              {
                id: "pre",
                home: "HOME",
                away: "AWAY",
                status: "final",
                phase: "preseason",
              },
            ],
          },
        };
      calls.push(String(args.gid));
      if (fail) return { error: { message: "Report unavailable" } };
      return {
        data: {
          game: {
            id: args.gid,
            home: "HOME",
            away: "AWAY",
            status: "final",
            box: { teams: {}, players: {} },
          },
          plays: [],
          players: {},
          total_plays: 0,
        },
      };
    },
  };
  render(
    React.createElement(CoachingResults, {
      league,
      team: "HOME",
      client: client as never,
    }),
  );
  await screen.findByText("1 completed game");
  assert.deepEqual(calls, ["final"]);
  assert.ok(screen.getByText("Blitz rate"));
  fireEvent.change(screen.getByLabelText("Season 1"), {
    target: { value: "preseason" },
  });
  await waitFor(() => assert.deepEqual(calls, ["final", "pre"]));
  await screen.findByText("1 completed game");
  fail = true;
  fireEvent.click(screen.getByRole("button", { name: "Refresh results" }));
  await screen.findByRole("alert");
  assert.ok(screen.getByText("Report unavailable"));
  assert.equal(screen.queryByText("Blitz rate"), null);
  cleanup();
  render(
    React.createElement(CoachingResults, {
      league,
      team: "HOME",
      client: { rpc: async () => ({ data: null }) } as never,
    }),
  );
  await screen.findByText(/Results appear after your first/);
  cleanup();
  dom.window.close();
});
