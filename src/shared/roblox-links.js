// Public link metadata only. Safe to share between the browser and tracker.
export const PLACE_ID = 15532962292;
// This is Roblox's parameter-style app URI, not a conventional URL with a query.
// Bypass /games/start: that website handoff can ignore gameInstanceId.
export const joinUrl = (id) =>
  `roblox://${new URLSearchParams({ placeId: PLACE_ID, gameInstanceId: id })}`;
