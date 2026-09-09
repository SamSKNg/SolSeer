"""Persistent join history and a local record-then-redirect endpoint."""

from __future__ import annotations

import re
import sqlite3
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable
from urllib.parse import parse_qs, urlencode, urlparse

from .links import join_url


JOB_ID_PATTERN = re.compile(r"^[A-Za-z0-9-]{1,100}$")


@dataclass(frozen=True)
class JoinRecord:
    job_id: str
    joined_at: float
    players: int | None
    max_players: int | None
    alert_level: str | None
    score: float | None


class JoinHistory:
    def __init__(self, path: Path | str | None = None) -> None:
        if path is None:
            path = Path(__file__).resolve().parents[2] / ".data/join_history.sqlite3"
        self.path = Path(path).resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=5.0)
        connection.row_factory = sqlite3.Row
        return connection

    @contextmanager
    def _connection(self):
        connection = self._connect()
        try:
            yield connection
        except Exception:
            connection.rollback()
            raise
        else:
            connection.commit()
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self._connection() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS joins (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL,
                    joined_at REAL NOT NULL,
                    players INTEGER,
                    max_players INTEGER,
                    alert_level TEXT,
                    score REAL
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS joins_job_id ON joins(job_id)"
            )

    def record(self, item: JoinRecord) -> None:
        with self._connection() as connection:
            connection.execute(
                """
                INSERT INTO joins (
                    job_id, joined_at, players, max_players, alert_level, score
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    item.job_id,
                    item.joined_at,
                    item.players,
                    item.max_players,
                    item.alert_level,
                    item.score,
                ),
            )

    def summary(self) -> dict[str, tuple[int, float]]:
        with self._connection() as connection:
            rows = connection.execute(
                """
                SELECT job_id, COUNT(*) AS join_count, MAX(joined_at) AS last_joined
                FROM joins GROUP BY job_id
                """
            ).fetchall()
        return {
            str(row["job_id"]): (int(row["join_count"]), float(row["last_joined"]))
            for row in rows
        }

    def recent(self, limit: int = 200) -> list[JoinRecord]:
        with self._connection() as connection:
            rows = connection.execute(
                """
                SELECT job_id, joined_at, players, max_players, alert_level, score
                FROM joins ORDER BY joined_at DESC LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [
            JoinRecord(
                job_id=str(row["job_id"]),
                joined_at=float(row["joined_at"]),
                players=row["players"],
                max_players=row["max_players"],
                alert_level=row["alert_level"],
                score=row["score"],
            )
            for row in rows
        ]

    def total(self) -> int:
        with self._connection() as connection:
            row = connection.execute("SELECT COUNT(*) AS total FROM joins").fetchone()
        return int(row["total"])


class JoinRedirectServer:
    """Record a click, then redirect the browser to the exact Roblox server."""

    def __init__(
        self,
        place_id: int,
        on_join: Callable[[str], None],
        host: str = "127.0.0.1",
        port: int = 0,
    ) -> None:
        self.place_id = place_id
        self.on_join = on_join
        self.host = host
        self.port = port
        self._server: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None

    def start(self) -> "JoinRedirectServer":
        if self._server is not None:
            return self
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
                parsed = urlparse(self.path)
                values = parse_qs(parsed.query)
                job_id = values.get("job_id", [""])[0]
                if parsed.path != "/join" or not JOB_ID_PATTERN.fullmatch(job_id):
                    self.send_error(400, "Invalid join request")
                    return
                outer.on_join(job_id)
                self.send_response(302)
                self.send_header("Location", join_url(outer.place_id, job_id))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()

            def log_message(self, _format: str, *_args: object) -> None:
                return

        self._server = ThreadingHTTPServer((self.host, self.port), Handler)
        self.port = int(self._server.server_address[1])
        self._thread = threading.Thread(
            target=self._server.serve_forever,
            name="join-click-recorder",
            daemon=True,
        )
        self._thread.start()
        return self

    def tracking_url(self, job_id: str) -> str:
        return f"http://{self.host}:{self.port}/join?" + urlencode({"job_id": job_id})

    def stop(self) -> None:
        if self._server is None:
            return
        self._server.shutdown()
        self._server.server_close()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        self._server = None
