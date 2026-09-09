import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Pause, Play } from "lucide-react";
import { Sparkline } from "./Sparkline.jsx";
import { signalLabel } from "../shared/signals.js";
import "./carousel.css";

export function SignalCarousel({
  items,
  renderCard,
  empty,
  now,
  motionPaused = false,
  suspended = false,
}) {
  const [activeId, setActiveId] = useState(null);
  const [manualPause, setManualPause] = useState(false);
  const [interactionPause, setInteractionPause] = useState(false);
  const [direction, setDirection] = useState("next");
  const [inView, setInView] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  const [reduced, setReduced] = useState(
    () =>
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  const active = items.find((item) => item.id === activeId) ?? items[0];
  const index = active ? items.findIndex((item) => item.id === active.id) : 0;
  const previous =
    items.length > 1 ? items[(index - 1 + items.length) % items.length] : null;
  const next = items.length > 1 ? items[(index + 1) % items.length] : null;
  const latest = useRef({ items, active });
  latest.current = { items, active };
  const deadline = useRef(performance.now() + 8000);
  const pauseUntil = useRef(0);
  // Autoplay pauses must not suppress a transition explicitly requested by the user.
  const motionDisabled = motionPaused || suspended || reduced || !inView;
  const blocked = motionDisabled || manualPause;
  const cardRef = useRef(null);
  const rootRef = useRef(null);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.2 },
    );
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const update = (event) => setReduced(event.matches);
    media?.addEventListener?.("change", update);
    return () => media?.removeEventListener?.("change", update);
  }, []);

  // Keep the current server stable when live ranks change. Only replace it if it leaves.
  useEffect(() => {
    if (active?.id !== activeId) {
      setActiveId(active?.id ?? null);
      deadline.current = performance.now() + 8000;
    }
  }, [active?.id, activeId]);

  useEffect(() => {
    const pause = () => {
      pauseUntil.current = performance.now() + 10000;
      deadline.current = pauseUntil.current;
      setInteractionPause(true);
    };
    document.addEventListener("click", pause, true);
    document.addEventListener("pointerdown", pause, true);
    document.addEventListener("keydown", pause, true);
    return () => {
      document.removeEventListener("click", pause, true);
      document.removeEventListener("pointerdown", pause, true);
      document.removeEventListener("keydown", pause, true);
    };
  }, []);

  useEffect(() => {
    // No catch-up burst after returning from a dialog, hidden tab or manual pause.
    deadline.current = Math.max(performance.now() + 8000, pauseUntil.current);
    const visibleAgain = () => {
      deadline.current = Math.max(performance.now() + 8000, pauseUntil.current);
    };
    document.addEventListener("visibilitychange", visibleAgain);
    const timer = setInterval(() => {
      const now = performance.now();
      if (now >= pauseUntil.current) setInteractionPause(false);
      if (
        blocked ||
        document.hidden ||
        now < deadline.current ||
        now < pauseUntil.current
      )
        return;
      const { items: currentItems, active: current } = latest.current;
      if (currentItems.length < 2) return;
      // Do not remove a card while its links are being navigated with the keyboard.
      if (cardRef.current?.contains(document.activeElement)) return;
      const currentIndex = currentItems.findIndex(
        (item) => item.id === current?.id,
      );
      setDirection("next");
      setActiveId(currentItems[(currentIndex + 1) % currentItems.length].id);
      deadline.current = now + 8000;
    }, 250);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibleAgain);
    };
  }, [blocked]);

  const advance = (amount) => {
    if (items.length < 2) return;
    setDirection(amount > 0 ? "next" : "previous");
    setActiveId(items[(index + amount + items.length) % items.length].id);
    pauseUntil.current = performance.now() + 10000;
    deadline.current = pauseUntil.current;
    setInteractionPause(true);
  };

  return (
    <section
      ref={rootRef}
      className="signal-carousel"
      data-reveal="visible"
      aria-label="Cluster candidates"
      aria-roledescription="carousel"
    >
      <div
        className={`carousel-viewport ${previous ? "has-previews" : ""} ${motionDisabled ? "motion-disabled" : ""}`}
        data-direction={direction}
      >
        {previous && (
          <SignalPreview
            item={previous}
            now={now}
            side="previous"
            onClick={() => advance(-1)}
          />
        )}
        {active ? (
          <div
            key={active.id}
            ref={cardRef}
            className={`carousel-slide ${direction} ${motionDisabled ? "still" : ""}`}
            role="group"
            aria-roledescription="slide"
            aria-label={`Signal ${index + 1} of ${items.length}`}
          >
            {renderCard(active)}
          </div>
        ) : (
          <div className="carousel-empty">{empty}</div>
        )}
        {next && (
          <SignalPreview
            item={next}
            now={now}
            side="next"
            onClick={() => advance(1)}
          />
        )}
      </div>
      <div className="carousel-controls">
        <span className="carousel-position">
          {String(active ? index + 1 : 0).padStart(2, "0")}{" "}
          <span>/ {String(items.length).padStart(2, "0")}</span>
        </span>
        <span className="carousel-status">
          {!active
            ? "waiting for a signal"
            : items.length < 2
              ? "one signal, for now"
              : blocked
                ? "rotation paused"
                : interactionPause
                  ? "paused · 10s after interaction"
                  : "a new perspective every 8s"}
        </span>
        <div className="carousel-buttons">
          <button
            aria-label="Previous signal"
            disabled={items.length < 2}
            onClick={() => advance(-1)}
          >
            <ArrowLeft size={17} />
          </button>
          <button
            aria-label={
              manualPause ? "Resume signal rotation" : "Pause signal rotation"
            }
            aria-pressed={manualPause}
            disabled={items.length < 2 || motionPaused || reduced}
            onClick={() => setManualPause(!manualPause)}
          >
            {manualPause ? <Play size={14} /> : <Pause size={14} />}
          </button>
          <button
            aria-label="Next signal"
            disabled={items.length < 2}
            onClick={() => advance(1)}
          >
            <ArrowRight size={17} />
          </button>
        </div>
      </div>
    </section>
  );
}

function SignalPreview({ item, side, onClick, now }) {
  return (
    <button
      className={`carousel-preview preview-${side}`}
      onClick={onClick}
      aria-label={`View ${side} signal: server ${item.id}`}
    >
      <span className="preview-direction">
        {side === "previous" ? <ArrowLeft size={13} /> : null}
        {side}
        {side === "next" ? <ArrowRight size={13} /> : null}
      </span>
      <span key={item.id} className="preview-content" aria-hidden="true">
        <span className="preview-alert">{signalLabel(item)}</span>
        <strong className="preview-id">{item.id.slice(0, 8)}</strong>
        <span className="preview-population">
          {item.players ?? "—"}
          <small>/{item.capacity ?? "—"}</small>
        </span>
        <Sparkline history={item.history} capacity={item.capacity} now={now} />
        <span className="preview-invitation">bring into focus</span>
      </span>
    </button>
  );
}
