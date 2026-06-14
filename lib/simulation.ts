/**
 * The simulation engine — the "physics" of a cache-protected database under a
 * ticketing surge. Framework-agnostic: no React, no DOM. A host drives it by
 * calling `tick(dtSeconds)` on a clock (typically requestAnimationFrame) and
 * reads `metrics`, `packets`, and `events` to render.
 *
 * Design contract: METRICS ARE THE TRUTH. They are computed analytically from
 * aggregate rates (arrival rate, hit rate, the M/M/1 queueing law, Little's
 * law). The rendered PACKETS are a *sampled, capped* visualisation of that same
 * flow — never the source of the numbers. So the dashboard stays honest even
 * though only ~150 packets are ever drawn while 19,000 buyers are modelled.
 */
import { SIM, STATUS } from "./constants";

export type WritePolicy = "write-through" | "write-back" | "write-around";
export type Eviction = "LFU" | "LRU" | "FIFO";
export type Concurrency = "atomic" | "naive";
export type Status = "NOMINAL" | "DEGRADED" | "CRITICAL";

export interface Config {
  arrivalRate: number; // target requests / second
  writeFraction: number; // 0..1 — share of requests that are purchases (writes)
  writePolicy: WritePolicy;
  cacheEnabled: boolean;
  cacheCapacity: number; // resident entries
  workingSet: number; // distinct keys touched
  eviction: Eviction;
  stampedeProtection: boolean; // single-flight / request coalescing on misses
  ttlJitter: boolean; // spread TTL expiries to avoid synchronized cliffs
  concurrency: Concurrency; // atomic DECR vs naive read-modify-write
}

export type PacketKind = "hit" | "miss" | "write-db" | "write-cache" | "flush";

export interface Packet {
  id: number;
  kind: PacketKind;
  hot: boolean; // belongs to the hot (popular) key
  errored: boolean; // dropped at the DB (timeout / pool exhaustion)
  t: number; // 0..1 progress along its route
  speed: number; // progress per second (legs may re-scale this live)
  leg: number; // index into the route's leg list (canvas owns geometry)
}

export interface Metrics {
  status: Status;
  // throughput
  arrivalRate: number;
  acceptedRate: number;
  // cache
  hitRate: number;
  cacheQPS: number;
  memUtil: number; // 0..1
  evictionRate: number; // evictions / s
  dirtyCount: number; // un-flushed write-back entries (== crash data-loss window)
  flushRate: number; // rows / s drained from the dirty buffer to the DB
  // database
  dbQPS: number;
  dbUtil: number; // ρ = λ/μ (may exceed 1 ⇒ overload)
  dbLatencyMs: number; // R = S/(1−ρ)
  dbIOPS: number; // physical writes incl. amplification
  poolInUse: number; // active connections (Little's law)
  poolUtil: number; // 0..1+
  poolQueue: number; // requests waiting for a connection
  replLagMs: number;
  // end-to-end latency percentiles
  p50: number;
  p95: number;
  p99: number;
  errorRate: number; // 0..1
  // derived headline
  dbRequestsPrevented: number; // req/s the cache absorbed (hits)
  // ticketing
  sold: number;
  remaining: number;
  oversold: number;
}

export interface LogEvent {
  id: number;
  t: number; // simulated seconds
  level: "info" | "warn" | "crit" | "ok";
  msg: string;
}

