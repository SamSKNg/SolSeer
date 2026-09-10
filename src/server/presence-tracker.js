import { PLACE_ID } from "../shared/roblox-links.js";

const JOB_ID = /^[a-zA-Z0-9-]{1,100}$/;

export class PresenceTracker {
  constructor({ request, now = Date.now, interval = 5000 } = {}) {
    this.request = request;
    this.now = now;
    this.interval = interval;
    this.running = false;
    this.busy = false;
    this.user = null;
    this.state = this.#empty();
    this.onUpdate = () => {};
  }

  #empty() {
    return {
      available: Boolean(this.request?.hasCookie),
      status: this.request?.hasCookie ? "identifying" : "cookie_required",
      userId: null,
      username: null,
      displayName: null,
      inExperience: false,
      placeId: null,
      serverId: null,
      lastLocation: null,
      checkedAt: null,
      lastSuccessfulAt: null,
      error: null,
    };
  }

  snapshot() {
    const serverFresh =
      this.state.serverId != null &&
      this.state.lastSuccessfulAt != null &&
      this.now() - this.state.lastSuccessfulAt <= 15000;
    return {
      ...this.state,
      serverId: serverFresh ? this.state.serverId : null,
      serverFresh,
    };
  }

  configureRequest(request) {
    this.controller?.abort();
    this.request = request;
    this.user = null;
    this.state = this.#empty();
    if (this.running) this.#schedule(0);
    this.onUpdate();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.#schedule(0);
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.controller?.abort();
  }

  #schedule(delay) {
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      await this.refresh();
      if (this.running) this.#schedule(this.interval);
    }, delay);
  }

  async #json(response, label) {
    if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
    const value = await response.json();
    if (!value || typeof value !== "object")
      throw new Error(`${label} returned invalid data`);
    return value;
  }

  async refresh() {
    if (this.busy || !this.request?.hasCookie) return this.snapshot();
    this.busy = true;
    this.controller = new AbortController();
    const timeout = setTimeout(() => this.controller.abort(), 8000);
    try {
      if (!this.user) {
        const identity = await this.#json(
          await this.request.authenticatedUser({
            signal: this.controller.signal,
          }),
          "Roblox identity",
        );
        if (!Number.isSafeInteger(identity.id) || identity.id < 1)
          throw new Error("Roblox identity returned invalid data");
        this.user = {
          id: identity.id,
          name: typeof identity.name === "string" ? identity.name : null,
          displayName:
            typeof identity.displayName === "string"
              ? identity.displayName
              : null,
        };
      }
      const payload = await this.#json(
        await this.request.userPresence(this.user.id, {
          signal: this.controller.signal,
        }),
        "Roblox presence",
      );
      const presence = Array.isArray(payload.userPresences)
        ? payload.userPresences.find((item) => item?.userId === this.user.id)
        : null;
      if (!presence) throw new Error("Roblox presence returned invalid data");
      const placeId = Number.isSafeInteger(presence.placeId)
        ? presence.placeId
        : null;
      const inExperience = placeId === PLACE_ID;
      const serverId =
        inExperience &&
        typeof presence.gameId === "string" &&
        JOB_ID.test(presence.gameId)
          ? presence.gameId
          : null;
      const type = Number(presence.userPresenceType);
      this.state = {
        available: true,
        status: serverId
          ? "in_experience"
          : inExperience
            ? "experience_server_hidden"
            : type === 2
              ? "in_other_experience"
              : type === 1 || type === 3
                ? "online"
                : "offline",
        userId: this.user.id,
        username: this.user.name,
        displayName: this.user.displayName,
        inExperience,
        placeId,
        serverId,
        lastLocation:
          typeof presence.lastLocation === "string"
            ? presence.lastLocation.slice(0, 200)
            : null,
        checkedAt: this.now(),
        lastSuccessfulAt: this.now(),
        error: null,
      };
    } catch (error) {
      if (error?.name !== "AbortError") {
        this.state = {
          ...this.state,
          available: true,
          status: "unavailable",
          checkedAt: this.now(),
          error: "Account presence is temporarily unavailable.",
        };
      }
    } finally {
      clearTimeout(timeout);
      this.busy = false;
      this.controller = null;
      this.onUpdate();
    }
    return this.snapshot();
  }
}
