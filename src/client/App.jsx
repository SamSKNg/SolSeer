import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Radio,
  Search,
  SlidersHorizontal,
  History,
  Server,
  ChevronRight,
  Copy,
  Check,
  Radar,
  Zap,
  Clock,
  X,
  Maximize2,
  Minus,
  Pause,
  Play,
  Settings2,
  GalleryHorizontal,
  LayoutGrid,
  MapPin,
  ScanLine,
} from "lucide-react";
import "./styles.css";
import { PollCountdown } from "./PollCountdown.jsx";
import { Sparkline } from "./Sparkline.jsx";
import { ReflectionScene } from "./ReflectionScene.jsx";
import { SignalView } from "./SignalView.jsx";
import { CopyServerLink } from "./CopyServerLink.jsx";
import "./reflection.css";
import "./gallery.css";
import "./motion.css";
import { useScrollReveals } from "./useScrollReveals.js";
import { Settings } from "./Settings.jsx";
import { useNotifications } from "./useNotifications.js";
import {
  compareSignals,
  isActionable,
  signalLabel,
  signalLabels,
} from "../shared/signals.js";

const labels = signalLabels;
const biomeColors = {
  // Matched visually to the heading fills in the supplied August 2026 guide.
  // Biomes absent from that guide retain their existing colors.
  Normal: "#c7ccd3",
  Windy: "#9fcfe0",
  Snowy: "#dedede",
  Rainy: "#5865ed",
  Sandstorm: "#be8b45",
  Hell: "#b63217",
  Starfall: "#286bbd",
  Heaven: "#ebd36a",
  Corruption: "#713dbe",
  Null: "#505050",
  Glitched: "#e5ffff",
  Dreamspace: "#c77aba",
  Cyberspace: "#537bde",
  Singularity: "#d58a6d",
  "Pumpkin Moon": "#ff842f",
  Graveyard: "#989bad",
  "Blazing Sun": "#ffb936",
  "Blood Rain": "#dc4058",
  Aurora: "#67f0c8",
  Eggland: "#fff18c",
  Incinerator: "#ff6335",
};
const pace = (row) =>
  row.growthPer10s == null ? "—" : row.growthPer10s.toFixed(1);
const peerSummary = (row) =>
  row.peerGrowth?.percentile == null
    ? `Insufficient comparison data (${row.peerGrowth?.count ?? 0}/${row.peerGrowth?.minimumPeers ?? 20} peers)`
    : `Growing faster than ${row.peerGrowth.percentile}% of ${row.peerGrowth.count} comparable sampled servers`;
const observationAge = (row, now) =>
  `${Math.max(0, Math.floor(((now ?? row.lastSeen) - row.lastSeen) / 1000))}s`;
const availability = (row) =>
  row.players < row.capacity
    ? `${Math.max(0, row.capacity - row.players)} open slots`
    : row.alert === "cluster"
      ? "Full · Roblox queue"
      : "Full";
