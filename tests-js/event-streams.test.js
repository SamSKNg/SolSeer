import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http from "node:http";
import { EventStreams } from "../src/server/event-streams.js";

class Response extends EventEmitter {
  writes = [];
  writable = false;
  ended = false;
  write(message) {
    this.writes.push(JSON.parse(message.slice(6)));
    return this.writable;
  }
  end() {
    this.ended = true;
    this.emit("close");
  }
}

test("large snapshots survive backpressure and deliver only the newest queued frame on drain", () => {
  let sequence = 0;
  const streams = new EventStreams(() => ({
    sequence,
    data: "x".repeat(100000),
  }));
  const response = new Response();
  streams.add(response);
  sequence = 1;
  streams.broadcast();
  sequence = 2;
  streams.broadcast();
  assert.equal(response.ended, false);
  assert.deepEqual(
    response.writes.map((frame) => frame.sequence),
    [0],
  );
  response.writable = true;
  response.emit("drain");
  assert.deepEqual(
    response.writes.map((frame) => frame.sequence),
    [0, 2],
  );
  sequence = 3;
  streams.broadcast();
  assert.deepEqual(
    response.writes.map((frame) => frame.sequence),
    [0, 2, 3],
  );
  response.emit("close");
  streams.broadcast();
  assert.equal(response.writes.length, 3);
  assert.equal(response.listenerCount("drain"), 0);
});

test("one slow stream does not block others, errors clean up and shutdown ends streams", () => {
  const streams = new EventStreams(() => ({ now: 1 }));
  const slow = new Response(),
    fast = new Response();
  fast.writable = true;
  streams.add(slow);
  streams.add(fast);
  streams.broadcast();
  assert.equal(fast.writes.length, 2);
  assert.equal(slow.writes.length, 1);
  slow.emit("error", new Error("Disconnected"));
  assert.equal(streams.clients.size, 1);
  streams.close();
  assert.equal(fast.ended, true);
  assert.equal(streams.clients.size, 0);
});

test(
  "real HTTP stream keeps delivering large snapshots without reconnecting",
  { timeout: 5000 },
  async () => {
    let sequence = 0;
    const streams = new EventStreams(() => ({
      sequence: ++sequence,
      rows: "x".repeat(150000),
    }));
    const server = http.createServer((_req, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      streams.add(response);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const timer = setInterval(() => streams.broadcast(), 30);
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}`,
        { signal: controller.signal },
      );
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buffer = "",
        count = 0;
      while (count < 3) {
        const { value, done } = await reader.read();
        assert.equal(
          done,
          false,
          "Stream must not end because a snapshot exceeded the write buffer",
        );
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          assert.equal(
            JSON.parse(buffer.slice(6, boundary)).rows.length,
            150000,
          );
          buffer = buffer.slice(boundary + 2);
          count++;
        }
      }
      assert.ok(count >= 3);
      await reader.cancel();
    } finally {
      clearInterval(timer);
      clearTimeout(deadline);
      controller.abort();
      streams.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
