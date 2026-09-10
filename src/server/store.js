// One store per backend session. No filesystem, SQLite, or browser storage.
import { AUTHENTICATED_POLLING } from "./polling-config.js";
import { randomUUID } from "node:crypto";

export const BIOME_OUTCOMES = Object.freeze(["rare", "not_rare"]);

const observations = (row) =>
  (row.history ?? []).slice(-120).map(({ at, players, capacity, poll }) => ({
    at,
    players,
    capacity: capacity ?? row.capacity ?? null,
    poll: poll ?? null,
  }));

const signalEvidence = (row) => ({
  deltaPoll: row.deltaPoll ?? null,
  growth15s: row.growth15s ?? null,
  growth10s: row.growth10s ?? null,
  growthWindowMs: row.growthWindowMs ?? null,
  growthPer10s: row.growthPer10s ?? null,
  followUpConfirmed: row.followUpConfirmed ?? false,
  burstGainRetained: row.burstGainRetained ?? null,
  burstGain: row.burstMemory?.gain ?? null,
  openSlots: row.openSlots ?? null,
  peerGrowth: row.peerGrowth ?? null,
  reasons: Array.isArray(row.reasons) ? [...row.reasons] : [],
});

export class Store {
  #history = [];
  #joined = new Map();
  #attempts = [];
  #cooldownUntil = 0;
  #nextId = 1;

  join(row, now = Date.now()) {
    const entry = {
      id: this.#nextId++,
      feedbackId: randomUUID(),
      jobId: row.id,
      at: now,
      players: row.players ?? null,
      capacity: row.capacity ?? null,
      alert: row.alert ?? null,
      signalState: row.signalState ?? null,
      growthPer10s: row.growthPer10s ?? null,
      outcome: null,
    };
    Object.defineProperty(entry, "joinObservations", {
      value: observations(row),
    });
    Object.defineProperty(entry, "joinSignal", {
      value: signalEvidence(row),
    });
    this.#history.push(entry);
    this.#history.sort((a, b) => b.at - a.at || b.id - a.id);
    this.#history = this.#history.slice(0, 200);
    const previous = this.#joined.get(row.id);
    this.#joined.set(row.id, {
      count: (previous?.count ?? 0) + 1,
      at: Math.max(previous?.at ?? now, now),
    });
    return { ...entry };
  }
  joins() {
    return this.#history.map((row) => ({ ...row }));
  }
  summary() {
    return Object.fromEntries(
      [...this.#joined].map(([id, value]) => [id, { ...value }]),
    );
  }
  feedbackExample(id, outcome, current, now = Date.now()) {
    if (outcome !== null && !BIOME_OUTCOMES.includes(outcome))
      throw Object.assign(new Error("Invalid biome outcome."), { status: 400 });
    const entry = this.#history.find((row) => row.id === id);
    if (!entry)
      throw Object.assign(new Error("Join attempt was not found."), {
        status: 404,
      });
    return {
      feedbackId: entry.feedbackId,
      outcome,
      labeledAt: now,
      join: {
        jobId: entry.jobId,
        at: entry.at,
        players: entry.players,
        capacity: entry.capacity,
        alert: entry.alert,
        signalState: entry.signalState,
        growthPer10s: entry.growthPer10s,
      },
      signal: entry.joinSignal,
      observations: current ? observations(current) : entry.joinObservations,
    };
  }
  setJoinOutcome(id, outcome) {
    const entry = this.#history.find((row) => row.id === id);
    if (!entry)
      throw Object.assign(new Error("Join attempt was not found."), {
        status: 404,
      });
    entry.outcome = outcome;
    return { ...entry };
  }
  requests(now) {
    this.#attempts = this.#attempts.filter((at) => at > now - 60000);
    return [...this.#attempts];
  }
  reserve(now, limit = 3) {
    const wait = this.availableIn(now, limit);
    // Synchronous reservation is atomic within this single Node process.
    if (!wait) {
      this.#attempts.push(now);
      this.#attempts.sort((a, b) => a - b);
    }
    return wait;
  }
  availableIn(now, limit = 3) {
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > AUTHENTICATED_POLLING.requestLimit
    )
      throw new Error("Invalid request budget");
    const sent = this.requests(now);
    return Math.max(
      0,
      this.#cooldownUntil - now,
      sent.length >= limit ? sent[sent.length - limit] + 60250 - now : 0,
    );
  }
  cooldown(until) {
    this.#cooldownUntil = Math.max(this.#cooldownUntil, until);
  }
  close() {
    this.#history = [];
    this.#joined.clear();
    this.#attempts = [];
    this.#cooldownUntil = 0;
    this.#nextId = 1;
  }
}