const delta = (n) => (n == null ? "—" : `${n > 0 ? "+" : ""}${n}`);
const date = (at) =>
  at
    ? new Date(at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";
const blank = {
  rows: [],
  joins: [],
  events: [],
  budget: 0,
  polls: 0,
  tracked: 0,
  totalJoins: 0,
  notifications: null,
  presence: null,
  automation: null,
  currentServerId: null,
};

function Badge({ value, row }) {
  return (
    <span className={`badge ${value}`}>
      <i />
      {row ? signalLabel(row) : labels[value] || value || "Unknown"}
    </span>
  );
}
function Join({
  id,
  children = "Join server",
  compact = false,
  disabled = false,
}) {
  return (
    <form
      action={`/api/join/${encodeURIComponent(id)}`}
      method="POST"
      target="_blank"
      onSubmit={disabled ? (event) => event.preventDefault() : undefined}
    >
      <button
        className={`join ${compact ? "compact" : ""}`}
        type="submit"
        disabled={disabled}
      >
        {children}
        {disabled ? <MapPin size={15} /> : <ArrowUpRight size={15} />}
      </button>
    </form>
  );
}
export function App() {
  const [data, setData] = useState(blank),
    [connected, setConnected] = useState(false);
  const receivedAt = useRef(0);
  const [motionPaused, setMotionPaused] = useState(
    () =>
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  const [tab, setTab] = useState("servers"),
    [search, setSearch] = useState(""),
    [min, setMin] = useState(13);
  const [hideJoined, setHideJoined] = useState(false),
    [alertsOnly, setAlertsOnly] = useState(false);
  const [selected, setSelected] = useState(null),
    [limit, setLimit] = useState(20),
    [copied, setCopied] = useState(false);
  const [serversOpen, setServersOpen] = useState(false);
  const [signalView, setSignalView] = useState("carousel");
  const [dismissed, setDismissed] = useState(() => new Set());
  const pageRef = useScrollReveals(tab, motionPaused);
  const drawerRef = useRef(null);
  const copyTimer = useRef(null);
  const autoJoinRequest = useRef(null);
  const [autoJoinBusy, setAutoJoinBusy] = useState(false);
  const [autoJoinError, setAutoJoinError] = useState("");
  const notificationError = useNotifications(data, (id) => {
    setTab("servers");
    setSelected(id);
  });
  useEffect(() => {
    const stream = new EventSource("/api/events");
    stream.onmessage = (event) => {
      receivedAt.current = performance.now();
      const snapshot = JSON.parse(event.data);
      setData(snapshot);
      // A dismissed notice stays quiet for this signal episode, not forever.
      setDismissed((previous) => {
        const active = new Set(
          snapshot.rows
            .filter(
              (r) =>
                r.isFresh !== false &&
                ["cluster", "potential"].includes(r.alert),
            )
            .flatMap((r) => [`${r.id}:potential`, `${r.id}:cluster`]),
        );
        const next = new Set([...previous].filter((id) => active.has(id)));
        return next.size === previous.size ? previous : next;
      });
      setConnected(true);
    };
    stream.onerror = () => setConnected(false);
    return () => {
      stream.close();
      clearTimeout(copyTimer.current);
      autoJoinRequest.current?.abort();
    };
  }, []);
  const togglePreference = async (key) => {
    if (autoJoinBusy) return;
    const preferences = data.notifications?.preferences;
    if (!preferences) return;
    const controller = new AbortController();
    autoJoinRequest.current?.abort();
    autoJoinRequest.current = controller;
    setAutoJoinBusy(true);
    setAutoJoinError("");
    try {
      const settingsResponse = await fetch("/api/settings", {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!settingsResponse.ok) throw new Error();
      const { token, notifications: latestPreferences } =
        await settingsResponse.json();
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Solseer-Token": token,
        },
        body: JSON.stringify({
          notifications: {
            ...(latestPreferences ?? preferences),
            [key]: !preferences[key],
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (!controller.signal.aborted)
        setData((current) => ({
          ...current,
          notifications: {
            ...current.notifications,
            preferences: result.notifications,
          },
        }));
    } catch {
      if (!controller.signal.aborted)
        setAutoJoinError(
          `Could not update ${key === "autoStart" ? "Auto-Start" : "auto-join"}. Try again.`,
        );
    } finally {
      if (!controller.signal.aborted) setAutoJoinBusy(false);
      if (autoJoinRequest.current === controller)
        autoJoinRequest.current = null;
    }
  };
  const toggleAutoJoin = () => togglePreference("autoJoin");
  const toggleAutoStart = () => {
    const enabled = data.notifications?.preferences.autoStart;
    const resolution =
      data.notifications?.preferences.ocrResolution === "1080p"
        ? "1920 × 1080"
        : "2560 × 1440";
    if (
      !enabled &&
      !window.confirm(
        `Auto-Start clicks Play while Roblox is the foreground maximized window on a ${resolution} display. Biome and Play-marker OCR pause when you switch to another app. Continue?`,
      )
    )
      return;
    togglePreference("autoStart");
  };
  useEffect(() => {
    if (!selected) return;
    setCopied(false);
    clearTimeout(copyTimer.current);
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    drawerRef.current?.querySelector("button")?.focus();
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setSelected(null);
      if (event.key === "Tab") {
        const controls = drawerRef.current?.querySelectorAll(
          'button, a[href], input, select, [tabindex="0"]',
        );
        if (!controls?.length) return;
        const first = controls[0],
          last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [selected]);
  const alerts = data.rows
    .filter(
      (r) => r.isFresh !== false && ["cluster", "potential"].includes(r.alert),
    )
    .sort((a, b) => b.players - a.players || compareSignals(a, b));
  const notifications = alerts
    .filter(
      (r) =>
        isActionable(r) &&
        (r.noticeEligible ?? r.notificationEligible) !== false &&
        !dismissed.has(`${r.id}:${r.alert}`),
    )
    .sort(compareSignals);
  const notice = notifications[0];
  const rows = useMemo(
    () =>
      data.rows
        .filter(
          (r) =>
            r.players >= min &&
            (!hideJoined || !r.joined) &&
            (!alertsOnly ||
              (r.isFresh !== false &&
                ["cluster", "potential"].includes(r.alert))) &&
            r.id.toLowerCase().includes(search.toLowerCase()),
        )
        .sort(
          (a, b) =>
            b.players - a.players ||
            compareSignals(a, b) ||
            a.id.localeCompare(b.id),
        ),
    [data, min, hideJoined, alertsOnly, search],
  );
  const detail = data.rows.find((r) => r.id === selected);
  const currentServerId = data.currentServerId ?? data.presence?.serverId;
  const currentBiome = data.automation?.biome ?? null;
  const currentBiomeColor = biomeColors[currentBiome] ?? "#c7ccd3";
  const autoJoinCooldownSeconds = data.notifications?.autoJoinCooldownUntil
    ? Math.max(
        0,
        Math.ceil(
          (data.notifications.autoJoinCooldownUntil -
            (data.now ?? Date.now())) /
            1000,
        ),
      )
    : 0;
  const titles = {
    settings: ["Settings", "Your connection, kept on this machine."],
    servers: ["Server radar", "Follow the movement. Find the signal."],
    history: ["Join history", "Servers opened during this backend session."],
    activity: [
      "Poll activity",
      "A live record of each poll cycle and its page requests.",
    ],
  };
  return (
    <div
      className={`shell reflection gallery ${motionPaused ? "motion-paused" : ""}`}
    >
      <a className="skip-link" href="#main-content">
        Skip to tracker
      </a>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="solseer home">
          solseer
        </a>
        <div className="workspace">
          <span className="game-icon">S</span>
          <div>
            <strong>Sol’s RNG</strong>
            <small>PUBLIC SERVER MONITOR</small>
          </div>
        </div>
        <nav aria-label="Primary navigation">
          {[
            ["servers", Radar, "Server radar"],
            ["history", History, "Join history"],
            ["activity", Activity, "Poll activity"],
            ["settings", Settings2, "Settings"],
          ].map(([key, Icon, label]) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              aria-current={tab === key ? "page" : undefined}
              onClick={() => setTab(key)}
            >
              <Icon size={18} />
              {label}
              {key === "history" && (
                <span className="nav-count">{data.totalJoins}</span>
              )}
            </button>
          ))}
        </nav>
        <button
          className="motion-toggle"
          aria-label={motionPaused ? "Resume reflections" : "Pause reflections"}
          aria-pressed={motionPaused}
          onClick={() => setMotionPaused(!motionPaused)}
        >
          {motionPaused ? <Play size={13} /> : <Pause size={13} />}{" "}
          <span>Reflections</span>
        </button>
      </aside>
      <main id="main-content">
        <header className="topbar">
          <span>
            SOL’S RNG <ChevronRight size={13} /> {titles[tab][0]}
          </span>
          <div className={`connection ${connected ? "" : "offline"}`}>
            <span className="live-dot" />
            {connected ? "Live connection" : "Reconnecting…"}
          </div>
        </header>
        <div className="content" key={tab} ref={pageRef} data-page={tab}>
          <div
            className={`page-heading ${tab !== "servers" ? "compact-heading" : ""}`}
          >
            {tab === "servers" && (
              <ReflectionScene motionPaused={motionPaused} />
            )}
            <div className="hero-copy">
              <div className="eyebrow">
                {tab === "servers"
                  ? "an ongoing study of chance"
                  : "notes from the current session"}
              </div>
              <h1>
                {tab === "servers" ? (
                  <>
                    <span className="title-opening">In search of</span>{" "}
                    <em>the unseen.</em>
                  </>
                ) : (
                  titles[tab][0]
                )}
              </h1>
              <p>
                {tab === "servers"
                  ? "A gathering. A ripple. Something worth looking closer at. Follow the quiet shifts in Sol’s RNG."
                  : titles[tab][1]}
              </p>
              {tab === "servers" && (
                <button
                  className="gallery-entry"
                  onClick={() => {
                    setServersOpen(true);
                    document
                      .getElementById("live-servers")
                      ?.scrollIntoView({ block: "start" });
                  }}
                >
                  Find a server <ArrowUpRight size={18} />
                </button>
              )}
            </div>
            <div className="poll-timer">
              <div className="timer-icon">
                <Clock size={20} />
              </div>
              <div>
                <small>NEXT POLL</small>
                <PollCountdown
                  nextAt={data.nextAt}
                  serverNow={data.now}
                  receivedAt={receivedAt.current}
                  busy={data.busy}
                  connected={connected}
                />
              </div>
            </div>
          </div>
          {tab === "servers" && (
            <div className="art-caption">
              <span>01 — Reflections on chance</span>
              <span>Nothing certain. Everything possible.</span>
            </div>
          )}
          {notificationError && (
            <p role="status" className="settings-error">
              {notificationError}
            </p>
          )}
          {data.error && (
            <div className="error-banner">
              <Radio size={18} />
              <div>
                <strong>Request delayed</strong>
                <p>
                  {data.error}. The tracker will retry within the available
                  budget.
                </p>
              </div>
            </div>
          )}
          <section
            className="metrics gallery-notes"
            data-reveal="visible"
            aria-label="Tracker statistics"
          >
            <Metric
              icon={Server}
              title="Recently visible"
              value={data.rows.length}
              note={`${data.tracked} unique IDs tracked`}
            />
            <Metric
              icon={Zap}
              title="Population leads"
              value={alerts.length}
              note={`${alerts.filter((r) => r.alert === "cluster").length} rapid · ${alerts.filter((r) => r.alert === "potential").length} early / recent`}
              accent
            />
            <Metric
              icon={History}
              title="Join attempts"
              value={data.totalJoins}
              note="Current session only"
            />
            <Metric
              icon={Activity}
              title="API requests"
              value={data.totalRequests ?? data.polls}
              note={`Last result ${date(data.lastAt)}`}
            />
          </section>
          {tab === "servers" && currentServerId && (
            <section
              className="current-server-card"
              data-biome={currentBiome}
              aria-label="Current Roblox server"
              data-reveal="visible"
              style={{ "--biome-color": currentBiomeColor }}
            >
              <div className="current-server-aura" aria-hidden="true">
                {Array.from({ length: 12 }, (_, index) => (
                  <i
                    key={index}
                    style={{
                      "--particle-y": `${8 + ((index * 29) % 84)}%`,
                      "--particle-delay": `${-index * 0.83}s`,
                      "--particle-duration": `${6 + (index % 4)}s`,
                      "--particle-size": `${2 + (index % 3)}px`,
                    }}
                  />
                ))}
              </div>
              <div className="current-server-card-icon" aria-hidden="true">
                <MapPin size={19} />
              </div>
              <div className="current-server-card-copy">
                <span>Current Roblox server</span>
                <div className="current-server-identity">
                  <button
                    type="button"
                    onClick={() => setSelected(currentServerId)}
                  >
                    Server {currentServerId.slice(0, 8)}
                  </button>
                  <strong>{data.presence?.username ?? "Account"}</strong>
                  <strong className="current-server-biome">
                    {currentBiome ?? "Biome pending"}
                  </strong>
                </div>
                <small>
                  Presence confirmed
                  {currentBiome
                    ? data.automation?.biomeFresh
                      ? " · live biome reading"
                      : " · last detected biome"
                    : " · waiting for first biome reading"}
                </small>
              </div>
              <div className="current-server-card-state">
                <span>Connected</span>
                {autoJoinCooldownSeconds > 0 && (
                  <small>Join cooldown {autoJoinCooldownSeconds}s</small>
                )}
              </div>
              <div className="current-server-card-actions">
                <CopyServerLink id={currentServerId} />
                <button
                  type="button"
                  onClick={() => setSelected(currentServerId)}
                >
                  Inspect <ArrowUpRight size={14} aria-hidden="true" />
                </button>
              </div>
            </section>
          )}
          {tab === "servers" && (
            <>
              <div className="signal-section-header" data-reveal="visible">
                <div className="section-heading signal-section-heading">
                  <h2>Signals to watch</h2>
                </div>
                <div className="signal-heading-actions">
                  {data.automation && (
                    <p className="ocr-status ocr-status-inline" role="status">
                      <ScanLine size={14} aria-hidden="true" />
                      {data.automation.status !== "scanning"
                        ? data.automation.message
                        : "Live OCR"}
                      {data.automation.lastScanAt != null && (
                        <span title="Text similarity to the closest known biome, not an OCR accuracy probability.">
                          {" · "}
                          {!data.automation.scanAccepted
                            ? "no match"
                            : `${Math.round(data.automation.scanConfidence * 100)}% match (${data.automation.scanBiome})`}
                        </span>
                      )}
                    </p>
                  )}
                  <button
                    type="button"
                    className="auto-join-toggle"
                    aria-pressed={Boolean(
                      data.notifications?.preferences.autoJoin,
                    )}
                    disabled={autoJoinBusy || !data.notifications?.preferences}
                    title="Windows only. Launches Roblox for the strongest enabled signal type, including full rapid-fill queues, at most once per episode. Choose Early or Rapid in Settings."
                    onClick={toggleAutoJoin}
                  >
                    <Zap size={15} aria-hidden="true" />
                    {autoJoinBusy
                      ? "Saving auto-join…"
                      : `Auto-join ${data.notifications?.preferences.autoJoin ? "On" : "Off"}`}
                  </button>
                  <button
                    type="button"
                    className="auto-join-toggle auto-start-toggle"
                    aria-pressed={Boolean(
                      data.notifications?.preferences.autoStart,
                    )}
                    disabled={autoJoinBusy || !data.notifications?.preferences}
                    title={`Windows only. With Roblox foreground and maximized at ${data.notifications?.preferences.ocrResolution === "1080p" ? "1920 × 1080" : "2560 × 1440"}, one OCR pass reads both the biome and Play marker. Scanning pauses while another app is foreground.`}
                    onClick={toggleAutoStart}
                  >
                    <ScanLine size={15} aria-hidden="true" />
                    {autoJoinBusy
                      ? "Saving Auto-Start…"
                      : `Auto-Start ${data.notifications?.preferences.autoStart ? "On" : "Off"}`}
                  </button>
                  <div
                    className="signal-view-switch"
                    role="group"
                    aria-label="Signal view"
                  >
                    <button
                      type="button"
                      aria-pressed={signalView === "carousel"}
                      onClick={() => setSignalView("carousel")}
                    >
                      <GalleryHorizontal size={15} aria-hidden="true" />{" "}
                      Carousel
                    </button>
                    <button
                      type="button"
                      aria-pressed={signalView === "cards"}
                      onClick={() => setSignalView("cards")}
                    >
                      <LayoutGrid size={15} aria-hidden="true" /> Cards
                    </button>
                  </div>
                </div>
              </div>
              {autoJoinError && (
                <p className="signal-setting-error" role="alert">
                  {autoJoinError}
                </p>
              )}
              {data.notifications?.autoJoinPausedBiome && (
                <p className="target-biome-status" role="status">
                  Auto-join paused · target biome{" "}
                  {data.notifications.autoJoinPausedBiome} detected
                </p>
              )}
              <SignalView
                view={signalView}
                items={alerts}
                now={data.now}
                motionPaused={motionPaused}
                suspended={Boolean(selected)}
                renderCard={(r) => (
                  <article key={r.id} className={`signal-card ${r.alert}`}>
                    <div className="signal-top">
                      <Badge value={r.alert} row={r} />
                      <span className="mono">
                        {r.isFresh === false ? "Stale · " : "Observed "}
                        {observationAge(r, data.now)} ago
                      </span>
                    </div>
                    <button
                      className="signal-title"
                      onClick={() => setSelected(r.id)}
                    >
                      <span>
                        Server {r.id.slice(0, 8)}
                        {r.isCurrentServer && (
                          <span className="current-server-marker">
                            <MapPin size={13} aria-hidden="true" /> You are here
                          </span>
                        )}
                      </span>
                      <ArrowUpRight size={17} />
                    </button>
                    <div className="signal-numbers">
                      <strong>
                        {r.players}
                        <small>/{r.capacity} players</small>
                      </strong>
                      <span className="growth">
                        {delta(r.deltaPoll)} <small>last observation</small>
                      </span>
                    </div>
                    <Sparkline
                      history={r.history}
                      capacity={r.capacity}
                      now={data.now}
                    />
                    <p className="signal-reason">{r.reasons?.join(" · ")}</p>
                    <p
                      className="subtle"
                      title="Same capacity, starting population within 2 players, similar sample duration. Ranking context, not biome confidence."
                    >
                      {peerSummary(r)}
                    </p>
                    <div className="signal-footer">
                      {r.isCurrentServer ? (
                        <span className="current-server-marker">
                          <MapPin size={13} aria-hidden="true" /> Current server
                        </span>
                      ) : r.joined ? (
                        <span
                          className="previously-joined"
                          title={`${r.joined.count} recorded join attempt(s) this session. Arrival in Roblox is not confirmed.`}
                        >
                          <Check size={13} aria-hidden="true" /> Previously
                          joined
                        </span>
                      ) : (
                        <span>{availability(r)}</span>
                      )}
                      <div className="signal-actions">
                        <CopyServerLink id={r.id} />
                        <Join id={r.id} compact disabled={r.isCurrentServer}>
                          {r.isCurrentServer
                            ? "Current server"
                            : r.joined
                              ? "Join again"
                              : "Join server"}
                        </Join>
                      </div>
                    </div>
                  </article>
                )}
                empty={
                  <div className="empty-signal">
                    <Radar size={32} />
                    <div>
                      <strong>
                        {data.polls
                          ? "Listening for a population jump"
                          : "Connecting to the server list"}
                      </strong>
                      <p>
                        {data.polls
                          ? "Burst window: 15.5s. +2 is an early lead; +3 or more is rapid filling."
                          : "Your first observations will appear as soon as the request completes."}
                      </p>
                    </div>
                    <span className="listening">MONITORING</span>
                  </div>
                }
              />
              <p className="signal-disclaimer">
                Population leads, not confirmed rare biomes. Highest player
                count first; each server is only updated when its page is
                sampled.
                {data.pollIntervalMs > 15000 &&
                  " Current polling is too slow to resolve the 15.5-second burst window; close-together observations are required."}
              </p>
              <section
                id="live-servers"
                data-reveal="visible"
                className={`panel server-window ${serversOpen ? "expanded" : ""}`}
                aria-label="Live server window"
              >
                <div className="panel-heading">
                  <h2>
                    <span className="window-index">01 /</span> Live servers{" "}
                    <span className="count">
                      {Math.min(rows.length, limit)}
                    </span>
                  </h2>
                  <button
                    className="window-toggle"
                    aria-expanded={serversOpen}
                    aria-controls="server-window-content"
                    onClick={() => setServersOpen(!serversOpen)}
                  >
                    {serversOpen ? "Collapse servers" : `Explore top ${limit}`}{" "}
                    {serversOpen ? (
                      <Minus size={16} />
                    ) : (
                      <Maximize2 size={16} />
                    )}
                  </button>
                </div>
                <p className="window-description">
                  Highest population first. {rows.length} matching servers. All
                  counts update when their page is sampled, not on every poll.
                </p>
                {serversOpen && (
                  <div id="server-window-content">
                    <div className="toolbar">
                      <label className="search">
                        <Search size={16} />
                        <input
                          placeholder="Search Job ID…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          aria-label="Search Job ID"
                        />
                      </label>
                      <label className="filter">
                        <SlidersHorizontal size={15} />
                        Players ≥{" "}
                        <input
                          type="number"
                          min="13"
                          max="100"
                          value={min}
                          onChange={(e) =>
                            setMin(Math.max(13, Number(e.target.value)))
                          }
                          aria-label="Minimum players"
                        />
                      </label>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={alertsOnly}
                          onChange={(e) => setAlertsOnly(e.target.checked)}
                        />
                        Alerts only
                      </label>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={hideJoined}
                          onChange={(e) => setHideJoined(e.target.checked)}
                        />
                        Hide joined
                      </label>
                      <select
                        value={limit}
                        onChange={(e) => setLimit(Number(e.target.value))}
                        aria-label="Visible server limit"
                      >
                        <option value={10}>Top 10 by population</option>
                        <option value={20}>Top 20 by population</option>
                      </select>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>SERVER</th>
                            <th>SIGNAL</th>
                            <th>PLAYERS</th>
                            <th>Δ OBSERVED</th>
                            <th>GAIN ≤15.5s</th>
                            <th>TREND</th>
                            <th>PACE /10s</th>
                            <th>AGE</th>
                            <th>JOINED</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {rows.slice(0, limit).map((r, index) => (
                            <tr key={r.id}>
                              <td>
                                <button
                                  className="server-id"
                                  onClick={() => setSelected(r.id)}
                                >
                                  <span
                                    className="server-rank"
                                    aria-hidden="true"
                                  >
                                    {String(index + 1).padStart(2, "0")}
                                  </span>
                                  <span>
                                    {r.id.slice(0, 8)}
                                    {r.isCurrentServer && (
                                      <small className="current-server-marker">
                                        <MapPin size={11} aria-hidden="true" />
                                        You are here
                                      </small>
                                    )}
                                    <small>{r.ping ?? "—"} ms ping</small>
                                  </span>
                                </button>
                              </td>
                              <td>
                                <Badge value={r.alert} row={r} />
                              </td>
                              <td>
                                <div className="population">
                                  {r.players}
                                  <span>/{r.capacity}</span>
                                  <div className="population-bar">
                                    <i
                                      style={{
                                        width: `${Math.min(100, (r.players / r.capacity) * 100)}%`,
                                      }}
                                    />
                                  </div>
                                </div>
                              </td>
                              <td className={r.deltaPoll > 0 ? "positive" : ""}>
                                {delta(r.deltaPoll)}
                              </td>
                              <td className={r.growth15s > 0 ? "positive" : ""}>
                                {delta(r.growth15s)}
                              </td>
                              <td>
                                <Sparkline
                                  history={r.history}
                                  capacity={r.capacity}
                                  now={data.now}
                                />
                              </td>
                              <td
                                className="mono"
                                title="Observed net growth normalized to ten seconds, not a forecast or confidence score"
                              >
                                {pace(r)}
                              </td>
                              <td className="subtle">
                                {Math.max(
                                  0,
                                  Math.floor((data.now - r.lastSeen) / 1000),
                                )}
                                s
                              </td>
                              <td>
                                {r.joined ? (
                                  <span className="joined">
                                    <Check size={13} />
                                    {r.joined.count}×
                                  </span>
                                ) : (
                                  <span className="subtle">—</span>
                                )}
                              </td>
                              <td>
                                <Join
                                  id={r.id}
                                  compact
                                  disabled={r.isCurrentServer}
                                >
                                  {r.isCurrentServer
                                    ? "Current"
                                    : r.joined
                                      ? "Join again"
                                      : "Join"}
                                </Join>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!rows.length && (
                        <div className="empty-table">
                          {data.polls
                            ? "No servers match these filters."
                            : "Waiting for the first poll…"}
                        </div>
                      )}
                    </div>
                    <div className="table-footer">
                      <span>
                        {Math.min(rows.length, limit)} of {rows.length} matches
                        · population descending · sample age shown per server
                      </span>
                      <span>
                        <span className="live-dot" /> Live updates enabled
                      </span>
                    </div>
                  </div>
                )}
              </section>
            </>
          )}
          {tab === "history" && (
            <section className="panel" data-reveal="visible">
              <div className="panel-heading">
                <h2>Opened servers</h2>
                <a
                  href="/api/joins/export"
                  download="solseer-join-history.json"
                >
                  Export all history (JSON)
                </a>
                <span className="subtle">
                  Latest 200 attempts · join biomes are captured by OCR and
                  saved locally with graph evidence
                </span>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>OPENED AT</th>
                      <th>JOB ID</th>
                      <th>PLAYERS</th>
                      <th>SIGNAL AT CLICK</th>
                      <th>PACE /10s</th>
                      <th>BIOME AT JOIN</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.joins.map((j) => (
                      <tr key={j.id}>
                        <td>{new Date(j.at).toLocaleString()}</td>
                        <td className="mono">{j.jobId}</td>
                        <td>
                          {j.players ?? "—"}/{j.capacity ?? "—"}
                        </td>
                        <td>
                          <Badge value={j.alert} row={j} />
                        </td>
                        <td>{pace(j)}</td>
                        <td>
                          <span
                            className={`join-biome ${j.biome ? "detected" : "pending"}`}
                            style={
                              j.biome
                                ? { "--biome-color": biomeColors[j.biome] }
                                : undefined
                            }
                            title={
                              j.biome
                                ? `${j.biomeSource === "tesseract" ? "Tesseract" : "Windows OCR"} · ${Math.round((j.biomeConfidence ?? 0) * 100)}% match`
                                : "Waiting for account presence and a biome OCR match"
                            }
                          >
                            {j.biome ?? "Waiting for OCR"}
                          </span>
                        </td>
                        <td>
                          <Join
                            id={j.jobId}
                            compact
                            disabled={j.jobId === data.currentServerId}
                          >
                            {j.jobId === data.currentServerId
                              ? "Current"
                              : "Join again"}
                          </Join>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.joins.length && (
                  <div className="empty-table">
                    Your manual and automatic join attempts will appear here for
                    this session.
                  </div>
                )}
              </div>
            </section>
          )}
          {tab === "activity" && (
            <section className="panel" data-reveal="visible">
              <div className="panel-heading">
                <h2>Request timeline</h2>
                <span className="subtle">Latest 100 poll cycles</span>
              </div>
              <div className="timeline">
                {data.events.map((e) => (
                  <div key={e.id} className="event">
                    <span className={`event-icon ${e.error ? "failed" : ""}`}>
                      <Radio size={18} />
                    </span>
                    <div>
                      <strong>{e.page}</strong>
                      <small>
                        {e.requests ?? 1} API request(s)
                        {e.partial
                          ? ` · partial update: ${e.count ?? 0} servers refreshed`
                          : ""}
                        {e.deferredPage
                          ? ` · page ${e.deferredPage} deferred for quota`
                          : ""}
                      </small>
                      <p>
                        {e.error ||
                          `${e.count} servers · ${e.fresh} first seen · ${e.growing} growing · ${e.retention ?? "—"}% retained`}
                      </p>
                      {!e.error && (
                        <small>
                          {e.filteredBelowMin ?? 0} servers below 13 players
                          filtered out
                        </small>
                      )}
                    </div>
                    <div className="event-time">
                      <span>{date(e.at)}</span>
                      <small>{e.duration} ms</small>
                    </div>
                  </div>
                ))}
                {!data.events.length && (
                  <div className="empty-table">No completed polls yet.</div>
                )}
              </div>
            </section>
          )}
          {tab === "settings" && <Settings />}
          <footer className="page-footer" data-reveal="visible">
            <span>
              <Radio size={13} /> Sol’s RNG public-server telemetry
            </span>
            <span>
              <span className="budget-readout">
                {data.budget}/{data.requestLimit ?? 3}
              </span>{" "}
              requests used / rolling minute ·{" "}
              {(data.pollIntervalMs ?? 20500) / 1000}s polling · up to{" "}
              {data.pagesPerPoll ?? 1} page(s) per cycle
            </span>
          </footer>
        </div>
      </main>
      <div
        className="notice-announcer"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {notice
          ? `${signalLabel(notice)}: server ${notice.id.slice(0, 8)}. ${notifications.length} actionable leads.`
          : ""}
      </div>
      {notice && !selected && (
        <aside
          className="signal-notice"
          aria-label={
            notice.alert === "cluster"
              ? "Strong signal notification"
              : "Early lead notification"
          }
        >
          <div className="notice-heading">
            <span>
              <Zap size={13} />{" "}
              {notice.alert === "cluster" ? "RAPID FILLING" : "EARLY LEAD"} /{" "}
              {String(notifications.length).padStart(2, "0")}
            </span>
            <button
              aria-label={
                notice.alert === "cluster"
                  ? "Dismiss strong signal"
                  : "Dismiss early lead"
              }
              onClick={() =>
                setDismissed(
                  (previous) =>
                    new Set([
                      ...previous,
                      `${notice.id}:${notice.alert}`,
                      ...(notice.alert === "cluster"
                        ? [`${notice.id}:potential`]
                        : []),
                    ]),
                )
              }
            >
              <X size={16} />
            </button>
          </div>
          <button
            className="notice-title"
            aria-label={`Inspect server ${notice.id}`}
            onClick={() => setSelected(notice.id)}
          >
            Server {notice.id.slice(0, 8)} <ArrowUpRight size={16} />
          </button>
          <p>
            {notice.players}/{notice.capacity} players · {availability(notice)}
            {" · "}observed {observationAge(notice, data.now)} ago
          </p>
          <small>
            {notice.reasons?.join(" · ") ||
              "Rapid population growth observed; biome unknown."}
          </small>
          <div className="notice-actions">
            <button onClick={() => setSelected(notice.id)}>
              Inspect signal
            </button>
            <Join id={notice.id} compact disabled={notice.isCurrentServer}>
              {notice.isCurrentServer
                ? "Current"
                : notice.joined
                  ? "Join again"
                  : "Join"}
            </Join>
          </div>
        </aside>
      )}
      {selected && (
        <div className="drawer-overlay" onClick={() => setSelected(null)}>
          <aside
            ref={drawerRef}
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Server details"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              onClick={() => setSelected(null)}
              aria-label="Close server details"
            >
              <X size={21} />
            </button>
            {detail ? (
              <>
                <div className="eyebrow">SERVER DETAIL</div>
                <h2>Follow the signal.</h2>
                <Badge value={detail.alert} row={detail} />
                <p className="subtle">
                  Observed {observationAge(detail, data.now)} ago ·{" "}
                  {detail.isFresh === false
                    ? "Stale; awaiting a sample"
                    : `${availability(detail)} at last observation`}
                </p>
                <div className="detail-id">
                  <code>{detail.id}</code>
                  <button
                    aria-label="Copy Job ID"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(detail.id);
                        setCopied(true);
                        clearTimeout(copyTimer.current);
                        copyTimer.current = setTimeout(
                          () => setCopied(false),
                          2000,
                        );
                      } catch {
                        setCopied(false);
                      }
                    }}
                  >
                    {copied ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                </div>
                <div className="detail-pop">
                  {detail.players}
                  <small>/{detail.capacity} players</small>
                </div>
                <Sparkline
                  history={detail.history}
                  capacity={detail.capacity}
                  now={data.now}
                  large
                />
                <div className="chart-labels">
                  <span>{date(detail.history[0]?.at)}</span>
                  <span>Auto-zoom · players</span>
                  <span>{date(data.now)}</span>
                </div>
                <p className="subtle">
                  Flat segments hold the last reading. Dashed = last known
                  count, awaiting a new observation.
                </p>
                <div className="detail-stats">
                  <Metric
                    title="Last observation"
                    value={delta(detail.deltaPoll)}
                    note="players"
                  />
                  <Metric
                    title="Gain within 15.5 seconds"
                    value={delta(detail.growth15s)}
                    note="net players"
                  />
                  <Metric
                    title="Observed growth pace"
                    value={pace(detail)}
                    note="net players /10s, not a forecast"
                  />
                  <Metric
                    title="Peak population"
                    value={detail.peak}
                    note={`First seen ${date(detail.firstSeen)}`}
                  />
                  <Metric
                    title="Peer-window slope"
                    value={
                      detail.peerGrowth?.slopePer10s == null
                        ? "—"
                        : detail.peerGrowth.slopePer10s.toFixed(1)
                    }
                    note={`net players /10s over ${((detail.peerGrowth?.durationMs ?? 0) / 1000).toFixed(1)}s of actual observations`}
                  />
                  <Metric
                    title="Burst gain retained"
                    value={
                      detail.burstGainRetained == null
                        ? "—"
                        : `${detail.burstGainRetained}/${detail.burstMemory.gain}`
                    }
                    note="net players from the original burst, not biome confidence"
                  />
                </div>
                <p className="detail-note">
                  {peerSummary(detail)}.{" "}
                  {detail.peerGrowth?.medianPer10s != null &&
                    `Peer median: ${detail.peerGrowth.medianPer10s.toFixed(1)} net players /10s. `}
                  Matched by capacity, starting population (±2), and observation
                  duration (±3s). Comparison only ranks leads; it never triggers
                  an alert by itself.
                </p>
                <p className="detail-note">
                  {detail.reasons?.join(" · ") || "No growth rule met yet."}{" "}
                  Near-full occupancy (context only):{" "}
                  {Math.floor((detail.nearFullDurationMs ?? 0) / 1000)}s / 60s.
                </p>
                <CopyServerLink id={detail.id} />
                <Join id={detail.id} disabled={detail.isCurrentServer}>
                  {detail.isCurrentServer
                    ? "Current server"
                    : detail.joined
                      ? "Join again"
                      : "Join server"}
                </Join>
                <p className="detail-note">
                  {detail.isCurrentServer
                    ? "Roblox presence reports that your configured account is in this server."
                    : detail.joined
                      ? `Previously joined · ${detail.joined.count} recorded join attempt(s). Last attempt ${date(detail.joined.at)}. Arrival in Roblox is not confirmed.`
                      : "Opening a server records a join attempt for this session only."}
                </p>
              </>
            ) : (
              <>
                <h2>
                  {selected === data.currentServerId
                    ? "Your current Roblox server"
                    : "Server left the recent sample"}
                </h2>
                <p>
                  It may still be running. This Job ID is available for this
                  session.
                </p>
                <code>{selected}</code>
                <CopyServerLink id={selected} />
                <Join
                  id={selected}
                  disabled={selected === data.currentServerId}
                >
                  {selected === data.currentServerId
                    ? "Current server"
                    : "Join server"}
                </Join>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
function Metric({ icon: Icon, title, value, note, accent }) {
  return (
    <article className={`metric ${accent ? "accent" : ""}`}>
      <div className="metric-title">
        {title}
        {Icon && <Icon size={16} />}
      </div>
      <strong>{value}</strong>
      <p>{note}</p>
    </article>
  );
}
