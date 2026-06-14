"use client";

import { COLOR } from "@/lib/constants";
import type { Config } from "@/lib/simulation";
import { SCENARIOS, type Scenario } from "@/lib/scenarios";
import { fmtCompact } from "@/lib/format";
import { Panel, Segmented, Toggle, Field, Slider } from "./primitives";

const POLICY_DESC: Record<Config["writePolicy"], string> = {
  "write-through": "Sync to cache + DB. Strong consistency, but zero write-path protection — the DB absorbs every write.",
  "write-back": "To cache only, marked dirty, flushed async in coalesced batches. Fastest writes; a crash loses the dirty window.",
  "write-around": "Straight to the DB, bypassing the cache. No write relief, and the next read is a guaranteed cold miss.",
};

const CONCURRENCY_DESC: Record<Config["concurrency"], string> = {
  atomic: "Atomic DECR — the post-decrement value is returned in one indivisible step. Reject < 0. Oversell is impossible.",
  naive: "Read-modify-write — concurrent buyers read the same stock then both write. Races oversell the last units.",
};

export function ControlPanel({
  config,
  activeScenario,
  onChange,
  onScenario,
  onInfo,
}: {
  config: Config;
  activeScenario: string | null;
  onChange: <K extends keyof Config>(key: K, value: Config[K]) => void;
  onScenario: (s: Scenario) => void;
  onInfo: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto pr-0.5">
      <Panel
        label="SCENARIO PRESETS"
        fig="FIG.01"
        right={
          <button onClick={onInfo} className="eyebrow text-ink-faint transition-colors hover:text-ink">
            [ METHODOLOGY ]
          </button>
        }
        bodyClass="flex flex-col"
      >
        {SCENARIOS.map((s) => {
          const active = activeScenario === s.id;
          return (
            <button
              key={s.id}
              onClick={() => onScenario(s)}
              className={`group flex items-start gap-2 border-b border-line px-3 py-2 text-left transition-colors last:border-b-0 ${
                active ? "bg-ink text-black" : "hover:bg-panel-2"
              }`}
            >
              <span className={`mt-px text-[9px] tabular-nums ${active ? "text-black/50" : "text-ink-ghost"}`}>
                {s.tag}
              </span>
              <span className="flex flex-col gap-0.5">
                <span className={`text-[11px] font-medium tracking-wide ${active ? "text-black" : "text-ink"}`}>
                  {s.label}
                </span>
                <span className={`text-[9px] leading-snug ${active ? "text-black/60" : "text-ink-faint"}`}>
                  {s.blurb}
                </span>
              </span>
            </button>
          );
        })}
      </Panel>

      <Panel label="WRITE POLICY" fig="FIG.02" bodyClass="flex flex-col gap-2 p-3">
        <Segmented<Config["writePolicy"]>
          value={config.writePolicy}
          onChange={(v) => onChange("writePolicy", v)}
          columns={3}
          options={[
            { value: "write-through", label: "THROUGH" },
            { value: "write-back", label: "BACK" },
            { value: "write-around", label: "AROUND" },
          ]}
        />
        <p className="text-[9px] leading-relaxed text-ink-dim">{POLICY_DESC[config.writePolicy]}</p>
      </Panel>

      <Panel label="CACHE CONFIGURATION" fig="FIG.2A" bodyClass="flex flex-col gap-3 p-3">
        <Field label="CACHE TIER" hint={config.cacheEnabled ? "ONLINE" : "OFFLINE"}>
          <Toggle on={config.cacheEnabled} onChange={(v) => onChange("cacheEnabled", v)} labels={["OFFLINE", "ONLINE"]} />
        </Field>
        <Field label="EVICTION POLICY" hint="skewed workload">
          <Segmented<Config["eviction"]>
            value={config.eviction}
            onChange={(v) => onChange("eviction", v)}
            columns={3}
            options={[
              { value: "LFU", label: "LFU" },
              { value: "LRU", label: "LRU" },
              { value: "FIFO", label: "FIFO" },
            ]}
          />
        </Field>
        <Field
          label="CACHE CAPACITY"
          hint={`${fmtCompact(config.cacheCapacity)} / ${fmtCompact(config.workingSet)} keys`}
        >
          <Slider
            value={config.cacheCapacity}
            min={200}
            max={config.workingSet}
            step={100}
            onChange={(v) => onChange("cacheCapacity", v)}
            format={(v) => fmtCompact(v)}
            ariaLabel="Cache capacity in entries"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="SINGLE-FLIGHT" hint="anti-stampede">
            <Toggle on={config.stampedeProtection} onChange={(v) => onChange("stampedeProtection", v)} />
          </Field>
          <Field label="TTL JITTER" hint="desync expiry">
            <Toggle on={config.ttlJitter} onChange={(v) => onChange("ttlJitter", v)} />
          </Field>
        </div>
      </Panel>

      <Panel label="WORKLOAD" fig="FIG.2B" bodyClass="flex flex-col gap-3 p-3">
        <Field label="ARRIVAL RATE" hint="requests / sec">
          <Slider
            value={config.arrivalRate}
            min={100}
            max={22000}
            step={100}
            onChange={(v) => onChange("arrivalRate", v)}
            format={(v) => fmtCompact(v) + "/s"}
            ariaLabel="Arrival rate in requests per second"
          />
        </Field>
        <Field label="WRITE FRACTION" hint="purchases / total">
          <Slider
            value={config.writeFraction}
            min={0}
            max={0.6}
            step={0.01}
            onChange={(v) => onChange("writeFraction", v)}
            format={(v) => (v * 100).toFixed(0) + "%"}
            ariaLabel="Write fraction, share of requests that are purchases"
          />
        </Field>
      </Panel>

      <Panel label="INVENTORY CONCURRENCY" fig="FIG.2C" bodyClass="flex flex-col gap-2 p-3">
        <Segmented<Config["concurrency"]>
          value={config.concurrency}
          onChange={(v) => onChange("concurrency", v)}
          columns={2}
          options={[
            { value: "atomic", label: "ATOMIC DECR" },
            { value: "naive", label: "NAIVE RMW" },
          ]}
        />
        <p className="text-[9px] leading-relaxed" style={{ color: config.concurrency === "naive" ? COLOR.miss : COLOR.inkDim }}>
          {CONCURRENCY_DESC[config.concurrency]}
        </p>
      </Panel>
    </div>
  );
}