export interface HistoryFrame {
  dbUtil: number;
  hitRate: number;
  dbLatency: number;
  cacheLatency: number;
  p99: number;
  arrivalRate: number;
  errorRate: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
// exponential smoothing toward target with time-constant τ (seconds)
const approach = (cur: number, target: number, dt: number, tau: number) =>
  cur + (target - cur) * (1 - Math.exp(-dt / Math.max(tau, 1e-3)));

/** Eviction quality on a skewed (Zipf) workload — how well the resident set
 *  covers the hot keys. LFU keeps the genuinely popular keys; FIFO is blind. */
const EVICTION_EFFICIENCY: Record<Eviction, number> = {
  LFU: 1.0,
  LRU: 0.96,
  FIFO: 0.86,
};

/**
 * Fraction of a Zipf(s≈1) request stream served by the top-`k` keys when the
 * cache holds `capacity` of `workingSet` distinct keys. Because popularity is
 * heavily skewed, even a small resident set covers most traffic — which is
 * exactly why caching an inventory counter is so effective. Modelled with the
 * harmonic-number ratio H(capacity)/H(workingSet) for s=1.
 */
function zipfCoverage(capacity: number, workingSet: number): number {
  const k = clamp(Math.floor(capacity), 0, workingSet);
  if (k <= 0) return 0;
  if (k >= workingSet) return 1;
  // H(n) ≈ ln(n) + γ ; use exact-ish approximation, fine for the visual range.
  const H = (n: number) => Math.log(n) + 0.5772156649 + 1 / (2 * n);
  return clamp(H(k) / H(workingSet), 0, 1);
}

let _pid = 0;
let _eid = 0;

export class Simulation {
  config: Config;
  metrics: Metrics;
  packets: Packet[] = [];
  events: LogEvent[] = [];
  history: HistoryFrame[] = [];

  time = 0; // simulated seconds elapsed
  private hitRate = 0; // smoothed, with warm-up
  private dirty = 0;
  private flushAccumulator = 0;
  private lastFlushRate = 0;
  private spawnAccumulator = 0;
  private stampedeTimer: number = SIM.STAMPEDE_PERIOD_S;
  private stampedeBoost = 0; // transient DB-load spike from a cold hot key
  private latencySamples: number[] = [];
  private lastStatus: Status = "NOMINAL";
  private lastPoolSaturated = false;
  private soldOutAnnounced = false;
  private sold = 0;
  private oversold = 0;

  constructor(config?: Partial<Config>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.metrics = blankMetrics();
    this.log("ok", "TELEMETRY LINK ESTABLISHED // 3-TIER TOPOLOGY ONLINE");
  }

  reset(config?: Partial<Config>) {
    this.config = { ...this.config, ...config };
    this.metrics = blankMetrics();
    this.packets = [];
    this.history = [];
    this.time = 0;
    this.hitRate = 0;
    this.dirty = 0;
    this.flushAccumulator = 0;
    this.lastFlushRate = 0;
    this.stampedeTimer = SIM.STAMPEDE_PERIOD_S;
    this.stampedeBoost = 0;
    this.latencySamples = [];
    this.sold = 0;
    this.oversold = 0;
    this.soldOutAnnounced = false;
    this.lastStatus = "NOMINAL";
    this.lastPoolSaturated = false;
  }

  set<K extends keyof Config>(key: K, value: Config[K]) {
    if (this.config[key] === value) return;
    const prev = this.config[key];
    this.config[key] = value;
    this.announceConfigChange(key, prev, value);
  }

