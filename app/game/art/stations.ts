import type { Station } from "../types";
import { PAINT } from "./ships";

/**
 * Station art lives here, separate from simulation code.
 *
 * A station is scaffold: a long main boom, a hub of tanks and a dome,
 * lattice masts, a solar array, radiators, and warm work lights. The
 * berth — a lit rectangular pad on a short arm off the -x end — is the
 * most readable thing on it, and is deliberately drawn UNSCALED so the
 * pad always matches the simulation's fixed docking capture radius.
 *
 * Station-local space: +x runs along the boom, +y is starboard, and the
 * caller's rotation is `station.orientation`. See ART_DIRECTION.md.
 */

const TAU = Math.PI * 2;

/** The simulation's docking capture radius, in world units. */
export const BERTH_CAPTURE = 105;

export type StationArtState = {
  time: number;
  /** Camera zoom; keeps the capture envelope a hairline at any zoom. */
  zoom: number;
  /** True for the station the pilot has targeted. */
  target: boolean;
  /** Ship speed, m/s. Drives the target ring's approach colour. */
  shipSpeed: number;
  /** Ship distance to this station, world units. */
  shipDistance: number;
};

/**
 * A point `distance` out from the hub along the berth arm, in world
 * space: station-local (-distance, 0) rotated by the station's
 * orientation. The pad is centred on `berthPoint(station, 100)`.
 */
export function berthPoint(station: Station, distance: number) {
  return {
    x: station.position.x - Math.cos(station.orientation) * distance,
    y: station.position.y - Math.sin(station.orientation) * distance,
  };
}

export function stationScale(station: Station) {
  return station.size === "large" ? 1.22 : station.size === "small" ? 0.76 : 1;
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */
function outlined(ctx: CanvasRenderingContext2D, fill: string, width = 1.2) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = PAINT.outline;
  ctx.lineWidth = width;
  ctx.stroke();
}

