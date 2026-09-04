import { PAINT } from "./ships";

/**
 * Wake debris art lives here, separate from simulation code.
 *
 * Every chunk is drawn from the same steel-and-outline vocabulary as the
 * ships and cargo containers, with the vocabulary switched off: no label
 * stripe, no lit status lamp, no conspicuity tape, no corner castings.
 * Losing those cues is what tells a pilot "this is not freight" at a glance
 * — a jagged, unlit silhouette instead of a serviced one. Like the cargo
 * family, every chunk still takes one highlight edge on its torn flank and
 * one shade band on the other, so it reads as a solid object catching the
 * same light as everything else, not a flat sticker. See ART_DIRECTION.md.
 */

const TAU = Math.PI * 2;

const HULK = {
  plate: "#4c4a43",
  plateLight: "#6d6a5f",
  plateDeep: "#26241f",
  scorch: "rgba(10,9,7,.5)",
  rust: "#8a5a3a",
};

export type DebrisState = {
  /** Collision radius; also the drawn half-size. */
  r: number;
  /** Selects a silhouette: 0 shard, 1 spar, 2 drum. */
  variant: number;
};

/** A jagged broken hull plate, one corner sheared clean off. */
function drawShard(ctx: CanvasRenderingContext2D, r: number) {
  const outline: [number, number][] = [
    [-r, -r * 0.55], [-r * 0.3, -r], [r * 0.8, -r * 0.7],
    [r, r * 0.1], [r * 0.35, r], [-r * 0.7, r * 0.65], [-r * 0.95, r * 0.1],
  ];
  ctx.beginPath();
  outline.forEach(([x, y], index) => (index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = HULK.plate;
  ctx.fill();
  ctx.strokeStyle = PAINT.outline;
  ctx.lineWidth = Math.max(0.6, r * 0.07);
  ctx.stroke();
  // one lit bevel along the top tear
  ctx.strokeStyle = HULK.plateLight;
  ctx.lineWidth = Math.max(0.5, r * 0.055);
  ctx.beginPath();
  ctx.moveTo(-r, -r * 0.55);
  ctx.lineTo(-r * 0.3, -r);
  ctx.lineTo(r * 0.8, -r * 0.7);
  ctx.stroke();
  // shade band along the opposite flank
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = HULK.plateDeep;
  ctx.beginPath();
  ctx.moveTo(r * 0.35, r);
  ctx.lineTo(-r * 0.7, r * 0.65);
  ctx.lineTo(-r * 0.2, r * 0.15);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // a scorch mark and a rust bleed from the tear: this failed, it did not land
  ctx.fillStyle = HULK.scorch;
  ctx.beginPath();
  ctx.ellipse(r * 0.1, -r * 0.1, r * 0.32, r * 0.2, 0.4, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = HULK.rust;
  ctx.lineWidth = Math.max(0.4, r * 0.04);
  ctx.beginPath();
  ctx.moveTo(-r * 0.3, -r * 0.9);
  ctx.lineTo(-r * 0.1, -r * 0.2);
  ctx.stroke();
}

/** A snapped structural strut, capsule-bodied, jagged where it parted. */
function drawSpar(ctx: CanvasRenderingContext2D, r: number) {
  ctx.beginPath();
  ctx.roundRect(-r, -r * 0.34, r * 1.5, r * 0.68, r * 0.3);
  ctx.fillStyle = HULK.plate;
  ctx.fill();
  ctx.strokeStyle = PAINT.outline;
  ctx.lineWidth = Math.max(0.6, r * 0.07);
  ctx.stroke();
  ctx.strokeStyle = HULK.plateLight;
  ctx.lineWidth = Math.max(0.5, r * 0.05);
  ctx.beginPath();
  ctx.moveTo(-r * 0.9, -r * 0.3);
  ctx.lineTo(r * 0.4, -r * 0.3);
  ctx.stroke();
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = HULK.plateDeep;
  ctx.fillRect(-r * 0.9, r * 0.06, r * 1.3, r * 0.28);
  ctx.restore();
  // the torn end: a jagged bite where the rounded cap should be
  ctx.beginPath();
  ctx.moveTo(r * 0.5, -r * 0.34);
  ctx.lineTo(r * 0.72, -r * 0.12);
  ctx.lineTo(r * 0.5, r * 0.02);
  ctx.lineTo(r * 0.78, r * 0.2);
  ctx.lineTo(r * 0.5, r * 0.34);
  ctx.strokeStyle = PAINT.outline;
  ctx.lineWidth = Math.max(0.6, r * 0.06);
  ctx.stroke();
  // exposed conduit at the break
  ctx.strokeStyle = HULK.rust;
  ctx.lineWidth = Math.max(0.4, r * 0.035);
  ctx.beginPath();
  ctx.moveTo(r * 0.35, -r * 0.1);
  ctx.lineTo(r * 0.55, r * 0.06);
  ctx.stroke();
}

/** A dead relay's drum, a cracked dish still bolted to its stub mast. */
function drawDrum(ctx: CanvasRenderingContext2D, r: number) {
  ctx.beginPath();
  ctx.roundRect(-r * 0.55, -r * 0.85, r * 1.1, r * 1.7, r * 0.22);
  ctx.fillStyle = HULK.plate;
  ctx.fill();
  ctx.strokeStyle = PAINT.outline;
  ctx.lineWidth = Math.max(0.6, r * 0.07);
  ctx.stroke();
  ctx.strokeStyle = HULK.plateLight;
  ctx.lineWidth = Math.max(0.5, r * 0.05);
  ctx.beginPath();
  ctx.moveTo(-r * 0.5, -r * 0.8);
  ctx.lineTo(-r * 0.5, r * 0.8);
  ctx.stroke();
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = HULK.plateDeep;
  ctx.fillRect(r * 0.12, -r * 0.85, r * 0.43, r * 1.7);
  ctx.restore();
  // cracked dish, off-axis: nothing is listening any more
  ctx.save();
  ctx.translate(0, -r * 0.95);
  ctx.rotate(0.6);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.5, 0.2, TAU - 0.5);
  ctx.strokeStyle = HULK.plateLight;
  ctx.lineWidth = Math.max(0.6, r * 0.08);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-r * 0.1, -r * 0.15);
  ctx.lineTo(r * 0.15, r * 0.25);
  ctx.strokeStyle = PAINT.outline;
  ctx.lineWidth = Math.max(0.5, r * 0.05);
  ctx.stroke();
  ctx.restore();
  // the housing where a status light used to be, unlit
  ctx.fillStyle = HULK.plateDeep;
  ctx.beginPath();
  ctx.arc(0, r * 0.55, Math.max(0.6, r * 0.1), 0, TAU);
  ctx.fill();
  ctx.strokeStyle = PAINT.outline;
  ctx.lineWidth = Math.max(0.4, r * 0.035);
  ctx.stroke();
}

/**
 * Draws one chunk of Wake debris, centred on the origin and pre-rotated by
 * the caller. Three silhouettes cover the size range: a shard for the small
 * scares, a spar or a dead relay drum for the pieces big enough to matter.
 * Cheap on purpose — a handful of path operations, no loops — since a whole
 * field of these is repainted every frame.
 */
export function drawDebrisChunk(ctx: CanvasRenderingContext2D, state: DebrisState) {
  const { r, variant } = state;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (variant === 1) drawSpar(ctx, r);
  else if (variant === 2) drawDrum(ctx, r);
  else drawShard(ctx, r);
}
