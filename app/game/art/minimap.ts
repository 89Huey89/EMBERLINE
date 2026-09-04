import type { StarSystem, Vec2 } from "../types";
import { bodyPose, fieldPose, gatePose, stationPose } from "../orbits";
import { GRAVITY_REACH } from "../flight";
import { SURFACE_CONTACT } from "./planets";
import { CORONA_REACH } from "./star";

const TAU = Math.PI * 2;

/**
 * The scope: a small round plate of local space, always on, ship at the
 * centre and north up.
 *
 * It is not the navigation chart. The chart is schematic, compresses its
 * radii and exists to choose a destination; the scope is an instrument and
 * is honest about scale, because the only thing it is for is seeing what is
 * near enough to hit. It draws whatever the system record holds — worlds
 * with their decks, ports, gates, a debris field's actual chunks — plus the
 * one thing that is not in the record: the track the ship is on, and where
 * that track ends if it ends against something.
 *
 * Unlike `chart.ts` this reads `orbits.ts` directly. The chart is also a
 * portrait, drawn in menus from a supplied pose; the scope only ever runs in
 * flight, where the live pose of everything is exactly what it is for.
 */

/** The ranges the scope steps through, in world units from the ship to the rim. */
export const MINIMAP_RANGES = [1200, 2400, 4800, 9600, 19200];

const BONE = "#e7dfcd";
const AMBER = "#dca952";
const TEAL = "#70aaa4";
/** Oxide, lifted a stop so a contact marker reads against a rust-coloured world underneath it. */
const ALARM = "#ff8a63";

export type MinimapState = {
  time: number;
  ship: { x: number; y: number; angle: number };
  /** World units from the centre of the plate to its rim. */
  range: number;
  /** The port the beacon is set to, drawn lit and chased to the rim when it is off-scope. */
  targetId: string;
  /** The projected track, in world coordinates. Empty while berthed. */
  track: Vec2[];
  /** Where the track ends against something solid, if it does. */
  impact: Vec2 | null;
  /** True once the contact can no longer be flown out of. */
  critical: boolean;
  /** Chunks in their field's frame, the shape the flight view holds them in. */
  debris: { fieldId: string; x: number; y: number; r: number; discovered: boolean }[];
  pickups: { x: number; y: number; discovered: boolean; source: string }[];
};

