# solseer

A little public-server radar for Sol's RNG. Find the gathering before the server hits 20/20.

I just vibe coded this on the side. It's a scrappy solo-dev project built around something I kept noticing: when a rare biome shows up, people flock to that server fast. By the time a signal looks really convincing, there might not be a slot left.

So the goal is simple: **spot unusual population growth early, surface a server worth checking, and give you a join link while there's still room.**

This is not a confirmed biome detector. It's a population tracker with some deliberately early heuristics and a UI I probably spent too long making reflective.

## what this is actually for

Keep solseer open while playing or hunting for rare biomes. It watches Roblox's public server-list data, looks for servers filling quickly, and brings those leads forward so you can decide whether to jump in.

You get:

- A live, population-sorted server list, tucked away until you want it. Top 10 or 20, with filters.
- Early leads and rapid-filling signals in a carousel or a numbered card index, plus an actionable corner notice. Switch with **Carousel / Cards** above Signals to watch; both views sort by **player count, highest first**, with signal priority breaking population ties, and share Join/Copy actions. The choice lasts while the page is open, including navigation between app pages; a reload defaults to the carousel.
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

| Signal                | What triggers it                                                                                         | What happens                                                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Early lead            | Net **+2 players within 15 seconds**, currently **13–18 players**, with an open slot                     | Show it immediately; optionally send a desktop alert. No confirmation wait.                                                                                  |
| Rapid filling         | Net **+3 players within 10 seconds**, currently **13+ players**, with an open slot                       | Highest-priority actionable tier; can upgrade an early alert.                                                                                                |
| Follow-up             | Another real observation within **20 seconds** of the trigger holds or exceeds the triggering population | Add supporting context. This confirms sampled population held, **not a biome**.                                                                              |
| Holding population    | A previously detected burst gets fresh readings without any population drop since the burst              | Keep the card visible below active growth. No repeat notification from a plateau.                                                                            |
| Declining burst       | A **−1** change from the previous actual observation after a burst                                       | Show **Declining · recent burst** until the next completed poll; remove unless new growth qualifies. A **−2 or larger** drop removes the signal immediately. |
| Full / recent filling | A recent lead fills, or a **+2 within 15s** burst is first seen at capacity                              | Keep it as a recent lead, behind joinable candidates. No desktop join alert.                                                                                 |
| Sustained occupancy   | **19–20/20 for at least one observed minute**, with no observation gaps over 20 seconds                  | Context only. Being full does not create an alert on its own.                                                                                                |
| Stale observation     | No actual observation of that server for **more than 20 seconds**                                        | Label the old reading clearly. Don't notify from it.                                                                                                         |

A few details that matter:

- **Net growth is not individual connections.** Going from 15 to 17 tells us the net change was +2. It doesn't tell us how many people arrived and left in between.
- Windows use **actual observation timestamps**, not "three requests must mean fifteen seconds." Another page being fetched is not another observation of this server.
- A population dip or capacity change resets the growth baseline. Old gains aren't recycled after a drop.
- After a stale gap (over 20 seconds), the first returning observation resets the growth baseline and clears any old lead hold. It shows **Awaiting fresh sample**, with no lead or notification. A second actual observation of that same server must show qualifying growth from the new baseline; a flat follow-up does not validate the jump during the gap. Other-page polls and UI heartbeats don't count, and another stale gap restarts the guard.
- A burst starts **60 seconds of wall-clock visibility**. Fresh non-declining readings extend visibility to 60 seconds after that reading, capped at **two minutes from the original trigger**. Flat readings don't start new burst episodes or desktop alerts.
- **A −1 post-burst change marks the signal for removal after the next completed global poll.** It stays briefly as Declining · recent burst; flat readings and +1 rebounds cannot save it. A new qualifying burst from a post-drop baseline can start a fresh episode instead. A **−2 or larger change in one observation removes the signal immediately**, including its short grace hold. Other-page polls and failed requests complete the pending −1 removal too; heartbeats, requests still in flight and quota waits do not. Losses are measured between actual observations, not inferred from a missing server. Departures are negative evidence, not proof a rare biome is absent. This removes the signal, not the server's observation history or its normal live-list entry.
- The short two-completed-poll grace period still exists alongside burst memory, but cannot keep an expired burst alive. Other-page polls and failures consume that short grace, not the longer wall-clock visibility. Only real retained-population readings extend the longer timer. Stale readings never notify, and returning after a stale gap clears both old holds.
- Below-13 observations already returned by Roblox are retained internally as baselines. The live list still defaults to 13+; held cards can temporarily show a lower count.

