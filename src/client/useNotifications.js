import { useEffect, useRef, useState } from "react";

export function notificationPermission() {
  return typeof window.Notification === "function"
    ? window.Notification.permission
    : "unsupported";
}

export function showNotification(events, inspect) {
  if (!events.length || notificationPermission() !== "granted") return null;
  const first = events[0];
  const title =
    events.length > 1
      ? `solseer · ${events.length} new signals`
      : `solseer · ${first.alert === "cluster" ? "Rapid filling" : "Early lead"}`;
  const notice = new window.Notification(title, {
    body: `${events
      .slice(0, 3)
      .map(
        (event) =>
          `${event.alert === "cluster" ? "Rapid filling" : "Early lead"}: ${event.id.slice(0, 8)} · ${event.players}/${event.capacity} players · ${event.players >= event.capacity ? "full queue" : `${Math.max(0, event.capacity - event.players)} open slots`}${event.reason ? ` · ${event.reason}` : ""}`,
      )
      .join(
        "\n",
      )}\nPopulation leads, not confirmed rare biomes. Click to inspect.`,
    tag: "solseer-live-signals",
  });
  notice.onclick = () => {
    window.focus();
    inspect(first.id);
    notice.close();
  };
  return notice;
}

export function useNotifications(data, inspect) {
  const current = useRef({ data, inspect });
  current.current = { data, inspect };
  const request = useRef(null);
  const notices = useRef(new Set());
  const [error, setError] = useState("");
  useEffect(
    () => () => {
      request.current?.abort();
      notices.current.forEach((notice) => notice.close());
      notices.current.clear();
    },
    [],
  );
  useEffect(() => {
    if (!data.notifications?.preferences.enabled) {
      notices.current.forEach((notice) => notice.close());
      notices.current.clear();
      setError("");
      return;
    }
    if (
      !data.notifications.pending ||
      notificationPermission() !== "granted" ||
      request.current
    )
      return;
    const controller = new AbortController();
    request.current = controller;
    (async () => {
      try {
        const response = await fetch("/api/settings", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error();
        const { token } = await response.json();
        if (
          controller.signal.aborted ||
          !current.current.data.notifications?.preferences.enabled ||
          notificationPermission() !== "granted"
        )
          return;
        const claimed = await fetch("/api/notifications/claim", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Solseer-Token": token,
          },
          signal: controller.signal,
        });
        if (!claimed.ok) throw new Error();
        const { events } = await claimed.json();
        if (
          controller.signal.aborted ||
          !current.current.data.notifications?.preferences.enabled
        )
          return;
        const notice = showNotification(events, (id) =>
          current.current.inspect(id),
        );
        if (notice) {
          notices.current.forEach((old) => old.close());
          notices.current.clear();
          notices.current.add(notice);
          notice.onclose = () => notices.current.delete(notice);
          notice.onerror = () =>
            setError(
              "Desktop notification could not be displayed. Check Settings and your browser/Windows notification permissions.",
            );
        }
        setError("");
      } catch {
        if (!controller.signal.aborted)
          setError(
            "Desktop notifications are unavailable. Signals are still visible in the app; check Settings and browser permissions.",
          );
      } finally {
        if (request.current === controller) request.current = null;
      }
    })();
  }, [data]);
  return error;
}
