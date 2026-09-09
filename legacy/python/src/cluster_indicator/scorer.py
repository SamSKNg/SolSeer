"""Player-clustering heuristic tuned for per-request observations."""

from __future__ import annotations

from dataclasses import dataclass

from .state import ServerRecord


@dataclass(frozen=True)
class ScoreWeights:
    occupancy: float = 15.0
    players: float = 0.25
    poll_delta: float = 6.0
    velocity_3m: float = 3.0
    acceleration: float = 4.0
    growth_streak: float = 2.0


@dataclass(frozen=True)
class AlertThresholds:
    near_cap_players: int = 15
    potential_delta_poll: int = 2
    potential_delta_two_polls: int = 3
    cluster_delta_poll: int = 4
    cluster_delta_3m: int = 7


@dataclass(frozen=True)
class ScoredServer:
    record: ServerRecord
    delta_poll: int | None
    delta_two_polls: int | None
    delta_1m: int | None
    delta_2m: int | None
    delta_3m: int | None
    acceleration: float | None
    growth_streak: int
    occupancy: float
    score: float
    alert_level: str

    @property
    def warmed_up(self) -> bool:
        return self.delta_poll is not None

    @property
    def alert_priority(self) -> int:
        return {"cluster": 2, "potential": 1}.get(self.alert_level, 0)


def score_server(
    record: ServerRecord,
    now: float,
    weights: ScoreWeights = ScoreWeights(),
    thresholds: AlertThresholds = AlertThresholds(),
) -> ScoredServer:
    delta_poll = record.poll_delta()
    delta_two_polls = record.poll_delta(2)
    delta_1m = record.delta(60.0, now)
    delta_2m = record.delta(120.0, now)
    delta_3m = record.delta(180.0, now)
    occupancy = record.players / record.max_players if record.max_players > 0 else 0.0
    streak = record.recent_growth_streak()

    acceleration = None
    if delta_1m is not None and delta_3m is not None:
        earlier_rate = (delta_3m - delta_1m) / 2.0
        acceleration = delta_1m - earlier_rate

    score = weights.occupancy * occupancy + weights.players * record.players
    if delta_poll is not None:
        score += weights.poll_delta * max(0, delta_poll)
    if delta_3m is not None:
        score += weights.velocity_3m * max(0.0, delta_3m / 3.0)
    if acceleration is not None:
        score += weights.acceleration * max(0.0, acceleration)
    score += weights.growth_streak * min(streak, 4)
    if delta_poll is None:
        score *= 0.35

    if (delta_poll or 0) >= thresholds.cluster_delta_poll or (
        (delta_3m or 0) >= thresholds.cluster_delta_3m and streak >= 2
    ):
        alert_level = "cluster"
    elif record.players >= thresholds.near_cap_players and (
        (delta_poll or 0) >= thresholds.potential_delta_poll
        or (delta_two_polls or 0) >= thresholds.potential_delta_two_polls
    ):
        alert_level = "potential"
    elif delta_poll is None:
        alert_level = "warmup"
    else:
        alert_level = "watch"

    return ScoredServer(
        record=record,
        delta_poll=delta_poll,
        delta_two_polls=delta_two_polls,
        delta_1m=delta_1m,
        delta_2m=delta_2m,
        delta_3m=delta_3m,
        acceleration=acceleration,
        growth_streak=streak,
        occupancy=occupancy,
        score=score,
        alert_level=alert_level,
    )


def rank_servers(records: list[ServerRecord], now: float) -> list[ScoredServer]:
    return sorted(
        (score_server(record, now) for record in records),
        key=lambda item: (item.alert_priority, item.score, item.record.players),
        reverse=True,
    )