  // ── main step ──────────────────────────────────────────────────────────────
  tick(dt: number) {
    dt = clamp(dt, 0, 0.05); // guard against tab-switch jumps
    if (dt <= 0) return;
    this.time += dt;
    const c = this.config;

    // 1) Arrival split into reads (availability checks) and writes (purchases).
    const arrival = c.arrivalRate;
    const writes = arrival * c.writeFraction;
    const reads = arrival - writes;

    // 2) Hit rate — emergent from sizing × eviction quality, with cold warm-up.
    this.updateStampede(dt);
    const coverage = zipfCoverage(c.cacheCapacity, c.workingSet);
    const targetHit = c.cacheEnabled
      ? clamp(coverage * EVICTION_EFFICIENCY[c.eviction], 0, 1) * SIM.HIT_RATE_CEILING
      : 0;
    // warm-up: a cold cache fills over a few seconds; cache-off collapses instantly.
    const tau = c.cacheEnabled ? 1.6 : 0.25;
    this.hitRate = approach(this.hitRate, targetHit, dt, tau);
    // a stampede momentarily depresses the *effective* hit rate (hot key cold).
    const effHit = clamp(this.hitRate - this.stampedeBoost, 0, 1);

    // 3) Database read load = misses (the hit-rate load multiplier).
    let dbReadQPS = reads * (1 - effHit);
    // stampede: a synchronized cold-key event slams the DB unless single-flight
    // coalesces the concurrent misses down to ~one recompute.
    if (this.stampedeBoost > 0 && !c.stampedeProtection) {
      dbReadQPS += reads * this.stampedeBoost * 1.5;
    }

    // 4) Database write load — depends entirely on the write policy.
    let dbWriteQPS = 0;
    let cacheWriteQPS = 0;
    switch (c.writePolicy) {
      case "write-through": // synchronous to BOTH — zero write-path protection
        dbWriteQPS = writes;
        cacheWriteQPS = c.cacheEnabled ? writes : 0;
        break;
      case "write-around": // straight to DB, bypass cache (+ later cold reads)
        dbWriteQPS = writes;
        cacheWriteQPS = 0;
        break;
      case "write-back": // to cache only; mark dirty; async coalesced flush
        cacheWriteQPS = c.cacheEnabled ? writes : 0;
        if (c.cacheEnabled) {
          this.dirty += writes * dt; // accrue un-flushed entries
        } else {
          dbWriteQPS = writes; // no cache ⇒ write-back degenerates to direct DB
        }
        break;
    }

    // Background flusher. A healthy write-back flusher keeps the dirty buffer
    // BOUNDED: each cycle it persists the writes that arrived that interval, plus
    // a slice of any backlog, so the un-flushed "crash-loss window" settles at
    // roughly one flush interval of writes (its irreducible exposure) instead of
    // growing without bound. dbWriteQPS stays the *coalesced* unique-key rate —
    // far below the raw write rate — which is the whole point of write-back.
    let flushRate = 0;
    if (c.writePolicy === "write-back" && c.cacheEnabled) {
      this.flushAccumulator += dt * 1000;
      if (this.flushAccumulator >= SIM.FLUSH_INTERVAL_MS) {
        const intervalS = this.flushAccumulator / 1000;
        this.flushAccumulator = 0;
        const accrued = writes * intervalS; // writes that arrived this cycle
        const target = writes * (SIM.FLUSH_INTERVAL_MS / 1000); // in-flight window
        // drain at least the accrual (keep pace), up to clearing backlog to the
        // target, but never more than the flusher's batch capacity per cycle.
        const batch = Math.min(
          this.dirty,
          Math.min(Math.max(accrued, this.dirty - target), accrued + SIM.FLUSH_BATCH_ROWS),
        );
        this.dirty -= batch;
        this.lastFlushRate = batch / Math.max(intervalS, 1e-3);
        if (batch > 5) this.maybeFlushEvent(batch);
      }
      dbWriteQPS = writes * SIM.COALESCE_FLOOR;
      flushRate = this.lastFlushRate; // actual rows/s drained from the dirty buffer
    }
    if (!c.cacheEnabled) this.dirty = 0;

    // 5) Database queueing — the M/M/1 response-time law, the credibility core.
    const dbQPS = dbReadQPS + dbWriteQPS;
    const rhoRaw = dbQPS / SIM.DB_MAX_QPS;
    const rho = clamp(rhoRaw, 0, 0.995);
    const dbLatency = SIM.DB_SERVICE_MS / (1 - rho);

    // 6) Connection pool via Little's law: L = λ · W (in-flight = qps · seconds).
    const acceptedDbQPS = Math.min(dbQPS, SIM.DB_MAX_QPS);
    const inFlight = acceptedDbQPS * (dbLatency / 1000);
    const poolUtil = inFlight / SIM.DB_POOL_SIZE;
    const poolInUse = Math.min(inFlight, SIM.DB_POOL_SIZE);
    const poolQueue = Math.max(0, inFlight - SIM.DB_POOL_SIZE);

    // 7) Errors: overload (ρ→1) drops the overflow; pool exhaustion times out.
    const overloadErr = rhoRaw > 1 ? clamp((rhoRaw - 1) / rhoRaw, 0, 0.9) : 0;
    const poolErr = poolUtil > 1 ? clamp((poolUtil - 1) / (poolUtil + 1), 0, 0.6) : 0;
    const errorRate = clamp(1 - (1 - overloadErr) * (1 - poolErr), 0, 0.97);

    // 8) Replication lag rises as the write path loads up.
    const writeLoad = clamp(acceptedDbQPS / SIM.DB_MAX_QPS, 0, 1);
    const replLag = lerp(SIM.REPL_LAG_MS_OK, SIM.REPL_LAG_MS_SURGE, writeLoad ** 2);

    // 9) End-to-end latency distribution → p50/p95/p99 via a rolling reservoir.
    this.sampleLatencies(reads, writes, effHit, dbLatency, c);
    const { p50, p95, p99 } = this.percentiles();

    // 10) Ticketing — atomic DECR is race-free; naive RMW oversells under load.
    this.updateTickets(writes, errorRate, dt, c);

    // 11) Memory / eviction telemetry.
    const memUtil = c.cacheEnabled && c.cacheCapacity > 0 ? clamp(c.workingSet / c.cacheCapacity, 0, 1) : 0;
    const evictionRate =
      c.cacheEnabled && c.cacheCapacity < c.workingSet
        ? reads * (1 - coverage) * 0.5
        : 0;

    // 12) Commit metrics.
    const acceptedRate = arrival * (1 - errorRate);
    const status = this.deriveStatus(rhoRaw, errorRate);
    this.metrics = {
      status,
      arrivalRate: arrival,
      acceptedRate,
      hitRate: effHit,
      cacheQPS: reads * effHit + cacheWriteQPS,
      memUtil,
      evictionRate,
      dirtyCount: Math.round(this.dirty),
      flushRate,
      dbQPS,
      dbUtil: rhoRaw,
      dbLatencyMs: dbLatency,
      dbIOPS: dbWriteQPS * SIM.WRITE_AMP + dbReadQPS,
      poolInUse,
      poolUtil,
      poolQueue,
      replLagMs: replLag,
      p50,
      p95,
      p99,
      errorRate,
      dbRequestsPrevented: reads * effHit,
      sold: Math.round(this.sold),
      remaining: Math.max(0, SIM.TICKET_SUPPLY - Math.round(this.sold)),
      oversold: Math.round(this.oversold),
    };

    this.pushHistory(rho, effHit, dbLatency, p99, arrival, errorRate);
    this.emitTransitionEvents(status, poolQueue);
    this.updatePackets(dt, reads, writes, effHit, dbLatency, errorRate, c);
  }

