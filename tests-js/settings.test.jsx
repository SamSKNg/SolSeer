import React from "react";
import { test, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { Settings } from "../src/client/Settings.jsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const status = {
  hasCookie: true,
  saved: true,
  storagePath: "C:\\test-profile\\solseer\\.env",
  token: "test-token",
};
test("settings require consent, mask input, clear the draft and send only to the local endpoint", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => status })
    .mockResolvedValueOnce({ ok: true, json: async () => status });
  vi.stubGlobal("fetch", fetchMock);
  const view = render(<Settings />);
  await screen.findByText(/Cookie configured/);
  const input = screen.getByLabelText("Roblox security cookie");
  expect(input.type).toBe("password");
  expect(input.value).toBe("");
  fireEvent.change(input, { target: { value: "synthetic-cookie" } });
  const save = screen.getByRole("button", { name: "Replace cookie" });
  expect(save.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: /I understand/ }));
  fireEvent.click(save);
  await screen.findByText(/Saved locally/);
  expect(input.value).toBe("");
  expect(view.container.textContent).not.toContain("synthetic-cookie");
  const [url, options] = fetchMock.mock.calls[1];
  expect(url).toBe("/api/settings");
  expect(options.headers["X-Solseer-Token"]).toBe("test-token");
  expect(JSON.parse(options.body)).toEqual({
    cookie: "synthetic-cookie",
    confirmLocalStorage: true,
  });
});
test("clearing uses anonymous mode and errors never echo response secrets", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => status })
    .mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "SENSITIVE" }),
    });
  vi.stubGlobal("fetch", fetchMock);
  render(<Settings />);
  await screen.findByText(/Cookie configured/);
  fireEvent.click(
    screen.getByRole("button", { name: "Clear / use anonymous" }),
  );
  await screen.findByRole("alert");
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).cookie).toBe("");
  expect(screen.queryByText(/SENSITIVE/)).toBeNull();
});
test("leaving settings aborts the request and discards the cookie draft", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => status })
    .mockImplementationOnce(() => new Promise(() => {}));
  vi.stubGlobal("fetch", fetchMock);
  const view = render(<Settings />);
  await screen.findByText(/Cookie configured/);
  fireEvent.change(screen.getByLabelText("Roblox security cookie"), {
    target: { value: "test-only" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: /I understand/ }));
  fireEvent.click(screen.getByRole("button", { name: "Replace cookie" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  view.unmount();
  expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
});

test.each([
  ["local settings", "Saved on this machine"],
  ["environment", "Loaded from startup environment"],
  ["project .env / anonymous", "Loaded from project .env"],
])(
  "existing cookie status clearly identifies its %s source without filling the input",
  async (source, caption) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ...status, source }),
      })),
    );
    render(<Settings />);
    await screen.findByText("Already set");
    expect(screen.getByText(caption)).toBeTruthy();
    expect(screen.getByText(/Configured does not mean verified/)).toBeTruthy();
    expect(screen.getByText(/No need to paste it again/)).toBeTruthy();
    const field = screen.getByLabelText("Roblox security cookie");
    expect(field.value).toBe("");
    expect(field.placeholder).toBe("Paste a replacement cookie");
    expect(
      screen.getByRole("button", { name: "Replace cookie" }).disabled,
    ).toBe(true);
  },
);

test("cookie and notification panels are siblings in reading order, and clearing updates the status", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => status })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...status,
          hasCookie: false,
          source: "local settings",
        }),
      }),
  );
  render(<Settings />);
  await screen.findByText("Already set");
  const cookiePanel = screen.getByRole("region", { name: "Local settings" });
  const notifications = screen.getByRole("region", {
    name: "Notification settings",
  });
  expect(cookiePanel.parentElement.className).toBe("settings-layout");
  expect(cookiePanel.nextElementSibling).toBe(notifications);
  fireEvent.click(
    screen.getByRole("button", { name: "Clear / use anonymous" }),
  );
  await screen.findByText("No cookie configured");
  expect(screen.queryByText("Already set")).toBeNull();
  expect(screen.getByText(/using anonymous polling/)).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Save on this machine" }),
  ).toBeTruthy();
  expect(screen.getByRole("region", { name: "Notification settings" })).toBe(
    notifications,
  );
});

test("settings load failure does not incorrectly imply there is no cookie", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false })),
  );
  render(<Settings />);
  await screen.findByText("Cookie status unavailable");
  expect(screen.queryByText("No cookie configured")).toBeNull();
  expect(screen.getByLabelText("Roblox security cookie").disabled).toBe(true);
});
