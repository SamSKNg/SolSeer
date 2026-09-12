# solseer

A little public-server radar for Sol's RNG. Find the gathering before the server hits 20/20.

I just vibe coded this on the side. It's a scrappy solo-dev project built around something I kept noticing: when a rare biome shows up, people flock to that server fast. By the time a signal looks really convincing, there might not be a slot left.

So the goal is simple: **spot unusual population growth early, surface a server worth checking, and give you a join link while there is still room—or a fresh queue worth entering.**

This is not a confirmed biome detector. It's a population tracker with some deliberately early heuristics and a UI I probably spent too long making reflective.

## Desktop app (local preview)

The desktop executable, app window, and browser favicon use `SolSeer Icon.png`. After replacing that source artwork, run `npm run icons` on Windows to regenerate the multi-size `.ico` and PNG in `public/`, then rebuild the app.

SolSeer can now run as a **port-free Electron desktop app**. Launch `SolSeer.exe` from the complete extracted desktop package: no separate Node installation, terminal window, browser tab, or localhost server is needed. The React interface uses a sandboxed preload bridge to communicate with the Node backend; only bundled UI files are served through an internal app protocol. OCR uses the bundled Electron/Node runtime and English model, and fonts are bundled locally too.

Minimize the window to keep tracking and auto-join running. Closing it quits the app and stops its OCR helper. A second desktop launch focuses the existing instance. There is no system-tray mode or automatic updater yet. Stop the old browser-based copy before switching so you do not run two trackers against the same account/settings. Existing preferences and join history remain in `%LOCALAPPDATA%\\solseer` (or your `SOLSEER_CONFIG_DIR` override). History export opens a native Save dialog.

From source:

```powershell
npm install
npm run build
npm run desktop
```

`npm run package:desktop` builds a fresh native helper in an isolated staging folder and creates a portable Windows x64 desktop ZIP under `release/desktop-*`. Keep all files next to `SolSeer.exe`; do not copy only the executable. This local preview is unsigned and may show a Windows publisher warning. It has not replaced the published browser-based v0.5.4 release.

`npm run test:desktop` runs an isolated Electron smoke test with Roblox polling disabled. It checks the renderer sandbox, IPC settings/snapshots/export, and rejects any attempt by the backend to open a TCP listener. Existing browser development and packaging commands remain available.

## what this is actually for

Keep solseer open while playing or hunting for rare biomes. It watches Roblox's public server-list data, looks for servers filling quickly, and brings those leads forward so you can decide whether to jump in.

You get:

- A live, population-sorted server list, tucked away until you want it. Top 10 or 20, with filters.
- Early leads and rapid-filling signals in a carousel or a numbered card index, plus an actionable corner notice. Switch with **Carousel / Cards** above Signals to watch; both views sort by **player count, highest first**, with signal priority breaking population ties, and share Join/Copy actions. The choice lasts while the page is open, including navigation between app pages; a reload defaults to the carousel.
- Population graphs, observation age, open slots, and a plain-English reason for each signal.
- Join/rejoin buttons, copyable server links, and persistent join history with a full JSON export.
- Automatic join-time biome OCR, saved locally with raw OCR and population graph evidence for future analysis.
- Optional desktop notifications and opt-in Windows auto-join, so you don't have to stare at the page.
- Exact account-presence tracking, a **You are here** marker, and current-server exclusion for joins.
- Always-on 1080p/1440p fullscreen biome OCR, optional Play automation, and user-selected biomes that pause auto-join.

Population signals still do not confirm a biome. A separate Windows-only OCR helper reads the visible biome label while Roblox is foreground, even when Auto-Start is off; it does not inject into Roblox. Auto-Start controls the optional Play click and subsequent zoom-out. A friend group joining together can look like a rare-biome rush, and OCR can misread stylized text. False positives are part of the tradeoff here.

### joining a server

