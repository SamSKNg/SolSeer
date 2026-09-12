import { resolve, relative, isAbsolute } from "node:path";

export function isAppPage(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "solseer:" &&
      url.hostname === "app" &&
      !url.username &&
      !url.password &&
      !url.port &&
      ["/", "/index.html"].includes(url.pathname)
    );
  } catch {
    return false;
  }
}

export function assetPath(dist, value) {
  const url = new URL(value);
  if (
    url.protocol !== "solseer:" ||
    url.hostname !== "app" ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error("Invalid app origin");
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.includes("\\") || pathname.includes("\0"))
    throw new Error("Invalid asset path");
  const path = resolve(
    dist,
    "." + (pathname === "/" ? "/index.html" : pathname),
  );
  const within = relative(dist, path);
  if (!within || within.startsWith("..") || isAbsolute(within))
    throw new Error("Invalid asset path");
  // Vite emits only these static assets. Never expose backend files or settings.
  if (!/\.(?:html|js|css|svg|png|ico|woff2?)$/i.test(path))
    throw new Error("Invalid asset type");
  return path;
}
