import { score, THRESHOLDS, updateSignalHold } from "./scorer.js";
import { compareSignals } from "../shared/signals.js";
import { ANONYMOUS_POLLING, pollingFor } from "./polling-config.js";
import { addPeerGrowth } from "./peer-growth.js";

import { PLACE_ID, joinUrl } from "../shared/roblox-links.js";
export { PLACE_ID, joinUrl } from "../shared/roblox-links.js";

export class Tracker {
  constructor(
    store,
    {
      fetchFn = fetch,
      now = Date.now,
      interval = ANONYMOUS_POLLING.interval,
      requestLimit = ANONYMOUS_POLLING.requestLimit,
      pagesPerPoll = ANONYMOUS_POLLING.pagesPerPoll,
      coverageEvery = ANONYMOUS_POLLING.coverageEvery,
    } = {},
  ) {
    Object.assign(this, {
      store,
      fetchFn,
      now,
      interval,
      requestLimit,
      pagesPerPoll,
      coverageEvery,
    });
    this.records = new Map();
    this.events = [];
    this.slot = 0;
    this.coverage = null;
    this.coverageSeeded = false;
    this.busy = false;
    this.running = false;
    this.polls = 0;
    this.totalRequests = 0;
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
  configurePolling(seconds) {
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60)
      throw new Error("Polling interval must be 1–60 seconds.");
    this.preferredInterval = seconds * 1000;
    this.interval = this.preferredInterval;
    // Let an in-flight request finish; never erase quota or retry backoff.
    if (!this.busy) {
      const delay = Math.max(
        this.interval,
        this.nextAt - this.now(),
        this.store.availableIn(this.now(), this.requestLimit),
      );
      if (this.running) this.schedule(delay);
      else this.nextAt = this.now() + delay;
    }
  }
  configureFetch(fetchFn) {
    if (this.busy) {
      this.pendingFetch = fetchFn;
      return;
    }
    this.fetchFn = fetchFn;
    Object.assign(this, pollingFor(fetchFn.hasCookie));
    if (this.preferredInterval) this.interval = this.preferredInterval;
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
      this.status = "Waiting for Roblox rate limit";
      this.nextAt = this.now() + wait;
      return;
    }
    this.busy = true;
    const paired = this.pagesPerPoll === 2;
    const cursor =
      !paired &&
      this.coverageEvery > 0 &&
      this.slot % this.coverageEvery === this.coverageEvery - 1
        ? this.coverage
        : null;
    const page = paired ? "Pages 1 + 2" : cursor ? "Coverage 100" : "Top 100";
    this.status = `Polling ${page.toLowerCase()}`;
    const start = this.now();
    this.onUpdate();
    const event = {
      id: ++this.polls,
      at: start,
      page,
      requests: 0,
      pages: [],
    };
    let delay = this.interval;
    const batches = [];
    try {
      let requestCursor = cursor;
      let failure = null;
      this.controller = new AbortController();
      for (let pageIndex = 0; pageIndex < (paired ? 2 : 1); pageIndex++) {
        if (pageIndex > 0) {
          if (this.controller.signal.aborted) {
            failure = new DOMException("Stopped", "AbortError");
            break;
          }
          const secondWait = this.store.reserve(this.now(), this.requestLimit);
          if (secondWait) {
            event.deferredPage = 2;
            delay = Math.max(delay, secondWait);
            break;
          }
        }
        event.requests++;
        this.totalRequests++;
        const pageResult = {
          page: paired ? pageIndex + 1 : page,
          at: this.now(),
        };
        event.pages.push(pageResult);
        try {
          const params = new URLSearchParams({
            sortOrder: "Desc",
            excludeFullGames: "false",
            limit: "100",
          });
          if (requestCursor) params.set("cursor", requestCursor);
          const timeout = setTimeout(() => this.controller.abort(), 15000);
          let response, payload;
          try {
            response = await this.fetchFn(
              `https://games.roblox.com/v1/games/${PLACE_ID}/servers/Public?${params}`,
              { signal: this.controller.signal },
            );
            pageResult.status = response.status;
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
          batches.push({ payload, at: this.now() });
          pageResult.count = payload.data.length;
          if (response.headers.get("x-ratelimit-remaining") === "0") {
            const reset = Number(response.headers.get("x-ratelimit-reset"));
            this.store.cooldown(
              this.now() +
                (Number.isFinite(reset) && reset > 0 ? reset * 1000 : 60000) +
                250,
            );
          }
          requestCursor = payload.nextPageCursor;
          // Page 2 always uses this cycle's fresh page-1 cursor. Never fetch page 3.
          if (!paired || typeof requestCursor !== "string" || !requestCursor)
            break;
        } catch (error) {
          failure = error;
          break;
        } finally {
          pageResult.duration = this.now() - pageResult.at;
        }
      }
      const completedAt = this.now(),
        ids = new Set(),
        observations = new Map();
      let changed = 0,
        growing = 0,
        fresh = 0,
        filteredBelowMin = 0,
        duplicates = 0;
      for (const batch of batches) {
        const seenIds = new Set();
        for (const s of batch.payload.data) {
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
          if (observations.has(s.id)) duplicates++;
          // A server can move between pages. Use its latest page reading once,
          // never count two appearances in one cycle as two heuristic samples.
          observations.set(s.id, { server: s, at: batch.at });
        }
      }
      for (const { server: s, at } of observations.values()) {
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
          completedAt - record.lastSeen > 900000 &&
          (record.signalHold?.expiresAtPoll ?? 0) <= event.id
        )
          this.records.delete(id);
      const previous = cursor ? null : this.previousPages.get(page);
      Object.assign(event, {
        at: completedAt,
        count: ids.size,
        fetchedCount: batches.reduce(
          (sum, batch) => sum + batch.payload.data.length,
          0,
        ),
        filteredBelowMin,
        changed,
        growing,
        fresh,
        duplicates,
        retention:
          !failure && !event.deferredPage && previous?.size
            ? Math.round(
                ([...ids].filter((id) => previous.has(id)).length /
                  previous.size) *
                  100,
              )
            : null,
      });
      if (!cursor && !failure && !event.deferredPage)
        this.previousPages.set(page, ids);
      if (!paired && batches.length && (cursor || !this.coverageSeeded)) {
        const payload = batches[0].payload;
        this.coverage =
          payload.nextPageCursor && payload.nextPageCursor !== cursor
            ? payload.nextPageCursor
            : null;
        this.coverageSeeded = Boolean(this.coverage);
      }
      if (batches.length) this.lastAt = batches.at(-1).at;
      if (failure) throw failure;
      this.error = null;
      this.status = event.deferredPage
        ? "Partial update; waiting for quota"
        : "Live";
      this.slot++;
      delay = event.deferredPage
        ? delay
        : Math.max(0, this.interval - (this.now() - start));
    } catch (error) {
      // An expired discovery cursor must not trap future polls on that page.
      if (cursor && error.message === "Roblox HTTP 400") {
        this.coverage = null;
        this.coverageSeeded = false;
      }
      // Slow down if authentication stops working; never hammer a rejected cookie.
      if (/^Roblox HTTP (401|403)$/.test(error.message)) {
        Object.assign(this, ANONYMOUS_POLLING);
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
      this.status = batches.length
        ? "Partial update; retry scheduled"
        : "Retry scheduled";
      // Keep this page slot; retry on the normal cadence after any backoff.
    } finally {
      this.busy = false;
      if (this.pendingFetch) {
        this.fetchFn = this.pendingFetch;
        this.pendingFetch = null;
        Object.assign(this, pollingFor(this.fetchFn.hasCookie));
        if (this.preferredInterval) this.interval = this.preferredInterval;
        delay = Math.max(delay, this.interval);
      }
      event.duration = this.now() - start;
      event.partial =
        batches.length > 0 && Boolean(event.error || event.deferredPage);
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
      .map((r) => ({
        ...r,
        ...score(r, completedPoll, now),
        joined: joined[r.id] ?? null,
      }))
      .filter(
        (r) =>
          (now - r.lastSeen <= THRESHOLDS.freshnessMs &&
            r.players >= THRESHOLDS.minimumPlayers) ||
          ["potential", "cluster"].includes(r.alert),
      );
    addPeerGrowth(rows, now).sort(compareSignals);
    return {
      now,
      status: this.status,
      error: this.error,
      busy: this.busy,
      nextAt: this.nextAt,
      lastAt: this.lastAt,
      polls: this.polls,
      totalRequests: this.totalRequests,
      budget: this.store.requests(now).length,
      requestLimit: this.requestLimit,
      pollIntervalMs: this.interval,
      pagesPerPoll: this.pagesPerPoll,
      coverageEvery: this.coverageEvery,
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
