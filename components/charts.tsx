"use client";

import { useMemo } from "react";
import { COLOR, SIM } from "@/lib/constants";

/** Minimal SVG sparkline — hard polyline, no smoothing, no fill gradient. */
export function Sparkline({
  data,
  color = COLOR.inkDim,
  max,
  min = 0,
  height = 24,
  baseline,
}: {
  data: number[];
  color?: string;
  max?: number;
  min?: number;
  height?: number;
  baseline?: number; // optional reference line value
}) {
  const W = 100;
  const H = height;
  const hi = max ?? Math.max(1e-6, ...data);
  const span = hi - min || 1;
  const pts = data.length
    ? data
        .map((v, i) => {
          const x = (i / Math.max(1, data.length - 1)) * W;
          const y = H - ((Math.max(min, Math.min(hi, v)) - min) / span) * H;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ")
    : "";
  const baseY = baseline !== undefined ? H - ((baseline - min) / span) * H : null;
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block">
      {baseY !== null && (
        <line x1="0" y1={baseY} x2={W} y2={baseY} stroke={COLOR.inkGhost} strokeWidth="0.5" strokeDasharray="2 2" />
      )}
      {pts && <polyline points={pts} fill="none" stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

/**
 * The queueing curve: R = S/(1−ρ). The static M/M/1 response-time law plotted on
 * a log latency axis, with the operating knee (ρ=0.70) and saturation (ρ=0.92)
 * marked, the flat cache baseline for contrast, and a LIVE marker at the system's
 * current operating point. This is the single most important credibility signal —
 * it shows latency is not linear in load: it diverges as ρ→1.
 */
export function QueueingCurve({ rho, dbLatency }: { rho: number; dbLatency: number }) {
  const W = 260;
  const H = 150;
  const padL = 30;
  const padR = 10;
  const padT = 12;
  const padB = 20;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const LMIN = 0.1; // ms
  const LMAX = 1000; // ms
  const x = (r: number) => padL + Math.min(1, Math.max(0, r)) * plotW;
  const y = (ms: number) => {
    const c = Math.min(LMAX, Math.max(LMIN, ms));
    const f = (Math.log10(c) - Math.log10(LMIN)) / (Math.log10(LMAX) - Math.log10(LMIN));
    return padT + (1 - f) * plotH;
  };

  const curve = useMemo(() => {
    const pts: string[] = [];
    for (let r = 0; r <= 0.985; r += 0.01) {
      pts.push(`${x(r).toFixed(1)},${y(SIM.DB_SERVICE_MS / (1 - r)).toFixed(1)}`);
    }
    return pts.join(" ");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const liveR = Math.min(0.995, Math.max(0, rho));
  const markerColor = rho >= 0.92 ? COLOR.crit : rho >= 0.7 ? COLOR.miss : COLOR.hit;
  const gridMs = [1, 10, 100, 1000];

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="block">
      {/* y grid (log decades) */}
      {gridMs.map((ms) => (
        <g key={ms}>
          <line x1={padL} y1={y(ms)} x2={W - padR} y2={y(ms)} stroke={COLOR.line} strokeWidth="0.5" />
          <text x={padL - 4} y={y(ms) + 3} textAnchor="end" fontSize="7" fill={COLOR.inkFaint}>
            {ms >= 1000 ? "1s" : ms + "ms"}
          </text>
        </g>
      ))}
      {/* x ticks */}
      {[0, 0.5, 0.7, 0.92, 1].map((r) => (
        <text key={r} x={x(r)} y={H - 6} textAnchor="middle" fontSize="7" fill={COLOR.inkFaint}>
          {r.toFixed(2)}
        </text>
      ))}
      {/* knee + saturation markers */}
      <line x1={x(0.7)} y1={padT} x2={x(0.7)} y2={padT + plotH} stroke={COLOR.miss} strokeWidth="0.5" strokeDasharray="2 2" />
      <line x1={x(0.92)} y1={padT} x2={x(0.92)} y2={padT + plotH} stroke={COLOR.crit} strokeWidth="0.5" strokeDasharray="2 2" />
      <text x={x(0.7) + 2} y={padT + 8} fontSize="6.5" fill={COLOR.miss}>KNEE</text>
      <text x={x(0.92) + 2} y={padT + 8} fontSize="6.5" fill={COLOR.crit}>SAT</text>

      {/* cache baseline */}
      <line x1={padL} y1={y(SIM.CACHE_READ_MS)} x2={W - padR} y2={y(SIM.CACHE_READ_MS)} stroke={COLOR.hit} strokeWidth="0.75" strokeDasharray="3 2" />
      <text x={W - padR} y={y(SIM.CACHE_READ_MS) - 3} textAnchor="end" fontSize="6.5" fill={COLOR.hit}>CACHE 0.3ms</text>

      {/* the curve */}
      <polyline points={curve} fill="none" stroke={COLOR.inkDim} strokeWidth="1.25" vectorEffect="non-scaling-stroke" />

      {/* live operating point */}
      <line x1={x(liveR)} y1={padT} x2={x(liveR)} y2={padT + plotH} stroke={markerColor} strokeWidth="0.5" opacity="0.4" />
      <rect x={x(liveR) - 3} y={y(dbLatency) - 3} width="6" height="6" fill={markerColor} />
      <text x={padL + 2} y={padT + 8} fontSize="7" fill={markerColor}>
        ρ={liveR.toFixed(2)} · {dbLatency < 1 ? (dbLatency * 1000).toFixed(0) + "µs" : dbLatency.toFixed(1) + "ms"}
      </text>
    </svg>
  );
}
