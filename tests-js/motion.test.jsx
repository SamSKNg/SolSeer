import React from "react";
import { test, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { useScrollReveals } from "../src/client/useScrollReveals.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Page({ page = "servers", paused = false, count = 0 }) {
  const ref = useScrollReveals(page, paused);
  return (
    <div key={page} ref={ref}>
      <section data-reveal="visible">
        <button>Inspect {count}</button>
      </section>
    </div>
  );
}
function setup({ reduced = false, supported = true } = {}) {
  const observers = [];
  const listeners = new Set();
  const media = {
    matches: reduced,
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn),
  };
  vi.stubGlobal("matchMedia", () => media);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    top: 5000,
  });
  vi.stubGlobal(
    "IntersectionObserver",
    supported
      ? class {
          constructor(callback) {
            this.callback = callback;
            this.observe = vi.fn();
            this.unobserve = vi.fn();
            this.disconnect = vi.fn();
            observers.push(this);
          }
        }
      : undefined,
  );
  return { observers, media, listeners };
}

test("scroll reveal runs once per section and does not restart on live updates", () => {
  const { observers } = setup();
  const view = render(<Page />);
  const section = view.container.querySelector("section");
  expect(section.dataset.reveal).toBe("pending");
  observers[0].callback([{ target: section, isIntersecting: false }]);
  expect(section.dataset.reveal).toBe("pending");
  observers[0].callback([{ target: section, isIntersecting: true }]);
  expect(section.dataset.reveal).toBe("visible");
  expect(observers[0].unobserve).toHaveBeenCalledWith(section);
  view.rerender(<Page count={1} />);
  expect(observers).toHaveLength(1);
  expect(view.container.querySelector("section")).toBe(section);
  expect(section.dataset.reveal).toBe("visible");
  view.rerender(<Page page="history" />);
  expect(observers[0].disconnect).toHaveBeenCalled();
  expect(view.container.querySelector("section")).not.toBe(section);
  expect(view.container.querySelector("section").dataset.reveal).toBe(
    "pending",
  );
});

test("keyboard focus reveals a section immediately and cleanup disconnects observers", () => {
  const { observers, listeners } = setup();
  const view = render(<Page />);
  const section = view.container.querySelector("section");
  fireEvent.focusIn(view.getByRole("button"));
  expect(section.dataset.reveal).toBe("visible");
  expect(observers[0].unobserve).toHaveBeenCalledWith(section);
  view.unmount();
  expect(observers[0].disconnect).toHaveBeenCalled();
  expect(listeners.size).toBe(0);
});

test("pausing or changing motion preference reveals pending content without replaying it", () => {
  const { observers, listeners, media } = setup();
  const view = render(<Page />);
  const section = view.container.querySelector("section");
  view.rerender(<Page paused />);
  expect(section.dataset.reveal).toBe("visible");
  expect(observers[0].disconnect).toHaveBeenCalled();
  view.rerender(<Page />);
  expect(section.dataset.reveal).toBe("visible");
  view.rerender(<Page page="history" />);
  const next = view.container.querySelector("section");
  expect(next.dataset.reveal).toBe("pending");
  media.matches = true;
  listeners.forEach((fn) => fn({ matches: true }));
  expect(next.dataset.reveal).toBe("visible");
});

test.each([{ reduced: true }, { supported: false }])(
  "motion preference or unsupported observers never hide content: %j",
  (options) => {
    const { observers } = setup(options);
    const view = render(<Page />);
    expect(view.container.querySelector("section").dataset.reveal).toBe(
      "visible",
    );
    expect(observers).toHaveLength(0);
  },
);
