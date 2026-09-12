// Browser development keeps HTTP; the packaged desktop app uses only IPC.
export async function apiFetch(path, options = {}) {
  if (!window.solseerDesktop) return fetch(path, options);
  options.signal?.throwIfAborted();
  const result = await window.solseerDesktop.request({
    path,
    method: options.method ?? "GET",
    body: options.body ?? "",
    token: new Headers(options.headers).get("X-Solseer-Token") ?? "",
  });
  options.signal?.throwIfAborted();
  return new Response(result.body, {
    status: result.status,
    headers: result.headers,
  });
}

export function snapshotStream() {
  if (!window.solseerDesktop) return new EventSource("/api/events");
  let closed = false,
    received = false;
  const stream = {
    onmessage: null,
    onerror: null,
    close: () => {
      closed = true;
      unsubscribe();
    },
  };
  const deliver = (value) => {
    if (!closed) stream.onmessage?.({ data: JSON.stringify(value) });
  };
  const unsubscribe = window.solseerDesktop.onSnapshot((value) => {
    received = true;
    deliver(value);
  });
  apiFetch("/api/snapshot")
    .then((response) => response.json())
    .then((value) => {
      if (!received) deliver(value);
    })
    .catch(() => {
      if (!closed) stream.onerror?.();
    });
  return stream;
}
