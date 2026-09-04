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
 * kind from another. Like the ships, every unit takes one highlight line on
 * the port (-y) edge and one shade band on the starboard (+y) flank, and casts
 * a short shadow to starboard so it sits on the spine instead of floating over
 * it. See ART_DIRECTION.md for the rules these drawings follow.
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
  shade: "rgba(12,14,12,.26)",
  frost: "rgba(222,242,240,.42)",
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

function stencil(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, color = PAINT.bone) {
  ctx.fillStyle = color;
  ctx.font = `700 ${px}px ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

/** One highlight on the sunlit port edge, one shade band on the starboard flank. */
function lighting(ctx: CanvasRenderingContext2D, x0: number, x1: number, highlight: string, top = -9.6, bottom = 7.4) {
  ctx.strokeStyle = highlight;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(x0, top);
  ctx.lineTo(x1, top);
  ctx.stroke();
  ctx.fillStyle = CRATE.shade;
  ctx.fillRect(x0, bottom, x1 - x0, 10.2 - bottom);
}

/** The shadow a unit throws onto whatever carries it. Drawn first. */
function castShadow(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "rgba(0,0,0,.34)";
  ctx.beginPath();
  ctx.roundRect(-14.4, -9.6, 30.4, 22.6, 1.8);
  ctx.fill();
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

/** Conspicuity tape along the bottom edge, alternating amber / oxide. */
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

/**
 * Wear. Rust starts at the corners and seams where water sat, then spreads;
 * a damaged unit also carries a scorch smear and a dent in the roof.
 */
function wear(ctx: CanvasRenderingContext2D, condition: number) {
  if (condition >= 0.95) return;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(-15, -11, 30, 22, 1.5);
  ctx.clip();
  const spots = Math.round((1 - condition) * 14);
  for (let i = 0; i < spots; i += 1) {
    // the first blooms hug the edges; later ones wander into the middle
    const edge = i < 6;
    const x = edge ? (i % 2 === 0 ? -13 + (i * 2.3) % 6 : 12.5 - (i * 3.1) % 7) : -11 + ((i * 9.7) % 22);
    const y = edge ? (i % 3 === 0 ? -9.5 + (i * 1.7) % 4 : 6 + (i * 1.3) % 4) : -8 + ((i * 6.3) % 16);
    const r = 0.8 + (i % 3) * 0.5;
    ctx.globalAlpha = 0.72;
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
  if (condition < 0.82) {
    // a streak of rust running back from a corner casting
    ctx.strokeStyle = "rgba(138,90,58,.5)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-12, -8.5);
    ctx.lineTo(-5, -7.5);
    ctx.stroke();
  }
  if (condition < 0.72) {
    ctx.fillStyle = "rgba(0,0,0,.32)";
    ctx.beginPath();
    ctx.ellipse(4, -2, 6, 2.6, -0.25, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.45)";
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
/** Standard dry box: corrugated roof, doors forward, label stripe aft. */
function drawCrate(ctx: CanvasRenderingContext2D, short: string, accent: string) {
  ctx.beginPath();
  ctx.roundRect(-15, -11, 30, 22, 1.5);
  body(ctx, CRATE.sage);
  // corrugation: a dark trough and a lit crest, repeating across the roof
  for (let x = -9; x <= 9; x += 3) {
    ctx.fillStyle = CRATE.sageDeep;
    ctx.fillRect(x - 0.5, -9.6, 1.2, 19.2);
    ctx.fillStyle = "rgba(125,138,120,.5)";
    ctx.fillRect(x + 0.9, -9.6, 0.7, 19.2);
  }
  lighting(ctx, -13, 13, CRATE.sageLight);
  corners(ctx);
  // label stripe at the rear, with its own seam
  ctx.fillStyle = accent;
  ctx.fillRect(-12.5, -11, 4, 22);
  ctx.fillStyle = "rgba(0,0,0,.22)";
  ctx.fillRect(-12.5, 7.4, 4, 3.6);
  seam(ctx, -8.5, -11, 11);
  // roof hatch
  ctx.beginPath();
  ctx.arc(-3.5, -4.6, 1.7, 0, TAU);
  body(ctx, CRATE.sageDeep, 0.6);
  // door end: seam, two lock rods, hinge pins
  seam(ctx, 13.3, -9, 9);
  ctx.fillStyle = CRATE.steelHi;
  ctx.fillRect(12.2, -6, 1.2, 2.5);
  ctx.fillRect(12.2, 3.5, 1.2, 2.5);
  ctx.fillStyle = PAINT.outline;
  ctx.fillRect(12, -1.6, 2.4, 0.8);
  ctx.fillRect(12, 0.8, 2.4, 0.8);
  // stencil on a painted-out panel so it reads over the corrugation
  ctx.fillStyle = CRATE.sage;
  ctx.fillRect(-3.5, -3.2, 12.5, 6.4);
  stencil(ctx, short, 2.7, 0, 5.5);
  ctx.fillStyle = "rgba(231,223,205,.45)";
  ctx.fillRect(-2, 4.2, 10, 0.8);
}

/** Pressure cylinder strapped to a skid. */
function drawTank(ctx: CanvasRenderingContext2D, kind: CargoKind, short: string, color: string, accent: string) {
  // skid
  ctx.beginPath();
  ctx.roundRect(-15, -11, 30, 22, 1.5);
  body(ctx, CRATE.sageDeep);
  ctx.fillStyle = CRATE.sage;
  ctx.fillRect(-15, -1, 30, 2);
  ctx.fillStyle = CRATE.shade;
  ctx.fillRect(-15, 8, 30, 3);
  corners(ctx);
  // cylinder
  ctx.beginPath();
  ctx.roundRect(-13, -8, 26, 16, 8);
  body(ctx, CRATE.steel, 1);
  // a broad soft light along the port side, a hard shade along starboard
  ctx.fillStyle = "rgba(255,255,255,.09)";
  ctx.beginPath();
  ctx.roundRect(-11, -6.8, 22, 4.2, 2);
  ctx.fill();
  ctx.strokeStyle = CRATE.steelHi;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-9, -5.2);
  ctx.lineTo(9, -5.2);
  ctx.stroke();
  ctx.fillStyle = "rgba(12,14,12,.3)";
  ctx.beginPath();
  ctx.roundRect(-11, 3.2, 22, 4, 2);
  ctx.fill();
  ctx.strokeStyle = CRATE.steelDeep;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-9, 5.6);
  ctx.lineTo(9, 5.6);
  ctx.stroke();
  // end caps
  ctx.strokeStyle = PAINT.outline;
  ctx.lineWidth = 0.6;
  for (const x of [-13, 10.5]) {
    ctx.fillStyle = CRATE.steelDeep;
    ctx.fillRect(x, -8, 2.5, 16);
    ctx.strokeRect(x, -8, 2.5, 16);
  }
  // contents band between the straps
  ctx.fillStyle = color;
  ctx.fillRect(-2.5, -8, 5, 16);
  ctx.fillStyle = accent;
  ctx.fillRect(-0.5, -8, 1, 16);
  // two amber saddle straps holding the cylinder to the skid
  for (const x of [-7.5, 5.5]) {
    ctx.fillStyle = PAINT.amber;
    ctx.fillRect(x, -8.6, 2, 17.2);
    ctx.fillStyle = PAINT.outline;
    ctx.fillRect(x - 0.4, -9.4, 2.8, 1.4);
    ctx.fillRect(x - 0.4, 8, 2.8, 1.4);
  }
  // label chip and stencil
  ctx.fillStyle = accent;
  ctx.fillRect(-12.5, -11, 3, 3);
  stencil(ctx, short, 1.6, 0.3, 4.6);
  // valve on the front cap
  ctx.fillStyle = PAINT.outline;
  ctx.fillRect(11.5, -3, 3, 2);
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(13.6, -2, 0.7, 0, TAU);
  ctx.fill();
  if (kind === "cryo") {
    // frost blooming where the plumbing enters, and the teal power line
    ctx.fillStyle = CRATE.frost;
    for (const [x, y, r] of [[-10, -4, 2.4], [-9, 3.5, 1.9], [-11.5, 0, 1.4]] as const) {
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.6, 0, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(112,170,164,.6)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (const y of [-3, 0, 3]) {
      ctx.moveTo(-8, y);
      ctx.lineTo(-4, y);
    }
    ctx.stroke();
    ctx.strokeStyle = PAINT.teal;
    ctx.lineWidth = 1;
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
  lighting(ctx, -13, 13, CRATE.sageLight, -9.8, 8.6);
  corners(ctx);
  ctx.fillStyle = CRATE.well;
  ctx.fillRect(-12.5, -8.5, 25, 17);
  // dust in the well
  ctx.fillStyle = "rgba(101,94,84,.55)";
  for (let i = 0; i < 8; i += 1) {
    ctx.fillRect(-11 + ((i * 6.7) % 22), -7 + ((i * 4.9) % 14), 0.9, 0.9);
  }
  // the load: each lump gets a lit facet on its port side
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
    ctx.fillStyle = "rgba(255,255,255,.16)";
    ctx.beginPath();
    ctx.arc(x, y, r * 0.75, Math.PI * 0.95, Math.PI * 1.7);
    ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fill();
    if (i % 2 === 0) {
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(x - 0.7, y - 0.7, 0.6, 0, TAU);
      ctx.fill();
    }
  }
  // cage bars with their shadows on the load
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.fillRect(-12.5, -2.2, 25, 1);
  ctx.fillRect(-12.5, 3.2, 25, 1);
  ctx.fillRect(0.5, -8.5, 1, 17);
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
  ctx.fillRect(3, 7.2, 11, 3.8);
  stencil(ctx, short, 8.5, 9.2, 4);
}

/** Machine chained down on an open flatrack. */
function drawMachine(ctx: CanvasRenderingContext2D, short: string, accent: string) {
  // flatrack rails, a cross member and end posts
  ctx.strokeStyle = PAINT.outline;
  ctx.lineWidth = 0.8;
  ctx.fillStyle = CRATE.sage;
  for (const y of [-11, 9]) {
    ctx.fillRect(-15, y, 30, 2);
    ctx.strokeRect(-15, y, 30, 2);
  }
  ctx.fillStyle = CRATE.sageDeep;
  ctx.fillRect(-2, -9, 2, 18);
  for (const x of [-15, 12.5]) {
    ctx.fillRect(x, -11, 2.5, 22);
    ctx.strokeRect(x, -11, 2.5, 22);
  }
  ctx.fillStyle = CRATE.shade;
  ctx.fillRect(-15, 9.6, 30, 1.4);
  // machine body with a control box on the rear end
  ctx.beginPath();
  ctx.roundRect(-11, -7, 17, 14, 1.5);
  body(ctx, CRATE.steelDeep);
  ctx.fillStyle = "rgba(255,255,255,.08)";
  ctx.fillRect(-10.5, -6.4, 16, 2.2);
  ctx.fillStyle = "rgba(0,0,0,.3)";
  ctx.fillRect(-10.5, 4.4, 16, 2);
  seam(ctx, -4, -7, 7);
  ctx.fillStyle = CRATE.steelHi;
  for (const [x, y] of [[-9, -5], [-9, 5], [4, -5], [4, 5]] as const) {
    ctx.beginPath();
    ctx.arc(x, y, 0.5, 0, TAU);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.roundRect(-10, -3.4, 4.5, 6.8, 0.6);
  body(ctx, CRATE.sage, 0.6);
  ctx.fillStyle = PAINT.marker;
  ctx.fillRect(-8.6, -2.2, 1.4, 1.4);
  // hydraulic ram along the starboard side
  ctx.fillStyle = CRATE.steelHi;
  ctx.fillRect(-3, 4.8, 7, 1.6);
  ctx.fillStyle = PAINT.outline;
  ctx.fillRect(3.5, 4.4, 1.4, 2.4);
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
  stencil(ctx, short, -0.5, 0.3, 4.2);
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
  castShadow(ctx);

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

  tape(ctx, tapeSpan[0], tapeSpan[1]);
  wear(ctx, condition);
  statusLight(ctx, kind, lightAt[0], lightAt[1], condition, time);
  frontMarkers(ctx);
  ctx.restore();
}
