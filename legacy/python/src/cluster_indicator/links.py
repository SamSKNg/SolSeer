"""Roblox exact-instance links."""

from urllib.parse import urlencode


def join_url(place_id: int, job_id: str) -> str:
    return "https://www.roblox.com/games/start?" + urlencode(
        {"placeId": place_id, "gameInstanceId": job_id}
    )


def direct_join_uri(place_id: int, job_id: str) -> str:
    return "roblox://" + urlencode({"placeId": place_id, "gameInstanceId": job_id})
