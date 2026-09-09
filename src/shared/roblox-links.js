// Public link metadata only. Safe to share between the browser and tracker.
export const PLACE_ID = 15532962292;
export const joinUrl = (id) =>
  `https://www.roblox.com/games/start?${new URLSearchParams({ placeId: PLACE_ID, gameInstanceId: id })}`;
