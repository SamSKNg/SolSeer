# Sol's RNG Cluster Indicator (archived Python version)

A lightweight detector for sudden player clustering in public Sol's RNG servers.
It surfaces behavioral leads that may correlate with rare biomes; it does not
observe or verify the biome itself.

## Start the live UI

```powershell
python -m streamlit run app.py
```

The root launcher automatically loads the package from `src/`; an editable
package install is not required.

The browser dashboard redraws once per second. Its background worker requests one
Roblox page about every 20.5 seconds and publishes each result immediately.

Only run one UI or console tracker at a time. Separate processes do not share a
request budget and can collectively trigger Roblox's rate limit.

## Polling strategy

The observed anonymous limit is three requests per rolling 60-second window. The
worker uses a `top → top → coverage` schedule:

- Top 100 high-population servers at approximately 0 seconds.
- Top 100 again at approximately 20.5 seconds.
- The next 100 servers at approximately 41 seconds.
- Repeat after approximately 61.5 seconds.

This makes high-population candidates update every 20–41 seconds while retaining
some deeper coverage. The dashboard's activity table receives a new row after
every request, so it does not wait for a full minute-long scan.

When a server first crosses into `POTENTIAL` or `CLUSTER`, the next request is
redirected to the same page and scheduled five seconds later. If all three
rolling-minute slots have already been consumed, it is queued for the earliest
legal time instead; the dashboard status and countdown make that delay explicit.

## Alert rules

- `POTENTIAL`: a server at 15+ players gains 2+ since its last observation, or
  gains 3+ across its last two observations.
- `CLUSTER`: any server gains 4+ since its last observation, or gains 7+ over
  three minutes with persistent growth.
- `WARMING UP`: the server has only one observation and cannot have a velocity yet.

Exact-server join actions are shown directly in the table.

Every Join click first passes through a local recorder and is then redirected to
Roblox. The live table shows whether and how often a Job ID was joined, while the
`Joined servers` tab keeps a timestamped history with rejoin links. History is
stored locally in `.data/join_history.sqlite3` and survives app restarts.

## Console mode

```powershell
python api.py
```

## Tests

```powershell
python -m unittest discover -s tests -v
```

## Structure

```text
.
├── app.py                         # Streamlit entry point
├── api.py                         # Console entry point
├── pyproject.toml
├── src/cluster_indicator/
│   ├── cli.py
│   ├── links.py
│   ├── poller.py
│   ├── scorer.py
│   ├── state.py
│   ├── tracker.py
│   └── ui.py
└── tests/
```
