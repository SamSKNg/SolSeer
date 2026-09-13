import React, { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { DEFAULT_NOTIFICATIONS } from "../shared/notifications.js";
import { BiomeSelection } from "./BiomeSelection.jsx";
import { notificationPermission } from "./useNotifications.js";
import { apiFetch } from "./transport.js";

export function NotificationSettings({
  initial,
  token,
  ready,
  category = null,
}) {
  const [preferences, setPreferences] = useState({
    ...DEFAULT_NOTIFICATIONS,
    ...initial,
  });
  const [permission, setPermission] = useState(notificationPermission);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const alive = useRef(true);
  const savedEnabled = useRef(Boolean(initial?.enabled));
  const request = useRef(null);
  const testNotice = useRef(null);
  useEffect(() => {
    alive.current = true;
    const refresh = () => setPermission(notificationPermission());
    window.addEventListener("focus", refresh);
    return () => {
      alive.current = false;
      request.current?.abort();
      testNotice.current?.close();
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const allow = async () => {
    setError("");
    try {
      const value = await window.Notification.requestPermission();
      if (alive.current) setPermission(value);
    } catch {
      if (alive.current)
        setError(
          "Could not request permission. Check this browser’s site settings.",
        );
    }
  };
  const save = async (event) => {
    event.preventDefault();
    if (
      busy ||
      !ready ||
      (preferences.enabled &&
        !savedEnabled.current &&
        notificationPermission() !== "granted")
    )
      return;
    setBusy(true);
    setError("");
    setMessage("");
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await apiFetch("/api/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Solseer-Token": token,
        },
        body: JSON.stringify({ notifications: preferences }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error();
      if (alive.current) {
        savedEnabled.current = preferences.enabled;
        setMessage(
          "Signal preferences saved on this machine. Only new signals will notify or auto-join.",
        );
      }
    } catch {
      if (alive.current)
        setError(
          "Could not save notification preferences. Reopen Settings and try again.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const test = () => {
    setError("");
    try {
      testNotice.current?.close();
      testNotice.current = new window.Notification(
        "solseer · Test notification",
        {
          body: "Desktop notifications are working. This is not a detected cluster.",
          tag: "solseer-test",
        },
      );
      testNotice.current.onerror = () => {
        if (alive.current)
          setError(
            "The notification could not be displayed. Check browser and Windows settings.",
          );
      };
      setMessage(
        "Test requested. If no notification appears, check Windows Do Not Disturb and browser notification settings.",
      );
    } catch {
      setError(
        "Notifications are not available in this browser. In-app signals still work.",
      );
    }
  };
  return (
    <section
      className="panel settings-panel notification-settings"
      aria-label="Notification settings"
      hidden={category === "connection" || category === "discord"}
    >
      <div hidden={category !== null && category !== "notifications"}>
        <div className="panel-heading">
          <h2>Something stirring.</h2>
          <Bell size={20} aria-hidden="true" />
        </div>
        <p className="settings-intro">
          Desktop alerts for new signals, even when this tab is in the
          background.
        </p>
        <p className="subtle">
          Keep the backend app running. Desktop alerts also need this browser
          tab; browser or Windows Do Not Disturb settings may suppress them.
          Clicking an alert opens server details.
        </p>
        <p className="settings-status">Browser permission: {permission}</p>
        {permission === "denied" && (
          <p className="settings-warning">
            Notifications are blocked. Allow notifications for this localhost
            site in your browser’s site settings, then return here.
          </p>
        )}
        {permission === "unsupported" && (
          <p className="settings-warning">
            This browser does not support desktop notifications. The in-app
            signal carousel remains available.
          </p>
        )}
      </div>
      <form onSubmit={save}>
        <div
          role={category ? "tabpanel" : undefined}
          id="settings-panel-polling"
          aria-labelledby={category ? "settings-tab-polling" : undefined}
          hidden={category !== null && category !== "polling"}
          tabIndex={0}
        >
          <h2>Server polling.</h2>
          <label className="settings-consent">
            Server polling interval (seconds)
            <input
              type="number"
              min="1"
              max="60"
              step="1"
              required
              value={preferences.pollIntervalSeconds}
              disabled={!ready || busy}
              onChange={(event) =>
                setPreferences({
                  ...preferences,
                  pollIntervalSeconds:
                    event.target.value === "" ? "" : Number(event.target.value),
                })
              }
            />
          </label>
          <p className="settings-description">
            Default: 1 second. Roblox rate limits and retry backoff can delay
            polls. This does not change the 500 ms OCR wait.
          </p>
        </div>
        <div
          role={category ? "tabpanel" : undefined}
          id="settings-panel-notifications"
          aria-labelledby={category ? "settings-tab-notifications" : undefined}
          hidden={category !== null && category !== "notifications"}
          tabIndex={0}
        >
          <label className="settings-consent">
            <input
              type="checkbox"
              checked={preferences.enabled}
              disabled={!ready || busy}
              onChange={(event) =>
                setPreferences({
                  ...preferences,
                  enabled: event.target.checked,
                })
              }
            />
            Enable desktop notifications
          </label>
          <label className="settings-consent">
            <input
              type="checkbox"
              checked={preferences.potential}
              disabled={!ready || busy}
              onChange={(event) =>
                setPreferences({
                  ...preferences,
                  potential: event.target.checked,
                })
              }
            />
            Early leads (+2 within 15.5s)
          </label>
          <label className="settings-consent">
            <input
              type="checkbox"
              checked={preferences.cluster}
              disabled={!ready || busy}
              onChange={(event) =>
                setPreferences({
                  ...preferences,
                  cluster: event.target.checked,
                })
              }
            />
            Rapid filling (+3 or more within 15.5s)
          </label>
          <p className="subtle">
            Early alerts fire immediately at 13–18 players, without waiting for
            confirmation. Rapid filling includes full servers because Roblox can
            queue the join. Stale and held-only leads do not trigger a new
            desktop alert. One desktop alert per episode, plus a rapid-filling
            upgrade; simultaneous detections are grouped.
          </p>
        </div>
        <div
          role={category ? "tabpanel" : undefined}
          id="settings-panel-auto-join"
          aria-labelledby={category ? "settings-tab-auto-join" : undefined}
          hidden={category !== null && category !== "auto-join"}
          tabIndex={0}
        >
          <h3>Auto-join signal types</h3>
          <p className="subtle">
            Choose which new signals the Auto-join switch may open. The master
            switch remains beside Signals to watch on the Server radar page.
            Auto-join also enables automatic Play clicks; turning it off
            disables those clicks. Target-biome pauses and join cooldowns still
            apply.
          </p>
          <label className="settings-consent">
            <input
              type="checkbox"
              checked={preferences.autoJoinPotential}
              disabled={!ready || busy}
              onChange={(event) =>
                setPreferences({
                  ...preferences,
                  autoJoinPotential: event.target.checked,
                })
              }
            />
            Auto-join early leads
          </label>
          <label className="settings-consent">
            <input
              type="checkbox"
              checked={preferences.autoJoinCluster}
              disabled={!ready || busy}
              onChange={(event) =>
                setPreferences({
                  ...preferences,
                  autoJoinCluster: event.target.checked,
                })
              }
            />
            Auto-join rapid filling (includes full queues)
          </label>
          <label className="settings-consent">
            <input
              type="checkbox"
              checked={preferences.autoJoinRecentFull ?? false}
              disabled={!ready || busy}
              onChange={(event) =>
                setPreferences({
                  ...preferences,
                  autoJoinRecentFull: event.target.checked,
                })
              }
            />
            Auto-join recent bursts in full servers
          </label>
          <p className="subtle">
            Also consider full servers retaining an earlier burst, even without
            new growth. Includes recent early and rapid bursts already on the
            list; attempts each episode once. Biome pauses and join cooldowns
            still apply.
          </p>
        </div>
        <div
          role={category ? "tabpanel" : undefined}
          id="settings-panel-ocr"
          aria-labelledby={category ? "settings-tab-ocr" : undefined}
          hidden={category !== null && category !== "ocr"}
          tabIndex={0}
        >
          <h3>Fullscreen OCR</h3>
          <p className="subtle">
            Biome OCR reads a fixed region of the foreground, maximized Roblox
            window and pauses when you switch apps. A shared capture and one
            Tesseract worker read both biome text and the Play marker.
            Auto-Start only clicks Play when Roblox itself is foreground. A
            selected target pauses automatic joins until OCR recognizes a
            different biome.
          </p>
          <div
            className="resolution-options"
            role="group"
            aria-label="OCR resolution"
          >
            <label className="settings-consent">
              <input
                type="radio"
                name="ocr-resolution"
                value="1440p"
                checked={preferences.ocrResolution === "1440p"}
                disabled={!ready || busy}
                onChange={() =>
                  setPreferences({ ...preferences, ocrResolution: "1440p" })
                }
              />
              2560 × 1440
            </label>
            <label className="settings-consent">
              <input
                type="radio"
                name="ocr-resolution"
                value="1080p"
                checked={preferences.ocrResolution === "1080p"}
                disabled={!ready || busy}
                onChange={() =>
                  setPreferences({ ...preferences, ocrResolution: "1080p" })
                }
              />
              1920 × 1080
            </label>
          </div>
        </div>
        <div
          role={category ? "tabpanel" : undefined}
          id="settings-panel-biome-targets"
          aria-labelledby={category ? "settings-tab-biome-targets" : undefined}
          hidden={category !== null && category !== "biome-targets"}
          tabIndex={0}
        >
          <h3>Biome Targets</h3>
          <p className="subtle">Choose which detected biomes pause auto-join until OCR recognizes a different biome. These targets are independent of Discord webhook selections.</p>
          <BiomeSelection
            legend="Biomes that pause auto-join"
            selected={preferences.biomeTargets}
            disabled={!ready || busy}
            onChange={(selected) =>
              setPreferences({ ...preferences, biomeTargets: selected })
            }
          />
        </div>
        <p className="subtle">
          Save applies changes across Polling, Notifications, Auto-join, OCR,
          and Biome Targets.
        </p>
        <div className="settings-actions">
          {permission === "default" && (
            <button type="button" onClick={allow}>
              Allow browser notifications
            </button>
          )}
          <button
            type="submit"
            disabled={
              !ready ||
              busy ||
              (preferences.enabled &&
                !savedEnabled.current &&
                permission !== "granted")
            }
          >
            {busy ? "Saving preferences…" : "Save preferences"}
          </button>
          <button
            type="button"
            hidden={category !== null && category !== "notifications"}
            disabled={permission !== "granted"}
            onClick={test}
          >
            Test notification
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
