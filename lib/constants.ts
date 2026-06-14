/**
 * Load-bearing simulation constants.
 *
 * These are realistic engineering ballparks — single-node Redis vs a single
 * Postgres primary, same-AZ — chosen so the emergent behaviour of the model
 * matches what an SRE would actually observe during a high-demand on-sale.
 * Sources informing these numbers: Redis benchmarks (~100k+ ops/s, sub-ms),
 * Postgres point-query ceilings (~5–10k QPS), HikariCP/EDB pool sizing
 * ((cores*2)+spindles ⇒ ~20–50), and the M/M/1 response-time law R = S/(1−ρ).
 */
export const SIM = {
  // ── Cache tier (in-memory store, e.g. Redis) ──────────────────────────────
  CACHE_READ_MS: 0.3, // GET p50, same-AZ
  CACHE_READ_MS_P99: 0.8, // tail under load
  CACHE_WRITE_MS: 0.3, // SET / DECR ≈ reads
  CACHE_MAX_QPS: 100_000, // conservative single-node ceiling

  // ── Database tier (persistent store, e.g. Postgres primary) ───────────────
  DB_SERVICE_MS: 5, // S — effective per-query service time
  DB_READ_MS_IDLE: 1, // warm buffer-cache point read
  DB_WRITE_MS_IDLE: 6, // single-row commit (WAL fsync dominates)
  DB_MAX_QPS: 8_000, // μ — point-query saturation ceiling
  DB_POOL_SIZE: 30, // active server-side connections ((cores*2)+spindles)
  DB_POOL_KNEE: 0.7, // recommended max operating utilisation
  WRITE_AMP: 6, // physical writes per logical write (WAL + heap + indexes)

  // ── Replication ───────────────────────────────────────────────────────────
  REPL_LAG_MS_OK: 20,
  REPL_LAG_MS_SURGE: 2_000, // async replica falls seconds behind under write storm

  // ── Workload ──────────────────────────────────────────────────────────────
  TICKET_SUPPLY: 19_000, // the headline figure: tickets to sell without DB saturation
  HIT_RATE_CEILING: 0.992, // a warm, well-sized cache never reaches a perfect 100%
  ZIPF_S: 1.0, // skew of the key-popularity distribution (hot ticket tier)

  // ── Write-back flusher ────────────────────────────────────────────────────
  FLUSH_INTERVAL_MS: 200, // background flush cadence
  FLUSH_BATCH_ROWS: 500, // dirty entries persisted per batched transaction
  COALESCE_FLOOR: 0.04, // writes to the same key collapse: DB sees ≪ the app's write rate

  // ── TTL / stampede ────────────────────────────────────────────────────────
  TTL_BASE_S: 60,
  TTL_JITTER_S: 10, // ± spread that turns a synchronized expiry cliff into a trickle
  STAMPEDE_PERIOD_S: 7, // how often a hot key would naturally expire / go cold

  // ── Visualisation ─────────────────────────────────────────────────────────
  MAX_PACKETS: 150, // on-screen packet cap; packets are a *sample* of true flow
  HISTORY: 180, // ring-buffer length for sparklines / charts (~ frames)
} as const;

/** Operating-point thresholds used to derive the system status banner. */
export const STATUS = {
  DEGRADED_UTIL: 0.7, // the M/M/1 knee
  CRITICAL_UTIL: 0.92,
  DEGRADED_ERR: 0.005,
  CRITICAL_ERR: 0.03,
} as const;

/** Brutalist / minimalist-noir palette. Kept in one place so canvas + DOM agree. */
export const COLOR = {
  bg: "#000000",
  panel: "#050505",
  ink: "#f2f2f2",
  inkDim: "#8a8a8a",
  inkFaint: "#4a4a4a",
  inkGhost: "#242424",
  line: "#1c1c1c",
  line2: "#2c2c2c",
  hit: "#e8e8e8", // a cache hit — stark white, "good"
  miss: "#c8962a", // a miss penetrating to the DB — amber, "warning"
  crit: "#d23b32", // saturation / errors / oversell — red, "critical"
  write: "#6f8a98", // write traffic — cold slate-cyan, distinct from reads
  flush: "#54707c", // background write-back flush — dimmer slate
} as const;
