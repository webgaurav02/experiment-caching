"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { COLOR, SIM } from "@/lib/constants";
import type { Packet, PacketKind, Simulation } from "@/lib/simulation";

export interface MapHandle {
  draw: () => void;
}

type Pt = { x: number; y: number };

const PACKET_COLOR: Record<PacketKind, string> = {
  hit: COLOR.hit,
  miss: COLOR.miss,
  "write-db": COLOR.write,
  "write-cache": COLOR.write,
  flush: COLOR.flush,
};

/**
 * The architecture map. Three network tiers — Client / Cache / Database — wired
 * by request + response rails. Geometric packets traverse the rails; their route
 * encodes what actually happened (hit bounces at the cache, miss penetrates to the
 * DB and crawls back, writes fork or flush by policy). The DB tier visibly heats
 * and queues as utilisation climbs. All geometry lives here; the engine only owns
 * each packet's kind + progress, keeping model and view cleanly separated.
 */
export const ArchitectureMap = forwardRef<MapHandle, { sim: Simulation }>(function ArchitectureMap(
  { sim },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });

  // stable handle: render() only reads refs + the (stable) sim instance, so the
  // initial closure stays correct for the lifetime of the component.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useImperativeHandle(ref, () => ({ draw: () => render() }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement!;
    const ro = new ResizeObserver(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      sizeRef.current = { w, h, dpr };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      render();
    });
    ro.observe(parent);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── geometry ────────────────────────────────────────────────────────────────
  function layout(w: number, h: number) {
    const cy = h * 0.45;
    const reqY = cy - 30;
    const respY = cy + 30;
    const flushY = respY + 22;
    const nodeW = clamp(w * 0.17, 96, 168);
    const nodeH = clamp(h * 0.5, 130, 230);
    const clientX = w * 0.13;
    const cacheX = w * 0.5;
    const dbX = w * 0.87;
    return {
      cy,
      reqY,
      respY,
      flushY,
      nodeW,
      nodeH,
      clientX,
      cacheX,
      dbX,
      clientR: clientX + nodeW / 2,
      cacheL: cacheX - nodeW / 2,
      cacheR: cacheX + nodeW / 2,
      dbL: dbX - nodeW / 2,
    };
  }

  function routeFor(p: Packet, L: ReturnType<typeof layout>): Pt[] {
    const { clientR, cacheL, cacheR, dbL, reqY, respY, flushY } = L;
    switch (p.kind) {
      case "hit":
      case "write-cache":
        return [
          { x: clientR, y: reqY },
          { x: cacheL, y: reqY },
          { x: cacheL, y: respY },
          { x: clientR, y: respY },
        ];
      case "flush":
        return [
          { x: cacheR, y: flushY },
          { x: dbL, y: flushY },
        ];
      case "miss":
      case "write-db":
        if (p.errored) {
          return [
            { x: clientR, y: reqY },
            { x: cacheL, y: reqY },
            { x: dbL, y: reqY },
          ];
        }
        return [
          { x: clientR, y: reqY },
          { x: cacheL, y: reqY },
          { x: dbL, y: reqY },
          { x: dbL, y: respY },
          { x: clientR, y: respY },
        ];
    }
  }

  function pointAt(route: Pt[], t: number): Pt {
    if (route.length === 1) return route[0];
    let total = 0;
    const segLen: number[] = [];
    for (let i = 0; i < route.length - 1; i++) {
      const d = Math.hypot(route[i + 1].x - route[i].x, route[i + 1].y - route[i].y);
      segLen.push(d);
      total += d;
    }
    let target = clamp(t, 0, 1) * total;
    for (let i = 0; i < segLen.length; i++) {
      if (target <= segLen[i] || i === segLen.length - 1) {
        const f = segLen[i] === 0 ? 0 : target / segLen[i];
        return {
          x: lerp(route[i].x, route[i + 1].x, f),
          y: lerp(route[i].y, route[i + 1].y, f),
        };
      }
      target -= segLen[i];
    }
    return route[route.length - 1];
  }

  // ── render ──────────────────────────────────────────────────────────────────
  function render() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h, dpr } = sizeRef.current;
    if (w === 0 || h === 0) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const L = layout(w, h);
    drawRails(ctx, L);
    drawClientNode(ctx, L);
    drawCacheNode(ctx, L);
    drawDbNode(ctx, L);
    drawPackets(ctx, L);
    drawLegend(ctx, w, h);
  }

  function drawRails(ctx: CanvasRenderingContext2D, L: ReturnType<typeof layout>) {
    const { clientR, cacheR, dbL, reqY, respY, flushY } = L;
    ctx.lineWidth = 1;
    ctx.strokeStyle = COLOR.line2;
    // request rail (left→right) and response rail (right→left)
    line(ctx, clientR, reqY, dbL, reqY);
    line(ctx, clientR, respY, dbL, respY);
    // flush lane
    ctx.strokeStyle = COLOR.line;
    line(ctx, cacheR, flushY, dbL, flushY);

    // directional notches + rail labels
    ctx.fillStyle = COLOR.inkGhost;
    ctx.font = "8px ui-monospace, Menlo, monospace";
    ctx.textAlign = "left";
    ctx.fillText("REQUEST →", clientR + 6, reqY - 6);
    ctx.textAlign = "right";
    ctx.fillText("← RESPONSE", dbL - 6, respY + 14);
    ctx.textAlign = "left";
    ctx.fillStyle = COLOR.line2;
    ctx.fillText("WRITE-BACK FLUSH →", cacheR + 6, flushY + 12);
  }

  function nodeBox(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    nodeW: number,
    nodeH: number,
    accent: string = COLOR.line2,
  ) {
    const x = cx - nodeW / 2;
    const y = cy - nodeH / 2;
    ctx.fillStyle = COLOR.panel;
    ctx.fillRect(x, y, nodeW, nodeH);
    ctx.lineWidth = 1;
    ctx.strokeStyle = accent;
    ctx.strokeRect(x + 0.5, y + 0.5, nodeW - 1, nodeH - 1);
    // corner registration ticks
    ctx.strokeStyle = COLOR.ink;
    const t = 6;
    corner(ctx, x, y, t, 1, 1);
    corner(ctx, x + nodeW, y, t, -1, 1);
    corner(ctx, x, y + nodeH, t, 1, -1);
    corner(ctx, x + nodeW, y + nodeH, t, -1, -1);
    return { x, y };
  }

  function drawClientNode(ctx: CanvasRenderingContext2D, L: ReturnType<typeof layout>) {
    const { clientX, cy, nodeW, nodeH } = L;
    const { x, y } = nodeBox(ctx, clientX, cy, nodeW, nodeH);
    const m = sim.metrics;
    label(ctx, x + 8, y + 16, "TIER 01", "ORIGIN");
    title(ctx, x + 8, y + 38, "CLIENT");
    stat(ctx, x + 8, y + 64, "ARRIVAL", fmtRate(m.arrivalRate));
    stat(ctx, x + 8, y + 88, "ACCEPTED", fmtRate(m.acceptedRate));
    stat(ctx, x + 8, y + 112, "BUYERS", SIM.TICKET_SUPPLY.toLocaleString());
    // throughput dropped to errors shown in crit if any
    if (m.errorRate > 0.005) {
      ctx.fillStyle = COLOR.crit;
      ctx.font = "9px ui-monospace, Menlo, monospace";
      ctx.fillText(`▼ ${(m.errorRate * 100).toFixed(1)}% DROPPED`, x + 8, y + nodeH - 12);
    }
  }

  function drawCacheNode(ctx: CanvasRenderingContext2D, L: ReturnType<typeof layout>) {
    const { cacheX, cy, nodeW, nodeH } = L;
    const m = sim.metrics;
    const enabled = sim.config.cacheEnabled;
    const accent = !enabled ? COLOR.crit : m.hitRate > 0.9 ? COLOR.ink : COLOR.miss;
    const { x, y } = nodeBox(ctx, cacheX, cy, nodeW, nodeH, accent);
    label(ctx, x + 8, y + 16, "TIER 02", enabled ? "IN-MEMORY" : "OFFLINE");
    title(ctx, x + 8, y + 38, "CACHE");

    if (!enabled) {
      ctx.fillStyle = COLOR.crit;
      ctx.font = "10px ui-monospace, Menlo, monospace";
      ctx.fillText("⊘ BYPASSED", x + 8, y + 64);
      ctx.fillStyle = COLOR.inkFaint;
      ctx.font = "8px ui-monospace, Menlo, monospace";
      wrap(ctx, "ALL TRAFFIC PENETRATES TO DB", x + 8, y + 80, nodeW - 16, 10);
      return;
    }

    stat(ctx, x + 8, y + 64, "HIT RATE", (m.hitRate * 100).toFixed(1) + "%", m.hitRate > 0.9 ? COLOR.hit : COLOR.miss);
    stat(ctx, x + 8, y + 88, "DIRTY", Math.round(m.dirtyCount).toLocaleString(), m.dirtyCount > 0 ? COLOR.write : COLOR.inkDim);

    // memory cells: a small grid filling with resident-set pressure
    const cells = 24;
    const filled = Math.round(clamp(m.memUtil, 0, 1) * cells);
    const gx = x + 8;
    const gy = y + 104;
    const cw = (nodeW - 16) / cells;
    ctx.font = "8px ui-monospace, Menlo, monospace";
    ctx.fillStyle = COLOR.inkFaint;
    ctx.fillText("MEM", gx, gy - 2);
    for (let i = 0; i < cells; i++) {
      ctx.fillStyle = i < filled ? (m.memUtil > 0.95 ? COLOR.miss : COLOR.inkDim) : COLOR.inkGhost;
      ctx.fillRect(gx + i * cw, gy + 2, Math.max(1, cw - 1), 6);
    }

    // dirty ticks: write-back un-flushed entries accumulating
    if (m.dirtyCount > 0) {
      const dy = y + 124;
      const ticks = Math.min(30, Math.round(m.dirtyCount / (SIM.FLUSH_BATCH_ROWS / 30)));
      ctx.fillStyle = COLOR.inkFaint;
      ctx.fillText("FLUSH-Q", gx, dy + 6);
      for (let i = 0; i < ticks; i++) {
        ctx.fillStyle = COLOR.write;
        ctx.fillRect(gx + 44 + i * 3, dy, 2, 8);
      }
    }
  }

  function drawDbNode(ctx: CanvasRenderingContext2D, L: ReturnType<typeof layout>) {
    const { dbX, cy, nodeW, nodeH } = L;
    const m = sim.metrics;
    const rho = clamp(m.dbUtil, 0, 1.2);
    const heat = rho >= STATUS_CRIT ? COLOR.crit : rho >= STATUS_KNEE ? COLOR.miss : COLOR.line2;
    const { x, y } = nodeBox(ctx, dbX, cy, nodeW, nodeH, heat);

    // load column: fills from the bottom as ρ climbs; turns red past the knee.
    const colW = 10;
    const colX = x + nodeW - colW - 7;
    const colTop = y + 30;
    const colBot = y + nodeH - 12;
    const colH = colBot - colTop;
    ctx.strokeStyle = COLOR.line2;
    ctx.strokeRect(colX + 0.5, colTop + 0.5, colW, colH);
    const fillH = clamp(rho, 0, 1) * colH;
    ctx.fillStyle = rho >= STATUS_CRIT ? COLOR.crit : rho >= STATUS_KNEE ? COLOR.miss : COLOR.inkDim;
    ctx.fillRect(colX, colBot - fillH, colW, fillH);
    // knee marker line
    const kneeY = colBot - STATUS_KNEE * colH;
    ctx.strokeStyle = COLOR.ink;
    line(ctx, colX - 3, kneeY, colX + colW + 3, kneeY);
    ctx.fillStyle = COLOR.inkFaint;
    ctx.font = "7px ui-monospace, Menlo, monospace";
    ctx.textAlign = "right";
    ctx.fillText("KNEE", colX - 5, kneeY + 3);
    ctx.textAlign = "left";

    label(ctx, x + 8, y + 16, "TIER 03", "PERSISTENT");
    title(ctx, x + 8, y + 38, "DATABASE");
    stat(ctx, x + 8, y + 64, "ρ UTIL", (rho * 100).toFixed(0) + "%", heat === COLOR.line2 ? COLOR.inkDim : heat);
    stat(ctx, x + 8, y + 88, "QPS", fmtRate(m.dbQPS));
    stat(ctx, x + 8, y + 112, "LATENCY", fmtMs(m.dbLatencyMs), m.dbLatencyMs > 50 ? COLOR.crit : m.dbLatencyMs > 17 ? COLOR.miss : COLOR.inkDim);

    // connection-pool ticks
    const pool = SIM.DB_POOL_SIZE;
    const inUse = Math.round(m.poolInUse);
    const py = y + nodeH - 22;
    ctx.fillStyle = COLOR.inkFaint;
    ctx.font = "8px ui-monospace, Menlo, monospace";
    ctx.fillText(`POOL ${inUse}/${pool}`, x + 8, py - 2);
    const ptW = (nodeW - 16 - colW - 8) / pool;
    for (let i = 0; i < pool; i++) {
      ctx.fillStyle = i < inUse ? (m.poolUtil >= 1 ? COLOR.crit : COLOR.ink) : COLOR.inkGhost;
      ctx.fillRect(x + 8 + i * ptW, py + 2, Math.max(1, ptW - 1), 6);
    }

    // wait-queue stack at the DB inlet when the pool is exhausted
    if (m.poolQueue > 1) {
      const qn = Math.min(20, Math.round(m.poolQueue / 30) + 1);
      ctx.fillStyle = COLOR.crit;
      for (let i = 0; i < qn; i++) {
        ctx.fillRect(x - 8 - i * 4, cy - 3, 2, 6);
      }
    }
  }

  function drawPackets(ctx: CanvasRenderingContext2D, L: ReturnType<typeof layout>) {
    for (const p of sim.packets) {
      const route = routeFor(p, L);
      const pos = pointAt(route, p.t);
      const color = p.errored ? COLOR.crit : PACKET_COLOR[p.kind];
      // errored packets fade as they die at the DB inlet
      const alpha = p.errored ? clamp(1 - (p.t - 0.6) / 0.4, 0.15, 1) : 1;
      const size = p.hot ? 4.5 : 3.2;

      // short motion trail
      const back = pointAt(route, Math.max(0, p.t - 0.04));
      ctx.globalAlpha = alpha * 0.35;
      ctx.strokeStyle = color;
      ctx.lineWidth = p.hot ? 2 : 1;
      line(ctx, back.x, back.y, pos.x, pos.y);

      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      if (p.kind === "flush") {
        // flush packets are dim diamonds
        diamond(ctx, pos.x, pos.y, size);
      } else {
        ctx.fillRect(pos.x - size / 2, pos.y - size / 2, size, size);
      }
      // hot packets get a ring tick
      if (p.hot && !p.errored) {
        ctx.globalAlpha = alpha * 0.8;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(pos.x - size, pos.y - size, size * 2, size * 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawLegend(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const items: [string, string][] = [
      ["CACHE HIT", COLOR.hit],
      ["DB MISS", COLOR.miss],
      ["WRITE", COLOR.write],
      ["FLUSH", COLOR.flush],
      ["DROPPED", COLOR.crit],
    ];
    const y = h - 14;
    let x = 14;
    ctx.font = "8px ui-monospace, Menlo, monospace";
    ctx.textAlign = "left";
    for (const [name, col] of items) {
      ctx.fillStyle = col;
      ctx.fillRect(x, y - 5, 5, 5);
      ctx.fillStyle = COLOR.inkDim;
      ctx.fillText(name, x + 9, y);
      x += 22 + name.length * 5.4;
    }
  }

  // ── tiny canvas helpers ───────────────────────────────────────────────────────
  function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  function diamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fill();
  }
  function corner(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, sx: number, sy: number) {
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + t * sx, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + t * sy);
    ctx.stroke();
  }
  function label(ctx: CanvasRenderingContext2D, x: number, y: number, tier: string, kind: string) {
    ctx.font = "8px ui-monospace, Menlo, monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = COLOR.inkGhost;
    ctx.fillText(tier, x, y);
    ctx.fillStyle = COLOR.inkFaint;
    ctx.fillText(kind, x + 42, y);
  }
  function title(ctx: CanvasRenderingContext2D, x: number, y: number, text: string) {
    ctx.font = "600 16px ui-monospace, Menlo, monospace";
    ctx.fillStyle = COLOR.ink;
    ctx.textAlign = "left";
    ctx.fillText(text, x, y);
  }
  function stat(ctx: CanvasRenderingContext2D, x: number, y: number, k: string, v: string, col: string = COLOR.ink) {
    ctx.font = "8px ui-monospace, Menlo, monospace";
    ctx.fillStyle = COLOR.inkFaint;
    ctx.textAlign = "left";
    ctx.fillText(k, x, y);
    ctx.font = "12px ui-monospace, Menlo, monospace";
    ctx.fillStyle = col;
    ctx.fillText(v, x, y + 13);
  }
  function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number) {
    const words = text.split(" ");
    let lineStr = "";
    let yy = y;
    for (const wword of words) {
      const test = lineStr ? lineStr + " " + wword : wword;
      if (ctx.measureText(test).width > maxW && lineStr) {
        ctx.fillText(lineStr, x, yy);
        lineStr = wword;
        yy += lh;
      } else {
        lineStr = test;
      }
    }
    ctx.fillText(lineStr, x, yy);
  }

  return <canvas ref={canvasRef} className="block h-full w-full" />;
});

const STATUS_KNEE = 0.7;
const STATUS_CRIT = 0.92;

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function fmtRate(n: number) {
  if (n >= 10000) return (n / 1000).toFixed(1) + "K/s";
  if (n >= 1000) return (n / 1000).toFixed(2) + "K/s";
  return Math.round(n) + "/s";
}
function fmtMs(ms: number) {
  if (ms >= 1000) return (ms / 1000).toFixed(2) + "s";
  if (ms < 1) return (ms * 1000).toFixed(0) + "µs";
  return ms.toFixed(1) + "ms";
}
