import React from "react";
import { test, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
  within,
} from "@testing-library/react";
import { App } from "../src/client/App.jsx";

let feed;
class FakeEventSource {
  constructor() {
    feed = this;
  }
  close() {}
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("site branding is solseer text without a logo", () => {
  vi.stubGlobal("EventSource", FakeEventSource);
  render(<App />);
  const brand = screen.getByRole("link", { name: "solseer home" });
  expect(brand.textContent.trim()).toBe("solseer");
  expect(brand.querySelector("svg, img, .brand-mark, .brand-dot")).toBeNull();
});

test("page entrances restart for navigation but not for polling updates", () => {
  vi.stubGlobal("EventSource", FakeEventSource);
  const { container } = render(<App />);
  const original = container.querySelector(".content");
  sendRows([]);
  expect(container.querySelector(".content")).toBe(original);
  fireEvent.click(screen.getByRole("button", { name: /Join history/ }));
  const historyPage = container.querySelector(".content");
  expect(historyPage).not.toBe(original);
  expect(historyPage.dataset.page).toBe("history");
  sendRows([]);
  expect(container.querySelector(".content")).toBe(historyPage);
});

test("gallery entry opens the live server window without replacing the inline navigation", () => {
  vi.stubGlobal("EventSource", FakeEventSource);
  render(<App />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
    "In search of the unseen.",
  );
  const windowSection = screen.getByRole("region", {
    name: "Live server window",
  });
  windowSection.scrollIntoView = vi.fn();
  expect(
    screen
      .getByRole("button", { name: "Explore top 20" })
      .getAttribute("aria-expanded"),
  ).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Find a server" }));
  expect(
    screen
      .getByRole("button", { name: "Collapse servers" })
      .getAttribute("aria-expanded"),
  ).toBe("true");
  expect(windowSection.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  const nav = screen.getByRole("navigation", { name: "Primary navigation" });
  expect(nav.parentElement).toBe(
    screen.getByRole("link", { name: "solseer home" }).parentElement,
  );
  expect(screen.getAllByLabelText("Next poll countdown")).toHaveLength(1);
});

test("countdown ticks locally between SSE messages and resyncs on quota waits and reconnects", () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  vi.stubGlobal("EventSource", FakeEventSource);
  const view = render(<App />);
  const payload = {
    rows: [],
    joins: [],
    events: [],
    budget: 0,
    polls: 1,
    tracked: 0,
    totalJoins: 0,
    now: 1000000,
    nextAt: 1005000,
    busy: false,
  };
  const send = (update) =>
    act(() =>
      feed.onmessage({ data: JSON.stringify({ ...payload, ...update }) }),
    );
  const countdown = () =>
    screen.getByLabelText("Next poll countdown").textContent;
  send({});
  expect(countdown()).toBe("5s");
  act(() => vi.advanceTimersByTime(2000));
  expect(countdown()).toBe("3s");
  act(() => vi.advanceTimersByTime(5000));
  expect(countdown()).toBe("0s");
  send({ now: 1007000, nextAt: 1027000 });
  expect(countdown()).toBe("20s");
  act(() => vi.advanceTimersByTime(1000));
  expect(countdown()).toBe("19s");
  send({ busy: true });
  expect(countdown()).toBe("Requesting…");
  act(() => feed.onerror());
  expect(countdown()).toBe("—");
  send({ now: 1010000, nextAt: 1015000 });
  expect(countdown()).toBe("5s");
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
test("live feed drives candidates, detail chart, filters, joins, history and reconnect state", () => {
  vi.stubGlobal("EventSource", FakeEventSource);
  render(<App />);
  const now = 1000000;
  const row = {
    id: "candidate-123",
    players: 17,
    capacity: 20,
    alert: "potential",
    growthPer10s: 2,
    deltaPoll: 2,
    deltaTwo: 3,
    growth15s: 2,
    nearFullDurationMs: 0,
    reasons: ["+2 net players in 10s"],
    ping: 60,
    history: [
      { at: now - 20000, players: 15 },
      { at: now, players: 17 },
    ],
    lastSeen: now,
    firstSeen: now - 20000,
    peak: 17,
    streak: 1,
    joined: null,
  };
  const payload = {
    now,
    nextAt: now + 5000,
    lastAt: now,
    status: "Live",
    polls: 2,
    budget: 2,
    requestLimit: 12,
    pollIntervalMs: 5000,
    tracked: 1,
    totalJoins: 0,
    rows: [row],
    events: [],
    joins: [],
  };
  act(() => feed.onmessage({ data: JSON.stringify(payload) }));
  expect(screen.queryByText("Previously joined")).toBeNull();
  expect(screen.getByText("Live connection")).toBeTruthy();
  expect(screen.getByText("Current session only")).toBeTruthy();
  expect(screen.queryByText("Priority follow-up queued")).toBeNull();
  expect(screen.getByText("2/12")).toBeTruthy();
  expect(screen.getAllByText("+2 net players in 10s").length).toBeGreaterThan(
    0,
  );
  fireEvent.click(screen.getByRole("button", { name: "Explore top 20" }));
  expect(screen.getByLabelText("Minimum players").value).toBe("13");
  expect(screen.getAllByText("Early lead").length).toBeGreaterThan(0);
  const join = screen
    .getByRole("button", { name: "Join server" })
    .closest("form");
  expect(join.getAttribute("method")).toBe("POST");
  expect(join.getAttribute("action")).toBe("/api/join/candidate-123");
  fireEvent.click(screen.getByRole("button", { name: "Server candidat" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getByText("Follow the signal.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close server details" }));
  fireEvent.change(screen.getByLabelText("Search Job ID"), {
    target: { value: "missing" },
  });
  expect(screen.getByText("No servers match these filters.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Search Job ID"), {
    target: { value: "" },
  });
  act(() =>
    feed.onmessage({
      data: JSON.stringify({
        ...payload,
        totalJoins: 1,
        rows: [{ ...row, joined: { count: 1, at: now } }],
        joins: [
          {
            id: 1,
            jobId: row.id,
            at: now,
            players: 17,
            capacity: 20,
            alert: "potential",
            growthPer10s: 2,
          },
        ],
      }),
    }),
  );
  const marker = screen.getByText("Previously joined");
  expect(marker.getAttribute("title")).toContain("1 recorded Join click(s)");
  expect(marker.getAttribute("title")).toContain(
    "Arrival in Roblox is not confirmed",
  );
  expect(screen.queryByText("Opened 1×")).toBeNull();
  expect(
    within(
      screen.getByRole("region", { name: "Cluster candidates" }),
    ).getByRole("button", { name: "Rejoin" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Hide joined"));
  expect(screen.getByText("No servers match these filters.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Join history/ }));
  expect(screen.getByText("Opened servers")).toBeTruthy();
  expect(screen.getByText("candidate-123")).toBeTruthy();
  act(() => feed.onerror());
  expect(screen.getByText("Reconnecting…")).toBeTruthy();
});

const sampleRow = (index, overrides = {}) => ({
  id: `server-${String(index).padStart(3, "0")}`,
  players: 13 + (index % 8),
  capacity: 20,
  alert: "watch",
  growthPer10s: index,
  deltaPoll: 0,
  growth15s: 0,
  history: [{ at: 1000000, players: 15 }],
  lastSeen: 1000000,
  firstSeen: 990000,
  peak: 20,
  streak: 0,
  joined: null,
  ...overrides,
});
const sendRows = (rows, polls = 1) =>
  act(() =>
    feed.onmessage({
      data: JSON.stringify({
        rows,
        now: 1000000,
        nextAt: 1005000,
        lastAt: 1000000,
        polls,
        budget: 1,
        tracked: rows.length,
        totalJoins: 0,
        joins: [],
        events: [],
      }),
    }),
  );

test("signal and detail share buttons copy a server link without marking it joined", async () => {
  vi.stubGlobal("EventSource", FakeEventSource);
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  render(<App />);
  sendRows([sampleRow(1, { alert: "potential" })]);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Copy server link" })),
  );
  expect(writeText).toHaveBeenCalledWith(
    expect.stringContaining("gameInstanceId=server-001"),
  );
  expect(screen.queryByText("Previously joined")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Server server-0" }));
  const dialog = screen.getByRole("dialog");
  await act(async () =>
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Copy server link" }),
    ),
  );
  expect(writeText).toHaveBeenCalledTimes(2);
  expect(
    within(dialog)
      .getByRole("button", { name: "Join server" })
      .closest("form")
      .getAttribute("action"),
  ).toBe("/api/join/server-001");
});

test("server window is collapsed initially, caps at 20 or 10, and stays population-sorted on every update", () => {
  vi.stubGlobal("EventSource", FakeEventSource);
  render(<App />);
  const rows = Array.from({ length: 35 }, (_, index) => sampleRow(index));
  sendRows(rows);
  expect(screen.queryByRole("table")).toBeNull();
  const toggle = screen.getByRole("button", { name: "Explore top 20" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(toggle);
  const tableRows = () =>
    within(screen.getByRole("table")).getAllByRole("row").slice(1);
  expect(tableRows()).toHaveLength(20);
  expect(
    within(tableRows()[0]).getByRole("button", { name: /server-0/ })
      .textContent,
  ).toContain("server-0");
  const counts = tableRows().map((row) =>
    Number(row.querySelector(".population").textContent.split("/")[0]),
  );
  expect(counts).toEqual([...counts].sort((a, b) => b - a));
  fireEvent.change(screen.getByLabelText("Visible server limit"), {
    target: { value: "10" },
  });
  expect(tableRows()).toHaveLength(10);
  sendRows(
    rows.map((row, index) => (index === 0 ? { ...row, players: 25 } : row)),
    2,
  );
  expect(tableRows()[0].querySelector(".population").textContent).toBe("25/20");
  expect(tableRows()).toHaveLength(10);
  fireEvent.click(screen.getByRole("button", { name: "Collapse servers" }));
  expect(screen.queryByRole("table")).toBeNull();
  sendRows(rows, 3);
  fireEvent.click(screen.getByRole("button", { name: "Explore top 10" }));
  expect(tableRows()).toHaveLength(10);
});

test("strong signals outside top 20 surface separately, dismiss for their episode, and reappear after requalification", () => {
  vi.stubGlobal("EventSource", FakeEventSource);
  render(<App />);
  const rows = Array.from({ length: 25 }, (_, index) =>
    sampleRow(index, { players: 20 }),
  );
  const strong = sampleRow(99, {
    id: "outside-strong",
    players: 15,
    alert: "cluster",
    deltaPoll: 4,
    reasons: ["+4 players in one observation"],
  });
  sendRows([...rows, strong]);
  fireEvent.click(screen.getByRole("button", { name: "Explore top 20" }));
  expect(within(screen.getByRole("table")).queryByText("outside-")).toBeNull();
  expect(screen.getByLabelText("Strong signal notification")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Inspect signal" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("outside-strong")).toBeTruthy();
  const close = screen.getByRole("button", { name: "Close server details" });
  expect(document.activeElement).toBe(close);
  fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(
    within(dialog).getByRole("button", { name: "Join server" }),
  );
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.body.style.overflow).not.toBe("hidden");
  fireEvent.click(
    screen.getByRole("button", { name: "Dismiss strong signal" }),
  );
  expect(screen.queryByLabelText("Strong signal notification")).toBeNull();
  sendRows([...rows, strong], 2);
  expect(screen.queryByLabelText("Strong signal notification")).toBeNull();
  sendRows([...rows, { ...strong, alert: "potential" }], 3);
  sendRows([...rows, strong], 4);
  expect(screen.queryByLabelText("Strong signal notification")).toBeNull();
  sendRows(rows, 5);
  expect(screen.queryByLabelText("Strong signal notification")).toBeNull();
  sendRows([...rows, strong], 6);
  expect(screen.getByLabelText("Strong signal notification")).toBeTruthy();
});

test("all signal candidates remain reachable and motion is optional without persistent storage", () => {
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const { container } = render(<App />);
  expect(container.querySelector(".motion-paused")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Resume reflections" }));
  expect(container.querySelector(".motion-paused")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Pause reflections" }));
  expect(container.querySelector(".motion-paused")).toBeTruthy();
  sendRows(
    Array.from({ length: 7 }, (_, index) =>
      sampleRow(index, { alert: "potential" }),
    ),
  );
  const candidates = screen.getByRole("region", { name: "Cluster candidates" });
  expect(within(candidates).getAllByRole("article")).toHaveLength(1);
  const seen = new Set();
  for (let index = 0; index < 7; index++) {
    seen.add(within(candidates).getByRole("article").textContent);
    fireEvent.click(screen.getByRole("button", { name: "Next signal" }));
  }
  expect(seen.size).toBe(7);
  expect(within(candidates).getAllByRole("article")).toHaveLength(1);
});

test("an early lead surfaces immediately outside the carousel, and disappears from the notice when full or stale", () => {
  vi.stubGlobal("EventSource", FakeEventSource);
  render(<App />);
  const early = sampleRow(1, {
    players: 13,
    alert: "potential",
    notificationEligible: true,
    isFresh: true,
    growth15s: 2,
    growthPer10s: 4,
    reasons: ["+2 net players in 5s"],
  });
  sendRows([early]);
  const notice = screen.getByLabelText("Early lead notification");
  expect(within(notice).getByText(/7 open slots/)).toBeTruthy();
  expect(within(notice).getByText("+2 net players in 5s")).toBeTruthy();
  fireEvent.click(
    within(notice).getByRole("button", { name: "Inspect signal" }),
  );
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Gain within 15 seconds")).toBeTruthy();
  expect(within(dialog).getByText("Observed growth pace")).toBeTruthy();
  expect(within(dialog).queryByText("Signal score")).toBeNull();
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Close server details" }),
  );
  sendRows([{ ...early, players: 20, notificationEligible: false }], 2);
  expect(screen.queryByLabelText("Early lead notification")).toBeNull();
  expect(screen.getByText("Full · recent filling")).toBeTruthy();
  sendRows([{ ...early, isFresh: false, notificationEligible: false }], 3);
  expect(screen.queryByLabelText("Early lead notification")).toBeNull();
  expect(screen.getByText("Stale observation")).toBeTruthy();
});

test("fresh open-slot leads rank ahead of full and stale cards, while rapid filling upgrades the notice", () => {
  vi.stubGlobal("EventSource", FakeEventSource);
  render(<App />);
  const early = sampleRow(1, {
    alert: "potential",
    players: 17,
    isFresh: true,
    notificationEligible: true,
  });
  const full = sampleRow(2, {
    alert: "cluster",
    players: 20,
    isFresh: true,
    notificationEligible: false,
  });
  const stale = sampleRow(3, {
    alert: "cluster",
    players: 17,
    isFresh: false,
    notificationEligible: false,
  });
  sendRows([full, stale, early]);
  const carousel = screen.getByRole("region", { name: "Cluster candidates" });
  expect(
    within(carousel)
      .getByRole("article")
      .querySelector("form")
      .getAttribute("action"),
  ).toBe("/api/join/server-001");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss early lead" }));
  sendRows([full, stale, early], 2);
  expect(screen.queryByLabelText("Early lead notification")).toBeNull();
  sendRows([full, stale, { ...early, alert: "cluster" }], 3);
  expect(screen.getByLabelText("Strong signal notification")).toBeTruthy();
});
