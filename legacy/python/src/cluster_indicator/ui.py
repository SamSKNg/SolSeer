"""Reactive Streamlit dashboard for the live tracker."""

from __future__ import annotations

from datetime import datetime

import pandas as pd
import streamlit as st

from .tracker import LiveTracker


PLACE_ID = 15532962292


@st.cache_resource
def get_tracker() -> LiveTracker:
    # One process-wide worker prevents each browser rerun/session from consuming
    # its own copy of the three-request Roblox quota.
    return LiveTracker(place_id=PLACE_ID).start()


def run() -> None:
    st.set_page_config(
        page_title="Sol's RNG Cluster Indicator",
        page_icon="📡",
        layout="wide",
    )
    st.title("Sol's RNG Cluster Indicator")
    st.caption(
        "Live behavioral leads from public-server player movement — not direct biome verification."
    )

    with st.sidebar:
        st.header("View filters")
        minimum_players = st.slider("Minimum players", 0, 20, 10)
        alerts_only = st.checkbox("Potential/cluster only", value=False)
        hide_joined = st.checkbox("Hide joined servers", value=False)
        row_limit = st.slider("Maximum rows", 10, 200, 60, step=10)
        st.divider()
        st.markdown(
            "**Polling plan**\n\n"
            "One request every 20.5 seconds: `top → top → coverage`. "
            "This keeps the highest-population servers fresher while staying "
            "under three requests per rolling minute. A newly detected alert "
            "queues a same-page verification after five seconds when quota allows."
        )

    tracker = get_tracker()

    @st.fragment(run_every=1.0)
    def live_panel() -> None:
        snapshot = tracker.snapshot()
        metric_columns = st.columns(7)
        metric_columns[0].metric("Status", snapshot.status)
        metric_columns[1].metric("API budget", f"{snapshot.request_budget_used}/3")
        metric_columns[2].metric("Next request", f"{snapshot.next_poll_seconds:.0f}s")
        metric_columns[3].metric(
            "Active / tracked",
            f"{snapshot.active_servers} / {snapshot.tracked_servers}",
        )
        metric_columns[4].metric("Potential", snapshot.potential_count)
        metric_columns[5].metric("Clusters", snapshot.cluster_count)
        metric_columns[6].metric("Join clicks", snapshot.joined_clicks)

        if snapshot.last_updated:
            updated = datetime.fromtimestamp(snapshot.last_updated).strftime("%H:%M:%S")
            st.caption(
                f"Dashboard refreshes every second · last API result {updated} · "
                f"{snapshot.poll_count} request(s) processed"
            )
        else:
            st.info("Starting the first Roblox request…")
        if snapshot.error:
            st.warning(f"Latest API error: {snapshot.error}")
        if snapshot.verification_pending:
            st.info(
                "A same-page verification is queued. The countdown reflects the "
                "earliest time permitted by the rolling API budget."
            )

        rows = [row for row in snapshot.rows if row["Players"] >= minimum_players]
        if alerts_only:
            rows = [row for row in rows if row["Alert"] in {"CLUSTER", "POTENTIAL"}]
        if hide_joined:
            rows = [row for row in rows if not row["Joined"]]
        rows = rows[:row_limit]

        alert_rows = [row for row in rows if row["Alert"] in {"CLUSTER", "POTENTIAL"}]
        for row in alert_rows[:5]:
            message = (
                f"{row['Alert']}: {row['Players']}/{row['Capacity']} players, "
                f"Δ poll {row['Δ poll']:+d}, score {row['Score']:.1f} — "
                f"[join server]({row['Join']})"
            )
            if row["Alert"] == "CLUSTER":
                st.error(message)
            else:
                st.warning(message)

        server_tab, history_tab, activity_tab = st.tabs(
            ["Live servers", "Joined servers", "Poll activity"]
        )
        with server_tab:
            st.caption(
                "Clicking Join records the server locally before forwarding you to Roblox."
            )
            if rows:
                frame = pd.DataFrame(rows)
                st.dataframe(
                    frame,
                    use_container_width=True,
                    hide_index=True,
                    height=min(850, 38 + 35 * len(frame)),
                    column_config={
                        "Join": st.column_config.LinkColumn(
                            "Join", display_text="Join"
                        ),
                        "Score": st.column_config.NumberColumn("Score", format="%.1f"),
                        "Age (s)": st.column_config.NumberColumn(
                            "Age (s)", format="%d"
                        ),
                    },
                )
            else:
                st.info("No servers match the current filters yet.")

        with history_tab:
            if snapshot.join_history:
                st.dataframe(
                    pd.DataFrame(snapshot.join_history),
                    use_container_width=True,
                    hide_index=True,
                    column_config={
                        "Rejoin": st.column_config.LinkColumn(
                            "Rejoin", display_text="Open Roblox"
                        ),
                        "Score": st.column_config.NumberColumn("Score", format="%.1f"),
                    },
                )
            else:
                st.info("No join links have been clicked yet.")

        with activity_tab:
            st.caption(
                "A row is appended immediately after every API response, rather than once per minute."
            )
            if snapshot.events:
                st.dataframe(
                    pd.DataFrame(snapshot.events[:20]),
                    use_container_width=True,
                    hide_index=True,
                )

    live_panel()


if __name__ == "__main__":
    run()
