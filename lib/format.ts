/** Monospace-friendly formatters. Fixed widths keep the telemetry grid steady. */

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Compact magnitude: 1.2K, 8.4K, 1.9M — for dense readouts. */
export function fmtCompact(n: number, digits = 1): string {
  const abs = Math.abs(n);
  if (abs < 1000) return abs < 10 && !Number.isInteger(n) ? n.toFixed(digits) : String(Math.round(n));
  if (abs < 1_000_000) return (n / 1000).toFixed(digits) + "K";
  return (n / 1_000_000).toFixed(digits) + "M";
}

export function fmtPct(x: number, digits = 1): string {
  return (x * 100).toFixed(digits) + "%";
}

/** Latency with adaptive units: sub-ms in µs, then ms. */
export function fmtLatency(ms: number): string {
  if (ms < 1) return (ms * 1000).toFixed(0) + "µs";
  if (ms < 100) return ms.toFixed(1) + "ms";
  return Math.round(ms) + "ms";
}

export function fmtMs(ms: number): string {
  if (ms >= 1000) return (ms / 1000).toFixed(2) + "s";
  return Math.round(ms) + "ms";
}

/** Seconds → HH:MM:SS uptime clock. */
export function fmtClock(seconds: number): string {
  const s = Math.floor(seconds);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
