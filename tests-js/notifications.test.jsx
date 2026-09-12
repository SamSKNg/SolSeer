import React from "react";
import { test, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  act,
} from "@testing-library/react";
import { NotificationSettings } from "../src/client/NotificationSettings.jsx";
import {
  useNotifications,
  showNotification,
} from "../src/client/useNotifications.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const preferences = {
  enabled: true,
  potential: true,
  cluster: true,
  autoJoin: false,
  autoJoinPotential: true,
  autoJoinCluster: true,
  autoJoinRecentFull: false,
  autoStart: false,
  pollIntervalSeconds: 1,
  ocrResolution: "1440p",
  biomeTargets: [],
};
const events = [
  { id: "candidate-123", alert: "potential", players: 17, capacity: 20 },
];
function mockNotifications(permission = "granted") {
  const shown = [];
  class Notification {
    static permission = permission;
    static requestPermission = vi.fn(async () => {
      Notification.permission = "granted";
      return "granted";
    });
    constructor(title, options) {
      this.title = title;
      this.options = options;
      this.close = vi.fn();
      shown.push(this);
    }
  }
  vi.stubGlobal("Notification", Notification);
  return { Notification, shown };
}
function Harness({ pending = 1, enabled = true, inspect = () => {} }) {
  const error = useNotifications(
    { notifications: { preferences: { ...preferences, enabled }, pending } },
    inspect,
  );
  return <p>{error}</p>;
}

test("permission is requested only by a deliberate settings click; saving preferences never sends a cookie", async () => {
  const { Notification } = mockNotifications("default");
  const fetchMock = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  render(
    <NotificationSettings ready initial={preferences} token="safe-token" />,
  );
  expect(Notification.requestPermission).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Save signal preferences" }).disabled,
  ).toBe(false);
  fireEvent.click(
    screen.getByRole("button", { name: "Allow browser notifications" }),
  );
  await screen.findByText("Browser permission: granted");
  fireEvent.click(screen.getByLabelText("Early leads (+2 within 15.5s)"));
  fireEvent.click(
    screen.getByRole("button", { name: "Save signal preferences" }),
  );
  await screen.findByText(/Signal preferences saved/);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    notifications: { ...preferences, potential: false },
  });
  expect(fetchMock.mock.calls[0][1].headers["X-Solseer-Token"]).toBe(
    "safe-token",
  );
});

test("settings save a custom polling interval", async () => {
  mockNotifications();
  const fetchMock = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  render(<NotificationSettings initial={preferences} token="test" ready />);
  const input = screen.getByRole("spinbutton", {
    name: "Server polling interval (seconds)",
  });
  expect(input.value).toBe("1");
  fireEvent.change(input, { target: { value: "5" } });
  fireEvent.click(
    screen.getByRole("button", { name: "Save signal preferences" }),
  );
  await screen.findByText(/Signal preferences saved/);
  expect(
    JSON.parse(fetchMock.mock.calls[0][1].body).notifications
      .pollIntervalSeconds,
  ).toBe(5);
});

test("settings save independent auto-join choices for early and rapid signals", async () => {
  mockNotifications();
  const fetchMock = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  render(
    <NotificationSettings ready initial={preferences} token="safe-token" />,
  );
  fireEvent.click(screen.getByLabelText("Auto-join early leads"));
  expect(
    screen.getByLabelText("Auto-join recent bursts in full servers").checked,
  ).toBe(false);
  fireEvent.click(
    screen.getByLabelText("Auto-join recent bursts in full servers"),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Save signal preferences" }),
  );
  await screen.findByText(/Signal preferences saved/);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).notifications).toEqual({
    ...preferences,
    autoJoinPotential: false,
    autoJoinCluster: true,
    autoJoinRecentFull: true,
  });
});

test("settings save the calibrated 1080p mode and biome targets", async () => {
  mockNotifications();
  const fetchMock = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  render(
    <NotificationSettings ready initial={preferences} token="safe-token" />,
  );
  fireEvent.click(screen.getByLabelText(/1920 × 1080/));
  fireEvent.click(screen.getByLabelText("Glitched"));
  fireEvent.click(screen.getByLabelText("Dreamspace"));
  fireEvent.click(
    screen.getByRole("button", { name: "Save signal preferences" }),
  );
  await screen.findByText(/Signal preferences saved/);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).notifications).toEqual({
    ...preferences,
    ocrResolution: "1080p",
    biomeTargets: ["Glitched", "Dreamspace"],
  });
});

test.each(["denied", "unsupported"])(
  "%s permission shows guidance and does not claim notifications",
  async (permission) => {
    if (permission === "unsupported") vi.stubGlobal("Notification", undefined);
    else mockNotifications(permission);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <>
        <NotificationSettings ready initial={preferences} token="token" />
        <Harness />
      </>,
    );
    expect(screen.getByText(`Browser permission: ${permission}`)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Test notification" }).disabled,
    ).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

test("test notification is explicitly labeled and requires a click", () => {
  const { shown } = mockNotifications();
  const view = render(
    <NotificationSettings ready initial={preferences} token="token" />,
  );
  expect(shown).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Test notification" }));
  expect(shown[0].title).toContain("Test notification");
  expect(shown[0].options.body).toContain("not a detected cluster");
  view.unmount();
  expect(shown[0].close).toHaveBeenCalled();
});

test("notification delivery claims once in flight, opens details without joining, and cleans up", async () => {
  const { shown } = mockNotifications();
  vi.spyOn(window, "focus").mockImplementation(() => {});
  const inspect = vi.fn();
  let finish;
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ token: "token" }) })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  vi.stubGlobal("fetch", fetchMock);
  const view = render(<Harness inspect={inspect} />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  view.rerender(<Harness inspect={inspect} />);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await act(async () => finish({ ok: true, json: async () => ({ events }) }));
  expect(shown).toHaveLength(1);
  expect(shown[0].title).toContain("Early lead");
  shown[0].onclick();
  expect(inspect).toHaveBeenCalledWith("candidate-123");
  expect(
    fetchMock.mock.calls.some(([url]) => url.startsWith("/api/join/")),
  ).toBe(false);
  view.unmount();
  expect(shown[0].close).toHaveBeenCalled();
});

test("batched detections produce a single grouped notification", () => {
  const { shown } = mockNotifications();
  showNotification(
    [...events, { ...events[0], id: "another", alert: "cluster" }],
    vi.fn(),
  );
  expect(shown).toHaveLength(1);
  expect(shown[0].title).toBe("solseer · 2 new signals");
  expect(shown[0].options.body).toContain("Rapid filling: another");
});

test("disabling while a claim is in flight suppresses its late result", async () => {
  const { shown } = mockNotifications();
  let finish;
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "token" }),
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
  );
  const view = render(<Harness />);
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  view.rerender(<Harness enabled={false} />);
  await act(async () => finish({ ok: true, json: async () => ({ events }) }));
  expect(shown).toHaveLength(0);
});
