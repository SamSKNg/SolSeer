import { readFileSync } from "node:fs";
import { mkdir, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_NOTIFICATIONS } from "../shared/notifications.js";
import { compareSignals, isActionable } from "../shared/signals.js";
import { normalizeBiome, validateBiomeTargets } from "../shared/biomes.js";

const eligible = (row) =>
  row?.notificationEligible === true && isActionable(row);
const AUTO_JOIN_COOLDOWN_MS = 60000;

function validate(value) {
  const required = ["enabled", "potential", "cluster"];
  const optional = [
    "autoJoin",
    "autoJoinPotential",
    "autoJoinCluster",
    "autoJoinRecentFull",
    "autoStart",
  ];
  if (
    !value ||
    (value.pollIntervalSeconds !== undefined &&
      (!Number.isInteger(value.pollIntervalSeconds) ||
        value.pollIntervalSeconds < 1 ||
        value.pollIntervalSeconds > 60)) ||
    required.some((key) => typeof value[key] !== "boolean") ||
    optional.some(
      (key) => value[key] !== undefined && typeof value[key] !== "boolean",
    ) ||
    (value.ocrResolution !== undefined &&
      !["1080p", "1440p"].includes(value.ocrResolution))
  )
    throw Object.assign(new Error("Invalid notification preferences."), {
      status: 400,
    });
  let biomeTargets;
  try {
    biomeTargets = validateBiomeTargets(value.biomeTargets ?? []);
  } catch {
    throw Object.assign(new Error("Invalid biome target list."), {
      status: 400,
    });
  }
  return {
    ...Object.fromEntries(
      Object.keys(DEFAULT_NOTIFICATIONS).map((key) => [
        key,
        value[key] ?? DEFAULT_NOTIFICATIONS[key],
      ]),
    ),
    ocrResolution: value.ocrResolution ?? "1440p",
    // Compatibility field for older settings files/clients; never independent.
    autoStart: Boolean(value.autoJoin),
    biomeTargets,
  };
}

const eventFor = (row, snapshot) => ({
  id: row.id,
  alert: row.alert,
  players: row.players,
  capacity: row.capacity,
  lastSeen: row.lastSeen,
  growthPer10s: row.growthPer10s,
  followUpConfirmed: row.followUpConfirmed,
  reason: row.reasons?.[0],
  at: snapshot.now,
});

