// Local scheduling limits, not a promise about Roblox's server-side quota.
export const AUTHENTICATED_POLLING = Object.freeze({
  interval: 3000,
  requestLimit: 40,
  pagesPerPoll: 2,
});
export const ANONYMOUS_POLLING = Object.freeze({
  interval: 20500,
  requestLimit: 3,
  pagesPerPoll: 1,
});
export const pollingFor = (hasCookie) =>
  hasCookie ? AUTHENTICATED_POLLING : ANONYMOUS_POLLING;