  // ── ticketing / oversell ────────────────────────────────────────────────────
  private updateTickets(writes: number, errorRate: number, dt: number, c: Config) {
    const remaining = SIM.TICKET_SUPPLY - this.sold;
    if (remaining <= 0) {
      if (!this.soldOutAnnounced) {
        this.soldOutAnnounced = true;
        this.log("ok", `SOLD OUT // ${SIM.TICKET_SUPPLY.toLocaleString()} TICKETS CLEARED`);
      }
      return;
    }
    // committed purchases this tick (writes that did not error out).
    const attempted = writes * (1 - errorRate) * dt;
    const committed = Math.min(attempted, remaining);
    this.sold += committed;

    // Naive read-modify-write: when many buyers race on the last few units, the
    // check-then-write window lets concurrent writers all read the same stock
    // and oversell. Atomic DECR returns the post-decrement value atomically and
    // simply rejects anything < 0 — no oversell, ever.
    if (c.concurrency === "naive") {
      const concurrentWriters = writes * dt; // contenders this tick
      if (remaining < concurrentWriters && remaining > 0) {
        const over = (concurrentWriters - remaining) * 0.18;
        if (over > 0.5) {
          this.oversold += over;
          this.maybeOversellEvent();
        }
      }
    }
  }

  // ── stampede dynamics ────────────────────────────────────────────────────────
  private updateStampede(dt: number) {
    this.stampedeBoost = Math.max(0, this.stampedeBoost - dt * 0.6); // decay
    if (!this.config.cacheEnabled) return;
    this.stampedeTimer -= dt;
    if (this.stampedeTimer <= 0) {
      // jitter spreads the next expiry; protection coalesces the miss burst.
      const period =
        SIM.STAMPEDE_PERIOD_S *
        (this.config.ttlJitter ? 1 + (Math.random() - 0.5) * 0.6 : 1);
      this.stampedeTimer = period;
      const magnitude = this.config.ttlJitter ? 0.06 : 0.22;
      const coalesced = this.config.stampedeProtection ? 0.08 : 1;
      this.stampedeBoost = Math.min(0.5, magnitude * coalesced * (1 - this.hitRate + 0.3));
      if (this.stampedeBoost > 0.12) {
        this.log(
          "warn",
          `HOT-KEY EXPIRY // ${this.config.stampedeProtection ? "COALESCED (single-flight)" : "THUNDERING HERD → DB"}`,
        );
      }
    }
  }

