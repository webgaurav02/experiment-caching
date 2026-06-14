# CACHE//STRATA

**An interactive, real-time telemetry console that visualises how an in-memory cache tier shields a persistent database during a high-traffic on-sale — modelling the architecture required to clear a 19,000-ticket surge without saturating the database.**

It is not a toy animation: every number on screen is derived from a stated model of distributed-systems physics (M/M/1 queueing, Little's law, hit-rate load multiplication, write-coalescing, atomic inventory). The packets you see flowing across the architecture map are a *sampled* visualisation of that model — the metrics are computed analytically from aggregate rates, never counted from the dots.

Built with **Next.js 16 · React 19 · Tailwind v4 · HTML Canvas**, in a strict **minimalist-noir / brutalist** design language: pitch-black, monospace, sharp-edged, high-contrast — a classified telemetry dashboard.

---

## The thesis

A 19,000-ticket on-sale produces a near-instant arrival spike. Naively, every availability check and every purchase hits the database — tens of thousands of operations in seconds, all contending on the same few inventory rows. A single primary saturates and latency diverges. Put an in-memory cache tier in front and that storm becomes a trickle the database can absorb. CACHE//STRATA lets you *feel* that interaction — and watch it break when the cache is removed or misconfigured.

## What it demonstrates

- **Three network tiers** — Client → Cache → Database — wired by request/response rails, with geometric data packets whose **routing changes with the caching policy**.
- **Cache hit vs miss** — a hit bounces straight back at the cache tier; a miss penetrates to the database, visibly *stalls* as utilisation climbs, and crawls back.
- **Write lifecycles** — write-through double-routes to cache *and* DB; write-back writes to cache, accrues a **dirty** count, and drains to the DB in coalesced background flushes; write-around bypasses the cache entirely.
- **The database heating up** — the DB tier fills toward red as utilisation ρ crosses the queueing **knee (0.70)**, the connection pool exhausts, and a wait-queue stacks at its inlet.
- **Live telemetry** — hit rate, ρ, p50/p95/p99 latency, DB QPS, error rate, dirty entries, pool usage, replication lag, evictions, and the headline *"requests/s the cache absorbed."*
- **Guided scenarios** — one click each: a calm baseline, a protected surge, a mid-sale **cache failure** (watch it melt down), a naive anti-pattern stack that **oversells**, and a resilient stack that clears the sale cleanly.

## The model (the part that makes it credible)

| Behaviour | Model |
|---|---|
| Database latency under load | **M/M/1**: `R = S / (1 − ρ)`, `S = 5 ms`, `ρ = QPS / 8,000`. Flat below the ~0.70 knee, diverges as ρ→1. |
| Cache as a load multiplier | `DB_read_QPS = arrival × (1 − hit_rate)`. A 99%→90% hit-rate drop *doubles* DB load. |
| Hit rate | Emerges from cache capacity vs working set over a **Zipf** popularity curve, scaled by eviction quality (LFU > LRU > FIFO on skewed workloads), with a cold-start warm-up. |
| Write-back coalescing | Dirty entries flushed in batches (`500 / 200 ms`); the DB sees ≪ the app's write rate. Cost: a crash-loss window equal to the dirty count. |
| Connection pool | **Little's law**: in-flight = `QPS × latency`. Past the 30-connection pool, requests queue → wait → time out. |
| Cache stampede | A hot key expiring triggers a thundering herd; **single-flight** coalesces the misses to one recompute, **TTL jitter** desynchronises expiries. |
| Inventory consistency | **Atomic DECR** is race-free (reject < 0 ⇒ no oversell); **naive read-modify-write** oversells the last units under concurrency. The DB's `stock ≥ 0` invariant is the final safety net. |

Open the **`[ METHODOLOGY ]`** panel in the app for the full derivation. Constants are realistic single-node ballparks (Redis ~sub-ms at ~100k ops/s; Postgres point queries ~1–6 ms idle, saturating near 8k QPS; pool sized by `(cores×2)+spindles`).

The engine is verified by a 26-assertion test that checks the physics exactly — e.g. latency `= 2×S` at ρ=0.5, write-back DB load ≈ 1/25th of write-through, the cache-failure meltdown (ρ=238%, 83% timeouts), and atomic=0 vs naive>0 oversell.

## Architecture

```
lib/
  constants.ts     realistic simulation constants + the brutalist palette
  simulation.ts    the framework-agnostic engine — all the physics, no React/DOM
  scenarios.ts     one-click guided states that narrate the thesis
  format.ts        monospace-friendly number formatters
components/
  Dashboard.tsx        owns the sim + the single rAF loop; brutalist grid layout
  ArchitectureMap.tsx  HTML-canvas renderer for the 3 tiers + packets (owns geometry)
  ControlPanel.tsx     real-time system mutation + scenario presets
  TelemetryPanel.tsx   dense readouts, sparklines, the live queueing curve
  charts.tsx           SVG sparkline + the M/M/1 queueing curve with a live marker
  EventLog.tsx         scrolling system event feed
  InfoOverlay.tsx      the methodology / model specification
  primitives.tsx       brutalist UI atoms (Panel, Readout, Toggle, Segmented, Slider…)
app/                page.tsx · layout.tsx (metadata, fonts) · globals.css (design system)
```

**Separation of concerns:** the engine is the single source of truth, advanced by one `requestAnimationFrame` loop in `Dashboard`. The canvas reads the engine's packet list each frame (it owns all geometry); React telemetry is updated from a throttled (~12 Hz) snapshot so the 60 fps animation never stalls on re-renders.

## Run locally

```bash
npm install
npm run dev      # http://localhost:3000
```

Build / preview the production bundle:

```bash
npm run build
npm run start    # honours $PORT
```

> Designed for a wide viewport (≥ 1024px) — it's a telemetry console, not a phone widget.

## Deploy for free

**Render (Node web service)** — push to GitHub and point Render at this repo; `render.yaml` is a ready blueprint (free plan, `npm run build` → `npm run start`).

**Any static host** — because the page is 100% client-rendered, set `output: "export"` in `next.config.ts`, run `npm run build`, and serve the generated `./out` folder on a Render Static Site, GitHub Pages, Netlify, Cloudflare Pages, or Vercel — no server, no cold starts.

## Notes on accuracy

This is a *simulation for intuition*, not a packet-level emulator. It deliberately abstracts a database to an M/M/1 queue and a cache to a flat-latency store with an emergent hit rate — the level of abstraction an SRE reasons at when capacity-planning an on-sale. The numbers are realistic order-of-magnitude ballparks chosen so the emergent behaviour (the knee, the meltdown, the coalescing) matches what you'd actually observe.
