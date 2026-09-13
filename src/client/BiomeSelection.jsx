import React, { useEffect, useRef } from "react";
import { BIOMES, BIOME_GROUPS } from "../shared/biomes.js";

function GroupToggle({ label, biomes, selected, disabled, onChange }) {
  const input = useRef(null);
  const count = biomes.filter((biome) => selected.includes(biome)).length;
  const all = count === biomes.length;
  useEffect(() => {
    input.current.indeterminate = count > 0 && !all;
  }, [count, all]);
  return (
    <label className="settings-consent biome-bulk-toggle">
      <input
        ref={input}
        type="checkbox"
        checked={all}
        disabled={disabled}
        onChange={() =>
          onChange(
            all
              ? selected.filter((biome) => !biomes.includes(biome))
              : [...new Set([...selected, ...biomes])],
          )
        }
      />
      <span>
        {label}{" "}
        <small aria-hidden="true">
          {count}/{biomes.length}
        </small>
      </span>
    </label>
  );
}

export function BiomeSelection({
  legend,
  selected,
  onChange,
  disabled,
  children,
}) {
  return (
    <fieldset className="biome-targets">
      <legend>{legend}</legend>
      {children}
      <GroupToggle
        label="All biomes"
        biomes={BIOMES}
        selected={selected}
        disabled={disabled}
        onChange={onChange}
      />
      {BIOME_GROUPS.map((group) => (
        <fieldset className="biome-target-group" key={group.label}>
          <legend>{group.label}</legend>
          <GroupToggle
            label={`All ${group.label.toLowerCase()}`}
            biomes={group.biomes}
            selected={selected}
            disabled={disabled}
            onChange={onChange}
          />
          <div className="biome-target-grid">
            {group.biomes.map((biome) => (
              <label className="settings-consent" key={biome}>
                <input
                  type="checkbox"
                  checked={selected.includes(biome)}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...new Set([...selected, biome])]
                        : selected.filter((item) => item !== biome),
                    )
                  }
                />
                {biome}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </fieldset>
  );
}
