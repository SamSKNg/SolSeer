import { useLayoutEffect, useRef } from "react";

// Observe sections once per page visit, never once per live snapshot.
export function useScrollReveals(page, paused) {
  const ref = useRef(null);
  const revealed = useRef(new WeakSet());
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const sections = [...root.querySelectorAll("[data-reveal]")];
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let observer;
    const reveal = (section) => {
      revealed.current.add(section);
      section.dataset.reveal = "visible";
      observer?.unobserve(section);
    };
    const reset = () => {
      observer?.disconnect();
      sections.forEach((section) => {
        section.dataset.reveal = "visible";
      });
    };
    const setup = () => {
      reset();
      if (
        paused ||
        media?.matches ||
        typeof IntersectionObserver === "undefined"
      ) {
        sections.forEach((section) => revealed.current.add(section));
        return;
      }
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach(({ target, isIntersecting }) => {
            if (isIntersecting) reveal(target);
          });
        },
        { threshold: 0, rootMargin: "0px 0px -32px 0px" },
      );
      sections.forEach((section) => {
        // Above-the-fold content is immediately usable. Only stage offscreen sections.
        if (
          !revealed.current.has(section) &&
          section.getBoundingClientRect().top >= window.innerHeight &&
          !section.contains(document.activeElement)
        ) {
          section.dataset.reveal = "pending";
          observer.observe(section);
        } else revealed.current.add(section);
      });
    };
    const focus = (event) => {
      const section = event.target.closest?.("[data-reveal]");
      if (section && root.contains(section)) reveal(section);
    };
    setup();
    // Changing motion preferences reveals everything immediately; never re-hide it.
    const preferenceChanged = () => {
      reset();
      sections.forEach((section) => revealed.current.add(section));
    };
    media?.addEventListener?.("change", preferenceChanged);
    root.addEventListener("focusin", focus);
    return () => {
      reset();
      media?.removeEventListener?.("change", preferenceChanged);
      root.removeEventListener("focusin", focus);
    };
  }, [page, paused]);
  return ref;
}
