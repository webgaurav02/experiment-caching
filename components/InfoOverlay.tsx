"use client";

import { SIM } from "@/lib/constants";
import { fmtCompact } from "@/lib/format";

/** Methodology overlay — makes the research backing explicit, which is the point:
 *  every number on the dashboard derives from a stated model, not decoration. */
export function InfoOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/85 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="methodology-title"
        className="ticked relative max-h-full w-full max-w-3xl overflow-y-auto border border-line-2 bg-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 flex items-center justify-between border-b border-line-2 bg-panel px-4 py-3">
          <div className="flex flex-col">
            <span className="eyebrow">METHODOLOGY // THE MODEL BEHIND THE TELEMETRY</span>
            <span id="methodology-title" className="text-sm font-medium tracking-wide text-ink">
              CACHE//STRATA — SIMULATION SPECIFICATION
            </span>
          </div>
          <button onClick={onClose} className="border border-line-2 px-3 py-1 text-[11px] text-ink-dim transition-colors hover:bg-ink hover:text-black">
            CLOSE [ESC]
          </button>
        </header>

        <div className="grid grid-cols-1 gap-px bg-line text-[11px] leading-relaxed md:grid-cols-2">
          <Section title="THE PREMISE">
            A 19,000-ticket on-sale produces a near-instant arrival spike. Naively, every availability check and every
            purchase hits the database — tens of thousands of operations in seconds, all contending on the same few
            inventory rows. A single primary saturates and latency diverges. An in-memory cache tier in front converts
            that storm into a trickle the database can absorb. This dashboard models that interaction, live.
          </Section>

          <Section title="DB QUEUEING — M/M/1">
            The database is modelled as an M/M/1 queue. Response time follows{" "}
            <Code>R = S / (1 − ρ)</Code> where <Code>S = {SIM.DB_SERVICE_MS}ms</Code> is service time and{" "}
            <Code>ρ = λ/μ</Code> is utilisation against a ceiling of <Code>μ = {fmtCompact(SIM.DB_MAX_QPS)} QPS</Code>.
            Latency is flat below the <b>~0.70 knee</b> and diverges toward infinity as ρ→1. This non-linearity is the
            single most important behaviour on screen.
          </Section>

          <Section title="HIT RATE IS A LOAD MULTIPLIER">
            DB read load = <Code>arrival × (1 − hit_rate)</Code>. A drop from 99% → 90% hit rate <i>doubles</i> the
            traffic reaching the database. Hit rate itself emerges from cache capacity vs working set over a Zipf
            popularity curve, scaled by eviction quality (LFU &gt; LRU &gt; FIFO on skewed workloads).
          </Section>

          <Section title="WRITE POLICIES">
            <b>Write-through</b>: synchronous to cache + DB — strong consistency, 1:1 DB writes, no surge protection.{" "}
            <b>Write-back</b>: cache-only, marked dirty, flushed async in coalesced batches ({SIM.FLUSH_BATCH_ROWS}/cycle) —
            fastest writes and the hero of surge absorption, at the cost of a crash-loss window equal to the dirty count.{" "}
            <b>Write-around</b>: straight to DB, bypassing cache — no relief, plus cold-read penalties.
          </Section>

          <Section title="CONNECTION POOL — LITTLE'S LAW">
            In-flight DB requests = <Code>QPS × latency</Code> (L = λW). Once that exceeds the{" "}
            <Code>{SIM.DB_POOL_SIZE}</Code>-connection pool, requests queue, wait, and time out — the classic
            surge-death mechanism, visible as the pool ticks saturating and the wait-queue stacking at the DB inlet.
          </Section>

          <Section title="STAMPEDE & OVERSELL">
            When a hot key expires, concurrent misses can <b>stampede</b> the DB. <b>Single-flight</b> coalesces them to
            one recompute; <b>TTL jitter</b> desynchronises expiries. For inventory, <b>atomic DECR</b> makes the
            decrement race-free (reject &lt; 0); <b>naive read-modify-write</b> oversells the last units under
            concurrency. The DB&apos;s <Code>stock ≥ 0</Code> invariant is the final safety net.
          </Section>
        </div>

        <footer className="border-t border-line-2 px-4 py-3 text-[10px] leading-relaxed text-ink-faint">
          Constants are realistic single-node ballparks: Redis ~sub-ms at ~{fmtCompact(SIM.CACHE_MAX_QPS)} ops/s;
          Postgres point queries ~1–6ms idle, saturating near {fmtCompact(SIM.DB_MAX_QPS)} QPS; pool sized by
          (cores×2)+spindles. Packets on the map are a sampled, capped visualisation of the flow — the metrics are
          computed analytically from aggregate rates, not counted from packets.
        </footer>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-panel p-4">
      <h3 className="eyebrow mb-2 text-ink-dim">{title}</h3>
      <p className="text-ink-dim">{children}</p>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <span className="bg-panel-2 px-1 text-ink">{children}</span>;
}
