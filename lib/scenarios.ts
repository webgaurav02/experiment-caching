import type { Config } from "./simulation";

/**
 * Guided scenarios — one-click states that narrate the central thesis:
 * a correctly-configured cache layer lets you clear a 19,000-ticket on-sale
 * without saturating the database; remove or misconfigure it and the DB melts.
 */
export interface Scenario {
  id: string;
  label: string;
  tag: string;
  blurb: string;
  config: Partial<Config>;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "baseline",
    label: "BASELINE",
    tag: "01",
    blurb:
      "Calm pre-sale traffic. Modest arrival rate, write-through, warm cache. The DB sits far below the queueing knee — everything is fast and boring, exactly as it should be.",
    config: {
      arrivalRate: 400,
      writeFraction: 0.2,
      writePolicy: "write-through",
      cacheEnabled: true,
      cacheCapacity: 5_000,
      workingSet: 6_000,
      eviction: "LFU",
      stampedeProtection: true,
      ttlJitter: true,
      concurrency: "atomic",
    },
  },
  {
    id: "surge-protected",
    label: "ON-SALE SURGE // PROTECTED",
    tag: "02",
    blurb:
      "Doors open: 19,000 buyers arrive at once. Write-back absorbs the purchase storm into coalesced batches, single-flight tames hot-key misses, atomic DECR guarantees no oversell. The DB barely notices the surge.",
    config: {
      arrivalRate: 19_000,
      writeFraction: 0.3,
      writePolicy: "write-back",
      cacheEnabled: true,
      cacheCapacity: 6_000,
      workingSet: 6_000,
      eviction: "LFU",
      stampedeProtection: true,
      ttlJitter: true,
      concurrency: "atomic",
    },
  },
  {
    id: "cache-failure",
    label: "CACHE FAILURE",
    tag: "03",
    blurb:
      "Same 19,000-buyer surge, but the cache tier drops offline mid-sale. Every request now penetrates to the database. Utilisation crosses ρ=1, the connection pool exhausts, latency diverges, requests time out. This is the meltdown the cache was preventing.",
    config: {
      arrivalRate: 19_000,
      writeFraction: 0.3,
      writePolicy: "write-through",
      cacheEnabled: false,
      cacheCapacity: 6_000,
      workingSet: 6_000,
      eviction: "LFU",
      stampedeProtection: false,
      ttlJitter: false,
      concurrency: "atomic",
    },
  },
  {
    id: "naive",
    label: "NAIVE STACK",
    tag: "04",
    blurb:
      "The textbook anti-pattern under load: under-provisioned cache, FIFO eviction evicting hot keys, no single-flight (thundering herd), and naive read-modify-write on inventory. Watch the oversell counter climb as concurrent writers race on the last units.",
    config: {
      arrivalRate: 12_000,
      writeFraction: 0.35,
      writePolicy: "write-around",
      cacheEnabled: true,
      cacheCapacity: 800,
      workingSet: 6_000,
      eviction: "FIFO",
      stampedeProtection: false,
      ttlJitter: false,
      concurrency: "naive",
    },
  },
  {
    id: "resilient",
    label: "RESILIENT STACK",
    tag: "05",
    blurb:
      "The same brutal 19,000-buyer load as the meltdown — but engineered correctly: write-back coalescing, generous LFU cache covering the hot tier, single-flight, TTL jitter, atomic decrements. The DB stays under its knee and the on-sale clears cleanly.",
    config: {
      arrivalRate: 19_000,
      writeFraction: 0.35,
      writePolicy: "write-back",
      cacheEnabled: true,
      cacheCapacity: 6_000,
      workingSet: 6_000,
      eviction: "LFU",
      stampedeProtection: true,
      ttlJitter: true,
      concurrency: "atomic",
    },
  },
];
