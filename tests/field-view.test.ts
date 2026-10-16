import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { JSDOM } from "jsdom";
import { simulateGame } from "../supabase/functions/_shared/simulation";
import { syntheticTeam } from "./fixtures/football";
test("field playback pauses, resumes, restarts, slows and finishes once with accessible player controls", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost",
  });
  let frames = new Map<number, FrameRequestCallback>(),
    id = 0,
    now = 100,
    reduced = false;
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    MutationObserver: dom.window.MutationObserver,
    requestAnimationFrame: (cb: FrameRequestCallback) => {
      frames.set(++id, cb);
      return id;
    },
    cancelAnimationFrame: (key: number) => frames.delete(key),
  });
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({
      matches: reduced,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
  dom.window.HTMLCanvasElement.prototype.getContext = () =>
    new Proxy({}, { get: () => () => {}, set: () => true }) as any;
  const { render, screen, fireEvent, act, cleanup } =
    await import("@testing-library/react");
  const { FootballField } = await import("../src/components/football-field");
  const h = syntheticTeam("H"),
    a = syntheticTeam("A");
  h.gameplay_version = a.gameplay_version = 3;
  const result = simulateGame({ seed: 12, phase: "regular", home: h, away: a });
  let ends = 0;
  const moments: any[] = [];
  const props = {
    play: result.plays[0],
    players: result.players,
    home: {
      id: "H",
      city: "Home",
      name: "Home",
      color: "#6040a0",
      conference: "AFC",
      division: "North",
    },
    away: {
      id: "A",
      city: "Away",
      name: "Away",
      color: "#208c93",
      conference: "NFC",
      division: "East",
    },
    playing: true,
    speed: 1,
    onEnd: () => ends++,
    onMoment: (m: any) => moments.push(m),
  };
  const tick = async (count: number) => {
    for (let i = 0; i < count; i++) {
      now += 100;
      await act(async () => {
        const callbacks = [...frames.values()];
        frames.clear();
        callbacks.forEach((cb) => cb(now));
      });
    }
  };
  try {
    const v = render(React.createElement(FootballField, props));
    await tick(12);
    assert.equal(ends, 0);
    assert.equal(moments.at(-1).resolved, false);
    v.rerender(
      React.createElement(FootballField, { ...props, playing: false }),
    );
    await tick(1);
    const clock = moments.at(-1).clock;
    await tick(10);
    assert.equal(moments.at(-1).clock, clock, "pause must freeze playback");
    v.rerender(React.createElement(FootballField, { ...props, speed: 0.5 }));
    await tick(20);
    assert.equal(ends, 0, "slow motion cannot finish at normal speed");
    await tick(70);
    assert.equal(ends, 1);
    assert.equal(moments.at(-1).resolved, true);
    await tick(5);
    assert.equal(ends, 1);
    v.rerender(
      React.createElement(FootballField, {
        ...props,
        replayKey: 1,
        playing: false,
      }),
    );
    await tick(1);
    assert.equal(
      moments.at(-1).resolved,
      false,
      "same-play restart must return to pre-snap",
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Inspect a player on the field" }),
      { target: { value: props.play.agents[0].id } },
    );
    assert.ok(screen.getByText(/OVR/));
    fireEvent.click(screen.getByRole("button", { name: "Names" }));
    assert.equal(
      screen
        .getByRole("button", { name: "Names" })
        .getAttribute("aria-pressed"),
      "false",
    );
    reduced = true;
    v.rerender(
      React.createElement(FootballField, {
        ...props,
        replayKey: 2,
        playing: false,
      }),
    );
    await tick(1);
    assert.equal(
      moments.at(-1).resolved,
      true,
      "reduced motion displays the result without running the clock",
    );
    assert.equal(ends, 1);
  } finally {
    cleanup();
    dom.window.close();
    frames.clear();
  }
});