/** Draws the scope filling a square of `size` CSS pixels, top-left at the current origin. */
export function drawMinimap(ctx: CanvasRenderingContext2D, system: StarSystem, size: number, state: MinimapState) {
  const centre = size / 2;
  const radius = centre - 1;
  const scale = radius / state.range;
  const to = (at: Vec2) => ({ x: centre + (at.x - state.ship.x) * scale, y: centre + (at.y - state.ship.y) * scale });
  /* Generous, because a disc whose centre is off-plate still shows an edge. */
  const onPlate = (at: Vec2, margin = 0) => Math.hypot(at.x - centre, at.y - centre) <= radius + margin;

  ctx.save();
  ctx.beginPath();
  ctx.arc(centre, centre, radius, 0, TAU);
  ctx.clip();

  ctx.fillStyle = "rgba(6,9,10,.86)";
  ctx.fillRect(0, 0, size, size);

  /* Range rings at a third and two thirds, so a glance reads distance. */
  ctx.strokeStyle = "rgba(231,223,205,.09)";
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  for (const fraction of [1 / 3, 2 / 3]) {
    ctx.beginPath();
    ctx.arc(centre, centre, radius * fraction, 0, TAU);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  /* Worlds: the deck at the radius the hull actually stops at, the well's
     edge around it. Both are simulation, not painting — the scope shows
     where a ship gets caught, not where the art puts the terminator. */
  for (const body of system.bodies) {
    const at = to(bodyPose(system, body, state.time));
    const deck = body.radius * (body.star ? CORONA_REACH : SURFACE_CONTACT) * scale;
    const well = body.radius * GRAVITY_REACH * scale;
    if (!onPlate(at, well)) continue;
    if (well > 4) {
      ctx.strokeStyle = "rgba(125,144,137,.16)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(at.x, at.y, well, 0, TAU);
      ctx.stroke();
    }
    ctx.fillStyle = body.star ? "#f6bd63" : body.color;
    ctx.beginPath();
    ctx.arc(at.x, at.y, Math.max(1.6, deck), 0, TAU);
    ctx.fill();
    if (deck > 3) {
      ctx.strokeStyle = "rgba(198,93,54,.55)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.arc(at.x, at.y, deck, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    /* Named only where there is room for the name: big enough on the plate to
       be worth naming, and inside the rim once placed. Above the disc where
       it fits, below where it does not, nowhere when neither works. */
    if (deck > 4) {
      const above = { x: at.x, y: at.y - deck - 5 };
      const below = { x: at.x, y: at.y + deck + 11 };
      const spot = onPlate(above, -12) ? above : onPlate(below, -12) ? below : null;
      if (spot) stencil(ctx, body.name.toUpperCase(), spot.x, spot.y, "rgba(185,177,160,.75)");
    }
  }

  /* Salvage fields, and the chunks in them that have been seen. */
  for (const field of system.fields) {
    const cloud = fieldPose(system, field, state.time);
    const at = to(cloud);
    const ring = field.radius * scale;
    if (!onPlate(at, ring)) continue;
    ctx.strokeStyle = "rgba(175,137,79,.3)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.arc(at.x, at.y, ring, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(198,93,54,.8)";
    for (const chunk of state.debris) {
      if (chunk.fieldId !== field.id || !chunk.discovered) continue;
      const dot = to({ x: cloud.x + chunk.x, y: cloud.y + chunk.y });
      ctx.fillRect(dot.x - 0.9, dot.y - 0.9, 1.8, 1.8);
    }
  }

  /* Loose freight worth turning for. */
  for (const pickup of state.pickups) {
    if (!pickup.discovered && pickup.source === "salvage") continue;
    const at = to(pickup);
    if (!onPlate(at)) continue;
    ctx.fillStyle = pickup.source === "salvage" ? TEAL : AMBER;
    ctx.fillRect(at.x - 1.3, at.y - 1.3, 2.6, 2.6);
  }

  /* Gates: the mouth, and a stub of the lane running out of it. */
  for (const gate of system.gates) {
    const pose = gatePose(system, gate, state.time);
    const at = to(pose);
    if (!onPlate(at, 14)) continue;
    const star = system.bodies.find((body) => body.star);
    const bearing = (star ? Math.atan2(pose.y - star.position.y, pose.x - star.position.x) : 0) + gate.bearingOffset;
    ctx.strokeStyle = "rgba(220,169,82,.55)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(at.x, at.y);
    ctx.lineTo(at.x + Math.cos(bearing) * 14, at.y + Math.sin(bearing) * 14);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 1.3;
    for (const side of [-1, 1]) {
      const bx = at.x + Math.cos(bearing + Math.PI / 2) * 4 * side;
      const by = at.y + Math.sin(bearing + Math.PI / 2) * 4 * side;
      ctx.beginPath();
      ctx.moveTo(bx - Math.cos(bearing) * 3, by - Math.sin(bearing) * 3);
      ctx.lineTo(bx + Math.cos(bearing) * 3, by + Math.sin(bearing) * 3);
      ctx.stroke();
    }
  }

  /* Ports: the same rotated square the chart uses, filled when targeted. */
  for (const station of system.stations) {
    const at = to(stationPose(system, station, state.time));
    if (!onPlate(at, 6)) continue;
    const lit = station.id === state.targetId;
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.rotate(Math.PI / 4);
    ctx.strokeStyle = lit ? AMBER : "rgba(220,169,82,.5)";
    ctx.fillStyle = lit ? AMBER : "transparent";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.rect(-2.6, -2.6, 5.2, 5.2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    if (lit && onPlate({ x: at.x, y: at.y + 13 }, -12)) stencil(ctx, station.callSign, at.x, at.y + 13, AMBER);
  }

  /* The track. Teal while it is only a vector; oxide once it ends on
     something the hull cannot survive at this speed. */
  if (state.track.length > 1) {
    ctx.strokeStyle = state.impact ? (state.critical ? "rgba(198,93,54,.95)" : "rgba(220,169,82,.85)") : "rgba(112,170,164,.7)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash(state.impact ? [] : [2, 3]);
    ctx.beginPath();
    state.track.forEach((point, index) => {
      const at = to(point);
      if (index === 0) ctx.moveTo(at.x, at.y);
      else ctx.lineTo(at.x, at.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (state.impact) {
    const at = to(state.impact);
    /* Laid over a world's own disc as often as not, so it is cut into the
       plate with a dark stroke first and then drawn inside that. */
    const mark = () => {
      ctx.beginPath();
      ctx.moveTo(at.x - 3.5, at.y - 3.5);
      ctx.lineTo(at.x + 3.5, at.y + 3.5);
      ctx.moveTo(at.x + 3.5, at.y - 3.5);
      ctx.lineTo(at.x - 3.5, at.y + 3.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(at.x, at.y, 6, 0, TAU);
      ctx.stroke();
    };
    ctx.strokeStyle = "rgba(6,9,10,.85)";
    ctx.lineWidth = 3.4;
    mark();
    ctx.strokeStyle = state.critical ? ALARM : AMBER;
    ctx.lineWidth = 1.4;
    mark();
  }

  /* The ship, always dead centre, nose where the nose is. */
  ctx.save();
  ctx.translate(centre, centre);
  ctx.rotate(state.ship.angle);
  ctx.fillStyle = BONE;
  ctx.beginPath();
  ctx.moveTo(5, 0);
  ctx.lineTo(-3.5, -3.2);
  ctx.lineTo(-1.8, 0);
  ctx.lineTo(-3.5, 3.2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.restore();

  /* The rim, its north tick, and the range this plate is showing. */
  ctx.strokeStyle = "rgba(231,223,205,.22)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(centre, centre, radius, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = "rgba(231,223,205,.35)";
  for (let tick = 0; tick < 4; tick += 1) {
    const angle = tick * (TAU / 4) - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(centre + Math.cos(angle) * (radius - (tick === 0 ? 6 : 3)), centre + Math.sin(angle) * (radius - (tick === 0 ? 6 : 3)));
    ctx.lineTo(centre + Math.cos(angle) * radius, centre + Math.sin(angle) * radius);
    ctx.stroke();
  }

  /* A port off the plate still has to be findable: a chevron on the rim in
     its bearing, the same job the arrow on the flight view does. */
  const target = system.stations.find((station) => station.id === state.targetId);
  if (target) {
    const at = to(stationPose(system, target, state.time));
    if (!onPlate(at, -6)) {
      const angle = Math.atan2(at.y - centre, at.x - centre);
      ctx.save();
      ctx.translate(centre + Math.cos(angle) * (radius - 5), centre + Math.sin(angle) * (radius - 5));
      ctx.rotate(angle);
      ctx.fillStyle = AMBER;
      ctx.beginPath();
      ctx.moveTo(4, 0);
      ctx.lineTo(-2.5, -2.6);
      ctx.lineTo(-2.5, 2.6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}

/** A range, written the way a gauge writes one: 2.4 k rather than 2400. */
export function rangeLabel(range: number) {
  return range >= 1000 ? `${(range / 1000).toFixed(1)} k` : `${Math.round(range)}`;
}

function stencil(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  ctx.font = "700 8px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}
