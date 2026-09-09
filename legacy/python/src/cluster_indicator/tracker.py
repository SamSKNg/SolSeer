"""Background live tracker that publishes one snapshot after every API request."""

from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime

from .join_history import JoinHistory, JoinRecord, JoinRedirectServer
from .links import join_url
from .poller import RobloxApiClient
from .scorer import rank_servers
from .state import ServerState


@dataclass(frozen=True)
class PollEvent:
    observed_at: float
    page: str
    servers: int
    new_servers: int
    changed_servers: int
    positive_moves: int
    retained: int | None
    previous_count: int | None
    duplicates: int
    elapsed_seconds: float
    error: str | None
    verification_queued: bool
    verification_delay: float | None


@dataclass(frozen=True)
class TrackerSnapshot:
    status: str
    error: str | None
    poll_count: int
    request_budget_used: int
    next_poll_seconds: float
    last_updated: float | None
    tracked_servers: int
    active_servers: int
    cluster_count: int
    potential_count: int
    verification_pending: bool
    joined_clicks: int
    rows: list[dict]
    events: list[dict]
    join_history: list[dict]


class LiveTracker:
    """Own the worker thread and expose immutable UI snapshots."""

    def __init__(
        self,
        place_id: int = 15532962292,
        request_interval: float = 20.5,
        fast_poll_interval: float = 5.0,
        stale_after: float = 900.0,
        active_for: float = 150.0,
        client: RobloxApiClient | None = None,
        join_history: JoinHistory | None = None,
    ) -> None:
        self.place_id = place_id
        self.request_interval = request_interval
        self.fast_poll_interval = fast_poll_interval
        self.stale_after = stale_after
        self.active_for = active_for
        self.client = client or RobloxApiClient(place_id)
        self.join_history = join_history or JoinHistory()
        self._join_server = JoinRedirectServer(place_id, self.record_join)
        self.state = ServerState(history_seconds=max(stale_after, 900.0))
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._slot = 0
        self._coverage_cursor: str | None = None
        self._verification_pending = False
        self._verification_cursor: str | None = None
        self._verification_source = "Top 100"
        self._alert_levels: dict[str, str] = {}
        self._previous_ids: dict[str, set[str]] = {}
        self._events: deque[PollEvent] = deque(maxlen=60)
        self._status = "starting"
        self._error: str | None = None
        self._poll_count = 0
        self._last_updated: float | None = None
        self._next_poll_at = time.time()
        self._scheduled_delay = 0.0

    def start(self) -> "LiveTracker":
        with self._lock:
            if self._thread and self._thread.is_alive():
                return self
            self._join_server.start()
            self._stop.clear()
            self._thread = threading.Thread(
                target=self._run,
                name="roblox-live-poller",
                daemon=True,
            )
            self._thread.start()
        return self

    def stop(self) -> None:
        self._stop.set()
        thread = self._thread
        if thread and thread.is_alive():
            thread.join(timeout=2.0)
        self._join_server.stop()

    def record_join(self, job_id: str) -> None:
        joined_at = time.time()
        with self._lock:
            record = self.state.records.get(job_id)
            if record is None:
                joined = JoinRecord(job_id, joined_at, None, None, None, None)
            else:
                scored = rank_servers([record], joined_at)[0]
                joined = JoinRecord(
                    job_id=job_id,
                    joined_at=joined_at,
                    players=record.players,
                    max_players=record.max_players,
                    alert_level=scored.alert_level,
                    score=round(scored.score, 1),
                )
        self.join_history.record(joined)

    def _run(self) -> None:
        while not self._stop.is_set():
            self.poll_once()
            with self._lock:
                delay = self._scheduled_delay
            if self._stop.wait(delay):
                break
        with self._lock:
            self._status = "stopped"

    def poll_once(self) -> PollEvent:
        with self._lock:
            is_verification = self._verification_pending
            if is_verification:
                cursor = self._verification_cursor
                source_page = self._verification_source
                page_name = f"Verify {source_page}"
                self._verification_pending = False
            else:
                slot = self._slot % 3
                use_coverage = slot == 2 and self._coverage_cursor is not None
                cursor = self._coverage_cursor if use_coverage else None
                source_page = "Coverage 100" if use_coverage else "Top 100"
                page_name = source_page
            self._status = f"polling {page_name.lower()}"

        result = self.client.fetch_page(cursor)
        observed_at = result.observed_at or time.time()
        ids = {
            server["id"]
            for server in result.servers
            if isinstance(server.get("id"), str)
        }

        with self._lock:
            previous_ids = self._previous_ids.get(source_page)
            retained = len(ids & previous_ids) if previous_ids is not None else None
            previous_count = len(previous_ids) if previous_ids is not None else None
            if result.error:
                changes = []
                new_alert_ids: list[str] = []
                self._status = "waiting after error"
                self._error = result.error
            else:
                changes = self.state.update(result.servers, observed_at)
                self.state.prune(self.stale_after, observed_at)
                self._previous_ids[source_page] = ids
                self._status = "live"
                self._error = None
                if source_page == "Top 100":
                    self._coverage_cursor = result.next_cursor
                scored_page = rank_servers(
                    [self.state.records[job_id] for job_id in ids], observed_at
                )
                new_alert_ids = []
                for item in scored_page:
                    previous_level = self._alert_levels.get(item.record.job_id, "watch")
                    current_level = item.alert_level
                    crossed_threshold = current_level in {"potential", "cluster"} and (
                        previous_level not in {"potential", "cluster"}
                        or (
                            current_level == "cluster" and previous_level == "potential"
                        )
                    )
                    if crossed_threshold:
                        new_alert_ids.append(item.record.job_id)
                    self._alert_levels[item.record.job_id] = current_level

            verification_queued = bool(new_alert_ids) and not is_verification
            verification_delay = None
            quota_wait = self.client.budget.next_available_in()
            if verification_queued:
                self._verification_pending = True
                self._verification_cursor = cursor
                self._verification_source = source_page
                verification_delay = max(
                    self.fast_poll_interval,
                    quota_wait + 0.25 if quota_wait else 0.0,
                )
                self._scheduled_delay = verification_delay
                if verification_delay <= self.fast_poll_interval + 0.25:
                    self._status = "alert found — verification in 5s"
                else:
                    self._status = "alert found — verification waiting for API quota"
            else:
                self._scheduled_delay = max(
                    self.request_interval,
                    quota_wait + 0.25 if quota_wait else 0.0,
                )

            changed = sum(change.delta not in (None, 0) for change in changes)
            positive = sum((change.delta or 0) > 0 for change in changes)
            event = PollEvent(
                observed_at=observed_at,
                page=page_name,
                servers=len(ids),
                new_servers=sum(change.delta is None for change in changes),
                changed_servers=changed,
                positive_moves=positive,
                retained=retained,
                previous_count=previous_count,
                duplicates=result.duplicate_rows,
                elapsed_seconds=result.elapsed_seconds,
                error=result.error,
                verification_queued=verification_queued,
                verification_delay=verification_delay,
            )
            self._events.append(event)
            self._poll_count += 1
            self._slot += 1
            self._last_updated = observed_at
            self._next_poll_at = time.time() + self._scheduled_delay
            return event

    def snapshot(self) -> TrackerSnapshot:
        now = time.time()
        joined_summary = self.join_history.summary()
        recent_joins = self.join_history.recent()
        joined_total = self.join_history.total()
        with self._lock:
            active_records = [
                record
                for record in self.state.records.values()
                if now - record.last_seen <= self.active_for
            ]
            ranked = rank_servers(active_records, now)
            rows: list[dict] = []
            for item in ranked:
                label = {
                    "cluster": "CLUSTER",
                    "potential": "POTENTIAL",
                    "warmup": "WARMING UP",
                    "watch": "watch",
                }[item.alert_level]
                record = item.record
                join_count, last_joined = joined_summary.get(record.job_id, (0, 0.0))
                if self._join_server.port:
                    tracked_join_url = self._join_server.tracking_url(record.job_id)
                else:
                    tracked_join_url = join_url(self.place_id, record.job_id)
                rows.append(
                    {
                        "Alert": label,
                        "Players": record.players,
                        "Capacity": record.max_players,
                        "Δ poll": item.delta_poll,
                        "Δ 2 polls": item.delta_two_polls,
                        "Δ 1m": item.delta_1m,
                        "Δ 3m": item.delta_3m,
                        "Streak": item.growth_streak,
                        "Score": round(item.score, 1),
                        "Ping": record.ping,
                        "Age (s)": round(now - record.last_seen),
                        "Joined": "yes" if join_count else "",
                        "Join count": join_count,
                        "Last joined": (
                            datetime.fromtimestamp(last_joined).strftime("%H:%M:%S")
                            if last_joined
                            else None
                        ),
                        "Job ID": record.job_id,
                        "Join": tracked_join_url,
                    }
                )

            event_rows = []
            for event in reversed(self._events):
                retention = None
                if event.retained is not None and event.previous_count:
                    retention = round(100 * event.retained / event.previous_count, 1)
                event_rows.append(
                    {
                        "Time": datetime.fromtimestamp(event.observed_at).strftime(
                            "%H:%M:%S"
                        ),
                        "Page": event.page,
                        "Servers": event.servers,
                        "New": event.new_servers,
                        "Changed": event.changed_servers,
                        "Growing": event.positive_moves,
                        "Retained %": retention,
                        "Duplicates": event.duplicates,
                        "Request (s)": round(event.elapsed_seconds, 2),
                        "Fast verify": event.verification_queued,
                        "Verify in (s)": (
                            round(event.verification_delay, 1)
                            if event.verification_delay is not None
                            else None
                        ),
                        "Error": event.error,
                    }
                )

            join_rows = [
                {
                    "Joined at": datetime.fromtimestamp(item.joined_at).strftime(
                        "%Y-%m-%d %H:%M:%S"
                    ),
                    "Players": item.players,
                    "Capacity": item.max_players,
                    "Alert": item.alert_level,
                    "Score": item.score,
                    "Job ID": item.job_id,
                    "Rejoin": (
                        self._join_server.tracking_url(item.job_id)
                        if self._join_server.port
                        else join_url(self.place_id, item.job_id)
                    ),
                }
                for item in recent_joins
            ]

            return TrackerSnapshot(
                status=self._status,
                error=self._error,
                poll_count=self._poll_count,
                request_budget_used=self.client.budget.used_in_window(),
                next_poll_seconds=max(0.0, self._next_poll_at - now),
                last_updated=self._last_updated,
                tracked_servers=len(self.state.records),
                active_servers=len(active_records),
                cluster_count=sum(row["Alert"] == "CLUSTER" for row in rows),
                potential_count=sum(row["Alert"] == "POTENTIAL" for row in rows),
                verification_pending=self._verification_pending,
                joined_clicks=joined_total,
                rows=rows,
                events=event_rows,
                join_history=join_rows,
            )
