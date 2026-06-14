"use client";

import { COLOR } from "@/lib/constants";
import type { LogEvent } from "@/lib/simulation";
import { fmtClock } from "@/lib/format";

const LEVEL_COLOR: Record<LogEvent["level"], string> = {
  info: COLOR.inkDim,
  ok: COLOR.hit,
  warn: COLOR.miss,
  crit: COLOR.crit,
};

const LEVEL_GLYPH: Record<LogEvent["level"], string> = {
  info: "·",
  ok: "✓",
  warn: "▲",
  crit: "✕",
};

export function EventLog({ events }: { events: LogEvent[] }) {
  const ordered = [...events].slice(-60).reverse();
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto font-mono text-[10px] leading-[1.7]">
      {ordered.length === 0 && <div className="px-3 py-2 text-ink-ghost">AWAITING EVENTS…</div>}
      {ordered.map((e) => (
        <div key={e.id} className="tickerin flex items-baseline gap-2 px-3 py-px hover:bg-panel-2">
          <span className="shrink-0 tabular-nums text-ink-ghost">{fmtClock(e.t)}</span>
          <span className="shrink-0" style={{ color: LEVEL_COLOR[e.level] }}>
            {LEVEL_GLYPH[e.level]}
          </span>
          <span className="truncate" style={{ color: LEVEL_COLOR[e.level] }}>
            {e.msg}
          </span>
        </div>
      ))}
    </div>
  );
}
