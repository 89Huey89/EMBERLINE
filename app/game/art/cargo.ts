import { CARGO } from "../data";
import type { CargoKind } from "../types";
import { PAINT } from "./ships";

/**
 * Cargo art lives here, separate from simulation code.
 *
 * Every unit is the same family of sage-green steel freight hardware seen from
 * above: the long axis runs along +x, the +x end is the front (doors, hazard
 * post, valve) and the -x end is the rear (label stripe, in the cargo's accent
 * colour). Shape, label stripe, stencil and visible contents are what tell one
 * kind from another. See ART_DIRECTION.md for the rules these drawings follow.
 */

const TAU = Math.PI * 2;

/* ------------------------------------------------------------------ */
/* Freight palette. Steel here is the pale hardware steel of tanks and  */
/* machines, warmer and lighter than the structural steel in PAINT.     */
/* ------------------------------------------------------------------ */
const CRATE = {
  sage: "#5c6b5a",
  sageLight: "#7d8a78",
  sageDeep: "#3f4a3e",
  steel: "#7a7e78",
  steelHi: "#a3a69e",
  steelDeep: "#4b4e49",
  well: "#2a2825",
  rust: "#8a5a3a",
};

export type CargoUnitState = {
  /** Uniform scale applied before drawing. */
  size: number;
  /** 0..1 physical condition; below 0.72 counts as damaged. */
  condition: number;
  /** Game clock in seconds, for blinking lights. */
  time: number;
};

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */
function body(ctx: CanvasRenderingContext2D, fill: string, width = 1.2) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = PAINT.outline;
  ctx.lineWidth = width;
  ctx.stroke();
}

function seam(ctx: CanvasRenderingContext2D, x: number, y0: number, y1: number, color = PAINT.outline, width = 0.6) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.lineTo(x, y1);
  ctx.stroke();
}

