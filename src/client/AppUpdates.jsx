import React, { useEffect, useState } from "react";

export function AppUpdates({ banner = false }) {
  const [state, setState] = useState(null);
  const [dismissed, setDismissed] = useState(null);
  const [busy, setBusy] = useState(false);
  const bridge = window.solseerDesktop;
  useEffect(() => {
    if (!bridge?.updates || !bridge.onUpdateStatus) return;
    let alive = true;
    const stop = bridge.onUpdateStatus(value => { if (alive) setState(value); });
    bridge.updates("status").then(value => { if (alive) setState(value); }).catch(() => {});
    return () => { alive = false; stop(); };
  }, [bridge]);
  const act = async action => {
    if (busy) return;
    setBusy(true);
    try { await bridge.updates(action); }
    catch { setState(current => ({ ...current, status: "error", message: "Could not complete the update request. Please try again." })); }
    finally { setBusy(false); }
  };
  if (banner && (state?.status !== "ready" || dismissed === state.availableVersion)) return null;
  return <section className={`app-updates ${banner ? "update-banner" : ""}`} aria-label="Application updates">
    {!banner && <h3>Application updates</h3>}
    {!banner && state?.version && <p className="subtle">Installed version: {state.version}</p>}
    <p role="status">{state?.message ?? "Automatic updates are available in the installed Windows app. Browser development and portable copies are not updated automatically."}</p>
    {state?.status === "downloading" && <progress aria-label="Update download" max="100" value={state.percent ?? 0} />}
    <div className="settings-actions">
      {!banner && state && state.status !== "unsupported" && <button type="button" disabled={busy || ["checking", "downloading", "ready", "installing"].includes(state.status)} onClick={() => act("check")}>Check for updates</button>}
      {state?.status === "ready" && <button type="button" disabled={busy} onClick={() => act("install")}>Restart to update</button>}
      {banner && <button type="button" onClick={() => setDismissed(state.availableVersion)}>Later</button>}
    </div>
  </section>;
}