/** A work light: a dot with a soft glow of the same colour. Off lights stay as dark fixtures. */
function light(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, r = 1, on = true) {
  if (!on) {
    ctx.fillStyle = PAINT.steelDeep;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    return;
  }
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.4, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

/** Two rails with cross bracing, drawn along x from `from` to `to`. */
function truss(
  ctx: CanvasRenderingContext2D,
  from: number,
  to: number,
  halfWidth: number,
  step: number,
  outlineWidth: number,
  railWidth: number,
) {
  ctx.strokeStyle = PAINT.steelLight;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  for (let x = from; x < to - 0.001; x += step) {
    const end = Math.min(x + step, to);
    ctx.moveTo(x, -halfWidth); ctx.lineTo(end, halfWidth);
    ctx.moveTo(x, halfWidth); ctx.lineTo(end, -halfWidth);
  }
  ctx.stroke();
  ctx.strokeStyle = PAINT.outline;
  ctx.lineWidth = outlineWidth;
  ctx.beginPath();
  ctx.moveTo(from, -halfWidth); ctx.lineTo(to, -halfWidth);
  ctx.moveTo(from, halfWidth); ctx.lineTo(to, halfWidth);
  ctx.stroke();
  ctx.strokeStyle = PAINT.steel;
  ctx.lineWidth = railWidth;
  ctx.stroke();
}

/** A lattice mast standing off the boom, from (x, y0) to (x, y1). */
function mast(ctx: CanvasRenderingContext2D, x: number, y0: number, y1: number) {
  const step = y1 > y0 ? 6 : -6;
  ctx.strokeStyle = PAINT.steelLight;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  for (let y = y0; step > 0 ? y < y1 : y > y1; y += step) {
    const end = step > 0 ? Math.min(y + step, y1) : Math.max(y + step, y1);
    ctx.moveTo(x - 2, y); ctx.lineTo(x + 2, end);
    ctx.moveTo(x + 2, y); ctx.lineTo(x - 2, end);
  }
  ctx.stroke();
  ctx.strokeStyle = PAINT.outline;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 2, y0); ctx.lineTo(x - 2, y1);
  ctx.moveTo(x + 2, y0); ctx.lineTo(x + 2, y1);
  ctx.stroke();
  ctx.strokeStyle = PAINT.steelLight;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/* ------------------------------------------------------------------ */
/* Body — scaled by station size                                        */
/* ------------------------------------------------------------------ */
function drawBody(ctx: CanvasRenderingContext2D, station: Station, time: number, work: string) {
  /* 1. main boom */
  truss(ctx, -40, 150, 4, 10, 3, 1.6);

  /* 2. module block */
  ctx.beginPath();
  ctx.roundRect(-32, -12, 22, 24, 3);
  outlined(ctx, PAINT.steelDeep, 1.2);
  ctx.fillStyle = station.color;
  for (const y of [-6, 4]) {
    for (const x of [-28, -23, -18]) {
      if (x === -23 && y === 4) continue; // one dark porthole: somebody lives here
      ctx.fillRect(x, y, 2, 1.5);
    }
  }

  /* 3. dome */
  ctx.beginPath();
  ctx.arc(0, 0, 22, 0, TAU);
  outlined(ctx, PAINT.steel, 1.4);
  ctx.strokeStyle = PAINT.steelLight;
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.arc(0, 0, 16, 0, TAU); ctx.stroke();
  ctx.strokeStyle = "rgba(231,223,205,.35)";
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0, 0, 19, 3.4, 4.6); ctx.stroke();
  [0.6, 2.2, 3.9, 5.4].forEach((angle, index) => {
    const on = Math.sin(time * 1.3 + index) > -0.6;
    ctx.fillStyle = on ? station.color : PAINT.steelDeep;
    ctx.beginPath();
    ctx.arc(Math.cos(angle) * 12, Math.sin(angle) * 12, 1.1, 0, TAU);
    ctx.fill();
  });

  /* 4. tanks */
  for (const [x, y, r] of [[30, -14, 11], [32, 14, 9]] as const) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
    outlined(ctx, "#4a4842", 1.2);
    ctx.fillStyle = PAINT.steelDeep;
    ctx.beginPath(); ctx.arc(x, y, 5, 0, TAU); ctx.fill();
    ctx.strokeStyle = station.color;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r, 3.3, 4.9); ctx.stroke();
  }

  /* 5. radiators */
  for (const y of [-30, 23]) {
    ctx.beginPath();
    ctx.roundRect(62, y, 34, 7, 1);
    outlined(ctx, "#5b2f26", 0.9);
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = "rgba(0,0,0,.35)";
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let x = 62; x <= 96; x += 3) { ctx.moveTo(x, y); ctx.lineTo(x, y + 7); }
    ctx.stroke();
    ctx.restore();
  }
  ctx.strokeStyle = "rgba(255,120,70,.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(62, -30); ctx.lineTo(96, -30);
  ctx.moveTo(62, 30); ctx.lineTo(96, 30);
  ctx.stroke();

  /* 6. solar array */
  ctx.strokeStyle = PAINT.steel;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(140, -8); ctx.lineTo(140, 8); ctx.stroke();
  for (const y of [-34, 8]) {
    ctx.beginPath();
    ctx.roundRect(118, y, 44, 26, 1);
    outlined(ctx, "#23313a", 1);
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = "rgba(140,170,180,.25)";
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let x = 118; x <= 162; x += 8) { ctx.moveTo(x, y); ctx.lineTo(x, y + 26); }
    for (let gy = y; gy <= y + 26; gy += 6.5) { ctx.moveTo(118, gy); ctx.lineTo(162, gy); }
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = "rgba(231,223,205,.3)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(118, y); ctx.lineTo(162, y); ctx.stroke();
  }

  /* 7. masts, beacon and dish */
  mast(ctx, 10, -22, -70);
  light(ctx, 10, -72, PAINT.tail, 1.4, Math.sin(time * 4) > 0);
  ctx.strokeStyle = "rgba(231,223,205,.8)";
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(6, -64, 5, 0.6, 2.8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(6, -64); ctx.lineTo(6, -59); ctx.stroke();
  mast(ctx, 20, 22, 52);
  light(ctx, 20, 54, work, 1.2);

  /* 8. work lights along the boom */
  let side = -1;
  for (let x = -30; x <= 130; x += 20) {
    light(ctx, x, side * 5.5, work, 1);
    side = -side;
  }

  /* 9. large stations carry a habitat ring */
  if (station.size === "large") {
    ctx.strokeStyle = "#5b5549";
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(0, 0, 48, 0, TAU); ctx.stroke();
    ctx.strokeStyle = station.color;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, 54, 0, TAU); ctx.stroke();
  }
}

