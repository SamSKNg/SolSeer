// Live polling is paced by the selected interval and Roblox's response headers.
export const AUTHENTICATED_POLLING = Object.freeze({
  interval: 2000,
  requestLimit: null,
  pagesPerPoll: 1,
  coverageEvery: 0,
});
export const ANONYMOUS_POLLING = Object.freeze({
  interval: 20500,
  requestLimit: null,
  pagesPerPoll: 1,
  coverageEvery: 3,
});
export const pollingFor = (hasCookie) =>
  hasCookie ? AUTHENTICATED_POLLING : ANONYMOUS_POLLING;

// Keep the explicitly invoked diagnostic finite; this is not a live app cap.
export const DIAGNOSTIC_POLLING = Object.freeze({
  interval: 2000,
  requestLimit: 40,
});
