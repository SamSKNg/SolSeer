import React, { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { DEFAULT_NOTIFICATIONS } from "../shared/notifications.js";
import { notificationPermission } from "./useNotifications.js";

export function NotificationSettings({ initial, token, ready }) {
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
      const response = await fetch("/api/settings", {
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
    >
      <div className="panel-heading">
        <h2>Something stirring.</h2>
        <Bell size={20} aria-hidden="true" />
      </div>
      <p className="settings-intro">
        Desktop alerts for new signals, even when this tab is in the background.
      </p>
      <p className="subtle">
        Keep the backend app running. Desktop alerts also need this browser tab;
        browser or Windows Do Not Disturb settings may suppress them. Clicking
        an alert opens server details.
      </p>
      <p className="settings-status">Browser permission: {permission}</p>
      {permission === "denied" && (
        <p className="settings-warning">
          Notifications are blocked. Allow notifications for this localhost site
          in your browser’s site settings, then return here.
        </p>
      )}
      {permission === "unsupported" && (
        <p className="settings-warning">
          This browser does not support desktop notifications. The in-app signal
          carousel remains available.
        </p>
      )}
      <form onSubmit={save}>
        <label className="settings-consent">
          <input
            type="checkbox"
            checked={preferences.enabled}
            disabled={!ready || busy}
            onChange={(event) =>
              setPreferences({ ...preferences, enabled: event.target.checked })
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
              setPreferences({ ...preferences, cluster: event.target.checked })
            }
          />
          Rapid filling (+3 or more within 15.5s)
        </label>
        <p className="subtle">
          Early alerts fire immediately at 13–18 players, without waiting for
          confirmation. Rapid filling includes full servers because Roblox can
          queue the join. Stale and held-only leads do not trigger a new desktop
          alert. One desktop alert per episode, plus a rapid-filling upgrade;
          simultaneous detections are grouped.
        </p>
        <div className="settings-divider" aria-hidden="true" />
        <h3>Auto-join signal types</h3>
        <p className="subtle">
          Choose which new signals the Auto-join switch may open. The master
          switch remains beside Signals to watch on the Server radar page.
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
            {busy ? "Saving preferences…" : "Save signal preferences"}
          </button>
          <button
            type="button"
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
