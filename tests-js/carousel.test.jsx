import React from "react";
import { test, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
} from "@testing-library/react";
import { SignalCarousel } from "../src/client/SignalCarousel.jsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
const props = {
  items: rows,
  renderCard: (row) => (
    <article data-testid="card">
      {row.id}
      <button>Inspect</button>
    </article>
  ),
  empty: <p>No signals yet</p>,
};
const tick = (ms) => act(() => vi.advanceTimersByTime(ms));
const current = () => screen.getByTestId("card").textContent;
function setup(extra = {}) {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  return render(<SignalCarousel {...props} {...extra} />);
}

test("advances every eight seconds, wraps, and heartbeats/rank changes preserve active identity and timer", () => {
  const view = setup();
  expect(current()).toBe("aInspect");
  tick(7000);
  view.rerender(
    <SignalCarousel
      {...props}
      items={[{ id: "c" }, { id: "a" }, { id: "b" }]}
    />,
  );
  expect(current()).toBe("aInspect");
  tick(1000);
  expect(current()).toBe("bInspect");
  tick(8000);
  expect(current()).toBe("cInspect");
  expect(screen.getAllByRole("article")).toHaveLength(1);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

test("clicking anywhere pauses for ten seconds, every later interaction restarts that window", () => {
  setup();
  tick(7000);
  fireEvent.click(document.body);
  tick(9000);
  expect(current()).toBe("aInspect");
  fireEvent.click(document.body);
  tick(9750);
  expect(current()).toBe("aInspect");
  tick(250);
  expect(current()).toBe("bInspect");
  tick(8000);
  expect(current()).toBe("cInspect");
});

test("manual next, previous and previews animate while the ten-second autoplay pause remains active", () => {
  const view = setup();
  const slide = () => view.container.querySelector(".carousel-slide");
  const initial = slide();
  fireEvent.click(document.body);
  expect(slide()).toBe(initial);
  expect(slide().classList.contains("still")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Next signal" }));
  expect(current()).toBe("bInspect");
  expect(slide()).not.toBe(initial);
  expect(slide().classList.contains("next")).toBe(true);
  expect(slide().classList.contains("still")).toBe(false);
  const nextSlide = slide();
  view.rerender(
    <SignalCarousel {...props} items={rows.map((row) => ({ ...row }))} />,
  );
  expect(slide()).toBe(nextSlide);
  tick(9750);
  expect(current()).toBe("bInspect");
  fireEvent.click(screen.getByRole("button", { name: "Previous signal" }));
  expect(slide().classList.contains("previous")).toBe(true);
  expect(slide().classList.contains("still")).toBe(false);
  fireEvent.click(
    screen.getByRole("button", { name: "Pause signal rotation" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "View next signal: server b" }),
  );
  expect(current()).toBe("bInspect");
  expect(slide().classList.contains("still")).toBe(false);
  tick(20000);
  expect(current()).toBe("bInspect");
  view.rerender(<SignalCarousel {...props} motionPaused />);
  fireEvent.click(screen.getByRole("button", { name: "Next signal" }));
  expect(current()).toBe("cInspect");
  expect(slide().classList.contains("still")).toBe(true);
  expect(
    view.container.querySelector(".carousel-viewport.motion-disabled"),
  ).toBeTruthy();
});

test("empty, single and multiple signals reuse the same stage and controls frame", () => {
  const view = setup({ items: [] });
  const stage = view.container.querySelector(".carousel-viewport");
  const controls = view.container.querySelector(".carousel-controls");
  expect(stage.querySelector(".carousel-empty")).toBeTruthy();
  expect(screen.getByText("waiting for a signal")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Pause signal rotation" }).disabled,
  ).toBe(true);
  for (const items of [[rows[0]], rows, [], [rows[1]], []]) {
    view.rerender(<SignalCarousel {...props} items={items} />);
    expect(view.container.querySelector(".carousel-viewport")).toBe(stage);
    expect(view.container.querySelector(".carousel-controls")).toBe(controls);
    expect(Boolean(stage.querySelector(".carousel-empty"))).toBe(
      items.length === 0,
    );
  }
});

test("neighbor previews wrap around, focus the chosen signal and preserve the ten-second interaction pause", () => {
  const view = setup();
  expect(
    screen.getByRole("button", { name: "View previous signal: server c" }),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "View next signal: server b" }),
  );
  expect(current()).toBe("bInspect");
  expect(
    screen.getByRole("button", { name: "View previous signal: server a" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "View next signal: server c" }),
  ).toBeTruthy();
  tick(9750);
  expect(current()).toBe("bInspect");
  tick(250);
  expect(current()).toBe("cInspect");
  fireEvent.click(
    screen.getByRole("button", { name: "View previous signal: server b" }),
  );
  expect(current()).toBe("bInspect");
  // A live reorder changes neighbors without displacing the active server.
  view.rerender(
    <SignalCarousel
      {...props}
      items={[{ id: "c" }, { id: "b" }, { id: "a" }]}
    />,
  );
  expect(current()).toBe("bInspect");
  expect(
    screen.getByRole("button", { name: "View previous signal: server c" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "View next signal: server a" }),
  ).toBeTruthy();
  expect(screen.getAllByRole("article")).toHaveLength(1);
});

test("two signals preview the same neighbor on both sides; one or zero never produces duplicate previews", () => {
  const view = setup({ items: rows.slice(0, 2) });
  expect(
    screen.getByRole("button", { name: "View previous signal: server b" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "View next signal: server b" }),
  ).toBeTruthy();
  view.rerender(<SignalCarousel {...props} items={[rows[0]]} />);
  expect(
    screen.queryByRole("button", { name: /View (previous|next) signal:/ }),
  ).toBeNull();
  view.rerender(<SignalCarousel {...props} items={[]} />);
  expect(
    screen.queryByRole("button", { name: /View (previous|next) signal:/ }),
  ).toBeNull();
});

test("manual next/previous wrap and restart pause; permanent pause and dialog suspension prevent rotation", () => {
  const view = setup();
  fireEvent.click(screen.getByRole("button", { name: "Previous signal" }));
  expect(current()).toBe("cInspect");
  tick(9750);
  expect(current()).toBe("cInspect");
  tick(250);
  expect(current()).toBe("aInspect");
  fireEvent.click(
    screen.getByRole("button", { name: "Pause signal rotation" }),
  );
  tick(30000);
  expect(current()).toBe("aInspect");
  fireEvent.click(
    screen.getByRole("button", { name: "Resume signal rotation" }),
  );
  tick(10000);
  expect(current()).toBe("bInspect");
  view.rerender(<SignalCarousel {...props} suspended />);
  tick(30000);
  expect(current()).toBe("bInspect");
  view.rerender(<SignalCarousel {...props} />);
  tick(8000);
  expect(current()).toBe("cInspect");
});

test("empty/single/removed signals stay valid and all candidates remain manually accessible with reduced motion", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const view = setup();
  tick(40000);
  expect(current()).toBe("aInspect");
  fireEvent.click(screen.getByRole("button", { name: "Next signal" }));
  expect(current()).toBe("bInspect");
  view.rerender(<SignalCarousel {...props} items={[{ id: "c" }]} />);
  expect(current()).toBe("cInspect");
  expect(screen.getByRole("button", { name: "Next signal" }).disabled).toBe(
    true,
  );
  view.rerender(<SignalCarousel {...props} items={[]} />);
  expect(screen.queryByRole("article")).toBeNull();
  expect(screen.getByText("No signals yet")).toBeTruthy();
});

test("keyboard focus, hidden pages and offscreen carousels never rotate out from under the user", () => {
  let observe;
  const disconnect = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback) {
        observe = callback;
      }
      observe() {}
      disconnect() {
        disconnect();
      }
    },
  );
  const view = setup();
  tick(20000);
  expect(current()).toBe("aInspect");
  act(() => observe([{ isIntersecting: true }]));
  tick(8000);
  expect(current()).toBe("bInspect");
  screen.getByRole("button", { name: "Inspect" }).focus();
  tick(20000);
  expect(current()).toBe("bInspect");
  screen.getByRole("button", { name: "Inspect" }).blur();
  tick(250);
  expect(current()).toBe("cInspect");
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  fireEvent(document, new Event("visibilitychange"));
  tick(20000);
  expect(current()).toBe("cInspect");
  vi.restoreAllMocks();
  fireEvent(document, new Event("visibilitychange"));
  tick(8000);
  expect(current()).toBe("aInspect");
  view.unmount();
  expect(disconnect).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
