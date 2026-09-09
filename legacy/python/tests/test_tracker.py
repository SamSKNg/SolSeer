import time
import tempfile
import unittest
from pathlib import Path

from cluster_indicator.join_history import JoinHistory
from cluster_indicator.poller import PageResult
from cluster_indicator.tracker import LiveTracker


class FakeBudget:
    def __init__(self, next_available=0.0):
        self.next_available = next_available

    def used_in_window(self):
        return 2

    def next_available_in(self):
        return self.next_available


class FakeClient:
    def __init__(self, responses, next_available=0.0):
        self.responses = iter(responses)
        self.cursors = []
        self.budget = FakeBudget(next_available)

    def fetch_page(self, cursor=None):
        self.cursors.append(cursor)
        return next(self.responses)


class TrackerTests(unittest.TestCase):
    def setUp(self):
        self._temporary_directory = tempfile.TemporaryDirectory()

    def tearDown(self):
        self._temporary_directory.cleanup()

    def make_tracker(self, client):
        database = Path(self._temporary_directory.name) / "joins.sqlite3"
        return LiveTracker(client=client, join_history=JoinHistory(database))

    def test_publishes_each_poll_and_uses_live_schedule(self):
        now = time.time()
        base = {"id": "job", "maxPlayers": 20, "ping": 50}
        client = FakeClient(
            [
                PageResult(
                    servers=[{**base, "playing": 13}], next_cursor="c1", observed_at=now
                ),
                PageResult(
                    servers=[{**base, "playing": 14}],
                    next_cursor="c2",
                    observed_at=now + 20,
                ),
                PageResult(
                    servers=[{"id": "other", "playing": 10, "maxPlayers": 20}],
                    observed_at=now + 40,
                ),
            ]
        )
        tracker = self.make_tracker(client)
        tracker.poll_once()
        tracker.poll_once()
        snapshot = tracker.snapshot()
        self.assertEqual(snapshot.poll_count, 2)
        self.assertEqual(snapshot.potential_count, 0)
        self.assertEqual(snapshot.rows[0]["Δ poll"], 1)
        self.assertIn("gameInstanceId=job", snapshot.rows[0]["Join"])
        tracker.record_join("job")
        joined_snapshot = tracker.snapshot()
        self.assertEqual(joined_snapshot.joined_clicks, 1)
        self.assertEqual(joined_snapshot.rows[0]["Joined"], "yes")
        self.assertEqual(joined_snapshot.join_history[0]["Players"], 14)
        tracker.poll_once()
        self.assertEqual(client.cursors, [None, None, "c2"])
        self.assertEqual(len(tracker.snapshot().events), 3)

    def test_new_alert_fast_forwards_same_page_verification(self):
        now = time.time()
        base = {"id": "job", "maxPlayers": 20, "ping": 50}
        client = FakeClient(
            [
                PageResult(
                    servers=[{**base, "playing": 13}],
                    next_cursor="c1",
                    observed_at=now,
                ),
                PageResult(
                    servers=[{**base, "playing": 15}],
                    next_cursor="c2",
                    observed_at=now + 20,
                ),
                PageResult(
                    servers=[{**base, "playing": 16}],
                    next_cursor="c3",
                    observed_at=now + 25,
                ),
            ]
        )
        tracker = self.make_tracker(client)
        tracker.poll_once()
        event = tracker.poll_once()
        self.assertTrue(event.verification_queued)
        self.assertEqual(event.verification_delay, 5.0)
        self.assertTrue(tracker.snapshot().verification_pending)

        verification = tracker.poll_once()
        self.assertEqual(verification.page, "Verify Top 100")
        self.assertFalse(verification.verification_queued)
        self.assertEqual(client.cursors, [None, None, None])

    def test_verification_waits_when_request_quota_is_full(self):
        now = time.time()
        base = {"id": "job", "maxPlayers": 20}
        client = FakeClient(
            [
                PageResult(servers=[{**base, "playing": 13}], observed_at=now),
                PageResult(servers=[{**base, "playing": 15}], observed_at=now + 20),
            ],
            next_available=18.0,
        )
        tracker = self.make_tracker(client)
        tracker.poll_once()
        event = tracker.poll_once()
        self.assertEqual(event.verification_delay, 18.25)
        self.assertIn("quota", tracker.snapshot().status)


if __name__ == "__main__":
    unittest.main()