function stencil(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, px: number) {
  ctx.fillStyle = PAINT.bone;
  ctx.font = `700 ${px}px ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

/** Twist-lock corner castings, one at each corner of the 30 x 22 footprint. */
function corners(ctx: CanvasRenderingContext2D) {
  for (const [x, y] of [[-15, -11], [12, -11], [-15, 8], [12, 8]] as const) {
    ctx.fillStyle = PAINT.outline;
    ctx.fillRect(x, y, 3, 3);
    ctx.fillStyle = CRATE.steelHi;
    ctx.fillRect(x + 0.9, y + 0.9, 1.2, 1.2);
  }
}

/** Amber conspicuity tape along the bottom edge, alternating amber / oxide. */
function tape(ctx: CanvasRenderingContext2D, from: number, to: number) {
  let index = 0;
  for (let x = from; x < to; x += 2, index += 1) {
    ctx.fillStyle = index % 2 === 0 ? PAINT.amber : PAINT.oxide;
    ctx.fillRect(x, 9.2, Math.min(2, to - x), 1);
  }
}

/** Two amber clearance dots on the door end. */
function frontMarkers(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = PAINT.marker;
  for (const y of [-9.6, 9.6]) {
    ctx.beginPath();
    ctx.arc(13.6, y, 0.6, 0, TAU);
    ctx.fill();
  }
}

/**
 * The one status light every unit carries: amber when healthy, blinking red
 * when damaged, a slow teal pulse on cryogenic tanks.
 */
function statusLight(ctx: CanvasRenderingContext2D, kind: CargoKind, x: number, y: number, condition: number, time: number) {
  let color = PAINT.marker;
  let on = true;
  if (condition < 0.72) {
    color = PAINT.tail;
    on = Math.sin(time * 9) > 0;
  } else if (kind === "cryo") {
    color = PAINT.teal;
    on = Math.sin(time * 2.5) > -0.3;
  }
  if (on) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 2.4, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = on ? color : CRATE.steelDeep;
  ctx.beginPath();
  ctx.arc(x, y, 1, 0, TAU);
  ctx.fill();
}

/** Rust blooms and, on a wrecked unit, a dent in the roof. */
function wear(ctx: CanvasRenderingContext2D, condition: number) {
  if (condition >= 0.95) return;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(-15, -11, 30, 22, 1.5);
  ctx.clip();
  const spots = Math.round((1 - condition) * 12);
  for (let i = 0; i < spots; i += 1) {
    const x = -12 + ((i * 9.7) % 24);
    const y = -8 + ((i * 6.3) % 16);
    const r = 0.8 + (i % 3) * 0.5;
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = CRATE.rust;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = PAINT.oxideDeep;
    ctx.beginPath();
    ctx.arc(x + 0.4, y + 0.4, r * 0.5, 0, TAU);
    ctx.fill();
  }
  if (condition < 0.72) {
    ctx.strokeStyle = "rgba(0,0,0,.35)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(6, -4, 4, 2.6, 4.2);
    ctx.stroke();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Shapes                                                               */
/* ------------------------------------------------------------------ */
/** Standard dry box: ribbed roof, doors forward, label stripe aft. */
function drawCrate(ctx: CanvasRenderingContext2D, short: string, accent: string) {
  ctx.beginPath();
  ctx.roundRect(-15, -11, 30, 22, 1.5);
  body(ctx, CRATE.sage);
  // roof ribs, then the sunlit edge highlight
  ctx.strokeStyle = CRATE.sageDeep;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let x = -9; x <= 9; x += 3) {
    ctx.moveTo(x, -9.5);
    ctx.lineTo(x, 9.5);
  }
  ctx.stroke();
  ctx.strokeStyle = CRATE.sageLight;
  ctx.beginPath();
  ctx.moveTo(-13, -9.6);
  ctx.lineTo(13, -9.6);
  ctx.stroke();
  corners(ctx);
  // label stripe at the rear
  ctx.fillStyle = accent;
  ctx.fillRect(-12.5, -11, 4, 22);
  seam(ctx, -8.5, -11, 11);
  // door end: seam plus two lock rods
  seam(ctx, 13.3, -9, 9);
  ctx.fillStyle = CRATE.steelHi;
  ctx.fillRect(12.2, -6, 1.2, 2.5);
  ctx.fillRect(12.2, 3.5, 1.2, 2.5);
  stencil(ctx, short, 1.5, 0, 5.5);
  ctx.fillStyle = "rgba(231,223,205,.45)";
  ctx.fillRect(-4, 3.8, 11, 0.8);
}

/** Pressure cylinder strapped to a skid. */
function drawTank(ctx: CanvasRenderingContext2D, kind: CargoKind, short: string, color: string, accent: string) {
  // skid
  ctx.beginPath();
  ctx.roundRect(-15, -11, 30, 22, 1.5);
  body(ctx, CRATE.sageDeep);
  ctx.fillStyle = CRATE.sage;
  ctx.fillRect(-15, -1, 30, 2);
  corners(ctx);
  // cylinder
  ctx.beginPath();
  ctx.roundRect(-13, -8, 26, 16, 8);
  body(ctx, CRATE.steel, 1);
  ctx.strokeStyle = CRATE.steelHi;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-9, -5.2);
  ctx.lineTo(9, -5.2);
  ctx.stroke();
  ctx.strokeStyle = CRATE.steelDeep;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-9, 5.2);
  ctx.lineTo(9, 5.2);
  ctx.stroke();
  // end caps
  ctx.strokeStyle = PAINT.outline;
  ctx.lineWidth = 0.6;
  for (const x of [-13, 10.5]) {
    ctx.fillStyle = CRATE.steelDeep;
    ctx.fillRect(x, -8, 2.5, 16);
    ctx.strokeRect(x, -8, 2.5, 16);
  }
  // contents band
  ctx.fillStyle = color;
  ctx.fillRect(-2.5, -8, 5, 16);
  ctx.fillStyle = accent;
  ctx.fillRect(-0.5, -8, 1, 16);
  // label chip and stencil
  ctx.fillStyle = accent;
  ctx.fillRect(-12.5, -11, 3, 3);
  stencil(ctx, short, 5.5, 0.4, 5);
  // valve on the front cap
  ctx.fillStyle = PAINT.outline;
  ctx.fillRect(11.5, -3, 3, 2);
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(13.6, -2, 0.7, 0, TAU);
  ctx.fill();
  if (kind === "cryo") {
    ctx.strokeStyle = "rgba(112,170,164,.5)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (const y of [-3, 0, 3]) {
      ctx.moveTo(-8, y);
      ctx.lineTo(-4, y);
    }
    ctx.stroke();
    ctx.strokeStyle = PAINT.teal;
    ctx.beginPath();
    ctx.moveTo(-12, -8);
    ctx.lineTo(-12, -11);
    ctx.stroke();
  }
}

/** Open-topped ore bin with a cage over the load. */
function drawOre(ctx: CanvasRenderingContext2D, short: string, color: string, accent: string) {
  ctx.beginPath();
  ctx.roundRect(-15, -11, 30, 22, 1.5);
  body(ctx, CRATE.sage);
  corners(ctx);
  ctx.fillStyle = CRATE.well;
  ctx.fillRect(-12.5, -8.5, 25, 17);
  // the load
  for (let i = 0; i < 9; i += 1) {
    const x = -10 + ((i * 7.3) % 21);
    const y = -5.5 + ((i * 5.1) % 11);
    const r = 2.2 + (i % 3) * 0.9;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = i % 4 === 3 ? CRATE.rust : color;
    ctx.fill();
    ctx.strokeStyle = PAINT.outline;
    ctx.lineWidth = 0.5;
    ctx.stroke();
    if (i % 2 === 0) {
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(x - 0.7, y - 0.7, 0.6, 0, TAU);
      ctx.fill();
    }
  }
  // cage bars
  ctx.fillStyle = CRATE.sageLight;
  ctx.fillRect(-12.5, -3.2, 25, 1);
  ctx.fillRect(-12.5, 2.2, 25, 1);
  ctx.fillRect(-0.5, -8.5, 1, 17);
  // label stripe at the rear
  ctx.fillStyle = accent;
  ctx.fillRect(-15, -11, 3, 22);
  seam(ctx, -12, -11, 11);
  // stencil plate on the front deck
  ctx.fillStyle = CRATE.sageDeep;
  ctx.fillRect(3, 7.5, 11, 3.5);
  stencil(ctx, short, 8.5, 9.3, 4);
}

/** Machine chained down on an open flatrack. */
function drawMachine(ctx: CanvasRenderingContext2D, short: string, accent: string) {
  // flatrack rails and end posts
  ctx.strokeStyle = PAINT.outline;
  ctx.lineWidth = 0.8;
  ctx.fillStyle = CRATE.sage;
  for (const y of [-11, 9]) {
    ctx.fillRect(-15, y, 30, 2);
    ctx.strokeRect(-15, y, 30, 2);
  }
  ctx.fillStyle = CRATE.sageDeep;
  for (const x of [-15, 12.5]) {
    ctx.fillRect(x, -11, 2.5, 22);
    ctx.strokeRect(x, -11, 2.5, 22);
  }
  // machine body
  ctx.beginPath();
  ctx.roundRect(-11, -7, 17, 14, 1.5);
  body(ctx, CRATE.steelDeep);
  seam(ctx, -4, -7, 7);
  ctx.fillStyle = CRATE.steelHi;
  for (const [x, y] of [[-9, -5], [-9, 5], [4, -5], [4, 5]] as const) {
    ctx.beginPath();
    ctx.arc(x, y, 0.5, 0, TAU);
    ctx.fill();
  }
  // flywheel
  ctx.beginPath();
  ctx.arc(8.5, 0, 7.5, 0, TAU);
  body(ctx, CRATE.well, 1);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(8.5, 0, 4.8, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = CRATE.steelHi;
  ctx.beginPath();
  ctx.arc(8.5, 0, 1.6, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = PAINT.outline;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let i = 0; i < 4; i += 1) {
    const a = (i * TAU) / 4;
    ctx.moveTo(8.5 + Math.cos(a) * 1.6, Math.sin(a) * 1.6);
    ctx.lineTo(8.5 + Math.cos(a) * 4.5, Math.sin(a) * 4.5);
  }
  ctx.stroke();
  // guard over the sunlit quarter of the wheel
  ctx.strokeStyle = PAINT.oxide;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(8.5, 0, 7.5, -1.9, -0.3);
  ctx.stroke();
  // tie-down chains
  ctx.strokeStyle = PAINT.amber;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [x0, y0, x1, y1] of [
    [-13, -9, -8, -7],
    [-13, 9, -8, 7],
    [14, -9, 10, -7.5],
    [14, 9, 10, 7.5],
  ] as const) {
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
  }
  ctx.stroke();
  stencil(ctx, short, -2.5, 0.3, 4.5);
  // label stripe on the rear post
  ctx.fillStyle = accent;
  ctx.fillRect(-15, -11, 2.5, 22);
  // hazard ticks down the front post
  ctx.save();
  ctx.beginPath();
  ctx.rect(12.5, -11, 2.5, 22);
  ctx.clip();
  for (let i = 0; i < 8; i += 1) {
    ctx.fillStyle = i % 2 === 0 ? PAINT.amber : PAINT.outline;
    ctx.fillRect(12.5, -11 + i * 3, 2.5, 3);
  }
  ctx.restore();
}

/**
 * Draws one cargo unit centred on the origin in a 30 x 22 box (before `size`).
 * The long axis runs along +x so units lie lengthwise on a ship's spine.
 */
export function drawCargoUnit(ctx: CanvasRenderingContext2D, kind: CargoKind, state: CargoUnitState) {
  const { size, condition, time } = state;
  const cargo = CARGO[kind];
  ctx.save();
  ctx.scale(size, size);
  ctx.lineJoin = "round";

  let lightAt: readonly [number, number];
  let tapeSpan: readonly [number, number];
  if (cargo.shape === "tank") {
    drawTank(ctx, kind, cargo.short, cargo.color, cargo.accent);
    lightAt = [10.2, -9.4];
    tapeSpan = [-7, 11];
  } else if (cargo.shape === "ore") {
    drawOre(ctx, cargo.short, cargo.color, cargo.accent);
    lightAt = [13.3, -9.3];
    tapeSpan = [-9, 1];
  } else if (cargo.shape === "machine") {
    drawMachine(ctx, cargo.short, cargo.accent);
    lightAt = [10.5, -10];
    tapeSpan = [-9, 9];
  } else {
    drawCrate(ctx, cargo.short, cargo.accent);
    lightAt = [10.2, -8.6];
    tapeSpan = [-7, 11];
  }

  wear(ctx, condition);
  tape(ctx, tapeSpan[0], tapeSpan[1]);
  statusLight(ctx, kind, lightAt[0], lightAt[1], condition, time);
  frontMarkers(ctx);
  ctx.restore();
}
