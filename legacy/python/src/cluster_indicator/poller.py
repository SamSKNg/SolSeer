"""Roblox public-server client and strict sliding-window limiter."""

from __future__ import annotations

import logging
import random
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Callable

import requests


LOG = logging.getLogger(__name__)


@dataclass
class PageResult:
    servers: list[dict] = field(default_factory=list)
    next_cursor: str | None = None
    raw_rows: int = 0
    duplicate_rows: int = 0
    elapsed_seconds: float = 0.0
    observed_at: float = 0.0
    rate_remaining: int | None = None
    rate_reset_seconds: float | None = None
    error: str | None = None


class RequestBudget:
    """Allow at most three attempted requests in any rolling minute."""

    def __init__(
        self,
        requests_per_window: int = 3,
        window_seconds: float = 60.0,
        sleep: Callable[[float], None] = time.sleep,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self.limit = requests_per_window
        self.window = window_seconds
        self._sleep = sleep
        self._monotonic = monotonic
        self._sent_at: deque[float] = deque()
        self._lock = threading.Lock()

    def _discard_expired(self, now: float) -> None:
        while self._sent_at and now - self._sent_at[0] >= self.window:
            self._sent_at.popleft()

    def acquire(self) -> None:
        with self._lock:
            now = self._monotonic()
            self._discard_expired(now)
            if len(self._sent_at) >= self.limit:
                delay = self.window - (now - self._sent_at[0]) + 0.25
                LOG.info("Three-request budget used; waiting %.1fs", delay)
                self._sleep(delay)
                now = self._monotonic()
                self._discard_expired(now)
            self._sent_at.append(self._monotonic())

    def next_available_in(self) -> float:
        with self._lock:
            now = self._monotonic()
            self._discard_expired(now)
            if len(self._sent_at) < self.limit:
                return 0.0
            return max(0.0, self.window - (now - self._sent_at[0]))

    def used_in_window(self) -> int:
        with self._lock:
            now = self._monotonic()
            self._discard_expired(now)
            return len(self._sent_at)


class RobloxApiClient:
    def __init__(
        self,
        place_id: int,
        timeout: float = 15.0,
        max_retries: int = 4,
        session: requests.Session | None = None,
        sleep: Callable[[float], None] = time.sleep,
        budget: RequestBudget | None = None,
    ) -> None:
        self.url = f"https://games.roblox.com/v1/games/{place_id}/servers/Public"
        self.timeout = timeout
        self.max_retries = max_retries
        self.session = session or requests.Session()
        self.session.headers.setdefault("User-Agent", "sols-rng-cluster-detector/0.2")
        self._sleep = sleep
        self.budget = budget or RequestBudget(sleep=sleep)

    @staticmethod
    def _seconds_header(response: requests.Response, name: str) -> float:
        try:
            return max(0.0, float(response.headers.get(name, "0")))
        except (TypeError, ValueError):
            return 0.0

    @staticmethod
    def _integer_header(response: requests.Response, name: str) -> int | None:
        try:
            return int(response.headers[name])
        except (KeyError, TypeError, ValueError):
            return None

    def _request(self, params: dict) -> requests.Response:
        for attempt in range(self.max_retries + 1):
            self.budget.acquire()
            try:
                response = self.session.get(
                    self.url, params=params, timeout=self.timeout
                )
            except requests.RequestException:
                if attempt >= self.max_retries:
                    raise
                delay = min(30.0, 2.0**attempt) + random.uniform(0.0, 0.5)
                LOG.warning("Network error; retrying in %.1fs", delay)
                self._sleep(delay)
                continue

            if response.status_code == 429:
                if attempt >= self.max_retries:
                    response.raise_for_status()
                delay = max(
                    self._seconds_header(response, "Retry-After"),
                    self._seconds_header(response, "X-RateLimit-Reset"),
                    2.0**attempt,
                ) + random.uniform(0.25, 0.75)
                LOG.warning("Roblox returned 429; retrying in %.1fs", delay)
                self._sleep(delay)
                continue

            if 500 <= response.status_code < 600:
                if attempt >= self.max_retries:
                    response.raise_for_status()
                delay = min(30.0, 2.0**attempt) + random.uniform(0.0, 0.5)
                LOG.warning(
                    "Roblox returned %d; retrying in %.1fs", response.status_code, delay
                )
                self._sleep(delay)
                continue

            response.raise_for_status()
            return response
        raise RuntimeError("request retries exhausted")

    def fetch_page(self, cursor: str | None = None) -> PageResult:
        started = time.monotonic()
        result = PageResult()
        params: dict[str, str | int] = {
            "sortOrder": "Desc",
            "excludeFullGames": "false",
            "limit": 100,
        }
        if cursor:
            params["cursor"] = cursor
        try:
            response = self._request(params)
            payload = response.json()
            rows = payload.get("data")
            if not isinstance(rows, list):
                raise ValueError("Roblox response did not contain a data list")
            result.raw_rows = len(rows)
            seen: set[str] = set()
            for server in rows:
                job_id = server.get("id")
                if isinstance(job_id, str) and job_id in seen:
                    result.duplicate_rows += 1
                    continue
                if isinstance(job_id, str):
                    seen.add(job_id)
                result.servers.append(server)
            result.next_cursor = payload.get("nextPageCursor")
            result.rate_remaining = self._integer_header(
                response, "X-RateLimit-Remaining"
            )
            reset = self._seconds_header(response, "X-RateLimit-Reset")
            result.rate_reset_seconds = reset if reset else None
        except (requests.RequestException, ValueError) as exc:
            result.error = str(exc)
        result.elapsed_seconds = time.monotonic() - started
        result.observed_at = time.time()
        return result
