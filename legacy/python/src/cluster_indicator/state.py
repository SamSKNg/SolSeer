"""Thread-confined rolling server history keyed by Roblox Job ID."""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Observation:
    timestamp: float
    players: int


@dataclass(frozen=True)
class ServerChange:
    job_id: str
    previous_players: int | None
    players: int

    @property
    def delta(self) -> int | None:
        if self.previous_players is None:
            return None
        return self.players - self.previous_players


@dataclass
class ServerRecord:
    job_id: str
    first_seen: float
    last_seen: float
    players: int
    max_players: int
    max_observed_players: int
    ping: int | None
    fps: float | None
    history: deque[Observation] = field(default_factory=deque)

    def delta(self, seconds: float, now: float) -> int | None:
        if len(self.history) < 2:
            return None
        target = now - seconds
        prior = min(
            list(self.history)[:-1], key=lambda item: abs(item.timestamp - target)
        )
        if abs(prior.timestamp - target) > max(8.0, min(20.0, seconds * 0.10)):
            return None
        return self.players - prior.players

    def poll_delta(self, polls_back: int = 1, maximum_age: float = 150.0) -> int | None:
        if len(self.history) <= polls_back:
            return None
        prior = self.history[-(polls_back + 1)]
        if self.last_seen - prior.timestamp > maximum_age:
            return None
        return self.players - prior.players

    def recent_growth_streak(self, maximum_gap: float = 90.0) -> int:
        streak = 0
        samples = list(self.history)
        for previous, current in reversed(list(zip(samples, samples[1:]))):
            if (
                current.players <= previous.players
                or current.timestamp - previous.timestamp > maximum_gap
            ):
                break
            streak += 1
        return streak


class ServerState:
    def __init__(self, history_seconds: float = 900.0) -> None:
        self.history_seconds = history_seconds
        self.records: dict[str, ServerRecord] = {}

    def update(
        self, servers: list[dict], observed_at: float | None = None
    ) -> list[ServerChange]:
        observed_at = observed_at if observed_at is not None else time.time()
        changes: list[ServerChange] = []
        for server in servers:
            job_id = server.get("id")
            if not isinstance(job_id, str) or not job_id:
                continue
            players = int(server.get("playing", 0))
            max_players = int(server.get("maxPlayers", 0))
            ping = server.get("ping")
            fps = server.get("fps")
            record = self.records.get(job_id)
            previous_players = record.players if record else None
            if record is None:
                record = ServerRecord(
                    job_id=job_id,
                    first_seen=observed_at,
                    last_seen=observed_at,
                    players=players,
                    max_players=max_players,
                    max_observed_players=players,
                    ping=int(ping) if ping is not None else None,
                    fps=float(fps) if fps is not None else None,
                )
                self.records[job_id] = record
            else:
                record.last_seen = observed_at
                record.players = players
                record.max_players = max_players
                record.max_observed_players = max(record.max_observed_players, players)
                record.ping = int(ping) if ping is not None else None
                record.fps = float(fps) if fps is not None else None
            record.history.append(Observation(observed_at, players))
            cutoff = observed_at - self.history_seconds
            while record.history and record.history[0].timestamp < cutoff:
                record.history.popleft()
            changes.append(ServerChange(job_id, previous_players, players))
        return changes

    def prune(self, stale_after: float, now: float | None = None) -> int:
        now = now if now is not None else time.time()
        stale = [
            job_id
            for job_id, item in self.records.items()
            if now - item.last_seen > stale_after
        ]
        for job_id in stale:
            del self.records[job_id]
        return len(stale)
