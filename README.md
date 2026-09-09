# solseer

A little public-server radar for Sol's RNG. Find the gathering before the server hits 20/20.

I just vibe coded this on the side. It's a scrappy solo-dev project built around something I kept noticing: when a rare biome shows up, people flock to that server fast. By the time a signal looks really convincing, there might not be a slot left.

So the goal is simple: **spot unusual population growth early, surface a server worth checking, and give you a join link while there's still room.**

This is not a confirmed biome detector. It's a population tracker with some deliberately early heuristics and a UI I probably spent too long making reflective.

## what this is actually for

Keep solseer open while playing or hunting for rare biomes. It watches Roblox's public server-list data, looks for servers filling quickly, and brings those leads forward so you can decide whether to jump in.

You get:

- A live, population-sorted server list, tucked away until you want it. Top 10 or 20, with filters.
- Early leads and rapid-filling signals in a carousel, plus an actionable corner notice.
- Population graphs, observation age, open slots, and a plain-English reason for each signal.
- Join/rejoin buttons, copyable server links, and a record of your join clicks for the session.
- Optional desktop notifications, so you don't have to stare at the page.

It doesn't read the biome inside a server, inject anything into Roblox, automatically join for you, or confirm that a join click got you into the game. The only detection input is sampled public population data. A friend group joining together can look like a rare-biome rush. False positives are part of the tradeoff here.

### joining a server

Join and Rejoin record your click locally, then hand off straight to the installed Roblox app using `roblox://placeId=...&gameInstanceId=...`. This skips the website join page, which has a [reported problem ignoring the selected server ID](https://devforum.roblox.com/t/deep-link-ignores-gameinstanceid-argument/3815549). Roblox documents the [direct-to-app format here](https://create.roblox.com/docs/production/promotion/deeplinks).

You need Roblox installed and signed in. Your browser may ask **Open Roblox?**; allow it if you intended to join. The cookie in solseer's Settings is for polling, not for signing the Roblox client into an account. This doesn't bypass full servers or access restrictions, and solseer can't verify which server the client ultimately joins.

**Copy server link** copies that same direct-app link. Some chat apps won't make `roblox://` links clickable; recipients can paste the full link into their browser's address bar. There is no automatic fallback to normal matchmaking. If the app doesn't open, check that Roblox is installed and that your browser hasn't blocked the launch prompt.

## the heuristics, no mystery sauce

These are hand-written rules, not a trained model. The thresholds are starting points, not numbers backed by a labeled biome dataset.

| Signal                | What triggers it                                                                                         | What happens                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Early lead            | Net **+2 players within 15 seconds**, currently **13–18 players**, with an open slot                     | Show it immediately; optionally send a desktop alert. No confirmation wait.     |
| Rapid filling         | Net **+3 players within 10 seconds**, currently **13+ players**, with an open slot                       | Highest-priority actionable tier; can upgrade an early alert.                   |
| Follow-up             | Another real observation within **20 seconds** of the trigger holds or exceeds the triggering population | Add supporting context. This confirms sampled population held, **not a biome**. |
| Full / recent filling | A recent lead fills, or a **+2 within 15s** burst is first seen at capacity                              | Keep it as a recent lead, behind joinable candidates. No desktop join alert.    |
| Sustained occupancy   | **19–20/20 for at least one observed minute**, with no observation gaps over 20 seconds                  | Context only. Being full does not create an alert on its own.                   |
| Stale observation     | No actual observation of that server for **more than 20 seconds**                                        | Label the old reading clearly. Don't notify from it.                            |

A few details that matter:

- **Net growth is not individual connections.** Going from 15 to 17 tells us the net change was +2. It doesn't tell us how many people arrived and left in between.
- Windows use **actual observation timestamps**, not "three requests must mean fifteen seconds." Another page being fetched is not another observation of this server.
- A population dip or capacity change resets the growth baseline. Old gains aren't recycled after a drop.
- Each qualifying observation starts or renews a **two-completed-poll card hold**. Someone leaving doesn't immediately remove the card. Flat samples can still qualify while the original gain is in the window; the hold itself and follow-up confirmation cannot renew it.
- Other-page polls and failed requests count toward that hold. Heartbeats, quota waits, and requests still in flight don't. Freshness is separate: a held card can still become stale.
- Below-13 observations already returned by Roblox are retained internally as baselines. The live list still defaults to 13+; held cards can temporarily show a lower count.

### how leads are ranked

Fresh candidates with open slots come first, then full candidates, then stale held leads. Within those groups: rapid filling, then early/recent leads, with follow-up confirmation, observed growth pace, freshness, and a stable server ID breaking ties. The expandable live list stays population-first.

There is **no biome confidence percentage or weighted mystery score**. `Pace /10s` just normalizes observed net growth to ten seconds. For example, +2 in 5 seconds is a pace of 4 per 10 seconds. That's a description of the sampled movement, not a prediction that four more people are coming.

The rules live in [scorer.js](src/server/scorer.js); the shared ordering lives in [signals.js](src/shared/signals.js).

## three-second polling does not mean every server, every three seconds

With a cookie configured, solseer targets **one request every 3 seconds**, capped at **20 attempts per rolling minute**. Without one, it's **20.5 seconds / 3 attempts per minute**. The anonymous cadence can't resolve the 10–15 second growth windows; the UI warns about this rather than pretending it can. The heuristic windows are unchanged; the two-poll card hold is now roughly six seconds at the target cadence.

Each request fetches at most 100 servers. The pattern is:

**top page → top page → next discovery page → repeat**

Discovery advances independently through deeper pages and wraps at the end. This gives us some breadth without abandoning the busiest page, but it has a real limitation: deeper servers may not be seen again in time for a useful follow-up. Population sorting can move servers between pages, too. More discovery means less repeated observation of the same servers.

That's why stale readings exist. "Last seen at 17/20" is not the same as "there are three slots open right now."

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

The app doesn't extract cookies from your Roblox client or browser. The value stays on the backend and is sent only to the Roblox public-server-list endpoint over HTTPS; redirects are refused. Settings shows whether a cookie is configured, never the saved value. "Configured" doesn't mean verified or entitled to a higher limit.

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

In Settings, enable desktop notifications, choose early leads and/or rapid filling, allow browser notifications, and save. The test button doesn't call Roblox. Notifications are off by default.

Keep the app and a browser tab running. Browser permissions and OS notification settings are separate from solseer's preferences; delivery can be delayed or suppressed. This isn't a background push service for a closed browser.

Desktop alerts fire once per signal episode, with one extra alert for a rapid-filling upgrade. Repeated polls don't spam you. Two completed polls outside candidate status rearm a server. Simultaneous alerts are grouped and delivery is shared across tabs. Full, stale, and held-only leads don't notify; queued alerts are rechecked before delivery. Clicking a notification opens details, not an automatic join.

**Saved locally:** cookie configuration and notification preferences.

**Session only:** population history, signal holds, notification deduplication, join clicks, joined markers, and local request/cooldown tracking. A refresh or another tab shares the running backend session. Restarting the backend clears it. A recorded join means you clicked Join, not that Roblox let you in.

## poking around

React + Vite on the frontend, plain Node HTTP on the backend. Live updates arrive through Server-Sent Events. No database in the active app.

```text
src/client/       UI, graphs, carousel, settings
src/server/       polling, heuristics, local API, session state
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
