// One store per backend session. No filesystem, SQLite, or browser storage.
import { AUTHENTICATED_POLLING } from "./polling-config.js";
import { randomUUID } from "node:crypto";
import { BIOMES } from "../shared/biomes.js";

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
      biome: null,
      biomeConfidence: null,
      biomeDetectedAt: null,
      biomeText: null,
      biomeSource: null,
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
  recordJoinBiome(jobId, reading, observedAfter = 0) {
    if (!BIOMES.includes(reading?.biome)) return null;
    const detectedAt = Number(reading.biomeAt);
    if (!Number.isFinite(detectedAt) || detectedAt < observedAfter) return null;
    const entry = this.#history.find(
      (row) => row.jobId === jobId && row.biome == null && detectedAt >= row.at,
    );
    if (!entry) return null;
    entry.biome = reading.biome;
    entry.biomeConfidence = Number.isFinite(reading.biomeConfidence)
      ? reading.biomeConfidence
      : null;
    entry.biomeDetectedAt = detectedAt;
    entry.biomeText = String(reading.biomeText ?? "").slice(0, 1000);
    entry.biomeSource = "windows_ocr";
    return { ...entry };
  }
  biomeExample(id, current, now = Date.now()) {
    const entry = this.#history.find((row) => row.id === id);
    if (!entry)
      throw Object.assign(new Error("Join attempt was not found."), {
        status: 404,
      });
    return {
      feedbackId: entry.feedbackId,
      biome: entry.biome,
      confidence: entry.biomeConfidence,
      rawText: entry.biomeText,
      source: entry.biomeSource,
      detectedAt: entry.biomeDetectedAt,
      recordedAt: now,
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
