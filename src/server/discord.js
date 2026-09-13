import { readFileSync } from "node:fs";
import { mkdir, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { validateBiomeTargets, BIOMES } from "../shared/biomes.js";
import { PLACE_ID } from "../shared/roblox-links.js";
import { DiscordRpc } from "./discord-rpc.js";
import { biomeColors } from "../shared/biome-colors.js";

export const DISCORD_APPLICATION_ID = "1548506509321699348";
const defaults = {
  presenceEnabled: false,
  applicationId: DISCORD_APPLICATION_ID,
  webhookEnabled: false,
  webhookUrl: "",
  biomes: [],
};
const invalid = (code = "invalid_settings") =>
  Object.assign(
    new Error(
      "Invalid Discord settings. Check the application ID and Discord webhook URL.",
    ),
    { status: 400, code },
  );
export function validateDiscord(value, previous = defaults) {
  if (
    !value ||
    typeof value.presenceEnabled !== "boolean" ||
    typeof value.webhookEnabled !== "boolean"
  )
    throw invalid();
  let webhookUrl =
    value.webhookUrl === undefined ? previous.webhookUrl : value.webhookUrl;
  if (typeof webhookUrl !== "string" || webhookUrl.length > 512)
    throw invalid("invalid_webhook");
  webhookUrl = webhookUrl.trim();
  if (webhookUrl) {
    try {
      const url = new URL(webhookUrl);
      if (
        url.protocol !== "https:" ||
        ![
          "discord.com",
          "discordapp.com",
          "canary.discord.com",
          "ptb.discord.com",
        ].includes(url.hostname) ||
        url.username ||
        url.password ||
        url.port ||
        url.hash ||
        !/^\/api(?:\/v\d{1,2})?\/webhooks\/\d{17,20}\/[A-Za-z0-9_.-]+\/?$/.test(
          url.pathname,
        ) ||
        [...url.searchParams].some(([key, value]) =>
          key === "wait"
            ? !["true", "false"].includes(value)
            : key === "thread_id"
              ? !/^\d{17,20}$/.test(value)
              : true,
        )
      )
        throw new Error();
      url.hostname = "discord.com";
      url.pathname = url.pathname.replace(/\/$/, "");
      url.searchParams.delete("wait");
      webhookUrl = url.toString();
    } catch {
      throw invalid("invalid_webhook");
    }
  }
  if (value.webhookEnabled && !webhookUrl) throw invalid("missing_webhook");
  let biomes;
  try {
    biomes = validateBiomeTargets(value.biomes);
  } catch {
    throw invalid("invalid_biomes");
  }
  return {
    presenceEnabled: value.presenceEnabled,
    applicationId: DISCORD_APPLICATION_ID,
    webhookEnabled: value.webhookEnabled,
    webhookUrl,
    biomes,
  };
}

export function discordReading(value) {
  const a = value.automation,
    p = value.presence;
  if (
    !p?.serverFresh ||
    !value.currentServerId ||
    p.serverId !== value.currentServerId ||
    !/^[a-f\d-]{36}$/i.test(value.currentServerId) ||
    !a ||
    !BIOMES.includes(a.biome) ||
    !Number.isFinite(p.serverAt) ||
    a.biomeAt < p.serverAt ||
    !Number.isFinite(a.biomeAt) ||
    a.biomeAt > value.now
  )
    return null;
  const url = `https://www.roblox.com/games/start?placeId=${PLACE_ID}&gameInstanceId=${encodeURIComponent(value.currentServerId)}`;
  const username =
    typeof p.username === "string" && /^[A-Za-z0-9_]{1,20}$/.test(p.username)
      ? p.username
      : "Unknown player";
  const userId =
    Number.isSafeInteger(p.userId) && p.userId > 0 ? p.userId : null;
  return {
    biome: a.biome,
    server: value.currentServerId,
    at: a.biomeAt,
    url,
    username,
    userId,
  };
}

export function discordActivity(value, startedAt) {
  const p = value.presence, a = value.automation;
  const username = typeof p?.username === "string" && /^[A-Za-z0-9_]{1,20}$/.test(p.username) ? p.username : "SolSeer";
  const server = p?.serverFresh && p.serverId === value.currentServerId && /^[a-f\d-]{36}$/i.test(value.currentServerId ?? "") ? value.currentServerId : null;
  const biome = server && Number.isFinite(p.serverAt) && Number.isFinite(a?.biomeAt) && a.biomeAt >= p.serverAt && a.biomeAt <= value.now && BIOMES.includes(a.biome) ? a.biome : null;
  const seconds = biome ? Math.max(0, Math.floor((value.now - a.biomeAt) / 1000)) : 0;
  const age = seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
  return {
    details: `${username} - unga bunga roll`,
    state: biome ? `✦ ${biome} · Detected ${age} ago` : server ? "✧ Exploring · Waiting for biome" : "✧ Watching for the next gathering",
    timestamps: { start: Math.floor(startedAt / 1000) },
    assets: {
      large_image: "https://raw.githubusercontent.com/SamSKNg/SolSeer/main/public/solseer-icon.png",
      large_text: biome ? `SolSeer · ${biome}` : "SolSeer · unga bunga roll",
    },
    ...(server ? { buttons: [{ label: "Join in Sol’s RNG", url: `https://www.roblox.com/games/start?placeId=${PLACE_ID}&gameInstanceId=${encodeURIComponent(server)}` }] } : {}),
  };
}

export class DiscordIntegration {
  constructor(
    directory,
    {
      fetchFn = fetch,
      rpcFactory = () => new DiscordRpc(),
      now = Date.now,
    } = {},
  ) {
    this.directory = directory;
    this.path = join(directory, "discord.json");
    this.fetch = fetchFn;
    this.rpcFactory = rpcFactory;
    this.now = now;
    this.startedAt = now();
    this.preferences = { ...defaults };
    this.rpcStatus = "Disabled";
    this.webhookStatus = "Disabled";
    this.generation = 0;
    this.rpcGeneration = 0;
    this.sent = new Map();
    this.nextWebhook = 0;
    this.nextRpc = 0;
    try {
      this.preferences = validateDiscord(
        JSON.parse(readFileSync(this.path, "utf8")),
      );
    } catch {}
    if (this.preferences.presenceEnabled)
      this.rpcStatus = "Waiting for Discord desktop";
    if (this.preferences.webhookEnabled)
      this.webhookStatus = "Waiting for a selected biome";
  }
  status() {
    const { webhookUrl, ...preferences } = this.preferences;
    return {
      ...preferences,
      hasWebhook: Boolean(webhookUrl),
      rpcStatus: this.rpcStatus,
      webhookStatus: this.webhookStatus,
    };
  }
  async save(value) {
    if (this.saving)
      throw Object.assign(new Error("Discord settings are being saved."), {
        status: 409,
      });
    const next = validateDiscord(value, this.preferences);
    this.saving = true;
    const temporary = join(this.directory, `discord-${randomUUID()}.tmp`);
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await writeFile(temporary, JSON.stringify(next), {
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporary, this.path);
      this.generation++;
      this.controller?.abort();
      if (next.presenceEnabled !== this.preferences.presenceEnabled) {
        this.rpcGeneration++;
        this.rpc?.close();
        this.rpc = null;
        this.lastActivity = undefined;
        this.nextRpc = 0;
        this.rpcStatus = next.presenceEnabled ? "Waiting for Discord desktop" : "Disabled";
      }
      this.preferences = next;
      this.webhookStatus = next.webhookEnabled
        ? "Waiting for a selected biome"
        : "Disabled";
      return this.status();
    } finally {
      this.saving = false;
      await unlink(temporary).catch(() => {});
    }
  }
  update(value) {
    if (this.closed) return;
    const reading = discordReading(value);
    this.latestReading = reading;
    this.latestActivity = discordActivity(value, this.startedAt);
    this.updateRpc(this.latestActivity);
    const key = reading && `${reading.server}:${reading.biome}`;
    if (
      !this.preferences.webhookEnabled ||
      !reading ||
      !this.preferences.biomes.includes(reading.biome) ||
      this.webhookBusy ||
      this.now() < this.nextWebhook ||
      this.sent.has(key)
    )
      return;
    this.sendWebhook(reading, key);
  }
  async sendWebhook(reading, key) {
    this.webhookBusy = true;
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(() => controller.abort(), 8000);
    this.nextWebhook = this.now() + 5000;
    // Mark before sending: ambiguous network errors must not spam duplicate messages.
    this.sent.set(key, this.now());
    if (this.sent.size > 1000) this.sent.delete(this.sent.keys().next().value);
    try {
      const response = await this.fetch(
        `${this.preferences.webhookUrl}${this.preferences.webhookUrl.includes("?") ? "&" : "?"}wait=true`,
        {
          method: "POST",
          redirect: "error",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            allowed_mentions: { parse: [] },
            embeds: [
              {
                title: `${reading.biome} detected`,
                author: {
                  name: `@${reading.username}`,
                  ...(reading.userId
                    ? {
                        url: `https://www.roblox.com/users/${reading.userId}/profile`,
                      }
                    : {}),
                },
                color: Number.parseInt(biomeColors[reading.biome].slice(1), 16),
                description: `Last detected **${reading.biome}** <t:${Math.floor(reading.at / 1000)}:R>.\n[Join server](${reading.url})`,
                timestamp: new Date(reading.at).toISOString(),
                footer: {
                  text: "SolSeer · OCR detection, not independently verified · server may change",
                },
              },
            ],
          }),
        },
      );
      if (generation !== this.generation) return;
      if (response.status === 429) {
        const body = await response.json().catch(() => ({}));
        const delay = Math.max(
          5000,
          (Number(body.retry_after) || 60) * 1000,
          (Number(response.headers.get("retry-after")) || 0) * 1000,
        );
        this.nextWebhook = this.now() + delay;
        this.sent.delete(key);
        this.webhookStatus = "Discord rate limited; waiting before retry";
      } else {
        if (response.headers.get("x-ratelimit-remaining") === "0")
          this.nextWebhook =
            this.now() +
            Math.max(
              5000,
              (Number(response.headers.get("x-ratelimit-reset-after")) || 60) *
                1000,
            );
        this.webhookStatus = response.ok
          ? "Biome broadcast sent"
          : "Webhook rejected; check its URL and permissions";
        if (!response.ok) this.nextWebhook = this.now() + 60000;
        await response.body?.cancel();
      }
    } catch {
      if (generation === this.generation)
        this.webhookStatus =
          "Delivery could not be confirmed; not retried to avoid duplicates";
    } finally {
      clearTimeout(timer);
      this.webhookBusy = false;
    }
  }
  async updateRpc(activity) {
    if (
      !this.preferences.presenceEnabled ||
      this.rpcBusy ||
      this.now() < this.nextRpc
    )
      return;
    const key = JSON.stringify(activity);
    if (this.rpc?.socket && this.lastActivity === key) return;
    this.rpcBusy = true;
    this.nextRpc = this.now() + 15000;
    const generation = this.rpcGeneration;
    const rpc = this.rpc ?? this.rpcFactory();
    this.rpc = rpc;
    try {
      if (!rpc.socket) await rpc.open(this.preferences.applicationId);
      if (generation !== this.rpcGeneration || this.closed) {
        rpc.close();
        return;
      }
      const freshActivity = this.latestActivity;
      await rpc.setActivity(freshActivity);
      if (generation !== this.rpcGeneration) return;
      this.lastActivity = JSON.stringify(freshActivity);
      this.rpcStatus = "Rich Presence connected";
    } catch {
      rpc.close();
      if (generation === this.rpcGeneration) {
        this.rpc = null;
        this.nextRpc = this.now() + 30000;
        this.rpcStatus = "Discord unavailable or rejected activity; retrying";
      }
    } finally {
      this.rpcBusy = false;
    }
  }
  close() {
    this.closed = true;
    this.rpcGeneration++;
    this.generation++;
    this.controller?.abort();
    this.rpc?.close();
  }
}
