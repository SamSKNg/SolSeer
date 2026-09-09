import React, { memo, useEffect, useRef } from "react";
import "./shards.css";

// Code-native facets keep the reference's reflected-light motif light and responsive.
export const ReflectionScene = memo(function ReflectionScene({
  motionPaused = false,
}) {
  const sceneRef = useRef(null);
  useEffect(() => {
    const scene = sceneRef.current;
    const hero = scene.closest(".page-heading");
    if (!hero) return;
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let frame = null,
      enabled = false,
      targetX = 0,
      targetY = 0;
    const reset = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      targetX = targetY = 0;
      scene.style.setProperty("--parallax-x", "0px");
      scene.style.setProperty("--parallax-y", "0px");
    };
    const configure = () => {
      enabled = !motionPaused && !preference?.matches;
      scene.dataset.parallax = enabled ? "on" : "off";
      reset();
    };
    const move = (event) => {
      if (
        !enabled ||
        document.hidden ||
        (event.pointerType && event.pointerType !== "mouse")
      )
        return;
      const bounds = hero.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const clamp = (value) => Math.max(-1, Math.min(1, value));
      targetX =
        clamp(((event.clientX - bounds.left) / bounds.width) * 2 - 1) * 22;
      targetY =
        clamp(((event.clientY - bounds.top) / bounds.height) * 2 - 1) * 14;
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        scene.style.setProperty("--parallax-x", `${targetX.toFixed(2)}px`);
        scene.style.setProperty("--parallax-y", `${targetY.toFixed(2)}px`);
      });
    };
    configure();
    hero.addEventListener("pointermove", move, { passive: true });
    hero.addEventListener("pointerleave", reset);
    window.addEventListener("blur", reset);
    window.addEventListener("resize", reset);
    window.addEventListener("scroll", reset, { passive: true });
    document.addEventListener("visibilitychange", reset);
    preference?.addEventListener?.("change", configure);
    return () => {
      reset();
      hero.removeEventListener("pointermove", move);
      hero.removeEventListener("pointerleave", reset);
      window.removeEventListener("blur", reset);
      window.removeEventListener("resize", reset);
      window.removeEventListener("scroll", reset);
      document.removeEventListener("visibilitychange", reset);
      preference?.removeEventListener?.("change", configure);
    };
  }, [motionPaused]);
  return (
    <div ref={sceneRef} className="reflection-scene" aria-hidden="true">
      <div className="light-wall" />
      <div className="light-thread" />
      <div className="shard-composition">
        <i className="shard shard-main" />
        <i className="shard shard-side" />
        <i className="shard shard-chip" />
        <i className="shard shard-sliver" />
      </div>
      <div className="reflection-floor">
        <i />
        <i />
        <i />
      </div>
      <div className="horizon-light" />
      <span className="scene-coordinate">light, in fragments</span>
    </div>
  );
});
