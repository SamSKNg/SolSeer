// A false write result means backpressure, not a disconnected client.
export class EventStreams {
  constructor(snapshot) {
    this.snapshot = snapshot;
    this.clients = new Map();
  }
  send(client, message) {
    if (client.blocked) {
      client.pending = message; // Retain only the newest update for slow readers.
      return;
    }
    client.blocked = !client.response.write(message);
  }
  add(response) {
    const client = { response, blocked: false, pending: null };
    const drain = () => {
      client.blocked = false;
      const pending = client.pending;
      client.pending = null;
      if (pending) this.send(client, pending);
    };
    const remove = () => {
      this.clients.delete(response);
      response.off("drain", drain);
      response.off("close", remove);
      response.off("error", remove);
      client.pending = null;
    };
    response.on("drain", drain);
    response.once("close", remove);
    response.once("error", remove);
    this.clients.set(response, client);
    this.send(client, `data: ${JSON.stringify(this.snapshot())}\n\n`);
  }
  broadcast() {
    if (!this.clients.size) return;
    const message = `data: ${JSON.stringify(this.snapshot())}\n\n`;
    for (const client of this.clients.values()) this.send(client, message);
  }
  close() {
    for (const client of this.clients.values()) client.response.end();
    this.clients.clear();
  }
}
