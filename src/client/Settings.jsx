import React, { useEffect, useRef, useState } from "react";
import { LockKeyhole, Save, Trash2, Check, KeyRound } from "lucide-react";
import "./settings.css";
import { NotificationSettings } from "./NotificationSettings.jsx";
import { apiFetch } from "./transport.js";

export function Settings() {
  const [status, setStatus] = useState(null);
  const [cookie, setCookie] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const token = useRef("");
  const controller = useRef(null);
  useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    apiFetch("/api/settings", { signal: request.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const result = await response.json();
        if (!request.signal.aborted) {
          token.current = result.token;
          setStatus(result);
        }
      })
      .catch(() => {
        if (!request.signal.aborted)
          setError("Could not load settings. Reopen this page to try again.");
      });
    return () => controller.current?.abort();
  }, []);

  const save = async (value) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    setCookie("");
    const request = new AbortController();
    controller.current = request;
    try {
      const response = await apiFetch("/api/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Solseer-Token": token.current,
        },
        body: JSON.stringify({ cookie: value, confirmLocalStorage: true }),
        signal: request.signal,
      });
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (request.signal.aborted) return;
      setStatus(result);
      setConsent(false);
      setMessage(
        value
          ? "Saved locally. The new credential applies by the next poll; existing cooldowns remain in place."
          : "Cookie cleared from local settings and disabled for this session. Existing project .env files are unchanged.",
      );
    } catch {
      if (!request.signal.aborted)
        setError(
          "Could not save. Check the cookie format and folder permissions, or reopen settings and try again.",
        );
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  };

  return (
    <div className="settings-layout" data-reveal="visible">
      <section
        className="panel settings-panel cookie-settings"
        aria-label="Local settings"
      >
        <div className="panel-heading">
          <h2>Your connection.</h2>
          <LockKeyhole size={20} aria-hidden="true" />
        </div>
        <p className="settings-intro">
          A private connection, on this machine only.
        </p>
        <div
          className={`cookie-status ${status?.hasCookie ? "is-configured" : "is-empty"}`}
          role="status"
          aria-live="polite"
        >
          <span className="cookie-status-icon" aria-hidden="true">
            {status?.hasCookie ? <Check size={22} /> : <KeyRound size={22} />}
          </span>
          <div>
            <span className="cookie-status-label">
              {status?.hasCookie
                ? "Already set"
                : status
                  ? "Optional connection"
                  : "Connection status"}
            </span>
            <strong>
              {status
                ? status.hasCookie
                  ? "Cookie configured"
                  : "No cookie configured"
                : error
                  ? "Cookie status unavailable"
                  : "Checking your local settings…"}
            </strong>
            <p>
              {status?.hasCookie
                ? "No need to paste it again. The field below is only for replacing your current cookie."
                : status
                  ? "You’re using anonymous polling. Add a cookie below if you want to configure it."
                  : "Your cookie value is never displayed here."}
            </p>
            {status?.hasCookie && (
              <span className="cookie-source">
                {status.source === "local settings"
                  ? "Saved on this machine"
                  : status.source === "environment"
                    ? "Loaded from startup environment"
                    : status.source === "project .env / anonymous"
                      ? "Loaded from project .env"
                      : "Available to the local backend"}
              </span>
            )}
          </div>
        </div>
        {status?.hasCookie && (
          <p className="subtle cookie-validation-note">
            Configured does not mean verified: Roblox may still reject an
            expired or invalid cookie.
          </p>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (consent && cookie && status) save(cookie);
          }}
        >
          <label htmlFor="roblox-cookie">Roblox security cookie</label>
          <input
            id="roblox-cookie"
            name="solseer-credential"
            type="password"
            value={cookie}
            onChange={(event) => setCookie(event.target.value)}
            disabled={busy || !status}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            maxLength={32768}
            placeholder={
              status?.hasCookie
                ? "Paste a replacement cookie"
                : "Paste cookie value only"
            }
            aria-describedby="cookie-format cookie-warning"
          />
          <p id="cookie-format" className="subtle">
            Value only, including its warning prefix. Omit Cookie: and
            .ROBLOSECURITY=. Saved values are never shown or returned here.
          </p>
          <div id="cookie-warning" className="settings-warning">
            <strong>Treat this like your password.</strong>
            <p>
              A .ROBLOSECURITY cookie grants access to your Roblox session.
              Anyone with the file may be able to use your account. Local .env
              storage is plaintext, not encrypted. Never share it, sync it, or
              include it in a support screenshot.
            </p>
            <p>
              Used only by this app’s backend for fixed Roblox public-server,
              account identity, and presence requests. A cookie does not
              guarantee a higher rate limit.
            </p>
          </div>
          {status && (
            <p className="settings-location">
              Local settings file <code>{status.storagePath}</code>
            </p>
          )}
          {status?.environmentOverride && (
            <p className="settings-warning">
              A startup environment variable was supplied. Settings changes
              apply now, but that variable takes precedence again after a
              restart unless you remove it from your launcher.
            </p>
          )}
          <label className="settings-consent">
            <input
              type="checkbox"
              checked={consent}
              disabled={busy}
              onChange={(event) => setConsent(event.target.checked)}
            />{" "}
            I understand and want to save this cookie as a local plaintext .env
            file.
          </label>
          <div className="settings-actions">
            <button
              type="submit"
              disabled={busy || !status || !cookie || !consent}
            >
              <Save size={15} />
              {busy
                ? "Saving…"
                : status?.hasCookie
                  ? "Replace cookie"
                  : "Save on this machine"}
            </button>
            <button
              type="button"
              disabled={busy || !status?.hasCookie}
              onClick={() => save("")}
            >
              <Trash2 size={15} />
              Clear / use anonymous
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
      {status && (
        <NotificationSettings
          initial={status.notifications}
          token={token.current}
          ready
        />
      )}
      {!status && (
        <section
          className="panel settings-panel notification-settings"
          aria-label="Notification settings"
        >
          <div className="panel-heading">
            <h2>Something stirring.</h2>
          </div>
          <p className="subtle">
            {error
              ? "Reopen Settings to load notification preferences."
              : "Loading notification preferences…"}
          </p>
        </section>
      )}
      <p className="subtle settings-session-note">
        Connection and notification preferences persist. Server observations and
        join history still reset when the app closes.
      </p>
    </div>
  );
}
