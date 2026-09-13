import React from "react";
import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AppUpdates } from "../src/client/AppUpdates.jsx";
afterEach(() => { cleanup(); delete window.solseerDesktop; });
test("update prompt allows postponing without installing", async () => {
  const updates = vi.fn(async () => ({ status: "ready", version: "0.5.5", availableVersion: "0.6.0", message: "Update ready" }));
  window.solseerDesktop = { updates, onUpdateStatus: () => () => {} };
  render(<AppUpdates banner />);
  await screen.findByText("Update ready");
  fireEvent.click(screen.getByRole("button", { name: "Later" }));
  expect(screen.queryByRole("button", { name: "Restart to update" })).toBeNull();
  expect(updates.mock.calls).toEqual([["status"]]);
});
test("browser setup explains that updater requires installed app", () => {
  render(<AppUpdates />);
  expect(screen.getByText(/installed Windows app/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Check for updates" })).toBeNull();
});
