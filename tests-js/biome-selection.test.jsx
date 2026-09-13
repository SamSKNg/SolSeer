import React, { useState } from "react";
import { test, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { BiomeSelection } from "../src/client/BiomeSelection.jsx";
import { BIOMES, BIOME_GROUPS } from "../src/shared/biomes.js";
afterEach(cleanup);
function Example({ disabled = false }) {
  const [selected, setSelected] = useState([]);
  return (
    <BiomeSelection
      legend="Targets"
      selected={selected}
      onChange={setSelected}
      disabled={disabled}
    />
  );
}
test("bulk toggles select all, clear all, and indicate partial selections", () => {
  render(<Example />);
  const all = screen.getByRole("checkbox", { name: "All biomes" });
  fireEvent.click(screen.getByRole("checkbox", { name: "Normal" }));
  expect(all.indeterminate).toBe(true);
  fireEvent.click(all);
  for (const biome of BIOMES)
    expect(screen.getByRole("checkbox", { name: biome }).checked).toBe(true);
  expect(all.indeterminate).toBe(false);
  fireEvent.click(all);
  for (const biome of BIOMES)
    expect(screen.getByRole("checkbox", { name: biome }).checked).toBe(false);
});
test("category toggles preserve selections outside their group", () => {
  render(<Example />);
  const group = BIOME_GROUPS[1];
  const outside = BIOMES.find((biome) => !group.biomes.includes(biome));
  fireEvent.click(screen.getByRole("checkbox", { name: outside }));
  const toggle = screen.getByRole("checkbox", {
    name: `All ${group.label.toLowerCase()}`,
  });
  fireEvent.click(toggle);
  for (const biome of group.biomes)
    expect(screen.getByRole("checkbox", { name: biome }).checked).toBe(true);
  fireEvent.click(toggle);
  expect(screen.getByRole("checkbox", { name: outside }).checked).toBe(true);
  for (const biome of group.biomes)
    expect(screen.getByRole("checkbox", { name: biome }).checked).toBe(false);
});
test("all selection controls disable while saving", () => {
  render(<Example disabled />);
  for (const input of screen.getAllByRole("checkbox"))
    expect(input.disabled).toBe(true);
});
