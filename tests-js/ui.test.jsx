import React from "react";
import { test, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
  within,
  waitFor,
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

test("activity reports one-page two-second authenticated polling", () => {
  vi.stubGlobal("EventSource", FakeEventSource);
  const { container } = render(<App />);
  act(() =>
    feed.onmessage({
      data: JSON.stringify({
        now: 1000000,
        nextAt: 1002000,
        lastAt: 1000000,
        rows: [],
        joins: [],
        polls: 20,
        totalRequests: 20,
        budget: 20,
        requestLimit: 40,
        pollIntervalMs: 2000,
        pagesPerPoll: 1,
        tracked: 100,
        totalJoins: 0,
        events: [
          {
            id: 20,
            at: 1000000,
            page: "Top 100",
            requests: 1,
            partial: false,
            count: 100,
            duration: 120,
            error: "Roblox HTTP 429",
          },
        ],
      }),
    }),
  );
  expect(screen.getByText("20/40")).toBeTruthy();
  expect(
    screen.getByText(/2s polling.*up to 1 page\(s\) per cycle/),
  ).toBeTruthy();
  expect(
    screen.getByText("API requests").closest(".metric").textContent,
  ).toContain("20");
  fireEvent.click(screen.getByRole("button", { name: /Poll activity/ }));
  expect(screen.getByText("Latest 100 poll cycles")).toBeTruthy();
  expect(container.querySelectorAll(".timeline .event")).toHaveLength(1);
  expect(screen.getByText("Top 100")).toBeTruthy();
  expect(screen.getByText(/1 API request\(s\)/)).toBeTruthy();
  expect(screen.getByText("Roblox HTTP 429")).toBeTruthy();
});

test("signal view switch shows all ranked cards, preserves identity on updates, and keeps per-server actions", async () => {
  vi.stubGlobal("EventSource", FakeEventSource);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  render(<App />);
  const rows = Array.from({ length: 5 }, (_, i) =>
    sampleRow(i, {
      alert: "potential",
      players: 18 - i,
      growthPer10s: 5 - i,
      joined: i === 1 ? { count: 1, at: 1000000 } : null,
    }),
  );
  sendRows(rows);
  const switcher = screen.getByRole("group", { name: "Signal view" });
  expect(
    within(switcher)
      .getByRole("button", { name: "Carousel" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(
    within(
      screen.getByRole("region", { name: "Cluster candidates" }),
    ).getAllByRole("article"),
  ).toHaveLength(1);
  fireEvent.click(within(switcher).getByRole("button", { name: "Cards" }));
  const list = screen.getByRole("list", {
    name: "Signals sorted by population",
  });
  const cards = () => within(list).getAllByRole("article");
  expect(cards()).toHaveLength(5);
  expect(screen.queryByRole("button", { name: "Next signal" })).toBeNull();
  const firstCard = cards()[0];
  expect(
    within(firstCard)
      .getByRole("button", { name: "Join server" })
      .closest("form")
      .getAttribute("action"),
  ).toBe(`/api/join/${rows[0].id}`);
  expect(
    within(cards()[1])
      .getByRole("button", { name: "Join again" })
      .closest("form")
      .getAttribute("action"),
  ).toBe(`/api/join/${rows[1].id}`);
  await act(async () =>
    fireEvent.click(
      within(cards()[1]).getByRole("button", { name: "Copy server link" }),
    ),
  );
  expect(writeText).toHaveBeenCalledWith(
    `roblox://placeId=15532962292&gameInstanceId=${rows[1].id}`,
  );
  const focusedJoin = within(firstCard).getByRole("button", {
    name: "Join server",
  });
  focusedJoin.focus();
  sendRows(
    [{ ...rows[4], players: 19, growthPer10s: 20 }, ...rows.slice(0, 4)],
    2,
  );
  expect(cards()[1]).toBe(firstCard);
  expect(document.activeElement).toBe(focusedJoin);
  expect(
    within(cards()[0])
      .getByRole("button", { name: "Join server" })
      .closest("form")
      .getAttribute("action"),
  ).toBe(`/api/join/${rows[4].id}`);
  fireEvent.click(within(cards()[0]).getByRole("button", { name: /^Server / }));
  expect(within(screen.getByRole("dialog")).getByText(rows[4].id)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close server details" }));
  fireEvent.click(screen.getByRole("button", { name: /Join history/ }));
  fireEvent.click(screen.getByRole("button", { name: /Server radar/ }));
  expect(
    screen.getByRole("list", { name: "Signals sorted by population" }),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Carousel", exact: true }),
  );
  expect(
    screen.queryByRole("list", { name: "Signals sorted by population" }),
  ).toBeNull();
  expect(screen.getByRole("button", { name: "Next signal" })).toBeTruthy();
});

test("card index handles empty, new and expired signals without changing the selected view", () => {
  vi.stubGlobal("EventSource", FakeEventSource);
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Cards", exact: true }));
  const region = screen.getByRole("region", { name: "Cluster candidates" });
  expect(
    within(region).getByText("Connecting to the server list"),
  ).toBeTruthy();
  sendRows([sampleRow(1, { alert: "potential" })]);
  expect(within(region).getAllByRole("article")).toHaveLength(1);
  sendRows([], 2);
  expect(within(region).queryByRole("article")).toBeNull();
  expect(
    within(region).getByText("Listening for a population jump"),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "Cards", exact: true })
      .getAttribute("aria-pressed"),
  ).toBe("true");
});

test("signal cards sort descending by population, break ties by signal priority, and do not reorder notices", () => {
  vi.stubGlobal("EventSource", FakeEventSource);
  render(<App />);
  const full = sampleRow(1, {
    players: 20,
    alert: "potential",
    signalState: "full",
    notificationEligible: false,
  });
  const early = sampleRow(2, {
    players: 17,
    alert: "potential",
    signalState: "growing",
    notificationEligible: true,
  });
  const held = sampleRow(3, {
    players: 17,
    alert: "potential",
    signalState: "holding",
    notificationEligible: false,
  });
  const rapid = sampleRow(4, {
    players: 13,
    alert: "cluster",
    signalState: "growing",
    notificationEligible: true,
  });
  sendRows([rapid, held, early, full]);
  fireEvent.click(screen.getByRole("button", { name: "Cards", exact: true }));
  const order = () =>
    within(screen.getByRole("list", { name: "Signals sorted by population" }))
      .getAllByRole("article")
      .map((card) => card.querySelector("form").getAttribute("action"));
  expect(order()).toEqual(
    [full, early, held, rapid].map((r) => `/api/join/${r.id}`),
  );
  const notice = screen.getByLabelText("Strong signal notification");
  expect(notice.querySelector("form").getAttribute("action")).toBe(
    `/api/join/${rapid.id}`,
  );
  sendRows([full, early, held, { ...rapid, players: 18 }], 2);
  expect(order()).toEqual(
    [full, rapid, early, held].map((r) => `/api/join/${r.id}`),
  );
});

test("holding bursts stay in the carousel and actionable notice while their gain is retained", () => {
  vi.stubGlobal("EventSource", FakeEventSource);
  render(<App />);
  const held = sampleRow(1, {
    id: "held-burst",
    alert: "potential",
    signalState: "holding",
    notificationEligible: false,
    noticeEligible: true,
    players: 17,
    deltaPoll: 0,
    burstMemory: { gain: 3 },
    burstGainRetained: 3,
    peerGrowth: {
      percentile: 80,
      count: 25,
      slopePer10s: 1,
      durationMs: 12000,
      medianPer10s: 0,
    },
  });
  sendRows([held]);
  const candidates = screen.getByRole("region", { name: "Cluster candidates" });
  expect(within(candidates).getByText("Holding population")).toBeTruthy();
  expect(
    within(candidates).getByText(/Growing faster than 80% of 25/),
  ).toBeTruthy();
  expect(screen.getByLabelText("Early lead notification")).toBeTruthy();
  expect(screen.queryByLabelText("Strong signal notification")).toBeNull();
  fireEvent.click(
    within(candidates).getByRole("button", { name: "Server held-bur" }),
  );
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Peer-window slope")).toBeTruthy();
  expect(within(dialog).getByText("Burst gain retained")).toBeTruthy();
  expect(within(dialog).getByText("3/3")).toBeTruthy();
  sendRows(
    [{ ...held, peerGrowth: { percentile: null, count: 4, minimumPeers: 20 } }],
    2,
  );
  expect(
    within(dialog).getByText(/Insufficient comparison data \(4\/20 peers\)/),
  ).toBeTruthy();
  sendRows([{ ...held, players: 20, signalState: "full" }], 3);
  expect(within(dialog).getByText("Full · recent burst")).toBeTruthy();
  expect(screen.queryByLabelText("Early lead notification")).toBeNull();
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
  expect(marker.getAttribute("title")).toContain("1 recorded join attempt(s)");
  expect(marker.getAttribute("title")).toContain(
    "Arrival in Roblox is not confirmed",
  );
  expect(screen.queryByText("Opened 1×")).toBeNull();
  expect(
    within(
      screen.getByRole("region", { name: "Cluster candidates" }),
    ).getByRole("button", { name: "Join again" }),
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
const sendRows = (
  rows,
  polls = 1,
  notifications = {
    preferences: {
      enabled: false,
      potential: true,
      cluster: true,
      autoJoin: false,
      autoJoinPotential: true,
      autoJoinCluster: true,
      autoStart: false,
      ocrResolution: "1440p",
      biomeTargets: [],
    },
    pending: 0,
  },
  joins = [],
  extra = {},
) =>
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
        totalJoins: joins.length,
        joins,
        events: [],
        notifications,
        ...extra,
      }),
    }),
  );

test("auto-join is toggleable below Signals to watch and saves the shared preference", async () => {
  vi.stubGlobal("EventSource", FakeEventSource);
  const preferences = {
    enabled: false,
    potential: true,
    cluster: true,
    autoJoin: false,
    autoJoinPotential: true,
    autoJoinCluster: true,
    autoStart: false,
    ocrResolution: "1440p",
    biomeTargets: [],
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: "safe-token" }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        notifications: { ...preferences, autoJoin: true },
      }),
    });
  vi.stubGlobal("fetch", fetchMock);
  render(<App />);
  sendRows([], 1, { preferences, pending: 0 });
  const signalHeader = screen
    .getByRole("heading", { name: /Signals to watch/ })
    .closest(".signal-section-header");
  const toggle = within(signalHeader).getByRole("button", {
    name: "Auto-join Off",
  });
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(toggle);
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Auto-join On" })
        .getAttribute("aria-pressed"),
    ).toBe("true"),
  );
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][0]).toBe("/api/settings");
  expect(fetchMock.mock.calls[1][1].headers["X-Solseer-Token"]).toBe(
    "safe-token",
  );
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
    notifications: { ...preferences, autoJoin: true },
  });
});

