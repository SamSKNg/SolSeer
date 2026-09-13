import React from "react";
import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DiscordSettings } from "../src/client/DiscordSettings.jsx";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test("Discord form masks webhook drafts, saves separate biome choices and keeps existing secrets", async () => {
  const initial = {
    presenceEnabled: false,
    applicationId: "123456789012345678",
    webhookEnabled: false,
    hasWebhook: true,
    biomes: [],
  };
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ discord: initial }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  render(<DiscordSettings initial={initial} token="test-token" />);
  const input = screen.getByLabelText("Discord webhook URL");
  expect(input.type).toBe("password");
  expect(input.value).toBe("");
  expect(screen.getByText(/Webhook configured/)).toBeTruthy();
  expect(screen.queryByText("Remove saved webhook")).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "Singularity" }));
  fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
  await screen.findByText("Discord preferences saved.");
  const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(payload.discord.biomes).toEqual(["Singularity"]);
  expect(payload.discord.webhookUrl).toBeUndefined();
  expect(payload.notifications).toBeUndefined();
  expect(fetchMock.mock.calls[0][1].headers["X-Solseer-Token"]).toBe(
    "test-token",
  );
  fireEvent.change(input, { target: { value: "https://discord.com/api/webhooks/123456789012345678/replacement" } });
  fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
  await screen.findByText("Discord preferences saved.");
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).discord.webhookUrl).toBe("https://discord.com/api/webhooks/123456789012345678/replacement");
  expect(input.value).toBe("");
});
