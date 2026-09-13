// Injectable controller: tests never contact GitHub or run an installer.
export class UpdateController {
  constructor({ updater, version, supported, notify = () => {}, confirm, shutdown, now = Date.now }) {
    Object.assign(this, { updater, notify, confirm, shutdown, now });
    this.state = { status: supported ? "idle" : "unsupported", version, message: supported ? "Updates are checked automatically." : "Automatic updates require the installed Windows version. Development and portable copies are unchanged." };
    this.supported = supported; this.lastCheck = -Infinity;
    if (!supported) return;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.logger = null;
    updater.on("checking-for-update", () => this.set({ status: "checking", message: "Checking for updates…" }));
    updater.on("update-available", info => this.set({ status: "downloading", availableVersion: info.version, percent: 0, message: `Downloading SolSeer ${info.version}…` }));
    updater.on("download-progress", info => this.set({ status: "downloading", percent: Math.max(0, Math.min(100, Number(info.percent) || 0)) }));
    updater.on("update-not-available", () => this.set({ status: "current", message: "SolSeer is up to date." }));
    updater.on("update-downloaded", info => this.set({ status: "ready", availableVersion: info.version, percent: 100, message: `SolSeer ${info.version} is ready. Restart when convenient to install it.` }));
    updater.on("error", () => this.set({ status: "error", message: "Update failed. Your current version is unchanged; try again later." }));
  }
  snapshot() { return { ...this.state }; }
  set(patch) { Object.assign(this.state, patch); this.notify(this.snapshot()); }
  start() {
    if (!this.supported || this.timer) return;
    this.timer = setTimeout(() => this.check(), 10000);
    this.interval = setInterval(() => this.check(), 6 * 60 * 60 * 1000);
    this.timer.unref?.(); this.interval.unref?.();
  }
  stop() { clearTimeout(this.timer); clearInterval(this.interval); }
  async check() {
    if (!this.supported || this.checking || ["checking", "downloading", "ready", "installing"].includes(this.state.status) || this.now() - this.lastCheck < 30000) return this.snapshot();
    this.checking = true; this.lastCheck = this.now();
    this.set({ status: "checking", message: "Checking for updates…" });
    try { await this.updater.checkForUpdates(); }
    catch { this.set({ status: "error", message: "Could not check for updates. Continue using SolSeer and try again later." }); }
    finally { this.checking = false; }
    return this.snapshot();
  }
  async install() {
    if (!this.supported || this.installing || this.state.status !== "ready") return false;
    this.installing = true;
    try {
      if (!await this.confirm()) return false;
      this.set({ status: "installing", message: "Stopping automation and restarting to update…" });
      this.stop();
      await this.shutdown();
      this.updater.quitAndInstall(false, true);
      return true;
    } catch {
      this.set({ status: "error", message: "Installation could not start. Restart SolSeer manually before using automation again." });
      return false;
    } finally { this.installing = false; }
  }
}
