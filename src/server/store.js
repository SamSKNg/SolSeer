// One store per backend session. No filesystem, SQLite, or browser storage.
import { AUTHENTICATED_POLLING } from "./polling-config.js";

export class Store {
  #history = [];
  #joined = new Map();
  #attempts = [];
  #cooldownUntil = 0;
  #nextId = 1;

  join(row, now = Date.now()) {
    this.#history.push({
      id: this.#nextId++,
      jobId: row.id,
      at: now,
      players: row.players ?? null,
      capacity: row.capacity ?? null,
      alert: row.alert ?? null,
      signalState: row.signalState ?? null,
      growthPer10s: row.growthPer10s ?? null,
    });
    this.#history.sort((a, b) => b.at - a.at || b.id - a.id);
    this.#history = this.#history.slice(0, 200);
    const previous = this.#joined.get(row.id);
    this.#joined.set(row.id, {
      count: (previous?.count ?? 0) + 1,
      at: Math.max(previous?.at ?? now, now),
    });
  }
  joins() {
    return this.#history.map((row) => ({ ...row }));
  }
  summary() {
    return Object.fromEntries(
      [...this.#joined].map(([id, value]) => [id, { ...value }]),
    );
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
