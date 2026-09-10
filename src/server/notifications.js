import { readFileSync } from "node:fs";
import { mkdir, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_NOTIFICATIONS } from "../shared/notifications.js";
import { compareSignals, isActionable } from "../shared/signals.js";

const eligible = (row) =>
  row?.notificationEligible === true && isActionable(row);

function validate(value) {
  const required = ["enabled", "potential", "cluster"];
  const optional = ["autoJoin", "autoJoinPotential", "autoJoinCluster"];
  if (
    !value ||
    required.some((key) => typeof value[key] !== "boolean") ||
    optional.some(
      (key) => value[key] !== undefined && typeof value[key] !== "boolean",
    )
  )
    throw Object.assign(new Error("Invalid notification preferences."), {
      status: 400,
    });
  return Object.fromEntries(
    Object.keys(DEFAULT_NOTIFICATIONS).map((key) => [
      key,
      value[key] ?? DEFAULT_NOTIFICATIONS[key],
    ]),
  );
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
  constructor(directory, { onAutoJoin = () => {} } = {}) {
    this.directory = directory;
    this.path = join(directory, "notifications.json");
    this.onAutoJoin = onAutoJoin;
    try {
      this.#preferences = validate(JSON.parse(readFileSync(this.path, "utf8")));
    } catch {
      /* Missing or invalid settings safely default to disabled. */
    }
  }
  get preferences() {
    return { ...this.#preferences };
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
        };
        if (rank > episode.rank && eligible(row)) {
          if (this.#preferences.enabled && this.#preferences[row.alert]) {
            // Keep only the newest level for a server waiting to be delivered.
            this.#pending = this.#pending.filter(
              (event) => event.id !== row.id,
            );
            this.#pending.push(eventFor(row, snapshot));
          }
          const autoJoinTypeEnabled =
            row.alert === "cluster"
              ? this.#preferences.autoJoinCluster
              : this.#preferences.autoJoinPotential;
          if (
            this.#preferences.autoJoin &&
            autoJoinTypeEnabled &&
            !episode.autoJoined
          )
            autoJoinCandidates.push({ row, episode });
        }
        this.#episodes.set(row.id, {
          rank: Math.max(rank, episode.rank),
          misses: 0,
          autoJoined: episode.autoJoined,
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
        selected.episode.autoJoined = true;
        const stored = this.#episodes.get(selected.row.id);
        if (stored) stored.autoJoined = true;
        Promise.resolve(
          this.onAutoJoin(eventFor(selected.row, snapshot)),
        ).catch(() => {});
      }
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
    return { preferences: this.preferences, pending: this.#pending.length };
  }
  claim() {
    // Synchronous, process-wide consumption prevents duplicate alerts across browser tabs.
    const events = this.#preferences.enabled ? this.#pending : [];
    this.#pending = [];
    return events.sort(compareSignals);
  }
}