  // ── latency reservoir ────────────────────────────────────────────────────────
  private sampleLatencies(
    reads: number,
    writes: number,
    hit: number,
    dbLatency: number,
    c: Config,
  ) {
    const total = reads + writes || 1;
    const N = 40; // samples per tick → smooth percentiles
    for (let i = 0; i < N; i++) {
      const r = Math.random();
      const isWrite = r < writes / total;
      let lat: number;
      if (isWrite) {
        switch (c.writePolicy) {
          case "write-back":
            lat = c.cacheEnabled ? SIM.CACHE_WRITE_MS : dbLatency; // cache-fast
            break;
          default: // write-through / write-around are DB-bound
            lat = Math.max(SIM.CACHE_WRITE_MS, dbLatency);
        }
      } else {
        const isHit = Math.random() < hit;
        lat = isHit
          ? jitter(SIM.CACHE_READ_MS, SIM.CACHE_READ_MS_P99)
          : SIM.CACHE_READ_MS + dbLatency + SIM.CACHE_WRITE_MS; // lookup+DB+populate
      }
      this.latencySamples.push(lat);
    }
    const cap = 600;
    if (this.latencySamples.length > cap) {
      this.latencySamples.splice(0, this.latencySamples.length - cap);
    }
  }

  private percentiles() {
    if (this.latencySamples.length === 0) return { p50: 0, p95: 0, p99: 0 };
    const s = [...this.latencySamples].sort((a, b) => a - b);
    const at = (p: number) => s[clamp(Math.floor(p * (s.length - 1)), 0, s.length - 1)];
    return { p50: at(0.5), p95: at(0.95), p99: at(0.99) };
  }

  // ── status + event log ───────────────────────────────────────────────────────
  private deriveStatus(rho: number, err: number): Status {
    if (rho >= STATUS.CRITICAL_UTIL || err >= STATUS.CRITICAL_ERR) return "CRITICAL";
    if (rho >= STATUS.DEGRADED_UTIL || err >= STATUS.DEGRADED_ERR) return "DEGRADED";
    return "NOMINAL";
  }

