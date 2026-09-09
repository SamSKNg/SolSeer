import React from "react";
import { SignalCarousel } from "./SignalCarousel.jsx";
import "./signal-view.css";

export function SignalView({
  view,
  items,
  renderCard,
  empty,
  ...carouselProps
}) {
  if (view === "carousel")
    return (
      <SignalCarousel
        items={items}
        renderCard={renderCard}
        empty={empty}
        {...carouselProps}
      />
    );

  return (
    <section
      className="signal-index"
      aria-label="Cluster candidates"
      data-reveal="visible"
    >
      {items.length ? (
        <ol
          className="signal-index-list"
          aria-label="Signals sorted by population"
        >
          {items.map((item, index) => (
            <li key={item.id} className="signal-index-entry">
              <span className="signal-index-number" aria-hidden="true">
                {String(index + 1).padStart(2, "0")} / SIGNAL
              </span>
              {renderCard(item)}
            </li>
          ))}
        </ol>
      ) : (
        <div className="signal-index-empty">{empty}</div>
      )}
    </section>
  );
}