### how leads are ranked

The signal carousel and card index sort by **player count descending**, using the signal ranking below to break ties. Full or stale high-population cards can therefore appear before lower-population actionable leads; their labels still show their status. The expandable live list also stays population-first.

Signal priority itself is unchanged: fresh candidates with open slots come first, then full candidates, then stale held leads. Within those groups, active growth comes before retained bursts; rapid filling comes before early growth. Peer-relative growth, follow-up confirmation, observed growth pace, freshness, and a stable server ID break ties. The actionable corner notice and desktop notifications retain this urgency-based ranking rather than following the population display order.

There is **no biome confidence percentage or weighted mystery score**. `Pace /10s` just normalizes observed net growth to ten seconds. For example, +2 in 5 seconds is a pace of 4 per 10 seconds. That's a description of the sampled movement, not a prediction that four more people are coming.

### comparing growth with nearby populations

We use the real observations behind the graphs, never the visual flat-line extension. Each server gets an endpoint slope over its longest available continuous **3–15 second** window: `(ending players - starting players) / elapsed seconds × 10`. Flat and negative movement count too. This peer-window slope is separate from the best qualifying burst's `Pace /10s` value.

Peers must have the same capacity, start within **±2 players**, cover a duration within **±3 seconds**, and end their window within **15 seconds** of the target sample. All must have been actually observed within the last **20 seconds**. Each other server contributes at most one sample.

With at least **20 comparable peers**, the card shows the percentage with a strictly lower slope; ties don't count as faster. Details also show the peer median. With fewer peers, it says **Insufficient comparison data**, and sorting uses a neutral internal midpoint instead of inventing a displayed percentile. Comparisons rank leads only: a lone +1 among flat servers cannot create an alert just because its percentile is high.

These are comparisons within our sampled servers, not all Roblox servers and definitely not a biome probability. Full servers have no room for positive net growth; their burst history stays visible without calling a flat 20/20 reading a new surge. No additional API requests are made for these calculations.

The rules live in [scorer.js](src/server/scorer.js), retention in [burst-memory.js](src/server/burst-memory.js), and peer comparisons in [peer-growth.js](src/server/peer-growth.js); the shared ordering lives in [signals.js](src/shared/signals.js).

## three-second polling does not mean every server, every three seconds

With a cookie configured, solseer targets **one two-page poll cycle every 3 seconds**, capped at **40 API attempts per rolling minute**. Page 1 supplies a fresh cursor for page 2, so the two requests run back-to-back, not simultaneously. There is no additional three-second wait between them. Each pair counts as **one completed heuristic poll**: time windows, the two-poll grace, and next-poll decline removal are unchanged. Without a cookie, it's still **one page every 20.5 seconds / 3 attempts per minute**. The anonymous cadence can't resolve the 10–15 second growth windows; the UI warns about this rather than pretending it can.

Each request fetches at most 100 servers. Authenticated polling repeatedly fetches:

**page 1 → page 2 → next three-second cycle → page 1 → page 2**

This refreshes up to 200 servers per cycle; authenticated polling no longer explores deeper pages. If page 1 has no next cursor, only one request is made. If the budget or Roblox cooldown prevents page 2, or page 2 fails, page 1's successful readings still update and the timeline marks a partial cycle. The next cycle starts with a fresh page 1, not an old page-2 cursor. Servers appearing on both pages contribute only one observation per cycle, using the later page's valid reading and its real timestamp. API request counters count both attempts, including failures; the timeline groups them by cycle.

Anonymous mode retains its top → top → next discovery page rotation. Servers outside the fetched pages can still go stale, and population sorting can move servers between pages. A three-second target is not a guarantee that every server is observed every three seconds.

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

Grab the [v0.2.0 Windows x64 ZIP](https://github.com/SamSKNg/SolSeer/releases/download/v0.2.0/solseer-v0.2.0-windows-x64.zip). See the [release notes](docs/releases/v0.2.0.md) for what changed. When updating, stop the old copy and extract the new ZIP into a fresh folder; your saved cookie and notification preferences stay in their separate local settings folder.

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