  private emitTransitionEvents(status: Status, poolQueue: number) {
    if (status !== this.lastStatus) {
      const level = status === "CRITICAL" ? "crit" : status === "DEGRADED" ? "warn" : "ok";
      const msg =
        status === "CRITICAL"
          ? "DB SATURATION // ρ→1, REQUESTS QUEUEING UNBOUNDED"
          : status === "DEGRADED"
            ? "OPERATING ABOVE KNEE // ρ>0.70, LATENCY CLIMBING"
            : "SYSTEM NOMINAL // DB BELOW KNEE";
      this.log(level, msg);
      this.lastStatus = status;
    }
    const saturated = poolQueue > 5;
    if (saturated && !this.lastPoolSaturated) {
      this.log("crit", `POOL EXHAUSTED // ${SIM.DB_POOL_SIZE}/${SIM.DB_POOL_SIZE} CONN, WAIT-Q=${Math.round(poolQueue)}`);
    }
    this.lastPoolSaturated = saturated;
  }

  private _flushCooldown = 0;
  private maybeFlushEvent(batch: number) {
    if (this.time - this._flushCooldown < 1.4) return;
    this._flushCooldown = this.time;
    this.log("info", `WRITE-BACK FLUSH // ${Math.round(batch)} DIRTY ENTRIES → DB (coalesced)`);
  }

  private _oversellCooldown = 0;
  private maybeOversellEvent() {
    if (this.time - this._oversellCooldown < 1.2) return;
    this._oversellCooldown = this.time;
    this.log("crit", "OVERSELL // NAIVE READ-MODIFY-WRITE RACE ON LAST UNITS");
  }

  private announceConfigChange<K extends keyof Config>(key: K, prev: Config[K], next: Config[K]) {
    const map: Partial<Record<keyof Config, string>> = {
      writePolicy: `WRITE POLICY → ${String(next).toUpperCase()}`,
      cacheEnabled: next ? "CACHE TIER ONLINE" : "CACHE TIER OFFLINE // ALL TRAFFIC → DB",
      stampedeProtection: next ? "SINGLE-FLIGHT ENABLED // MISS COALESCING ON" : "SINGLE-FLIGHT DISABLED",
      ttlJitter: next ? "TTL JITTER ON // EXPIRIES DESYNCHRONISED" : "TTL JITTER OFF",
      concurrency: next === "atomic" ? "ATOMIC DECR // OVERSELL-SAFE" : "NAIVE RMW // OVERSELL-PRONE",
      eviction: `EVICTION POLICY → ${String(next)}`,
    };
    const msg = map[key];
    if (msg) {
      const level =
        key === "cacheEnabled" && !next ? "crit" : key === "concurrency" && next === "naive" ? "warn" : "info";
      this.log(level, msg);
    }
    void prev;
  }

  private log(level: LogEvent["level"], msg: string) {
    this.events.push({ id: _eid++, t: this.time, level, msg });
    if (this.events.length > 80) this.events.splice(0, this.events.length - 80);
  }

  private pushHistory(
    dbUtil: number,
    hitRate: number,
    dbLatency: number,
    p99: number,
    arrivalRate: number,
    errorRate: number,
  ) {
    this.history.push({
      dbUtil,
      hitRate,
      dbLatency,
      cacheLatency: SIM.CACHE_READ_MS,
      p99,
      arrivalRate,
      errorRate,
    });
    if (this.history.length > SIM.HISTORY) {
      this.history.splice(0, this.history.length - SIM.HISTORY);
    }
  }