Join and Rejoin record your click locally, then hand off straight to the installed Roblox app using `roblox://placeId=...&gameInstanceId=...`. This skips the website join page, which has a [reported problem ignoring the selected server ID](https://devforum.roblox.com/t/deep-link-ignores-gameinstanceid-argument/3815549). Roblox documents the [direct-to-app format here](https://create.roblox.com/docs/production/promotion/deeplinks).

You need Roblox installed and signed in. Your browser may ask **Open Roblox?**; allow it if you intended to join. The cookie in solseer's Settings is for polling, not for signing the Roblox client into an account. This doesn't bypass full servers or access restrictions, and solseer can't verify which server the client ultimately joins.

On Windows, the **Auto-join** toggle beside **Signals to watch** launches the installed Roblox app for at most one newly detected server per poll. Settings has independent **Auto-join early leads** and **Auto-join rapid filling** choices; full Rapid signals are included so Roblox can place the attempt in its queue. It records the attempt in Join history, does not replay a signal that was already active when you enabled it, and does not launch the same episode again after a later tier change.

An additional opt-in, **Auto-join recent bursts in full servers**, also considers full servers retaining an earlier early/rapid burst without fresh growth. Unlike the new-signal options, it can consider already-visible, unattempted episodes. It is off by default and independent of the early/rapid switches. It preserves biome pauses, cooldowns, current-server exclusion, stale-sample rejection, and one attempt per episode. It does not add desktop alerts for retained bursts or auto-join arbitrary full servers with no burst signal.

With a valid cookie, solseer checks the configured account's Roblox presence every five seconds. When Roblox reports the exact Sol's RNG Job ID, a compact biome-colored current-server card appears below the tracker statistics with large server, username, and biome labels. That server also gets a **You are here** marker and its Join control is disabled. Auto-join excludes it and refreshes presence once more immediately before launching another server. Presence can lag or hide the Job ID, and private/reserved instances may not appear in the public list.

OCR reads the foreground, maximized Roblox window at the **1920 × 1080** or **2560 × 1440** resolution selected in Settings. Scanning pauses when you switch apps and resumes when Roblox returns to foreground. One shared in-memory capture supplies tight Play and biome crops to **one persistent Tesseract worker** with bundled English data and single-line recognition. Windows OCR is not initialized for live scanning. The worker reads the Play crop first, even with Auto-Start off; a recognized Play marker skips biome recognition of menu scenery. Otherwise it reads the biome crop, then contrast-stretched red, green, and blue channels until a biome reaches 70% text similarity. The fuzzy name matcher remains separate from Tesseract's own confidence score. No failed biome candidate is displayed. Each cycle finishes with a **500 ms wait**, so capture and OCR work add to the effective interval. No screenshots are saved or uploaded by the live pipeline.

The inline **Live OCR** status shows only a passing match from the latest scan and its match percentage; it does not repeat the stored current/last biome or show below-threshold candidates. “No match” means the scan did not reach the acceptance threshold, and scanning continues. Match percentages measure text similarity, not the probability that OCR is correct. The current-server card separately retains the last accepted biome, with biome-colored accents and left-to-right particles. Its guide-listed colors follow the supplied biome infographic, including Glitched's cyan/magenta accents.

The adjacent **Auto-Start** toggle clicks Play after two matching scans. After the menu disappears and at least 1.5 seconds have passed, it moves the pointer over the game view and sends **10 mouse-wheel zoom-out steps** alongside continued OCR. Switching apps cancels the queued burst; it never brings Roblox back into focus. The resulting camera distance depends on the game and starting zoom. Auto-Start does not create a second persistent OCR pipeline.

A selected target biome remains an Auto-join veto through focus loss and unclear or stale frames, until OCR recognizes another biome.

Every manual or automatic join starts a **60-second auto-join cooldown**, preventing another signal from switching servers while Roblox is waiting at or loading past the Play screen. When Auto-Start has clicked Play and a later biome reading confirms the game view is ready, that cooldown ends early. It also ends early after presence confirms arrival in the joined server and a subsequent OCR reading identifies a non-target biome, even when Play was clicked manually. Unreadable scans and pre-arrival readings do not trigger this new path. Target-biome pauses remain in effect independently of the cooldown. The current-server card shows the remaining cooldown when presence is available.

**Copy server link** copies that same direct-app link. Some chat apps won't make `roblox://` links clickable; recipients can paste the full link into their browser's address bar. There is no automatic fallback to normal matchmaking. If the app doesn't open, check that Roblox is installed and that your browser hasn't blocked the launch prompt.

## the heuristics, no mystery sauce

These are hand-written rules, not a trained model. The thresholds are starting points, not numbers backed by a labeled biome dataset.

| Signal               | What triggers it                                                                                                     | What happens                                                                                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Early lead           | Net **+2 players within 15.5 seconds**, currently **13–18 players**, with an open slot                               | Show it immediately; optionally send a desktop alert. No confirmation wait.                                                                                                       |
| Rapid filling        | Net **+3 or more players within 15.5 seconds**, currently **13+ players**, including a reading that reaches capacity | Highest-priority evidence tier; can upgrade an early alert. Full readings show a Full indicator and can enter Roblox's queue.                                                     |
| Follow-up            | Another real observation within **20 seconds** of the trigger holds or exceeds the triggering population             | Add supporting context. This confirms sampled population held, **not a biome**.                                                                                                   |
| Holding burst        | A previously detected burst retains more than half of its original net gain                                          | Keep the card and actionable corner notice visible below active growth. Retained Rapid signals say **Holding · rapid burst**. No repeat notification or auto-join from a plateau. |
| Burst loss threshold | At least half of the original burst gain has left                                                                    | Remove the retained burst and its corner notice immediately.                                                                                                                      |
| Full signal          | A Rapid burst reaches 20/20, or a **+2 within 15.5s** burst is first seen at capacity                                | Rapid stays Rapid and can notify/auto-join into the queue; a full Early burst remains an informational recent lead.                                                               |
| Sustained occupancy  | **19–20/20 for at least one observed minute**, with no observation gaps over 20 seconds                              | Context only. Being full does not create an alert on its own.                                                                                                                     |
| Falling off / stale  | No actual observation of that server for **more than 20 seconds**                                                    | Immediately remove it from signals and the live server list while retaining internal history for safe stale-return baselines.                                                     |

A few details that matter:

- **Net growth is not individual connections.** Going from 15 to 17 tells us the net change was +2. It doesn't tell us how many people arrived and left in between.
- Windows use **actual observation timestamps**, not "three requests must mean fifteen seconds." Another page being fetched is not another observation of this server.
- A population dip or capacity change resets the growth baseline. Old gains aren't recycled after a drop.
- After a stale gap (over 20 seconds), the first returning observation resets the growth baseline and clears any old lead hold. It shows **Awaiting fresh sample**, with no lead or notification. A second actual observation of that same server must show qualifying growth from the new baseline; a flat follow-up does not validate the jump during the gap. Other-page polls and UI heartbeats don't count, and another stale gap restarts the guard.
- A burst stays retained while **more than half of its original net gain remains**. For an original +4 burst, a loss of 2 removes it; for +3, the next whole-player loss means a loss of 2. Later peaks do not raise this threshold.
- Only actual observations can prove that population loss. Other-page polls, failures, heartbeats, requests still in flight, and quota waits cannot remove a retained burst. A full Rapid reading can remain actionable through Roblox's queue; full Early and all stale readings are not actionable. Returning after a stale gap clears the old burst rather than recycling it.
- The short two-completed-poll grace period still applies to ordinary signal holds. It cannot preserve a burst after the half-loss threshold is reached.
- Below-13 observations already returned by Roblox are retained internally as baselines. The live list still defaults to 13+; held cards can temporarily show a lower count.

### how leads are ranked

The signal carousel, card index, and live list contain only fresh servers and sort by **player count descending**, using signal ranking to break ties. Stale records remain internal only so a returning server cannot recycle an old growth baseline.

Signal priority puts fresh candidates with open slots first, then full candidates. Within those groups, active growth comes before retained bursts; rapid filling comes before early growth. Peer-relative growth, follow-up confirmation, observed growth pace, freshness, and a stable server ID break ties. The actionable corner notice and desktop notifications retain this urgency-based ranking rather than following the population display order.

Population signals have **no biome probability or weighted mystery score**. The separate Live OCR percentage describes text matching only. `Pace /10s` just normalizes observed net growth to ten seconds. For example, +2 in 5 seconds is a pace of 4 per 10 seconds. That's a description of the sampled movement, not a prediction that four more people are coming.

### comparing growth with nearby populations

We use the real observations behind the graphs, never the visual flat-line extension. Each server gets an endpoint slope over its longest available continuous **3–15 second** window: `(ending players - starting players) / elapsed seconds × 10`. Flat and negative movement count too. This peer-window slope is separate from the best qualifying burst's `Pace /10s` value.

Peers must have the same capacity, start within **±2 players**, cover a duration within **±3 seconds**, and end their window within **15 seconds** of the target sample. All must have been actually observed within the last **20 seconds**. Each other server contributes at most one sample.

With at least **20 comparable peers**, the card shows the percentage with a strictly lower slope; ties don't count as faster. Details also show the peer median. With fewer peers, it says **Insufficient comparison data**, and sorting uses a neutral internal midpoint instead of inventing a displayed percentile. Comparisons rank leads only: a lone +1 among flat servers cannot create an alert just because its percentile is high.

These are comparisons within our sampled servers, not all Roblox servers and definitely not a biome probability. A full server cannot show further positive net growth, so its Rapid tier comes from the burst that reached capacity; a later flat 20/20 reading is labeled as a retained Rapid burst, not a new surge. No additional API requests are made for these calculations.

The rules live in [scorer.js](src/server/scorer.js), retention in [burst-memory.js](src/server/burst-memory.js), and peer comparisons in [peer-growth.js](src/server/peer-growth.js); the shared ordering lives in [signals.js](src/shared/signals.js).

## two-second polling stays on the top page

Settings lets you choose a **server polling interval of 1–60 seconds**, defaulting to **1 second**. The preference persists locally and applies without restarting. This controls server-list polling, not the 500 ms OCR wait. With a cookie configured, requests are capped at **40 API attempts per rolling minute**, so a 1-second interval cannot be sustained throughout a whole minute. Each request fetches at most 100 servers and counts as one completed heuristic poll. Authenticated mode does not follow a page cursor; servers falling out of that sample are removed from the UI after 20 seconds.

**top 100 → configured interval → top 100 → configured interval → top 100**, subject to request budgets and backoff.

Without a cookie, polling retains its **3 attempts per minute** budget and top → top → discovery-page rotation. The configured interval does not bypass that budget, so anonymous polling cannot reliably resolve the 15.5-second burst window.

A two-second target is not a guarantee that every visible server is observed every two seconds. Population ordering can move servers into or out of the top page, and network or quota delays still apply. "Last seen at 17/20" is not the same as "there are three slots open right now."

Roblox rate limits, slow responses, and errors can delay things further. The tracker respects its local request budget and Roblox's reported cooldowns, including failures and retries. Alerts don't fast-forward polling or add requests. A cookie selects a faster local schedule; **it does not guarantee Roblox will accept that rate**. Authentication failures slow the tracker down.

There's no startup wait. But restarting the app does not reset Roblox's quota, so don't run multiple copies or restart repeatedly to dodge a cooldown.

## run it

You need **Node.js 22.13+**. No Python, no separate frontend/backend terminals.

```sh
npm ci
npm start
```

Open **http://localhost:3000**. `npm start` builds the React UI and starts the local Node server. Stop it with **Ctrl+C**.

For development with live React updates:

```sh
npm run dev
```

The app listens on your machine only. This is a local tool, not a hosted service.

### windows, without installing node

Grab the [v0.5.4 Windows x64 ZIP](https://github.com/SamSKNg/SolSeer/releases/download/v0.5.4/solseer-v0.5.4-windows-x64.zip). See the [v0.5.4 release notes](https://github.com/SamSKNg/SolSeer/releases/tag/v0.5.4) for what changed. When updating, stop the old copy and extract the new ZIP into a fresh folder; your saved cookie, notification preferences, join history, and biome observations stay in their separate local settings folder. Join attempts from older sessions that were never persisted cannot be recovered.

If you have a portable ZIP, extract the whole thing and double-click **Start solseer.cmd** inside the `solseer` folder. Keep its console open; Ctrl+C stops it. Stop an existing copy first if the port is already occupied.

To make that ZIP yourself, from a Windows x64 or arm64 development machine:

```sh
npm run package:windows
```

This builds the UI, downloads the current Node 22 runtime from nodejs.org, verifies its SHA-256 against the official manifest, and writes a versioned ZIP under `release/`. It's a browser app with a launcher, not a signed `.exe` installer. The ZIP excludes cookies, local settings, and session data. Build outputs aren't committed to this repository.

## the cookie bit — please read this

A `.ROBLOSECURITY` cookie is an account credential. **Someone who gets it may be able to access your Roblox session. Don't put it in an issue, screenshot, commit, shared ZIP, or chat.**

Using one is optional. If you choose to:

1. Open **Settings**.
2. Paste just the cookie value, without `Cookie:` or `.ROBLOSECURITY=`.
3. Acknowledge plaintext storage and choose **Save on this machine**.

The app doesn't extract cookies from your Roblox client or browser. The value stays on the backend and is sent only to three fixed Roblox endpoints over HTTPS: the Sol's RNG public-server list, the authenticated-user identity read, and that user's presence read. Redirects are refused. No inventory, trade, purchase, message, or account-changing endpoint is allowed. Settings shows whether a cookie is configured, never the saved value. "Configured" doesn't mean verified or entitled to a higher limit.

The saved file is **plaintext, not encrypted**: `%LOCALAPPDATA%\solseer\.env` on Windows, or `~/.config/solseer/.env` elsewhere. Don't sync or share that folder. Local malware or someone with access to your files can still read it. This is a vibe-coded side project, not a reason to be casual with an account credential.

Saving takes effect by the next poll without restarting. **Clear / use anonymous** switches back to anonymous polling. It doesn't erase other copies or backups of your cookie. Revoke the affected Roblox session if the credential leaks.

<details>
<summary>Other ways to configure it / local settings details</summary>

Startup precedence is an explicit `ROBLOX_SECURITY_COOKIE` environment variable, then the app-managed settings file, then a legacy project-root `.env`. An explicit empty environment value selects anonymous mode. An empty app-managed setting prevents fallback to an old project cookie.

The project `.env` is ignored by Git, but that does **not** stop OneDrive or another sync service from copying it. Prefer the Settings location outside the project. Never use a `VITE_` environment variable for a secret.

On Windows, `npm run start:authenticated` offers a masked, non-persistent prompt. It doesn't save the entered value; supply it again on the next launch. Don't weaken PowerShell policy if your machine blocks the launcher.

`SOLSEER_CONFIG_DIR` overrides the local settings directory. `PORT` defaults to 3000. `CLUSTER_NO_POLL=1` lets you inspect the UI/API without contacting Roblox. Settings writes require same-origin requests and a per-process token; that doesn't protect against software already running as your Windows user.

</details>

## notifications and what survives a restart

In Settings, choose early leads and/or rapid filling for desktop alerts, which tiers Auto-join may open, the 1080p/1440p OCR mode, and biomes that pause auto-join. The main Server radar page has separate Windows **Auto-join** and **Auto-Start** toggles below **Signals to watch**. Browser permission is required only for desktop alerts. Play-click and zoom-out automation remain off by default.

**Biomes that pause auto-join** are grouped for easier selection; grouping does not change the pause behavior or existing selections:

- **Normal:** Normal, Windy, Snowy, Rainy, Sandstorm, Hell, Starfall, Heaven, Corruption, Null.
- **Rare Biomes:** Glitched, Dreamspace, Cyberspace, Singularity.
- **Event Biomes:** Pumpkin Moon, Graveyard, Blazing Sun, Blood Rain, Aurora, Eggland, Incinerator.

Keep the backend app running. Desktop alerts additionally need an open browser tab; browser permissions and OS notification settings are separate from solseer's preferences and may suppress delivery. Auto-join launches Roblox from the local Windows backend and does not require the browser tab to remain open.

Desktop alerts fire once per signal episode, with one extra alert for a rapid-filling upgrade. Repeated polls don't spam you. Two completed polls outside candidate status rearm a server. Simultaneous alerts are grouped and delivery is shared across tabs. A newly full Rapid signal can alert; full Early, stale, and held-only leads do not create a new desktop alert. Queued alerts are rechecked before delivery. Clicking a desktop notification opens details. Auto-join is a separate opt-in and launches only the strongest enabled new signal in a poll.

**Saved locally:** cookie configuration, notification/auto-join preferences, Auto-Start mode, and the biome target list.

When account presence confirms that a join reached its intended Job ID, the first subsequent biome OCR match is saved locally in `biome-observations.json` beside the settings file. Each observation contains the detected biome, OCR confidence and raw text, join-time signal fields, and up to 120 recent public population observations. It contains no Roblox cookie or account identity.

**Persistent join history:** `join-history.json` lives beside local settings. All attempts, their OCR biome labels, and click-time graph/signal evidence survive restarts. Join history shows the latest 200; **Export all history (JSON)** downloads every saved attempt, including unlabelled attempts. Previous sessions lost before this feature cannot be recovered. Exports contain server IDs, timestamps and OCR text; review before sharing.

**Session only:** population tracking, signal holds, notification/auto-join deduplication, account-presence state, live OCR results, current-server markers, and request/cooldown tracking. A recorded join means solseer attempted the handoff; presence is separate evidence of arrival.

The biome crop, including color-channel fallback, is `(4,860,320,25)` at 1080p and `(5,1150,425,32)` at 1440p (x, y, width, height). The right margin accommodates longer names and excludes version, time-of-day and currency text. The Play crop is `(164,965,200,70)` at 1080p and `(212,1286,260,90)` at 1440p. Both are extracted from the same captured frame and recognized sequentially by one worker; there are no overlapping jobs or separate OCR services. New history observations identify their source as `tesseract`; older `windows_ocr` records remain readable.

The trial's small local resource test measured about 32 ms for an original-crop success and 68 ms for four unsuccessful passes, with approximately 122–132 MiB total memory for the additional OCR process and 9–14% of one CPU core at a 500 ms post-scan wait. These are sample-specific adapter measurements, not a guarantee for game scenes or the total app footprint. See [the benchmark](scripts/ocr-benchmark/README.md). Stop the running app before `npm start` so the native helper can rebuild; restarting an old executable alone does not load source changes.

## poking around

React + Vite on the frontend, plain Node HTTP on the backend. Live updates arrive through Server-Sent Events. No database in the active app.

```text
src/client/       UI, graphs, carousel, settings
src/server/       polling, heuristics, local API, persistent joins and session state
src/shared/       signal ordering, notification defaults, join links
tests-js/         backend and React tests
scripts/          launchers, portable packaging, polling probe
legacy/python/    the earlier Python version; not used by the app
```

```sh
npm test
npm run build
```

The normal tests use synthetic server data and isolated settings, not your Roblox cookie. `npm run test:polling` is different: it makes real Roblox requests with your local configuration. Stop every other poller first, and respect any cooldown it reports.

## rough edges / expectations

I wanted something useful to tinker with, not to pretend I'd solved biome detection from a server list. The thresholds will need tuning, coverage isn't complete, and a server can fill between a reading and your click. A flat 20/20 count also hides any arrivals replacing departures.

There's no measured rare-biome accuracy yet. The next useful step is collecting actual outcomes and checking whether these leads beat just joining another busy server. Until then: **a lead worth checking, not a promise.**