/* ------------------------------------------------------------------ */
/* Berth arm and pad — unscaled, so the pad matches the capture radius  */
/* ------------------------------------------------------------------ */
function drawBerth(ctx: CanvasRenderingContext2D, scale: number, time: number, work: string, cold: boolean) {
  const lane = cold ? "rgba(112,170,164,.15)" : "rgba(242,181,68,.15)";
  const flood = cold ? "rgba(112,170,164,.06)" : "rgba(242,181,68,.06)";

  /* 14. floodlight cones wash the bay from the gantry */
  ctx.fillStyle = flood;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-62, s * 6);
    ctx.lineTo(-158, s * 24);
    ctx.lineTo(-158, s * 6);
    ctx.closePath();
    ctx.fill();
  }

  /* 10. arm and gantry */
  truss(ctx, -62, -40 * scale, 2.5, 8, 2, 1);
  ctx.beginPath();
  ctx.rect(-66, -8, 6, 16);
  outlined(ctx, PAINT.steelDeep, 0.8);

  /* 11. pad: long enough to hold a whole truck, cab to bell */
  ctx.beginPath();
  ctx.roundRect(-158, -24, 92, 48, 3);
  ctx.fillStyle = "rgba(231,223,205,.06)";
  ctx.fill();
  ctx.strokeStyle = "rgba(231,223,205,.85)";
  ctx.lineWidth = 1.6;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(231,223,205,.6)";
  ctx.fillRect(-154, -12, 3, 24);
  ctx.fillRect(-72, -12, 3, 24);
  ctx.fillStyle = "rgba(231,223,205,.35)";
  ctx.fillRect(-154, -1, 85, 2);

  /* 12. pad edge lights, chasing around the bay */
  const edge: [number, number][] = [
    [-158, -24], [-112, -24], [-66, -24], [-66, 24], [-112, 24], [-158, 24],
  ];
  edge.forEach(([x, y], index) => {
    const on = (Math.floor(time * 4) + index) % 6 < 3;
    light(ctx, x, y, work, 1.2, on);
  });

  /* 13. approach lane */
  ctx.strokeStyle = lane;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 6]);
  ctx.beginPath(); ctx.moveTo(-218, 0); ctx.lineTo(-158, 0); ctx.stroke();
  ctx.setLineDash([]);
  [-168, -180, -192, -204, -216].forEach((x, index) => {
    const on = ((Math.floor(time * 5) - index) % 5 + 5) % 5 === 0;
    light(ctx, x, 0, work, 1, on);
  });
}

/* ------------------------------------------------------------------ */
/* Entry point                                                          */
/* ------------------------------------------------------------------ */
export function drawStation(ctx: CanvasRenderingContext2D, station: Station, state: StationArtState) {
  const { time, zoom, target, shipSpeed, shipDistance } = state;
  const scale = stationScale(station);
  const cold = station.id === "bluehour" || station.id === "quiet";
  const work = cold ? PAINT.teal : PAINT.marker;

  ctx.save();
  ctx.translate(station.position.x, station.position.y);
  ctx.rotate(station.orientation);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  ctx.save();
  ctx.scale(scale, scale);
  drawBody(ctx, station, time, work);
  ctx.restore();

  drawBerth(ctx, scale, time, work, cold);
  ctx.restore();

  /* Capture envelope, in world space: what the docking clamp can reach. */
  ctx.beginPath();
  ctx.arc(station.position.x, station.position.y, BERTH_CAPTURE, 0, TAU);
  if (target) {
    const fast = shipSpeed > 36;
    const inside = shipDistance < BERTH_CAPTURE;
    ctx.strokeStyle = fast ? PAINT.tail : inside ? PAINT.teal : PAINT.amber;
    ctx.globalAlpha = fast ? 0.55 : inside ? 0.8 + Math.sin(time * 4) * 0.2 : 0.45;
    ctx.lineWidth = 1.4 / zoom;
    ctx.setLineDash([8 / zoom, 6 / zoom]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  } else {
    ctx.strokeStyle = "rgba(231,223,205,.08)";
    ctx.lineWidth = 1 / zoom;
    ctx.stroke();
  }
}
