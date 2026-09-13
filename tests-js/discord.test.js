import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DiscordIntegration,
  discordReading,
  discordActivity,
  validateDiscord,
  DISCORD_APPLICATION_ID,
} from "../src/server/discord.js";
import { DiscordRpc } from "../src/server/discord-rpc.js";
import { EventEmitter } from "node:events";
const webhookUrl =
  "https://discord.com/api/webhooks/123456789012345678/test-secret";
const settings = {
  presenceEnabled: false,
  applicationId: "123456789012345678",
  webhookEnabled: true,
  webhookUrl,
  biomes: ["Singularity"],
};
const snapshot = (now = 100000) => ({
  now,
  currentServerId: "12345678-1234-1234-1234-123456789012",
  presence: {
    serverId: "12345678-1234-1234-1234-123456789012",
    serverFresh: true,
    username: "TestPlayer",
    userId: 12345,
    serverAt: now - 1000,
  },
  automation: {
    status: "scanning",
    biome: "Singularity",
    biomeAt: now,
    biomeFresh: true,
    scanAccepted: true,
    playVisible: false,
  },
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
test("presence retains the application biome while OCR is paused, but not across servers", () => {
  const value = snapshot();
  value.now += 3600000;
  Object.assign(value.automation, { status: "roblox_not_foreground", biomeFresh: false, scanAccepted: false });
  const activity = discordActivity(value, 50000);
  assert.match(activity.state, /Singularity/);
  assert.equal(activity.buttons.length, 1);
  assert.ok(activity.assets.large_image.endsWith("solseer-icon.png"));
  assert.equal(activity.timestamps.start, 50);
  assert.equal(discordReading(value).biome, "Singularity");
  assert.match(activity.state, /Detected 1h 0m ago/);
  value.presence.serverAt = value.now;
  assert.equal(discordActivity(value, 50000).state, "✧ Exploring · Waiting for biome");
  value.presence.serverFresh = false;
  assert.equal(discordActivity(value, 50000).buttons, undefined);
});
test("webhook ignores legacy pings and includes player attribution and biome color", () =>
  fixture(async (directory) => {
    let payload;
    const service = new DiscordIntegration(directory, {
      now: () => 100000,
      fetchFn: async (_url, options) => {
        payload = JSON.parse(options.body);
        return new Response(null, { status: 204 });
      },
    });
    await service.save({
      ...settings,
      mentions: {
        Singularity: "<@&123456789012345678>",
        Starfall: "<@987654321098765432>",
      },
    });
    service.update(snapshot());
    await tick();
    assert.equal(payload.embeds[0].color, 0xd58a6d);
    assert.equal(payload.content, undefined);
    assert.equal(payload.embeds[0].author.name, "@TestPlayer");
    assert.equal(
      payload.embeds[0].author.url,
      "https://www.roblox.com/users/12345/profile",
    );
    assert.deepEqual(payload.allowed_mentions, {
      parse: [],
    });
    service.close();
  }));
test("webhook-only setup accepts blank application ID and normalizes Discord URLs", () => {
  for (const url of [
    webhookUrl,
    webhookUrl.replace("discord.com", "discordapp.com"),
    webhookUrl + "/?wait=true",
    webhookUrl + ".suffix",
  ]) {
    const result = validateDiscord({
      ...settings,
      applicationId: "",
      webhookUrl: url,
    });
    assert.equal(result.applicationId, DISCORD_APPLICATION_ID);
    assert.equal(result.webhookEnabled, true);
    assert.ok(
      result.webhookUrl.startsWith("https://discord.com/api/webhooks/"),
    );
  }
  for (const applicationId of [undefined, "", "123456789012345678"]) {
    assert.equal(
      validateDiscord({ ...settings, applicationId, presenceEnabled: true })
        .applicationId,
      "1548506509321699348",
    );
  }
});
async function fixture(work) {
  const directory = await mkdtemp(join(tmpdir(), "solseer-discord-"));
  try {
    await work(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
test("Discord secrets are validated, persisted, omitted from status and retained on blank edits", () =>
  fixture(async (directory) => {
    const service = new DiscordIntegration(directory);
    assert.equal(service.preferences.webhookEnabled, false);
    await service.save(settings);
    assert.equal(
      JSON.stringify(service.status()).includes("test-secret"),
      false,
    );
    const loaded = new DiscordIntegration(directory);
    assert.equal(loaded.status().hasWebhook, true);
    const { webhookUrl: _, ...publicSettings } = settings;
    await loaded.save(publicSettings);
    assert.equal(loaded.preferences.webhookUrl, webhookUrl);
    await loaded.save({ ...settings, webhookEnabled: false, webhookUrl: "" });
    assert.equal(loaded.status().hasWebhook, false);
    for (const url of [
      "http://localhost/x",
      webhookUrl + "?redirect=x",
      webhookUrl.replace("discord.com", "discord.com.evil.org"),
    ])
      assert.throws(() => validateDiscord({ ...settings, webhookUrl: url }));
    assert.throws(() => validateDiscord({ ...settings, biomes: ["fake"] }));
  }));
test("latest accepted biome remains shareable despite paused or failed scans", () => {
  assert.ok(discordReading(snapshot()));
  for (const change of [
    { playVisible: true },
    { biomeFresh: false },
    { scanAccepted: false },
    { status: "roblox_not_foreground" },
  ]) {
    const value = snapshot();
    Object.assign(value.automation, change);
    assert.ok(discordReading(value));
  }
  const value = snapshot();
  value.automation.biomeAt = 1;
  assert.equal(discordReading(value), null);
  value.automation.biomeAt = value.now;
  value.presence.serverFresh = false;
  assert.equal(discordReading(value), null);
});
test("webhooks filter biomes, suppress duplicates and include only public join data", () =>
  fixture(async (directory) => {
    const calls = [];
    const service = new DiscordIntegration(directory, {
      now: () => 100000,
      fetchFn: async (url, options) => {
        calls.push([url, options]);
        return new Response(null, { status: 204 });
      },
    });
    service.update(snapshot());
    await tick();
    assert.equal(calls.length, 0);
    await service.save(settings);
    const normal = snapshot();
    normal.automation.biome = "Normal";
    service.update(normal);
    await tick();
    assert.equal(calls.length, 0);
    service.update(snapshot());
    await tick();
    service.update(snapshot());
    await tick();
    assert.equal(calls.length, 1);
    const body = JSON.parse(calls[0][1].body);
    assert.deepEqual(body.allowed_mentions, {
      parse: [],
    });
    assert.match(body.embeds[0].description, /gameInstanceId=/);
    assert.equal(calls[0][1].redirect, "error");
    service.close();
  }));
test("429 waits and retries only after Discord backoff", () =>
  fixture(async (directory) => {
    let now = 100000,
      calls = 0;
    const service = new DiscordIntegration(directory, {
      now: () => now,
      fetchFn: async () => {
        calls++;
        return new Response(JSON.stringify({ retry_after: 30 }), {
          status: 429,
        });
      },
    });
    await service.save(settings);
    service.update(snapshot(now));
    await tick();
    now += 10000;
    service.update(snapshot(now));
    await tick();
    assert.equal(calls, 1);
    now += 21000;
    service.update(snapshot(now));
    await tick();
    assert.equal(calls, 2);
    service.close();
  }));
test("rich presence updates are throttled, clear stale data and close when disabled", () =>
  fixture(async (directory) => {
    let now = 100000;
    const activities = [];
    const rpc = {
      socket: null,
      async open() {
        this.socket = true;
      },
      async setActivity(activity) {
        activities.push(activity);
      },
      close() {
        this.socket = null;
      },
    };
    const service = new DiscordIntegration(directory, {
      now: () => now,
      rpcFactory: () => rpc,
    });
    await service.save({
      ...settings,
      webhookEnabled: false,
      presenceEnabled: true,
    });
    service.update(snapshot(now));
    await tick();
    assert.equal(activities[0].details, "TestPlayer - unga bunga roll");
    assert.equal(activities[0].state, "✦ Singularity · Detected 0s ago");
    assert.match(activities[0].buttons[0].url, /gameInstanceId=/);
    await service.save({ ...settings, webhookEnabled: false, presenceEnabled: true, biomes: ["Normal"] });
    assert.equal(rpc.socket, true);
    service.update(snapshot(now));
    await tick();
    assert.equal(activities.length, 1);
    now += 16000;
    const value = snapshot(now);
    value.presence.serverFresh = false;
    service.update(value);
    await tick();
    assert.equal(activities[1].state, "✧ Watching for the next gathering");
    assert.equal(activities[1].buttons, undefined);
    assert.equal(activities[1].timestamps.start, activities[0].timestamps.start);
    await service.save({
      ...settings,
      webhookEnabled: false,
      presenceEnabled: false,
    });
    assert.equal(rpc.socket, null);
    service.close();
  }));
test(
  "RPC frames support fragmented handshake, ping and acknowledged activity",
  { skip: process.platform !== "win32" },
  async () => {
    const packet = (op, body) => {
      const data = Buffer.from(JSON.stringify(body));
      const header = Buffer.alloc(8);
      header.writeUInt32LE(op);
      header.writeUInt32LE(data.length, 4);
      return Buffer.concat([header, data]);
    };
    const writes = [];
    const socket = new EventEmitter();
    socket.destroy = () => socket.emit("close");
    socket.write = (frame) => {
      const op = frame.readUInt32LE(0);
      const body = JSON.parse(frame.subarray(8));
      writes.push([op, body]);
      if (body.nonce)
        queueMicrotask(() =>
          socket.emit("data", packet(1, { nonce: body.nonce })),
        );
    };
    const rpc = new DiscordRpc({
      connect: () => {
        queueMicrotask(() => {
          socket.emit("connect");
          const ready = packet(1, { evt: "READY" });
          socket.emit("data", ready.subarray(0, 3));
          socket.emit("data", ready.subarray(3));
        });
        return socket;
      },
    });
    await rpc.open(settings.applicationId);
    assert.equal(writes[0][0], 0);
    socket.emit("data", packet(3, { ping: 1 }));
    assert.equal(writes[1][0], 4);
    await rpc.setActivity({ details: "Biome: Normal" });
    assert.equal(writes[2][1].cmd, "SET_ACTIVITY");
    rpc.close();
  },
);