test("Auto-Start requires the fullscreen warning and saves beside auto-join", async () => {
  vi.stubGlobal("EventSource", FakeEventSource);
  const confirm = vi.fn(() => true);
  vi.stubGlobal("confirm", confirm);
  const preferences = {
    enabled: false,
    potential: true,
    cluster: true,
    autoJoin: false,
    autoJoinPotential: true,
    autoJoinCluster: true,
    autoStart: false,
    ocrResolution: "1440p",
    biomeTargets: ["Glitched"],
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: "safe-token", notifications: preferences }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        notifications: { ...preferences, autoStart: true },
      }),
    });
  vi.stubGlobal("fetch", fetchMock);
  render(<App />);
  sendRows([], 1, { preferences, pending: 0 });
  fireEvent.click(screen.getByRole("button", { name: "Auto-Start Off" }));
  expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/maximized/));
  await screen.findByRole("button", { name: "Auto-Start On" });
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
    notifications: { ...preferences, autoStart: true },
  });
});

test("the exact current server is marked and cannot be joined again", () => {
  vi.stubGlobal("EventSource", FakeEventSource);
  render(<App />);
  const current = sampleRow(1, {
    alert: "potential",
    isFresh: true,
    notificationEligible: true,
    isCurrentServer: true,
  });
  sendRows([current], 1, undefined, [], {
    currentServerId: current.id,
    presence: { serverId: current.id, username: "Seer" },
    automation: { biome: "Glitched", biomeFresh: false },
  });
  const card = screen.getByRole("region", { name: "Current Roblox server" });
  expect(within(card).getByText("Seer")).toBeTruthy();
  expect(within(card).getByText("Glitched")).toBeTruthy();
  expect(within(card).getByText(/last detected biome/)).toBeTruthy();
  expect(card.style.getPropertyValue("--biome-color")).toBe("#e5ffff");
  expect(card.getAttribute("data-biome")).toBe("Glitched");
  expect(screen.getAllByText(/You are here/).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "Current server" }).disabled).toBe(
    true,
  );
});

