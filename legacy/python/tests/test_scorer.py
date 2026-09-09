import unittest

from cluster_indicator.scorer import score_server
from cluster_indicator.state import ServerState


class ScorerTests(unittest.TestCase):
    def test_near_cap_plus_two_in_one_poll_is_potential(self):
        state = ServerState()
        base = {"id": "job", "maxPlayers": 20}
        state.update([{**base, "playing": 13}], 1000)
        state.update([{**base, "playing": 15}], 1020)
        scored = score_server(state.records["job"], 1020)
        self.assertEqual(scored.delta_poll, 2)
        self.assertEqual(scored.alert_level, "potential")

    def test_near_cap_plus_three_across_two_polls_is_potential(self):
        state = ServerState()
        base = {"id": "job", "maxPlayers": 20}
        for timestamp, players in [(1000, 12), (1020, 14), (1040, 15)]:
            state.update([{**base, "playing": players}], timestamp)
        scored = score_server(state.records["job"], 1040)
        self.assertEqual((scored.delta_poll, scored.delta_two_polls), (1, 3))
        self.assertEqual(scored.alert_level, "potential")

    def test_plus_two_below_near_cap_stays_watch(self):
        state = ServerState()
        base = {"id": "job", "maxPlayers": 20}
        state.update([{**base, "playing": 12}], 1000)
        state.update([{**base, "playing": 14}], 1020)
        self.assertEqual(score_server(state.records["job"], 1020).alert_level, "watch")

    def test_plus_four_in_one_poll_is_cluster(self):
        state = ServerState()
        base = {"id": "job", "maxPlayers": 20}
        state.update([{**base, "playing": 8}], 1000)
        state.update([{**base, "playing": 12}], 1020)
        self.assertEqual(
            score_server(state.records["job"], 1020).alert_level, "cluster"
        )


if __name__ == "__main__":
    unittest.main()
