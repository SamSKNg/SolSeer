import React, { memo, useEffect, useRef, useId } from "react";
import "./stars.css";

// Deterministic placement prevents live snapshots from reshuffling the sky.
const stars = Array.from({ length: 24 }, (_, index) => {
  const angle = index * 2.39996;
  const radius = Math.sqrt((index + 1) / 24);
  return {
    x: 535 + Math.cos(angle) * radius * 390,
    y: 345 + Math.sin(angle) * radius * 290,
    size: index % 7 === 0 ? 0.45 : 0.16 + ((index * 17) % 5) / 25,
    layer: index % 3,
  };
});

export const ReflectionScene = memo(function ReflectionScene({
  motionPaused = false,
}) {
  const sceneRef = useRef(null);
  const starId = useId().replaceAll(":", "");
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
    <div
      ref={sceneRef}
      className="reflection-scene ethereal-scene"
      aria-hidden="true"
    >
      <div className="starlight-haze" />
      <svg className="starfield" viewBox="0 0 1000 750" focusable="false">
        <defs>
          <path id={starId} d="M0-12Q2-2 12 0Q2 2 0 12Q-2 2-12 0Q-2-2 0-12Z" />
          <linearGradient
            id={`${starId}-tail`}
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="800"
            x2="0"
            y2="0"
          >
            <stop offset="0" stopColor="#dce4f2" stopOpacity="0" />
            <stop offset="0.5" stopColor="#e3ebff" stopOpacity="0.3" />
            <stop offset="0.8" stopColor="#eef3ff" stopOpacity="0.65" />
            <stop offset="1" stopColor="#fffaf0" stopOpacity="1" />
          </linearGradient>
        </defs>
        {[0, 1, 2].map((layer) => (
          <g key={layer} style={{ "--depth": 0.6 + layer * 0.6 }}>
            <g className="star-layer star-head">
              {stars
                .filter((star) => star.layer === layer)
                .map((star, index) => (
                  <g key={index} transform={`translate(${star.x} ${star.y})`}>
                    <g
                      className="shooting-star"
                      style={{
                        "--phase": `${-(index * 1.71 + layer * 2.9)}s`,
                        "--period": `${9 + (index % 5)}s`,
                      }}
                    >
                      <g transform={`scale(${star.size})`}>
                        <path
                          className="shooting-tail"
                          d="M0 800L0 0"
                          stroke={`url(#${starId}-tail)`}
                        />
                        <use href={`#${starId}`} className="star-spark" />
                      </g>
                    </g>
                  </g>
                ))}
            </g>
          </g>
        ))}
        <g className="star-dust">
          {Array.from({ length: 24 }, (_, index) => (
            <circle
              key={index}
              cx={130 + ((index * 137) % 770)}
              cy={80 + ((index * 89) % 570)}
              r={index % 3 === 0 ? 1.1 : 0.6}
            />
          ))}
        </g>
      </svg>
      <span className="scene-coordinate">a little closer to the infinite</span>
    </div>
  );
});
