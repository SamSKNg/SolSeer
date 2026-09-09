import json
import unittest
from unittest.mock import Mock, patch

import requests

from cluster_indicator.poller import RequestBudget, RobloxApiClient


def response(status, payload, headers=None):
    item = requests.Response()
    item.status_code = status
    item.headers.update(headers or {})
    item._content = json.dumps(payload).encode()
    item.url = "https://example.test/servers"
    return item


class FakeClock:
    def __init__(self):
        self.now = 0.0
        self.sleeps = []

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds


class RequestBudgetTests(unittest.TestCase):
    def test_fourth_request_waits_for_next_minute(self):
        clock = FakeClock()
        budget = RequestBudget(sleep=clock.sleep, monotonic=clock.monotonic)
        for _ in range(4):
            budget.acquire()
        self.assertEqual(clock.sleeps, [60.25])
        self.assertEqual(budget.used_in_window(), 1)


class ApiClientTests(unittest.TestCase):
    @patch("cluster_indicator.poller.random.uniform", return_value=0.25)
    def test_429_honors_longer_reset_header(self, _random):
        session = Mock()
        session.headers = {}
        session.get.side_effect = [
            response(
                429, {"errors": []}, {"Retry-After": "5", "X-RateLimit-Reset": "47"}
            ),
            response(200, {"data": [], "nextPageCursor": None}),
        ]
        sleeps = []
        budget = Mock()
        result = RobloxApiClient(
            1, session=session, sleep=sleeps.append, budget=budget
        ).fetch_page()
        self.assertEqual(sleeps, [47.25])
        self.assertEqual(budget.acquire.call_count, 2)
        self.assertIsNone(result.error)

    def test_duplicate_ids_are_removed(self):
        session = Mock()
        session.headers = {}
        session.get.return_value = response(
            200,
            {
                "data": [
                    {"id": "a", "playing": 5},
                    {"id": "a", "playing": 5},
                ],
                "nextPageCursor": "next",
            },
        )
        result = RobloxApiClient(1, session=session, budget=Mock()).fetch_page()
        self.assertEqual(len(result.servers), 1)
        self.assertEqual(result.duplicate_rows, 1)
        self.assertEqual(result.next_cursor, "next")


if __name__ == "__main__":
    unittest.main()
