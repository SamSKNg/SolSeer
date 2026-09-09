import tempfile
import unittest
from pathlib import Path

import requests

from cluster_indicator.join_history import JoinHistory, JoinRecord, JoinRedirectServer


class JoinHistoryTests(unittest.TestCase):
    def test_join_records_persist(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "joins.sqlite3"
            history = JoinHistory(path)
            history.record(
                JoinRecord(
                    job_id="job-id",
                    joined_at=1000.0,
                    players=17,
                    max_players=20,
                    alert_level="potential",
                    score=42.0,
                )
            )
            reopened = JoinHistory(path)
            self.assertEqual(reopened.total(), 1)
            self.assertEqual(reopened.summary()["job-id"], (1, 1000.0))
            self.assertEqual(reopened.recent()[0].players, 17)

    def test_redirect_records_then_forwards_to_roblox(self):
        clicked = []
        server = JoinRedirectServer(123, clicked.append).start()
        try:
            response = requests.get(
                server.tracking_url("job-id"), timeout=5, allow_redirects=False
            )
            self.assertEqual(response.status_code, 302)
            self.assertEqual(clicked, ["job-id"])
            self.assertIn("placeId=123", response.headers["Location"])
            self.assertIn("gameInstanceId=job-id", response.headers["Location"])
        finally:
            server.stop()


if __name__ == "__main__":
    unittest.main()
