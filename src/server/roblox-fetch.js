import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

// Keep the session credential in this backend closure, never tracker snapshots.
export function createRobloxFetch(cookie = "", fetchFn = fetch) {
  if (
    typeof cookie !== "string" ||
    cookie.length > 32768 ||
    (cookie && !/^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]+$/.test(cookie)) ||
    cookie.startsWith(".ROBLOSECURITY=") ||
    /^cookie:/i.test(cookie)
  ) {
    throw new Error(
      "Invalid ROBLOX_SECURITY_COOKIE: supply only the cookie value, without quotes, whitespace, or additional cookies.",
    );
  }
  const request = async (input, options = {}) => {
    const url = new URL(input);
    if (
      url.origin !== "https://games.roblox.com" ||
      url.username ||
      url.password ||
      !/^\/v1\/games\/\d+\/servers\/Public$/.test(url.pathname) ||
      (options.method && options.method !== "GET")
    )
      throw new Error(
        "Blocked request outside the Roblox public-server endpoint",
      );
    const headers = new Headers();
    headers.set("Accept", "application/json");
    if (cookie) headers.set("Cookie", `.ROBLOSECURITY=${cookie}`);
    try {
      return await fetchFn(url.href, {
        method: "GET",
        signal: options.signal,
        headers,
        // Never forward session credentials to a redirect destination.
        redirect: "error",
      });
    } catch (error) {
      if (error?.name === "AbortError")
        throw new DOMException("Request aborted", "AbortError");
      // Do not attach the original error/cause: it may contain request headers.
      throw new Error(
        "Roblox request failed (network error or blocked redirect)",
      );
    }
  };
  Object.defineProperty(request, "hasCookie", { value: Boolean(cookie) });
  return request;
}

export function configuredRobloxFetch(
  env = process.env,
  fetchFn = fetch,
  envPath,
  { requireCookie = false } = {},
) {
  let cookie = env.ROBLOX_SECURITY_COOKIE;
  // Read once and remove before starting Vite or spawning child processes.
  delete env.ROBLOX_SECURITY_COOKIE;
  // Explicit environment values (including empty) override the optional file.
  // Parse privately rather than importing .env into process.env or Vite.
  if (cookie === undefined && envPath) {
    try {
      cookie = parseEnv(readFileSync(envPath, "utf8")).ROBLOX_SECURITY_COOKIE;
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new Error("Unable to read the backend .env configuration");
    }
  }
  if (requireCookie && !cookie)
    throw new Error(
      "The polling test requires ROBLOX_SECURITY_COOKIE in .env or the environment",
    );
  return createRobloxFetch(cookie ?? "", fetchFn);
}
