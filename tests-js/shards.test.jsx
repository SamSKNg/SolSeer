import React from "react";
import { test, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { ReflectionScene } from "../src/client/ReflectionScene.jsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function setup(paused = false, reduced = false) {
  const frames = new Map();
  let nextFrame = 0;
  const listeners = new Set();
  const media = {
    matches: reduced,
    addEventListener: (_, callback) => listeners.add(callback),
    removeEventListener: (_, callback) => listeners.delete(callback),
  };
  vi.stubGlobal("matchMedia", () => media);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((id) => frames.delete(id)),
  );
  const view = render(
    <div className="page-heading">
      <ReflectionScene motionPaused={paused} />
    </div>,
  );
  const hero = view.container.querySelector(".page-heading");
  const scene = view.container.querySelector(".reflection-scene");
  vi.spyOn(hero, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 1000,
    height: 600,
  });
  const move = (x, y, pointerType = "mouse") =>
    fireEvent(
      hero,
      Object.assign(new Event("pointermove", { bubbles: true }), {
        clientX: x,
        clientY: y,
        pointerType,
      }),
    );
  const flush = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  };
  return { view, hero, scene, frames, move, flush, media, listeners };
}

test("parallax coalesces pointer events into one frame, clamps movement and returns to neutral on exit", () => {
  const { hero, scene, frames, move, flush } = setup();
  expect(scene.dataset.parallax).toBe("on");
  expect(scene.getAttribute("aria-hidden")).toBe("true");
  expect(scene.querySelectorAll(".shard")).toHaveLength(4);
  move(0, 0);
  move(1000, 600);
  expect(frames.size).toBe(1);
  flush();
  expect(scene.style.getPropertyValue("--parallax-x")).toBe("22.00px");
  expect(scene.style.getPropertyValue("--parallax-y")).toBe("14.00px");
  move(-5000, -3000);
  flush();
  expect(scene.style.getPropertyValue("--parallax-x")).toBe("-22.00px");
  expect(scene.style.getPropertyValue("--parallax-y")).toBe("-14.00px");
  move(700, 400);
  fireEvent.pointerLeave(hero);
  expect(frames.size).toBe(0);
  expect(scene.style.getPropertyValue("--parallax-x")).toBe("0px");
});

test("touch does not drive parallax, motion pause resets pending movement, and resume works", () => {
  const { view, scene, frames, move, flush } = setup();
  move(1000, 600, "touch");
  expect(frames.size).toBe(0);
  move(1000, 600);
  view.rerender(
    <div className="page-heading">
      <ReflectionScene motionPaused />
    </div>,
  );
  expect(frames.size).toBe(0);
  expect(scene.dataset.parallax).toBe("off");
  expect(scene.style.getPropertyValue("--parallax-x")).toBe("0px");
  move(1000, 600);
  expect(frames.size).toBe(0);
  view.rerender(
    <div className="page-heading">
      <ReflectionScene motionPaused={false} />
    </div>,
  );
  move(1000, 600);
  flush();
  expect(scene.style.getPropertyValue("--parallax-x")).toBe("22.00px");
});

test("reduced-motion changes take effect immediately and unmount removes frames and listeners", () => {
  const { view, hero, scene, media, listeners, frames, move } = setup(
    false,
    true,
  );
  move(1000, 600);
  expect(frames.size).toBe(0);
  expect(scene.dataset.parallax).toBe("off");
  media.matches = false;
  listeners.forEach((callback) => callback());
  move(1000, 600);
  expect(frames.size).toBe(1);
  fireEvent(window, new Event("blur"));
  expect(frames.size).toBe(0);
  move(1000, 600);
  media.matches = true;
  listeners.forEach((callback) => callback());
  expect(frames.size).toBe(0);
  expect(scene.dataset.parallax).toBe("off");
  media.matches = false;
  listeners.forEach((callback) => callback());
  move(1000, 600);
  view.unmount();
  expect(frames.size).toBe(0);
  expect(listeners.size).toBe(0);
  fireEvent(
    hero,
    Object.assign(new Event("pointermove"), { clientX: 1000, clientY: 600 }),
  );
  expect(frames.size).toBe(0);
});
