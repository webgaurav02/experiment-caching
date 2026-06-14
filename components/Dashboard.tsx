"use client";

import { useEffect, useRef, useState } from "react";
import { COLOR, SIM } from "@/lib/constants";
import {
  Simulation,
  type Config,
  type HistoryFrame,
  type LogEvent,
  type Metrics,
  type Status,
} from "@/lib/simulation";
import type { Scenario } from "@/lib/scenarios";
import { fmtClock, fmtInt, fmtLatency, fmtPct } from "@/lib/format";
import { ArchitectureMap, type MapHandle } from "./ArchitectureMap";
import { ControlPanel } from "./ControlPanel";
import { TelemetryPanel } from "./TelemetryPanel";
import { EventLog } from "./EventLog";
import { InfoOverlay } from "./InfoOverlay";
import { Panel, Meter } from "./primitives";

const STATUS_TONE: Record<Status, { text: string; bg: string; label: string }> = {
  NOMINAL: { text: COLOR.hit, bg: "transparent", label: "NOMINAL" },
  DEGRADED: { text: "#000", bg: COLOR.miss, label: "DEGRADED" },
  CRITICAL: { text: "#000", bg: COLOR.crit, label: "CRITICAL" },
};

const SPEEDS = [0.5, 1, 2, 4];

