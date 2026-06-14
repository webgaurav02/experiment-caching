"use client";

import { COLOR, SIM, STATUS } from "@/lib/constants";
import type { HistoryFrame, Metrics } from "@/lib/simulation";
import { fmtCompact, fmtInt, fmtLatency, fmtMs, fmtPct } from "@/lib/format";
import { Panel, Meter, Tone } from "./primitives";
import { QueueingCurve, Sparkline } from "./charts";

function Cell({
  label,
  value,
  unit,
  tone = "ink",
  spark,
  sparkColor,
  sparkMax,
  bar,
  knee,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: Tone;
  spark?: number[];
  sparkColor?: string;
  sparkMax?: number;
  bar?: number;
  knee?: number;
}) {
  const toneText: Record<Tone, string> = {
    ink: "text-ink",
    dim: "text-ink-dim",
    hit: "text-hit",
    miss: "text-miss",
    crit: "text-crit",
    write: "text-write",
  };
  return (
    <div className="flex flex-col gap-1 p-2.5">
      <span className="eyebrow">{label}</span>
      <div className="flex items-baseline gap-1">
        <span className={`text-lg font-medium tabular-nums leading-none ${toneText[tone]}`}>{value}</span>
        {unit && <span className="text-[9px] text-ink-faint">{unit}</span>}
      </div>
      {bar !== undefined && <Meter value={bar} tone={tone} knee={knee} />}
      {spark && <Sparkline data={spark} color={sparkColor ?? COLOR.inkFaint} max={sparkMax} height={18} />}
    </div>
  );
}

export function TelemetryPanel({ m, history }: { m: Metrics; history: HistoryFrame[] }) {
  const hHit = history.map((h) => h.hitRate);
  const hUtil = history.map((h) => h.dbUtil);
  const hP99 = history.map((h) => h.p99);
  const hErr = history.map((h) => h.errorRate);

  const utilTone: Tone = m.dbUtil >= STATUS.CRITICAL_UTIL ? "crit" : m.dbUtil >= STATUS.DEGRADED_UTIL ? "miss" : "hit";
  const hitTone: Tone = m.hitRate >= 0.9 ? "hit" : m.hitRate >= 0.6 ? "miss" : "crit";
  const errTone: Tone = m.errorRate >= STATUS.CRITICAL_ERR ? "crit" : m.errorRate > 0 ? "miss" : "dim";
  const latTone: Tone = m.p99 > 100 ? "crit" : m.p99 > 25 ? "miss" : "hit";

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto">
      <Panel label="DB QUEUEING MODEL" fig="FIG.03" bodyClass="p-2">
        <div className="h-[150px]">
          <QueueingCurve rho={m.dbUtil} dbLatency={m.dbLatencyMs} />
        </div>
        <p className="border-t border-line px-1 pt-2 text-[9px] leading-relaxed text-ink-faint">
          R = S/(1−ρ) · S={SIM.DB_SERVICE_MS}ms · μ={fmtCompact(SIM.DB_MAX_QPS)} QPS. Latency diverges as ρ→1; the cache holds the operating point left of the knee.
        </p>
      </Panel>

      <Panel label="LIVE TELEMETRY" fig="FIG.04" bodyClass="grid grid-cols-2 divide-x divide-y divide-line">
        <Cell
          label="CACHE HIT RATE"
          value={fmtPct(m.hitRate, 1)}
          tone={hitTone}
          spark={hHit}
          sparkColor={hitTone === "hit" ? COLOR.hit : COLOR.miss}
          sparkMax={1}
          bar={m.hitRate}
        />
        <Cell
          label="DB UTILISATION ρ"
          value={fmtPct(Math.min(m.dbUtil, 9.99), 0)}
          tone={utilTone}
          spark={hUtil}
          sparkColor={utilTone === "crit" ? COLOR.crit : utilTone === "miss" ? COLOR.miss : COLOR.inkDim}
          sparkMax={1}
          bar={m.dbUtil}
          knee={0.7}
        />
        <Cell label="LATENCY p50" value={fmtLatency(m.p50)} tone="dim" />
        <Cell label="LATENCY p99" value={fmtLatency(m.p99)} tone={latTone} spark={hP99} sparkColor={latTone === "crit" ? COLOR.crit : COLOR.miss} />
        <Cell label="DB THROUGHPUT" value={fmtCompact(m.dbQPS)} unit="QPS" tone="dim" />
        <Cell label="ERROR RATE" value={fmtPct(m.errorRate, 2)} tone={errTone} spark={hErr} sparkColor={COLOR.crit} sparkMax={0.5} />
        <Cell label="DIRTY ENTRIES" value={fmtInt(m.dirtyCount)} tone={m.dirtyCount > 0 ? "write" : "dim"} unit="unflushed" />
        <Cell label="REPL LAG" value={fmtMs(m.replLagMs)} tone={m.replLagMs > 500 ? "miss" : "dim"} />
        <Cell label="POOL" value={`${Math.round(m.poolInUse)}/${SIM.DB_POOL_SIZE}`} tone={m.poolUtil >= 1 ? "crit" : "dim"} bar={m.poolUtil} />
        <Cell label="EVICTIONS" value={fmtCompact(m.evictionRate)} unit="/s" tone={m.evictionRate > 0 ? "miss" : "dim"} />
      </Panel>

      <Panel label="CACHE LEVERAGE" fig="FIG.05" bodyClass="p-0">
        <Headline
          big={fmtCompact(m.dbRequestsPrevented, 1)}
          unit="req/s ABSORBED"
          note={`The cache is shielding the DB from ${fmtPct(m.arrivalRate > 0 ? m.dbRequestsPrevented / m.arrivalRate : 0, 0)} of all traffic`}
          tone="hit"
        />
      </Panel>
    </div>
  );
}

function Headline({ big, unit, note, tone }: { big: string; unit: string; note: string; tone: Tone }) {
  const toneText: Record<Tone, string> = {
    ink: "text-ink",
    dim: "text-ink-dim",
    hit: "text-hit",
    miss: "text-miss",
    crit: "text-crit",
    write: "text-write",
  };
  return (
    <div className="flex flex-col gap-1 p-3">
      <div className="flex items-baseline gap-2">
        <span className={`text-3xl font-semibold tabular-nums leading-none ${toneText[tone]}`}>{big}</span>
        <span className="text-[10px] text-ink-faint">{unit}</span>
      </div>
      <p className="text-[10px] leading-relaxed text-ink-dim">{note}</p>
    </div>
  );
}
