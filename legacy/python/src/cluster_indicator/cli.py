"""Small console frontend for environments without Streamlit."""

from __future__ import annotations

import logging
import time

from .tracker import LiveTracker


def main() -> None:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    tracker = LiveTracker().start()
    last_poll = -1
    print("Live tracker started. Press Ctrl+C to stop.")
    try:
        while True:
            snapshot = tracker.snapshot()
            if snapshot.poll_count != last_poll:
                last_poll = snapshot.poll_count
                print(
                    f"\nPoll {snapshot.poll_count} · {snapshot.status} · "
                    f"{snapshot.active_servers} active · "
                    f"{snapshot.potential_count} potential · {snapshot.cluster_count} cluster"
                )
                for row in snapshot.rows[:10]:
                    delta = "n/a" if row["Δ poll"] is None else f"{row['Δ poll']:+d}"
                    print(
                        f"{row['Alert']:<10} {row['Players']:>2}/{row['Capacity']:<2} "
                        f"poll {delta:>4} score {row['Score']:>5.1f} {row['Join']}"
                    )
            time.sleep(1.0)
    except KeyboardInterrupt:
        print("\nStopping tracker…")
    finally:
        tracker.stop()