export class Notifications {
  #preferences = { ...DEFAULT_NOTIFICATIONS };
  #episodes = new Map();
  #pending = [];
  #poll = 0;
  #saving = false;
  #autoJoinCooldownStartedAt = 0;
  #autoJoinCooldownUntil = 0;
  #autoJoinCooldownServerId = null;
  constructor(
    directory,
    { onAutoJoin = () => {}, onPreferencesChanged = () => {} } = {},
  ) {
    this.directory = directory;
    this.path = join(directory, "notifications.json");
    this.onAutoJoin = onAutoJoin;
    this.onPreferencesChanged = onPreferencesChanged;
    try {
      this.#preferences = validate(JSON.parse(readFileSync(this.path, "utf8")));
    } catch {
      /* Missing or invalid settings safely default to disabled. */
    }
  }
  get preferences() {
    return {
      ...this.#preferences,
      biomeTargets: [...this.#preferences.biomeTargets],
    };
  }
  startJoinCooldown(serverId, at = Date.now()) {
    this.#autoJoinCooldownStartedAt = at;
    this.#autoJoinCooldownUntil = at + AUTO_JOIN_COOLDOWN_MS;
    this.#autoJoinCooldownServerId = serverId;
  }
  async save(value) {
    const next = validate(value);
    if (this.#saving)
      throw Object.assign(
        new Error("A notification settings update is in progress."),
        { status: 409 },
      );
    this.#saving = true;
    const temporary = join(this.directory, `notifications-${randomUUID()}.tmp`);
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await writeFile(temporary, JSON.stringify(next), {
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporary, this.path);
      this.#preferences = next;
      this.onPreferencesChanged(this.preferences);
      // Changing preferences never replays already-active signals.
      this.#pending = [];
      return this.preferences;
    } catch {
      throw Object.assign(
        new Error("Could not save notification preferences."),
        { status: 500 },
      );
    } finally {
      this.#saving = false;
      await unlink(temporary).catch(() => {});
    }
  }
  update(snapshot) {
    const completedAutoStart =
      this.#autoJoinCooldownUntil > snapshot.now &&
      snapshot.automation?.lastAutoStartAt >= this.#autoJoinCooldownStartedAt &&
      snapshot.automation?.biomeAt > snapshot.automation?.lastAutoStartAt;
    const confirmedNonTarget =
      snapshot.currentServerId === this.#autoJoinCooldownServerId &&
      snapshot.presence?.serverAt >= this.#autoJoinCooldownStartedAt &&
      snapshot.automation?.biomeAt > snapshot.presence.serverAt &&
      snapshot.automation?.status === "scanning" &&
      !snapshot.automation.playVisible &&
      snapshot.automation?.biome &&
      !this.#preferences.biomeTargets.some(
        (biome) =>
          normalizeBiome(biome) === normalizeBiome(snapshot.automation.biome),
      );
    if (
      this.#autoJoinCooldownUntil <= snapshot.now ||
      completedAutoStart ||
      confirmedNonTarget
    ) {
      this.#autoJoinCooldownStartedAt = 0;
      this.#autoJoinCooldownUntil = 0;
      this.#autoJoinCooldownServerId = null;
    }
    const autoJoinCoolingDown = this.#autoJoinCooldownUntil > snapshot.now;
    // A rare biome remains authoritative until OCR positively recognizes a
    // different biome. An unclear/stale frame is not evidence that it ended.
    const unavailable = [
      "roblox_not_found",
      "unsupported",
      "ocr_unavailable",
      "error",
    ].includes(snapshot.automation?.status);
    const detectedBiome = unavailable
      ? null
      : (snapshot.automation?.biome ?? null);
    const targetBiome = this.#preferences.autoJoin
      ? this.#preferences.biomeTargets.find(
          (biome) => normalizeBiome(biome) === normalizeBiome(detectedBiome),
        )
      : null;
    const poll = snapshot.events[0]?.id ?? 0;
    if (poll !== this.#poll) {
      this.#poll = poll;
      const active = new Set();
      const autoJoinCandidates = [];
      for (const row of snapshot.rows) {
        if (
          !["potential", "cluster"].includes(row.alert) ||
          row.isFresh === false
        )
          continue;
        active.add(row.id);
        const rank = row.alert === "cluster" ? 2 : 1;
        const episode = this.#episodes.get(row.id) ?? {
          rank: 0,
          misses: 0,
          autoJoined: false,
          blockedByTargetBiome: false,
        };
        const actionableUpgrade = rank > episode.rank && eligible(row);
        if (actionableUpgrade) {
          if (this.#preferences.enabled && this.#preferences[row.alert]) {
            // Keep only the newest level for a server waiting to be delivered.
            this.#pending = this.#pending.filter(
              (event) => event.id !== row.id,
            );
            this.#pending.push(eventFor(row, snapshot));
          }
        }
        // This opt-in also considers already-visible retained full bursts,
        // but never an episode we have already attempted or stale samples.
        const recentFull =
          this.#preferences.autoJoinRecentFull &&
          row.signalState === "full" &&
          row.notificationEligible === false &&
          !row.awaitingFreshSample &&
          row.capacity > 0 &&
          row.players >= row.capacity;
        const autoJoinTypeEnabled =
          recentFull ||
          (row.alert === "cluster"
            ? this.#preferences.autoJoinCluster
            : this.#preferences.autoJoinPotential);
        const autoJoinEligible =
          this.#preferences.autoJoin &&
          autoJoinTypeEnabled &&
          row.id !== snapshot.currentServerId &&
          (isActionable(row) || recentFull) &&
          !episode.autoJoined;
        if (autoJoinEligible && targetBiome && actionableUpgrade)
          episode.blockedByTargetBiome = true;
        else if (
          autoJoinEligible &&
          !targetBiome &&
          !autoJoinCoolingDown &&
          (actionableUpgrade || episode.blockedByTargetBiome || recentFull)
        )
          autoJoinCandidates.push({ row, episode });
        this.#episodes.set(row.id, {
          rank: Math.max(rank, episode.rank),
          misses: 0,
          autoJoined: episode.autoJoined,
          blockedByTargetBiome: episode.blockedByTargetBiome,
        });
      }
      for (const [id, episode] of this.#episodes) {
        if (!active.has(id) && ++episode.misses >= 2) this.#episodes.delete(id);
      }

      // A single poll can reveal several signals. Launch only the strongest one
      // so automatic handoff never races Roblox between multiple Job IDs.
      const selected = autoJoinCandidates.sort((a, b) =>
        compareSignals(a.row, b.row),
      )[0];
      if (selected) {
        const cooldownStartedAt = snapshot.now;
        this.startJoinCooldown(selected.row.id, cooldownStartedAt);
        selected.episode.autoJoined = true;
        const stored = this.#episodes.get(selected.row.id);
        if (stored) stored.autoJoined = true;
        Promise.resolve(this.onAutoJoin(eventFor(selected.row, snapshot)))
          .then((launched) => {
            if (
              launched === false &&
              this.#autoJoinCooldownServerId === selected.row.id &&
              this.#autoJoinCooldownStartedAt === cooldownStartedAt
            ) {
              this.#autoJoinCooldownStartedAt = 0;
              this.#autoJoinCooldownUntil = 0;
              this.#autoJoinCooldownServerId = null;
            }
          })
          .catch(() => {});
      }
      // Releasing a target-biome pause is one decision: choose the strongest
      // waiting signal above, then discard the rest so Roblox cannot be
      // switched again on each following poll.
      if (!targetBiome && !autoJoinCoolingDown)
        for (const episode of this.#episodes.values())
          episode.blockedByTargetBiome = false;
    }
    // Revalidate on every heartbeat AND immediately before claim. A held card is
    // not permission to deliver stale or no-longer-actionable advice.
    const current = new Map(snapshot.rows.map((row) => [row.id, row]));
    this.#pending = this.#pending
      .filter((event) => {
        const row = current.get(event.id);
        if (
          !eligible(row) ||
          row.alert !== event.alert ||
          snapshot.now - event.at >= 30000
        )
          return false;
        Object.assign(event, {
          players: row.players,
          capacity: row.capacity,
          lastSeen: row.lastSeen,
          growthPer10s: row.growthPer10s,
          followUpConfirmed: row.followUpConfirmed,
          reason: row.reasons?.[0],
        });
        return true;
      })
      .sort(compareSignals)
      .slice(0, 100);
    return {
      preferences: this.preferences,
      pending: this.#pending.length,
      autoJoinPausedBiome: targetBiome ?? null,
      autoJoinCooldownUntil: autoJoinCoolingDown
        ? this.#autoJoinCooldownUntil
        : null,
      autoJoinCooldownServerId: autoJoinCoolingDown
        ? this.#autoJoinCooldownServerId
        : null,
      currentServerId: snapshot.currentServerId ?? null,
    };
  }
  claim() {
    // Synchronous, process-wide consumption prevents duplicate alerts across browser tabs.
    const events = this.#preferences.enabled ? this.#pending : [];
    this.#pending = [];
    return events.sort(compareSignals);
  }
}
