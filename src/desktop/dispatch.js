import { Readable } from "node:stream";

// Reuse the backend's validation and mutations without opening an HTTP socket.
// Only these small, fixed messages may cross from the sandboxed renderer.
export function allowedRequest(path, method) {
  return (
    (method === "GET" &&
      ["/api/settings", "/api/snapshot", "/api/joins/export"].includes(path)) ||
    (method === "POST" &&
      (["/api/settings", "/api/notifications/claim"].includes(path) ||
        /^\/api\/join\/[a-zA-Z0-9-]{1,100}$/.test(path)))
  );
}

export async function dispatch(handleRequest, message) {
  const { path, method = "GET", body = "", token = "" } = message ?? {};
  if (
    typeof path !== "string" ||
    !allowedRequest(path, method) ||
    typeof body !== "string" ||
    Buffer.byteLength(body) > 65536 ||
    typeof token !== "string" ||
    token.length > 256
  )
    throw new Error("Invalid desktop request");
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  Object.assign(req, {
    url: path,
    method,
    headers: {
      host: "localhost:0",
      origin: "http://localhost:0",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "x-solseer-token": token,
    },
  });
  const headers = {};
  let status = 200,
    text = "";
  const res = {
    headersSent: false,
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    writeHead(code, extra = {}) {
      status = code;
      this.headersSent = true;
      for (const [name, value] of Object.entries(extra))
        this.setHeader(name, value);
      return this;
    },
    end(value = "") {
      text += value;
      this.headersSent = true;
      return this;
    },
  };
  await handleRequest(req, res);
  return { status, headers, body: text };
}