export function Dashboard() {
  const simRef = useRef<Simulation | null>(null);
  if (simRef.current === null) simRef.current = new Simulation();
  const sim = simRef.current;
  const mapRef = useRef<MapHandle>(null);

  const [config, setConfig] = useState<Config>(sim.config);
  const [metrics, setMetrics] = useState<Metrics>(sim.metrics);
  const [history, setHistory] = useState<HistoryFrame[]>([]);
  const [events, setEvents] = useState<LogEvent[]>(sim.events.slice());
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [activeScenario, setActiveScenario] = useState<string | null>("baseline");
  const [showInfo, setShowInfo] = useState(false);
  const [uptime, setUptime] = useState(0);

  const runningRef = useRef(running);
  runningRef.current = running;
  const speedRef = useRef(speed);
  speedRef.current = speed;

  // single animation loop: tick the model, draw the map, throttle React snapshots.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (runningRef.current) {
        const s = speedRef.current;
        if (s >= 1) for (let i = 0; i < s; i++) sim.tick(dt);
        else sim.tick(dt * s);
      }
      mapRef.current?.draw();
      acc += dt;
      if (acc >= 0.08) {
        acc = 0;
        setMetrics({ ...sim.metrics });
        setHistory(sim.history.slice());
        setEvents(sim.events.slice());
        setUptime(sim.time);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [sim]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowInfo(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const update = <K extends keyof Config>(key: K, value: Config[K]) => {
    sim.set(key, value);
    setConfig({ ...sim.config });
    setActiveScenario(null);
  };

  const applyScenario = (s: Scenario) => {
    (Object.entries(s.config) as [keyof Config, Config[keyof Config]][]).forEach(([k, v]) => sim.set(k, v));
    setConfig({ ...sim.config });
    setActiveScenario(s.id);
  };

  const reset = () => {
    sim.reset();
    setConfig({ ...sim.config });
    setMetrics({ ...sim.metrics });
    setHistory([]);
    setEvents(sim.events.slice());
    setUptime(0);
  };

  const st = STATUS_TONE[metrics.status];
  const sellThrough = metrics.sold / SIM.TICKET_SUPPLY;

  return (
    <div className="scanlines relative flex h-screen w-screen flex-col overflow-hidden bg-bg">
      {/* ── small-screen notice ─────────────────────────────────────────────── */}
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center lg:hidden">
        <span className="eyebrow">CACHE//STRATA</span>
        <p className="max-w-xs text-sm text-ink-dim">
          This telemetry console is engineered for a wide viewport. Please open it on a display ≥ 1024px.
        </p>
      </div>

      {/* ── desktop console ─────────────────────────────────────────────────── */}
      <div className="hidden h-full flex-col lg:flex">
        {/* HEADER */}
        <header className="flex h-[52px] shrink-0 items-stretch border-b border-line">
          <div className="flex flex-col justify-center border-r border-line px-4">
            <span className="text-[15px] font-semibold tracking-[0.2em] text-ink">
              CACHE<span className="text-ink-faint">//</span>STRATA
            </span>
            <span className="eyebrow">DISTRIBUTED CACHE RESILIENCE TELEMETRY</span>
          </div>

          <div className="flex flex-1 items-center gap-6 px-5">
            <HeaderStat label="UPTIME" value={fmtClock(uptime)} />
            <HeaderStat label="ARRIVAL" value={`${fmtInt(metrics.arrivalRate)}/s`} />
            <HeaderStat label="HIT RATE" value={fmtPct(metrics.hitRate, 1)} tone={metrics.hitRate > 0.9 ? COLOR.hit : COLOR.miss} />
            <HeaderStat label="p99" value={fmtLatency(metrics.p99)} tone={metrics.p99 > 100 ? COLOR.crit : metrics.p99 > 25 ? COLOR.miss : COLOR.ink} />
            <HeaderStat label="ERRORS" value={fmtPct(metrics.errorRate, 2)} tone={metrics.errorRate > 0.005 ? COLOR.crit : COLOR.ink} />
          </div>

          {/* status banner */}
          <div
            className="flex w-[140px] items-center justify-center border-l border-r border-line"
            style={{ background: st.bg }}
          >
            <span className="flex items-center gap-2 text-[13px] font-semibold tracking-[0.18em]" style={{ color: st.text }}>
              <span className={`inline-block h-2 w-2 ${metrics.status !== "NOMINAL" ? "blink" : ""}`} style={{ background: metrics.status === "NOMINAL" ? COLOR.hit : st.text }} />
              {st.label}
            </span>
          </div>

          {/* transport controls */}
          <div className="flex items-center gap-px px-3">
            <CtrlBtn onClick={() => setRunning((r) => !r)} active={running}>
              {running ? "❚❚ PAUSE" : "▶ RUN"}
            </CtrlBtn>
            <CtrlBtn onClick={reset}>↺ RESET</CtrlBtn>
            <div className="ml-2 flex border border-line-2">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  className={`px-2 py-1 text-[10px] tabular-nums transition-colors ${
                    speed === s ? "bg-ink text-black" : "text-ink-faint hover:text-ink-dim"
                  }`}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>
        </header>

        {/* MAIN GRID */}
        <main className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)_336px] gap-2 p-2">
          <ControlPanel
            config={config}
            activeScenario={activeScenario}
            onChange={update}
            onScenario={applyScenario}
            onInfo={() => setShowInfo(true)}
          />

          <Panel
            label="ARCHITECTURE MAP — 3-TIER READ/WRITE TOPOLOGY"
            fig="FIG.00"
            right={<span className="eyebrow text-ink-ghost">CLIENT · CACHE · DATABASE</span>}
            bodyClass="relative grid-bg"
          >
            <ArchitectureMap ref={mapRef} sim={sim} />
          </Panel>

          <TelemetryPanel m={metrics} history={history} />
        </main>

        {/* FOOTER */}
        <footer className="grid h-[148px] shrink-0 grid-cols-[1fr_1.4fr] gap-2 border-t border-line p-2 pt-0">
          <Panel label="ON-SALE STATUS — 19,000 TICKETS" fig="FIG.06" bodyClass="flex flex-col justify-between p-3">
            <div className="flex items-end justify-between">
              <Big label="SOLD" value={fmtInt(metrics.sold)} tone={COLOR.hit} />
              <Big label="REMAINING" value={fmtInt(metrics.remaining)} tone={COLOR.inkDim} />
              <Big label="OVERSOLD" value={fmtInt(metrics.oversold)} tone={metrics.oversold > 0 ? COLOR.crit : COLOR.inkFaint} />
              <Big label="SELL-THROUGH" value={fmtPct(sellThrough, 1)} tone={COLOR.ink} />
            </div>
            <div className="flex flex-col gap-1">
              <Meter value={sellThrough} tone={metrics.oversold > 0 ? "crit" : "hit"} />
              <div className="flex justify-between">
                <span className="text-[9px] text-ink-ghost">0</span>
                <span className="text-[9px] text-ink-ghost">
                  {metrics.oversold > 0 ? "⚠ NAIVE RMW OVERSELLING LAST UNITS" : "ATOMIC DECR — OVERSELL-SAFE"}
                </span>
                <span className="text-[9px] text-ink-ghost">{fmtInt(SIM.TICKET_SUPPLY)}</span>
              </div>
            </div>
          </Panel>

          <Panel label="SYSTEM EVENT LOG" fig="FIG.07" right={<span className="eyebrow text-ink-ghost blink">● LIVE</span>}>
            <EventLog events={events} />
          </Panel>
        </footer>
      </div>

      {showInfo && <InfoOverlay onClose={() => setShowInfo(false)} />}
    </div>
  );
}

function HeaderStat({ label, value, tone = COLOR.ink }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="eyebrow">{label}</span>
      <span className="text-[13px] font-medium tabular-nums leading-none" style={{ color: tone }}>
        {value}
      </span>
    </div>
  );
}

function Big({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="eyebrow">{label}</span>
      <span className="text-xl font-semibold tabular-nums leading-none" style={{ color: tone }}>
        {value}
      </span>
    </div>
  );
}

function CtrlBtn({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`border border-line-2 px-3 py-1.5 text-[10px] tracking-wider transition-colors ${
        active ? "bg-panel-2 text-ink" : "text-ink-dim hover:bg-panel-2 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
