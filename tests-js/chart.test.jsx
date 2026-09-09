import React from "react";
import { test, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { Sparkline } from "../src/client/Sparkline.jsx";

afterEach(cleanup);
const history = (counts) =>
  counts.map((players, i) => ({ players, at: i * 5000 }));
const points = (container) =>
  container
    .querySelector("polyline")
    .getAttribute("points")
    .split(" ")
    .filter(Boolean)
    .map((point) => point.split(",").map(Number));

test("one-player movements use a tighter vertical scale and retain timestamp spacing", () => {
  const { container } = render(
    <Sparkline history={history([19, 20, 19])} large />,
  );
  const plotted = points(container).filter((_, index) => index % 2 === 0);
  expect(Math.abs(plotted[1][1] - plotted[0][1])).toBe(68);
  expect(plotted[0][1]).toBe(plotted[2][1]);
  expect(plotted[1][0] - plotted[0][0]).toBe(plotted[2][0] - plotted[1][0]);
  expect(screen.getByText("18")).toBeTruthy();
  expect(screen.getByText("20")).toBeTruthy();
  expect(container.querySelector("title").textContent).toContain(
    "18–20 players",
  );
});

test("flat, single-point, and empty histories never create spurious spikes or invalid coordinates", () => {
  const view = render(<Sparkline history={history([20, 20, 20])} />);
  expect(new Set(points(view.container).map((point) => point[1])).size).toBe(1);
  view.rerender(<Sparkline history={history([20])} />);
  expect(
    Number.isFinite(
      Number(view.container.querySelector("circle").getAttribute("cy")),
    ),
  ).toBe(true);
  view.rerender(<Sparkline history={[]} />);
  expect(points(view.container)).toEqual([]);
  expect(view.container.innerHTML).not.toMatch(/NaN|Infinity/);
});

test("wide ranges and counts above capacity remain inside the plot without clipping data", () => {
  const { container } = render(
    <Sparkline history={history([0, 13, 20, 25])} capacity={20} />,
  );
  for (const [x, y] of points(container)) {
    expect(x).toBeGreaterThanOrEqual(4);
    expect(x).toBeLessThanOrEqual(126);
    expect(y).toBeGreaterThanOrEqual(4);
    expect(y).toBeLessThanOrEqual(30);
  }
});

test("stagnant readings form time-proportional plateaus before and after a change", () => {
  const samples = [
    { at: 0, players: 15 },
    { at: 5000, players: 15 },
    { at: 15000, players: 17 },
    { at: 20000, players: 17 },
  ];
  const { container } = render(<Sparkline history={samples} />);
  const plotted = points(container);
  expect(plotted).toHaveLength(7);
  expect(plotted.slice(0, 4).every((point) => point[1] === plotted[0][1])).toBe(
    true,
  );
  expect(plotted.slice(4).every((point) => point[1] === plotted[4][1])).toBe(
    true,
  );
  expect(plotted[3][0]).toBe(plotted[4][0]);
  expect(plotted[4][1]).toBeLessThan(plotted[3][1]);
  expect(plotted[3][0] - plotted[1][0]).toBe(
    2 * (plotted[1][0] - plotted[0][0]),
  );
});

test("heartbeat time extends a dashed flat tail without inventing observations", () => {
  const samples = Object.freeze(history([15, 17]).map(Object.freeze));
  const view = render(<Sparkline history={samples} now={10000} />);
  const tail = () => view.container.querySelector('[data-last-known="true"]');
  expect(tail().getAttribute("y1")).toBe(tail().getAttribute("y2"));
  expect(tail().getAttribute("stroke-dasharray")).toBe("3 3");
  const previousStart = Number(tail().getAttribute("x1"));
  view.rerender(<Sparkline history={samples} now={15000} />);
  expect(Number(tail().getAttribute("x1"))).toBeLessThan(previousStart);
  expect(points(view.container)).toHaveLength(3);
  expect(samples).toHaveLength(2);
  view.rerender(<Sparkline history={samples} now={5000} />);
  expect(tail()).toBeNull();
  view.rerender(<Sparkline history={samples} now={0} />);
  expect(tail()).toBeNull();
  view.rerender(<Sparkline history={history([20])} now={5000} />);
  expect(tail().getAttribute("x1")).toBe("4");
  expect(tail().getAttribute("x2")).toBe("126");
  view.rerender(<Sparkline history={[]} now={5000} />);
  expect(tail()).toBeNull();
  expect(view.container.innerHTML).not.toMatch(/NaN|Infinity/);
});
