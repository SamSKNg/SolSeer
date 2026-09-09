import { existsSync } from "node:fs";
import { mkdir, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { configuredRobloxFetch, createRobloxFetch } from "./roblox-fetch.js";

export function settingsDirectory(env = process.env) {
  return (
    env.SOLSEER_CONFIG_DIR ||
    join(env.LOCALAPPDATA || join(homedir(), ".config"), "solseer")
  );
}

export class LocalSettings {
  #request;
  #saving = false;
  constructor({
    directory = settingsDirectory(),
    legacyPath,
    env = process.env,
    fetchFn = fetch,
  } = {}) {
    this.directory = directory;
    this.path = join(directory, ".env");
    this.fetchFn = fetchFn;
    this.environmentOverride = env.ROBLOX_SECURITY_COOKIE !== undefined;
    this.saved = existsSync(this.path);
    this.source = this.environmentOverride
      ? "environment"
      : this.saved
        ? "local settings"
        : "project .env / anonymous";
    this.#request = configuredRobloxFetch(
      env,
      fetchFn,
      this.saved ? this.path : legacyPath,
    );
  }
  get request() {
    return this.#request;
  }
  status() {
    return {
      hasCookie: this.#request.hasCookie,
      saved: this.saved,
      source: this.source,
      storagePath: this.path,
      environmentOverride: this.environmentOverride,
    };
  }
  async save(cookie, apply) {
    if (this.#saving)
      throw Object.assign(
        new Error("Another settings update is in progress. Try again."),
        { status: 409 },
      );
    let request;
    try {
      if (typeof cookie !== "string") throw new Error();
      request = createRobloxFetch(cookie, this.fetchFn);
    } catch {
      throw Object.assign(
        new Error(
          "Enter only the cookie value, without Cookie:, .ROBLOSECURITY=, quotes, spaces, or line breaks.",
        ),
        { status: 400 },
      );
    }
    this.#saving = true;
    const temporary = join(this.directory, `.env-${randomUUID()}.tmp`);
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      // Dedicated app-owned file; never modify the project's existing .env.
      // Double quotes preserve #; validation excludes double quotes, backslashes and newlines.
      await writeFile(
        temporary,
        `# Managed locally by solseer. Plaintext: do not share.\nROBLOX_SECURITY_COOKIE="${cookie}"\n`,
        { flag: "wx", mode: 0o600 },
      );
      await rename(temporary, this.path);
      this.#request = request;
      this.saved = true;
      this.source = "local settings";
      apply(request);
      return this.status();
    } catch {
      throw Object.assign(
        new Error(
          "Could not save local settings. Check the folder permissions and try again.",
        ),
        { status: 500 },
      );
    } finally {
      this.#saving = false;
      await unlink(temporary).catch(() => {});
    }
  }
}
