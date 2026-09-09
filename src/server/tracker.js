import { score, THRESHOLDS, updateSignalHold } from "./scorer.js";
import { compareSignals } from "../shared/signals.js";

import { PLACE_ID, joinUrl } from "../shared/roblox-links.js";
export { PLACE_ID, joinUrl } from "../shared/roblox-links.js";

export class Tracker {
  constructor(
    store,
    {
      fetchFn = fetch,
      now = Date.now,
      interval = 20500,
      requestLimit = 3,
    } = {},
  ) {
    Object.assign(this, { store, fetchFn, now, interval, requestLimit });
    this.records = new Map();
    this.events = [];
    this.slot = 0;
    this.coverage = null;
    this.coverageSeeded = false;
    this.busy = false;
    this.running = false;
    this.polls = 0;
    this.nextAt = now();
    this.lastAt = null;
    this.error = null;
    this.status = "Ready";
    this.previousPages = new Map();
    this.onUpdate = () => {};
  }
  start() {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }
  schedule(delay) {
    clearTimeout(this.timer);
    this.nextAt = this.now() + delay;
    this.timer = setTimeout(async () => {
      try {
        await this.poll();
      } catch (error) {
        this.error = "Tracker encountered an internal error";
        this.status = "Recovering";
        this.nextAt = this.now() + 30000;
      }
      if (this.running) this.schedule(Math.max(0, this.nextAt - this.now()));
      this.onUpdate();
    }, delay);
  }
  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.controller?.abort();
  }
  configureFetch(fetchFn) {
    if (this.busy) {
      this.pendingFetch = fetchFn;
      return;
    }
    this.fetchFn = fetchFn;
    this.interval = fetchFn.hasCookie ? 5000 : 20500;
    this.requestLimit = fetchFn.hasCookie ? 12 : 3;
    const delay = Math.max(
      this.interval,
      this.nextAt - this.now(),
      this.store.availableIn(this.now(), this.requestLimit),
    );
    if (this.running) this.schedule(delay);
    else this.nextAt = this.now() + delay;
    this.onUpdate();
  }
  async poll() {
    if (this.busy) return;
    const wait = this.store.reserve(this.now(), this.requestLimit);
    if (wait) {
      this.status = "Waiting for quota";
      this.nextAt = this.now() + wait;
      return;
    }
    this.busy = true;
    const cursor = this.slot % 3 === 2 ? this.coverage : null;
    const page = cursor ? "Coverage 100" : "Top 100";
    this.status = `Polling ${page.toLowerCase()}`;
    const start = this.now();
    this.onUpdate();
    const event = {
      id: ++this.polls,
      at: start,
      page,
    };
    let delay = this.interval;
    try {
      const params = new URLSearchParams({
        sortOrder: "Desc",
        excludeFullGames: "false",
        limit: "100",
      });
      if (cursor) params.set("cursor", cursor);
      this.controller = new AbortController();
      const timeout = setTimeout(() => this.controller.abort(), 15000);
      let response, payload;
      try {
        response = await this.fetchFn(
          `https://games.roblox.com/v1/games/${PLACE_ID}/servers/Public?${params}`,
          { signal: this.controller.signal },
        );
        if (response.ok) payload = await response.json();
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) {
        if (response.status === 429) {
          const seconds = (name) =>
            Math.max(0, Number(response.headers.get(name)) || 0);
          const retry = response.headers.get("retry-after");
          delay =
            Math.max(
              5000,
              seconds("x-ratelimit-reset") * 1000,
              seconds("retry-after") * 1000,
              Number.isNaN(Number(retry))
                ? (Date.parse(retry) || 0) - this.now()
                : 0,
            ) + 500;
          this.store.cooldown(this.now() + delay);
        }
        throw new Error(`Roblox HTTP ${response.status}`);
      }
      if (!payload || !Array.isArray(payload.data))
        throw new Error("Roblox returned an invalid server page");
      const at = this.now(),
        ids = new Set(),
        seenIds = new Set();
      let changed = 0,
        growing = 0,
        fresh = 0,
        filteredBelowMin = 0,
        duplicates = 0;
      for (const s of payload.data) {
        if (
          typeof s?.id !== "string" ||
          !s.id ||
          !Number.isInteger(s.playing) ||
          !Number.isInteger(s.maxPlayers) ||
          s.playing < 0 ||
          s.maxPlayers < 1 ||
          s.playing > s.maxPlayers
        )
          continue;
        if (seenIds.has(s.id)) {
          duplicates++;
          continue;
        }
        seenIds.add(s.id);
        const existing = this.records.get(s.id);
        // Retain already-fetched baselines without extra requests; filter the UI.
        if (s.playing < THRESHOLDS.minimumPlayers) filteredBelowMin++;
        else ids.add(s.id);
        let record = existing;
        const previousPlayers = record?.players;
        if (!record) {
          record = { id: s.id, history: [], firstSeen: at, peak: 0 };
          fresh++;
        } else {
          if (record.players !== s.playing) changed++;
          if (s.playing > record.players) growing++;
        }
        Object.assign(record, {
          players: s.playing,
          capacity: s.maxPlayers,
          ping: s.ping ?? null,
          fps: s.fps ?? null,
          lastSeen: at,
          pollInterval: this.interval,
          peak: Math.max(record.peak, s.playing),
        });
        record.history.push({
          at,
          players: s.playing,
          capacity: s.maxPlayers,
          poll: event.id,
        });
        record.history = record.history.filter((h) => at - h.at <= 900000);
        updateSignalHold(record, previousPlayers, event.id);
        this.records.set(s.id, record);
      }
      for (const [id, record] of this.records)
        if (
          at - record.lastSeen > 900000 &&
          (record.signalHold?.expiresAtPoll ?? 0) <= event.id
        )
          this.records.delete(id);
      const previous = cursor ? null : this.previousPages.get(page);
      Object.assign(event, {
        at,
        count: ids.size,
        fetchedCount: payload.data.length,
        filteredBelowMin,
        changed,
        growing,
        fresh,
        duplicates,
        retention: previous?.size
          ? Math.round(
              ([...ids].filter((id) => previous.has(id)).length /
                previous.size) *
                100,
            )
          : null,
      });
      if (!cursor) this.previousPages.set(page, ids);
      if (cursor || !this.coverageSeeded) {
        this.coverage =
          payload.nextPageCursor && payload.nextPageCursor !== cursor
            ? payload.nextPageCursor
            : null;
        this.coverageSeeded = Boolean(this.coverage);
      }
      this.error = null;
      this.lastAt = at;
      this.status = "Live";
      this.slot++;
      delay = Math.max(0, this.interval - (this.now() - start));
      if (response.headers.get("x-ratelimit-remaining") === "0") {
        const reset = Number(response.headers.get("x-ratelimit-reset"));
        if (Number.isFinite(reset) && reset > 0)
          this.store.cooldown(at + reset * 1000 + 250);
      }
    } catch (error) {
      // An expired discovery cursor must not trap future polls on that page.
      if (cursor && error.message === "Roblox HTTP 400") {
        this.coverage = null;
        this.coverageSeeded = false;
      }
      // Slow down if authentication stops working; never hammer a rejected cookie.
      if (/^Roblox HTTP (401|403)$/.test(error.message)) {
        this.interval = 20500;
        this.requestLimit = 3;
        delay = Math.max(delay, 60000);
      }
      this.error =
        error.name === "AbortError"
          ? "Request timed out or stopped"
          : /^Roblox HTTP \d{3}$/.test(error.message) ||
              [
                "Roblox returned an invalid server page",
                "Roblox request failed (network error or blocked redirect)",
              ].includes(error.message)
            ? error.message
            : "Roblox request failed";
      event.error = this.error;
      this.status = "Retry scheduled";
      // Keep this page slot; retry on the normal cadence after any backoff.
    } finally {
      this.busy = false;
      if (this.pendingFetch) {
        this.fetchFn = this.pendingFetch;
        this.pendingFetch = null;
        this.interval = this.fetchFn.hasCookie ? 5000 : 20500;
        this.requestLimit = this.fetchFn.hasCookie ? 12 : 3;
        delay = Math.max(delay, this.interval);
      }
      event.duration = this.now() - start;
      delay = Math.max(
        delay,
        this.store.availableIn(this.now(), this.requestLimit),
      );
      this.nextAt = this.now() + delay;
      event.nextDelay = delay;
      this.events.unshift(event);
      this.events = this.events.slice(0, 100);
      this.onUpdate();
    }
  }
  snapshot() {
    const now = this.now(),
      completedPoll = this.events[0]?.id ?? 0,
      joined = this.store.summary();
    const rows = [...this.records.values()]
      .filter(
        (r) =>
          (now - r.lastSeen <= 150000 &&
            r.players >= THRESHOLDS.minimumPlayers) ||
          (r.signalHold?.expiresAtPoll ?? 0) > completedPoll,
      )
      .map((r) => ({
        ...r,
        ...score(r, completedPoll, now),
        joined: joined[r.id] ?? null,
      }))
      .sort(compareSignals);
    return {
      now,
      status: this.status,
      error: this.error,
      busy: this.busy,
      nextAt: this.nextAt,
      lastAt: this.lastAt,
      polls: this.polls,
      budget: this.store.requests(now).length,
      requestLimit: this.requestLimit,
      pollIntervalMs: this.interval,
      minimumPlayers: THRESHOLDS.minimumPlayers,
      tracked: this.records.size,
      rows,
      events: this.events,
      joins: this.store.joins(),
      totalJoins: Object.values(joined).reduce(
        (sum, item) => sum + item.count,
        0,
      ),
    };
  }
  recordJoin(id) {
    const record = this.records.get(id);
    this.store.join(
      record
        ? { ...record, ...score(record, this.events[0]?.id ?? 0, this.now()) }
        : { id },
      this.now(),
    );
    this.onUpdate();
    return joinUrl(id);
  }
}
