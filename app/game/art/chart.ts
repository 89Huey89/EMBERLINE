import type { StarSystem, Vec2 } from "../types";

const TAU = Math.PI * 2;

/**
 * The navigation chart, drawn from the system record rather than authored.
 *
 * The chart used to be hand-placed CSS: one rule per body and one per port,
 * which meant a second system could not be charted without writing more CSS
 * for it. This draws whatever it is handed — lanes, worlds, ports, salvage
 * fields — at their live positions, so a system that exists in the data is a
 * system that charts itself.
 *
 * It is schematic, not scaled. Real lane radii run from a few hundred units
 * to tens of thousands, and a linear chart would crush everything inside the
 * outermost lane into the middle. Radii are compressed by RADIAL_GAMMA
 * instead, which keeps the ordering honest — inner is inner, outer is outer —
 * while leaving the inner system legible. Angles are never compressed, so
 * what the chart tells you about who is near whom is true.
 */

/** Radial compression. 1 would be true scale; below that opens up the inner system. */
const RADIAL_GAMMA = 0.62;
/** Screen radius of a port's own lane, as a fraction of its world's disc. */
const PORT_LANE = 2.4;
/** Smallest a world may be drawn, so the little ones stay clickable. */
const MIN_BODY_RADIUS = 5;

export type ChartTarget = {
  id: string;
  kind: "station" | "field";
  x: number;
  y: number;
  /** Click radius, generous enough for touch. */
  hit: number;
  label: string;
  sub: string;
};

export type ChartState = {
  time: number;
  /** Currently targeted port, drawn lit. */
  targetId: string;
  /** Live poses, supplied by the caller so the chart stays free of orbit code. */
  poseOf: (id: string) => Vec2 & { vx: number; vy: number };
};

/** The largest lane the chart has to fit, in world units. */
function systemExtent(system: StarSystem) {
  let extent = 1;
  for (const body of system.bodies) extent = Math.max(extent, Math.hypot(body.position.x, body.position.y) + body.radius);
  for (const field of system.fields) extent = Math.max(extent, Math.hypot(field.center.x, field.center.y) + field.radius);
  return extent;
}

/**
 * Draws the chart centred on (0,0) of the current transform, and returns
 * everything a pilot can click, in the same coordinates.
 */
export function drawChart(
  ctx: CanvasRenderingContext2D,
  system: StarSystem,
  radius: number,
  state: ChartState,
): ChartTarget[] {
  const extent = systemExtent(system);
  /** World radius to chart radius, compressed so the inner system stays open. */
  const scale = (worldRadius: number) => Math.pow(Math.min(1, worldRadius / extent), RADIAL_GAMMA) * radius;
  const place = (at: Vec2) => {
    const r = Math.hypot(at.x, at.y);
    if (r < 1) return { x: 0, y: 0 };
    const s = scale(r) / r;
    return { x: at.x * s, y: at.y * s };
  };

  const star = system.bodies.find((body) => body.star);
  const targets: ChartTarget[] = [];

  /* Lanes first, so everything else sits on top of them. */
  ctx.strokeStyle = "rgba(131,153,144,.28)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 7]);
  for (const body of system.bodies) {
    if (body.star) continue;
    ctx.beginPath();
    ctx.arc(0, 0, scale(Math.hypot(body.position.x, body.position.y)), 0, TAU);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  /* The star. Drawn as light rather than as a disc with an edge. */
  if (star) {
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 0.2);
    glow.addColorStop(0, "rgba(255,214,140,.85)");
    glow.addColorStop(0.35, "rgba(246,189,99,.35)");
    glow.addColorStop(1, "rgba(246,189,99,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#ffe9bf";
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(MIN_BODY_RADIUS, radius * 0.035), 0, TAU);
    ctx.fill();
    label(ctx, 0, radius * 0.075, star.name.toUpperCase(), star.kind, "#f0c46b", "center");
  }

  /* Worlds at their live positions, each with its ports around it. */
  for (const body of system.bodies) {
    if (body.star) continue;
    const at = place(state.poseOf(body.id));
    const drawn = Math.max(MIN_BODY_RADIUS, (body.radius / extent) * radius * 3.2);
    ctx.fillStyle = body.color;
    ctx.beginPath();
    ctx.arc(at.x, at.y, drawn, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(231,223,205,.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
    label(ctx, at.x, at.y + drawn + 12, body.name.toUpperCase(), body.kind, "#b9b1a0", "center");

    /* A port's own lane is far too small to scale honestly against a body
       lane, so it is drawn at a fixed multiple of its world's disc: the
       chart says which world a port belongs to, and the range readout below
       it says how far away it actually is. */
    const ports = system.stations.filter((station) => station.orbit.around === body.id);
    ports.forEach((station) => {
      const pose = state.poseOf(station.id);
      const world = state.poseOf(body.id);
      const bearing = Math.atan2(pose.y - world.y, pose.x - world.x);
      const lane = drawn * PORT_LANE;
      const x = at.x + Math.cos(bearing) * lane;
      const y = at.y + Math.sin(bearing) * lane;
      const lit = station.id === state.targetId;
      ctx.strokeStyle = lit ? "#dca952" : "rgba(220,169,82,.5)";
      ctx.fillStyle = lit ? "#dca952" : "transparent";
      ctx.lineWidth = 1.4;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.beginPath();
      ctx.rect(-4, -4, 8, 8);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      targets.push({ id: station.id, kind: "station", x, y, hit: 16, label: station.callSign, sub: station.name });
    });
  }

  /* Salvage fields: a dashed cloud wherever the field currently is. */
  for (const field of system.fields) {
    const at = place(state.poseOf(field.id));
    ctx.strokeStyle = "rgba(181,141,76,.45)";
    ctx.setLineDash([2, 5]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(at.x, at.y, 15, 9, -0.3, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    label(ctx, at.x, at.y + 20, field.name.toUpperCase(), "", "#9b8a6b", "center");
    targets.push({ id: field.id, kind: "field", x: at.x, y: at.y, hit: 18, label: field.name, sub: field.description });
  }

  return targets;
}

function label(ctx: CanvasRenderingContext2D, x: number, y: number, top: string, sub: string, color: string, align: CanvasTextAlign) {
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.font = "700 8px ui-monospace, monospace";
  ctx.fillText(top, x, y);
  if (!sub) return;
  ctx.fillStyle = "#6f7873";
  ctx.font = "7px ui-monospace, monospace";
  ctx.fillText(sub.toUpperCase(), x, y + 9);
}