test("join history displays the biome captured by OCR", () => {
  vi.stubGlobal("EventSource", FakeEventSource);
  const join = {
    id: 7,
    jobId: "candidate-123",
    at: 1000000,
    players: 17,
    capacity: 20,
    alert: "cluster",
    signalState: "growing",
    growthPer10s: 6,
    biome: "Glitched",
    biomeConfidence: 0.94,
    biomeSource: "windows_ocr",
  };
  render(<App />);
  sendRows([], 1, undefined, [join]);
  fireEvent.click(screen.getByRole("button", { name: /Join history/ }));
  const biome = screen.getByText("Glitched");
  expect(biome.className).toContain("detected");
  expect(biome.title).toContain("94% match");
});

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

test("carousel Join follows the displayed server after navigation and live reordering", () => {
  vi.stubGlobal("EventSource", FakeEventSource);
  render(<App />);
  const first = sampleRow(1, {
    id: "11111111-1111-4111-8111-111111111111",
    alert: "potential",
    players: 16,
    growthPer10s: 4,
  });
  const second = sampleRow(2, {
    id: "22222222-2222-4222-8222-222222222222",
    alert: "potential",
    growthPer10s: 2,
  });
  sendRows([first, second]);
  const joinForm = () =>
    within(screen.getByRole("region", { name: "Cluster candidates" }))
      .getByRole("button", { name: "Join server" })
      .closest("form");
  expect(joinForm().getAttribute("action")).toBe(`/api/join/${first.id}`);
  fireEvent.click(screen.getByRole("button", { name: "Next signal" }));
  expect(joinForm().getAttribute("action")).toBe(`/api/join/${second.id}`);
  sendRows([{ ...second, players: 18, growthPer10s: 10 }, first], 2);
  expect(joinForm().getAttribute("action")).toBe(`/api/join/${second.id}`);
  fireEvent.click(screen.getByRole("button", { name: "Next signal" }));
  expect(joinForm().getAttribute("action")).toBe(`/api/join/${first.id}`);
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
  expect(within(dialog).getByText("Gain within 15.5 seconds")).toBeTruthy();
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
  expect(screen.queryByText("Falling off · stale")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Explore top 20" }));
  expect(screen.getByText("Falling off · stale")).toBeTruthy();
});

test("population-first carousel leaves fresh actionable notification priority unchanged", () => {
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
  ).toBe("/api/join/server-002");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss early lead" }));
  sendRows([full, stale, early], 2);
  expect(screen.queryByLabelText("Early lead notification")).toBeNull();
  sendRows([full, stale, { ...early, alert: "cluster" }], 3);
  expect(screen.getByLabelText("Strong signal notification")).toBeTruthy();
});