  // ── visual packet sampling ───────────────────────────────────────────────────
  private updatePackets(
    dt: number,
    reads: number,
    writes: number,
    hit: number,
    dbLatency: number,
    errorRate: number,
    c: Config,
  ) {
    // advance existing packets; DB-bound legs slow down as latency climbs.
    const dbDrag = clamp(SIM.DB_SERVICE_MS / dbLatency, 0.08, 1); // ρ↑ ⇒ visible stall
    for (const p of this.packets) {
      // the DB "turn" sits around the middle of a miss/write route — stall there.
      const dbBound = p.kind === "miss" || p.kind === "write-db" || p.kind === "flush";
      const atDB = dbBound && p.t > 0.45 && p.t < 0.72;
      p.t += p.speed * (atDB ? dbDrag : 1) * dt;
    }
    this.packets = this.packets.filter((p) => p.t < 1);

    // spawn rate is a *sample* of true arrival, capped for the screen.
    const total = reads + writes || 1;
    const visualRate = clamp(Math.sqrt(c.arrivalRate) * 1.6, 6, 90); // packets/s on screen
    this.spawnAccumulator += visualRate * dt;
    let budget = Math.floor(this.spawnAccumulator);
    this.spawnAccumulator -= budget;

    while (budget-- > 0 && this.packets.length < SIM.MAX_PACKETS) {
      const isWrite = Math.random() < writes / total;
      const hot = Math.random() < 0.45; // hot ticket tier dominates
      if (isWrite) {
        this.spawnWritePacket(errorRate, hot, c);
      } else {
        const isHit = c.cacheEnabled && Math.random() < hit;
        this.packets.push({
          id: _pid++,
          kind: isHit ? "hit" : "miss",
          hot,
          errored: !isHit && Math.random() < errorRate,
          t: 0,
          speed: isHit ? 1.5 : 0.62,
          leg: 0,
        });
      }
    }

    // write-back flush packets: occasional batched cache→DB drains.
    if (c.writePolicy === "write-back" && c.cacheEnabled && this.dirty > SIM.FLUSH_BATCH_ROWS * 0.5) {
      if (Math.random() < dt * 3) {
        this.packets.push({ id: _pid++, kind: "flush", hot: false, errored: false, t: 0, speed: 0.7, leg: 0 });
      }
    }
  }

  private spawnWritePacket(errorRate: number, hot: boolean, c: Config) {
    const errored = Math.random() < errorRate;
    if (c.writePolicy === "write-back" && c.cacheEnabled) {
      this.packets.push({ id: _pid++, kind: "write-cache", hot, errored: false, t: 0, speed: 1.5, leg: 0 });
    } else {
      // write-through & write-around both land on the DB on the hot path.
      this.packets.push({ id: _pid++, kind: "write-db", hot, errored, t: 0, speed: 0.7, leg: 0 });
      if (c.writePolicy === "write-through" && c.cacheEnabled) {
        // the synchronised second leg to the cache.
        this.packets.push({ id: _pid++, kind: "write-cache", hot, errored: false, t: 0, speed: 1.4, leg: 0 });
      }
    }
  }
}

function jitter(p50: number, p99: number) {
  // lognormal-ish: mostly near p50, occasional reach toward p99
  return p50 + Math.random() ** 3 * (p99 - p50);
}

export const DEFAULT_CONFIG: Config = {
  arrivalRate: 400,
  writeFraction: 0.25,
  writePolicy: "write-through",
  cacheEnabled: true,
  cacheCapacity: 5_000,
  workingSet: 6_000,
  eviction: "LFU",
  stampedeProtection: true,
  ttlJitter: true,
  concurrency: "atomic",
};

function blankMetrics(): Metrics {
  return {
    status: "NOMINAL",
    arrivalRate: 0,
    acceptedRate: 0,
    hitRate: 0,
    cacheQPS: 0,
    memUtil: 0,
    evictionRate: 0,
    dirtyCount: 0,
    flushRate: 0,
    dbQPS: 0,
    dbUtil: 0,
    dbLatencyMs: SIM.DB_SERVICE_MS,
    dbIOPS: 0,
    poolInUse: 0,
    poolUtil: 0,
    poolQueue: 0,
    replLagMs: SIM.REPL_LAG_MS_OK,
    p50: 0,
    p95: 0,
    p99: 0,
    errorRate: 0,
    dbRequestsPrevented: 0,
    sold: 0,
    remaining: SIM.TICKET_SUPPLY,
    oversold: 0,
  };
}
