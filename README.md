# solseer

A little public-server radar for Sol's RNG. Find the gathering before the server hits 20/20.

I just vibe coded this on the side. It's a scrappy solo-dev project built around something I kept noticing: when a rare biome shows up, people flock to that server fast. The goal is simple: spot the rush early and give you a server worth checking.

**Population signals are leads, not confirmed biomes.** OCR can read the biome once you're there, but a friend group joining together can still look like a rare-biome rush. No mystery sauce, no measured rare-biome accuracy yet.

## run it

Download **SolSeer-Setup-X.Y.Z.exe** from the [latest release](https://github.com/SamSKNg/SolSeer/releases/latest). It's a Windows x64 Electron app: no Node installation, terminal, or browser tab needed.

- Minimize to keep tracking. Closing quits SolSeer and stops automation; there is no tray mode.
- Installed copies check for updates shortly after launch and every six hours. **Settings → Setup → Check for updates** checks manually. Downloads happen in the background; you choose when to restart and install.
- Moving from a portable copy? Install once and stop launching the old copy. Your local settings and history stay put. Portable ZIPs do not auto-update.
- Builds are unsigned, so Windows may show a publisher warning. The new updater has automated coverage, but a real installed, two-version upgrade still needs validation.

Don't run desktop and browser copies together against the same account/settings.

## what you get

- **Server radar:** population-sorted servers, early leads, rapid-filling signals, graphs, observation age, and carousel/card views.
- **Joining:** direct Roblox join/rejoin links, account presence, a biome-colored current-server card, and persistent join history with full JSON export.
- **Auto-join:** opt into early or rapid signals, including full rapid servers; optionally try recent bursts in full servers too. Roblox still decides whether you enter or queue.
- **Play automation:** linked to Auto-join. Recognizes Play, clicks it, then sends 10 zoom-out wheel steps. Target-biome pauses, cooldowns, and current-server exclusion still apply.
- **Biome OCR:** one persistent Tesseract worker reads Play and biome crops, with contrast-stretched RGB fallbacks. Join-time detections and signal evidence are saved for later analysis.
- **Notifications:** optional desktop alerts, Discord Rich Presence, and selected-biome webhooks.
- **Settings:** category sidebar, biome-section selection controls, polling interval, OCR resolution, and animation controls.

## the heuristics, no mystery sauce

Early leads need a net **+2 players within 15.5 seconds** at 13–18 players. Rapid filling needs **+3 or more** in that window at 13+ players, including full servers. Retained bursts stay visible while enough of their gain remains; a flat full server isn't a fresh surge. Peer-growth comparisons add context, not biome probabilities.

Polling defaults to **1 second**, configurable from 1–60 seconds. There is no local per-minute request cap: Roblox's rate limits and retry backoff determine when requests pause. Servers only update when sampled, so the interval isn't a freshness guarantee. Restarting doesn't reset Roblox's quota.

Auto-join avoids repeating signal episodes. Joins start a 60-second cooldown, which can end early when arrival and subsequent OCR establish a non-target biome or Play automation confirms readiness. Target-biome pauses survive unclear frames and focus loss until another biome is recognized.

## the OCR bit

Select **1920×1080** or **2560×1440** in Settings and keep Roblox foreground at the matching maximized/fullscreen size. Scanning pauses when you switch apps. Monitor-off capture isn't guaranteed; display changes and overnight sessions can leave capture or Play automation unable to work.

Play and biome recognition share one captured frame and one worker. The original biome crop and RGB fallbacks are tried until a name reaches **70% text similarity**. That's a name-match score, not Tesseract's confidence or a probability of correctness. Failed candidates aren't shown in Live OCR; the server card separately retains the last accepted biome.

Each cycle waits **500 ms after its work**, so the actual interval is longer. Live scanning doesn't save or upload screenshots or inject into Roblox. Stylized text, shaders, and moving backgrounds can still defeat it.

## Discord sharing

Two independent opt-ins under **Settings → Discord**:

- **Rich Presence:** uses SolSeer's shared application; no developer setup needed. Keep Discord desktop running with activity sharing enabled. Shows `Username - unga bunga roll`, the latest biome and detection age, and a join button when the current server is confirmed. Activity stays on while SolSeer runs, even with OCR paused. Discord shows the join button to others, not in your own profile preview.
- **Biome webhook:** paste a URL and choose biomes to broadcast, independently of auto-join targets. Messages include a biome-colored side bar, detecting player, detection age, and server link. No screenshots or role/user/everyone pings. Repeated server/biome pairs are suppressed for the session.

Sharing exposes your biome/server to its audience. Join links still depend on Roblox's handoff and server availability.

## the cookie bit — please read this

A `.ROBLOSECURITY` cookie is an account credential. **Don't put it in an issue, screenshot, commit, shared ZIP, or chat.** It's optional; authenticated polling and account presence use it, but it doesn't sign the Roblox client in for you.

Use **Settings → Setup** to save just the cookie value after acknowledging local plaintext storage. The webhook URL is also a secret. Preferences, credentials, and history live under `%LOCALAPPDATA%\solseer` (or `SOLSEER_CONFIG_DIR`); don't share that folder.

Join history survives restarts and exports all saved attempts, including unlabelled ones. Exports contain server IDs, timestamps, OCR text, and signal evidence—not credentials. Review before sharing. A recorded join is an attempted handoff; presence is separate evidence of arrival. Live population tracking and signal deduplication reset between sessions.

## poking around

React + Vite, a Node backend, and an Electron shell. Local JSON persistence, no database. Windows capture feeds bundled Tesseract and English data.

With **Node.js 22.13+**:

```sh
npm ci
npm run desktop    # desktop development; no updater
npm run dev        # browser development with live React updates
npm start          # build and serve at localhost:3000
```

```sh
npm test
npm run test:desktop
npm run package:installer  # Windows installer + update metadata
npm run package:desktop    # portable desktop ZIP
```

Normal tests use isolated settings and synthetic data. `npm run test:polling` makes real Roblox requests; stop other pollers first. After changing `SolSeer Icon.png`, run `npm run icons` and rebuild.

Code lives in `src/client`, `src/server`, `src/shared`, and `src/desktop`; tests in `tests-js`, packaging and diagnostics in `scripts`. The old `legacy/python` app isn't used.

See [installer and release workflow](docs/releases.md) for signing, update metadata, and tag-triggered drafts, or the [OCR benchmark](scripts/ocr-benchmark/README.md) for sample-specific measurements.

Until we've collected and checked real outcomes: **a lead worth checking, not a promise.**
