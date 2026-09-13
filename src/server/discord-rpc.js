import net from "node:net";
import { randomUUID } from "node:crypto";

// Discord desktop's local IPC protocol. No Discord user token or bot login.
export class DiscordRpc {
  constructor({ connect = net.createConnection } = {}) {
    this.connect = connect;
    this.socket = null;
    this.pending = new Map();
  }
  send(op, value) {
    const body = Buffer.from(JSON.stringify(value));
    const header = Buffer.alloc(8);
    header.writeUInt32LE(op, 0);
    header.writeUInt32LE(body.length, 4);
    this.socket.write(Buffer.concat([header, body]));
  }
  async open(clientId) {
    this.closed = false;
    if (process.platform !== "win32")
      throw new Error("Windows Discord desktop required.");
    for (let index = 0; index < 10; index++) {
      if (this.closed) throw new Error("Discord connection cancelled");
      try {
        await new Promise((resolve, reject) => {
          const socket = this.connect(`\\\\?\\pipe\\discord-ipc-${index}`);
          this.socket = socket;
          let buffer = Buffer.alloc(0);
          const timer = setTimeout(
            () => socket.destroy(new Error("Discord timeout")),
            2000,
          );
          socket.on("connect", () =>
            this.send(0, { v: 1, client_id: clientId }),
          );
          socket.on("error", reject);
          socket.on("close", () => {
            clearTimeout(timer);
            if (this.socket === socket) this.socket = null;
            for (const pending of this.pending.values())
              pending.reject(new Error("Discord disconnected"));
            this.pending.clear();
            reject(new Error("Discord disconnected"));
          });
          socket.on("data", (chunk) => {
            try {
              buffer = Buffer.concat([buffer, chunk]);
              while (buffer.length >= 8) {
                const op = buffer.readUInt32LE(0),
                  size = buffer.readUInt32LE(4);
                if (size > 1024 * 1024)
                  throw new Error("Invalid Discord frame");
                if (buffer.length < size + 8) break;
                const value = JSON.parse(
                  buffer.subarray(8, size + 8).toString(),
                );
                buffer = buffer.subarray(size + 8);
                if (op === 2) throw new Error("Discord closed connection");
                if (op === 3) this.send(4, value);
                if (op !== 1) continue;
                if (value.evt === "READY") {
                  clearTimeout(timer);
                  resolve();
                }
                const pending = this.pending.get(value.nonce);
                if (pending) {
                  this.pending.delete(value.nonce);
                  if (value.evt === "ERROR")
                    pending.reject(new Error("Discord rejected activity"));
                  else pending.resolve();
                }
              }
            } catch (error) {
              socket.destroy(error);
            }
          });
        });
        return;
      } catch {
        this.socket?.destroy();
        this.socket = null;
      }
    }
    throw new Error("Discord desktop unavailable");
  }
  async setActivity(activity) {
    if (!this.socket) throw new Error("Discord disconnected");
    const nonce = randomUUID();
    let timer;
    try {
      await new Promise((resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Discord activity timeout")),
          5000,
        );
        this.pending.set(nonce, { resolve, reject });
        this.send(1, {
          cmd: "SET_ACTIVITY",
          args: { pid: process.pid, activity },
          nonce,
        });
      });
    } finally {
      clearTimeout(timer);
      this.pending.delete(nonce);
    }
  }
  close() {
    this.closed = true;
    this.socket?.destroy();
    this.socket = null;
  }
}
