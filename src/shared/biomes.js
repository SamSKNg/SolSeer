export const BIOMES = Object.freeze([
  "Normal",
  "Windy",
  "Snowy",
  "Rainy",
  "Sandstorm",
  "Hell",
  "Starfall",
  "Heaven",
  "Corruption",
  "Null",
  "Glitched",
  "Dreamspace",
  "Cyberspace",
  "Singularity",
  "Pumpkin Moon",
  "Graveyard",
  "Blazing Sun",
  "Blood Rain",
  "Aurora",
  "Eggland",
  "Incinerator",
]);

export const BIOME_ALIASES = Object.freeze({
  Sandstorm: ["sand storm"],
});

export const normalizeBiome = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();

export function validateBiomeTargets(value) {
  if (!Array.isArray(value) || value.length > BIOMES.length)
    throw new Error("Invalid biome target list.");
  const allowed = new Map(
    BIOMES.map((biome) => [normalizeBiome(biome), biome]),
  );
  const targets = [];
  for (const item of value) {
    const biome = allowed.get(normalizeBiome(item));
    if (!biome || targets.includes(biome))
      throw new Error("Invalid biome target list.");
    targets.push(biome);
  }
  return targets;
}
