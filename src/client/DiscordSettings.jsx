import React, { useEffect, useRef, useState } from "react";
import { BiomeSelection } from "./BiomeSelection.jsx";
import { apiFetch } from "./transport.js";

export function DiscordSettings({ initial, token }) {
  const [preferences, setPreferences] = useState({
    presenceEnabled: false,
    webhookEnabled: false,
    biomes: [],
    ...initial,
  });
  const [webhook, setWebhook] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);
  const save = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    setError("");
    const controller = new AbortController();
    request.current = controller;
    const value = {
      presenceEnabled: preferences.presenceEnabled,
      webhookEnabled: preferences.webhookEnabled,
      biomes: preferences.biomes,
      ...(webhook.trim()
          ? { webhookUrl: webhook.trim() }
          : {}),
    };
    setWebhook("");
    try {
      const response = await apiFetch("/api/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Solseer-Token": token,
        },
        body: JSON.stringify({ discord: value }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw Object.assign(new Error(), { code: result.code });
      }
      const result = await response.json();
      if (controller.signal.aborted) return;
      setPreferences(result.discord);
      setMessage("Discord preferences saved.");
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          {
            invalid_webhook:
              "The webhook URL is not a supported Discord webhook link. Copy the full URL from Discord’s Integrations → Webhooks page and paste it again.",
            missing_webhook:
              "Paste a webhook URL before enabling biome broadcasts.",
            invalid_biomes:
              "One of the selected biomes is invalid. Reopen Settings and select the biomes again.",
          }[failure.code] ||
            "Could not save Discord settings. Reopen Settings and try again. If you just updated SolSeer, restart its backend/app first. Re-enter a replacement webhook URL if needed.",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return (
    <section className="panel settings-panel discord-settings">
      <h2>Discord.</h2>
      <p className="settings-intro">
        Share your detected biome and a link to your current server. Both
        features are off by default.
      </p>
      <p className="settings-warning">
        Enabling these features shares your biome and server publicly on your
        profile or with everyone who can read the webhook channel. Rich Presence
        and webhooks use the application's latest detected biome and show its age.
        Server links require confirmed Roblox presence. Configure your Roblox
        connection in Setup first.
      </p>
      <form onSubmit={save}>
        <section
          className="discord-settings-section"
          aria-label="Rich Presence settings"
        >
          <h3>Rich Presence</h3>
          <label className="settings-consent">
            <input
              type="checkbox"
              checked={preferences.presenceEnabled}
              disabled={busy}
              onChange={(e) =>
                setPreferences({
                  ...preferences,
                  presenceEnabled: e.target.checked,
                })
              }
            />
            Show username, biome and join button on Discord
          </label>
          <p className="subtle">
            Uses SolSeer’s shared Discord application automatically. No
            application setup, bot token, client secret, or Discord password is
            needed. Keep Discord desktop running on Windows and enable activity
            sharing. Other users can see the join button; it is not shown on
            your own profile view.
            Presence stays visible while tabbed out, with SolSeer artwork and an
            elapsed-time display. The last detected biome stays until the server
            changes; it is not a promise that the biome is still active.
          </p>
          <p className="subtle">
            Last loaded status: {preferences.rpcStatus || "Disabled"}. Reopen
            Settings to refresh.
          </p>
        </section>
        <section
          className="discord-settings-section"
          aria-label="Biome webhook settings"
        >
          <h3>Biome webhook</h3>
          <label className="settings-consent">
            <input
              type="checkbox"
              checked={preferences.webhookEnabled}
              disabled={busy}
              onChange={(e) =>
                setPreferences({
                  ...preferences,
                  webhookEnabled: e.target.checked,
                })
              }
            />
            Broadcast selected biome detections
          </label>
          <label className="discord-field">
            Discord webhook URL
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              maxLength={512}
              disabled={busy}
              value={webhook}
              placeholder={
                preferences.hasWebhook
                  ? "Saved — leave blank to keep"
                  : "https://discord.com/api/webhooks/…"
              }
              onChange={(e) => setWebhook(e.target.value)}
            />
          </label>
          <p className="subtle">
            In your Discord server, open Server Settings → Integrations →
            Webhooks, choose a channel, and copy the webhook URL. You need
            permission to manage webhooks. The URL is a secret saved locally in
            plaintext; it is never returned to the UI. Never share it or include
            the settings file in a support upload.
          </p>
          <p className={preferences.hasWebhook ? "settings-message" : "subtle"} role="status">
            {preferences.hasWebhook ? "Webhook configured. Leave the URL blank to keep it, or enter a new URL to replace it when you save." : "No webhook configured. Enter a URL and save to set one up."}
          </p>
          <BiomeSelection
            legend="Biomes to broadcast"
            selected={preferences.biomes}
            disabled={busy}
            onChange={(selected) =>
              setPreferences({ ...preferences, biomes: selected })
            }
          />
          <p className="subtle">
            Independent of auto-join pause targets. Repeated scans of the same
            server and biome are suppressed during this session. Your Roblox
            username is included as the detection source. No screenshots, cookie
            values, or pings are sent. Join links use Roblox’s web handoff;
            availability and exact-server joining depend on Roblox.
          </p>
          <p className="subtle">
            Last loaded status: {preferences.webhookStatus || "Disabled"}.
          </p>
        </section>
        <div className="settings-actions">
          <button disabled={busy} type="submit">
            {busy ? "Saving preferences…" : "Save preferences"}
          </button>
        </div>
      </form>
      {message && (
        <p role="status" className="settings-message">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="settings-error">
          {error}
        </p>
      )}
    </section>
  );
}
