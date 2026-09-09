import React from "react";
import { test, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
} from "@testing-library/react";
import { CopyServerLink } from "../src/client/CopyServerLink.jsx";
import { joinUrl, PLACE_ID } from "../src/shared/roblox-links.js";
import { joinUrl as trackerJoinUrl } from "../src/server/tracker.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("copying shares the same direct Roblox app URI as joining without a network request or POST", async () => {
  vi.useFakeTimers();
  const writeText = vi.fn().mockResolvedValue(undefined);
  const fetch = vi.fn();
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  vi.stubGlobal("fetch", fetch);
  const { unmount } = render(<CopyServerLink id="server/a?b&c" />);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Copy server link" })),
  );
  const expected = joinUrl("server/a?b&c");
  expect(expected).toBe(trackerJoinUrl("server/a?b&c"));
  expect(writeText).toHaveBeenCalledWith(expected);
  expect(expected.startsWith("roblox://placeId=")).toBe(true);
  const params = new URLSearchParams(expected.slice("roblox://".length));
  expect(params.get("placeId")).toBe(String(PLACE_ID));
  expect(params.get("gameInstanceId")).toBe("server/a?b&c");
  expect([...params.keys()]).toEqual(["placeId", "gameInstanceId"]);
  expect(expected).not.toContain("games/start");
  expect(screen.getByText("Copied")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("Server link copied");
  expect(fetch).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Copy server link" }).closest("form"),
  ).toBeNull();
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.queryByText("Copied")).toBeNull();
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

test.each(["missing", "rejected"])(
  "%s clipboard access exposes a selectable link instead of claiming success",
  async (mode) => {
    vi.stubGlobal(
      "navigator",
      mode === "missing"
        ? {}
        : {
            clipboard: {
              writeText: vi.fn().mockRejectedValue(new Error("denied")),
            },
          },
    );
    render(<CopyServerLink id="candidate-123" />);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Copy server link" })),
    );
    expect(screen.queryByText("Copied")).toBeNull();
    const input = screen.getByRole("textbox", { name: "Server link to copy" });
    expect(input.value).toBe(joinUrl("candidate-123"));
    expect(input.readOnly).toBe(true);
    fireEvent.focus(input);
    expect(input.selectionEnd).toBe(input.value.length);
  },
);

test("changing servers resets feedback and ignores pending clipboard completion for the previous card", async () => {
  let resolve;
  const writeText = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const view = render(<CopyServerLink id="first" />);
  fireEvent.click(screen.getByRole("button", { name: "Copy server link" }));
  expect(
    screen.getByRole("button", { name: "Copy server link" }).disabled,
  ).toBe(true);
  view.rerender(<CopyServerLink id="second" />);
  await act(async () => resolve());
  expect(screen.queryByText("Copied")).toBeNull();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Copy server link" })),
  );
  expect(writeText).toHaveBeenLastCalledWith(joinUrl("second"));
});
