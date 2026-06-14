"use client";

import { ReactNode } from "react";

export type Tone = "ink" | "dim" | "hit" | "miss" | "crit" | "write";

const TONE_TEXT: Record<Tone, string> = {
  ink: "text-ink",
  dim: "text-ink-dim",
  hit: "text-hit",
  miss: "text-miss",
  crit: "text-crit",
  write: "text-write",
};

const TONE_BAR: Record<Tone, string> = {
  ink: "bg-ink",
  dim: "bg-ink-faint",
  hit: "bg-hit",
  miss: "bg-miss",
  crit: "bg-crit",
  write: "bg-write",
};

/** A bordered, corner-ticked panel with a tracked-out eyebrow header. */
export function Panel({
  label,
  fig,
  right,
  children,
  className = "",
  bodyClass = "",
}: {
  label: string;
  fig?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section className={`ticked relative flex min-h-0 flex-col border border-line bg-panel ${className}`}>
      <header className="flex h-7 shrink-0 items-center justify-between border-b border-line px-3">
        <span className="eyebrow flex items-center gap-2">
          {fig && <span className="text-ink-ghost">{fig}</span>}
          <span className="text-ink-dim">{label}</span>
        </span>
        {right}
      </header>
      <div className={`min-h-0 flex-1 ${bodyClass}`}>{children}</div>
    </section>
  );
}

/** Large numeric readout with label + unit. The font does the heavy lifting. */
export function Readout({
  label,
  value,
  unit,
  tone = "ink",
  sub,
  size = "md",
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: Tone;
  sub?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const valueSize = size === "lg" ? "text-2xl" : size === "sm" ? "text-base" : "text-xl";
  return (
    <div className="flex flex-col gap-1 px-3 py-2">
      <span className="eyebrow">{label}</span>
      <div className="flex items-baseline gap-1">
        <span className={`${valueSize} font-medium tabular-nums leading-none ${TONE_TEXT[tone]}`}>
          {value}
        </span>
        {unit && <span className="text-[10px] text-ink-faint">{unit}</span>}
      </div>
      {sub}
    </div>
  );
}

/** Horizontal meter with an optional knee marker. */
export function Meter({
  value,
  tone = "ink",
  knee,
}: {
  value: number; // 0..1+
  tone?: Tone;
  knee?: number; // 0..1 marker position
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const over = value > 1;
  return (
    <div className="relative h-[6px] w-full border border-line-2 bg-black">
      <div
        className={`h-full ${over ? "bg-crit" : TONE_BAR[tone]}`}
        style={{ width: `${pct}%`, transition: "width 120ms linear" }}
      />
      {knee !== undefined && (
        <div
          className="absolute top-[-2px] bottom-[-2px] w-px bg-ink-dim"
          style={{ left: `${knee * 100}%` }}
        />
      )}
    </div>
  );
}

/** Two-state brutalist switch — active cell is inverted (white on black). */
export function Toggle({
  on,
  onChange,
  labels = ["OFF", "ON"],
  disabled,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  labels?: [string, string];
  disabled?: boolean;
}) {
  return (
    <div className={`flex border border-line-2 ${disabled ? "opacity-40" : ""}`}>
      {[false, true].map((state) => (
        <button
          key={String(state)}
          disabled={disabled}
          onClick={() => onChange(state)}
          className={`flex-1 px-2 py-1 text-[10px] tracking-wider transition-colors ${
            on === state ? "bg-ink text-black" : "bg-transparent text-ink-faint hover:text-ink-dim"
          } ${state ? "border-l border-line-2" : ""}`}
        >
          {labels[state ? 1 : 0]}
        </button>
      ))}
    </div>
  );
}

/** A row of mutually-exclusive options; the selected one is inverted. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  columns,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  columns?: number;
}) {
  return (
    <div
      className="grid gap-px border border-line-2 bg-line-2"
      style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0,1fr))` }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-2 py-[5px] text-[10px] tracking-wide transition-colors ${
            value === o.value ? "bg-ink text-black" : "bg-panel text-ink-faint hover:text-ink-dim"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Labelled control row used in the control panel. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="eyebrow">{label}</span>
        {hint && <span className="text-[9px] text-ink-ghost">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** Brutalist range slider with a tabular value pill. */
export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  ariaLabel?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel}
        aria-valuetext={format ? format(value) : String(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="brut-range h-1 flex-1 cursor-pointer appearance-none bg-line-2"
      />
      <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-ink">
        {format ? format(value) : value}
      </span>
    </div>
  );
}

export function StatusDot({ tone }: { tone: Tone }) {
  return <span className={`inline-block h-2 w-2 ${TONE_BAR[tone]}`} />;
}
