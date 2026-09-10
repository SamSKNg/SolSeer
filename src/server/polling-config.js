// Local scheduling limits, not a promise about Roblox's server-side quota.
export const AUTHENTICATED_POLLING = Object.freeze({
  interval: 2000,
  requestLimit: 40,
  pagesPerPoll: 1,
  coverageEvery: 0,
});
export const ANONYMOUS_POLLING = Object.freeze({
  interval: 20500,
  requestLimit: 3,
  pagesPerPoll: 1,
  coverageEvery: 3,
});
export const pollingFor = (hasCookie) =>
  hasCookie ? AUTHENTICATED_POLLING : ANONYMOUS_POLLING;
