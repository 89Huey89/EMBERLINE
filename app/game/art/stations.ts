import type { Station, Vec2 } from "../types";
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

/**
 * The simulation's docking capture radius, in world units.
 *
 * It has to clear `stationColliders` by a wide margin: the pilot needs room
 * to cross into the envelope, read the speed, and press the clamp before the
 * structure is in reach. The worst case is the Atlas at a large station,
 * which makes contact around 80 units out, so the envelope sits well beyond
 * that and the berth pad at 100 stays in open space.
 */
export const BERTH_CAPTURE = 140;

export type StationArtState = {
  time: number;
  /** Camera zoom; keeps the capture envelope a hairline at any zoom. */
  zoom: number;
  /** True for the station the pilot has targeted. */
  target: boolean;
  /**
   * Ship speed RELATIVE to this station, m/s. Drives the target ring's
   * approach colour: a port is moving, so closing speed is the number that
   * decides whether an arrival is clean, not speed over the star system.
   */
  closingSpeed: number;
  /** Ship distance to this station, world units. */
  shipDistance: number;
  /** Where the station is now. Stations orbit; see `orbits.ts`. */
  at: Vec2;
};

/**
 * A point `distance` out from the hub along the berth arm, in world
 * space: station-local (-distance, 0) rotated by the station's
 * orientation. The pad is centred on `berthPoint(station, 100, at)`.
 *
 * `at` is where the station is now — stations orbit, so the berth moves
 * with them. It defaults to the authored anchor position, which is correct
 * for the menus and portraits and for the start of a shift, but flight code
 * must pass the live pose from `stationPose`.
 */
export function berthPoint(station: Station, distance: number, at: Vec2 = station.position) {
  return {
    x: at.x - Math.cos(station.orientation) * distance,
    y: at.y - Math.sin(station.orientation) * distance,
  };
}

export function stationScale(station: Station) {
  return station.size === "large" ? 1.22 : station.size === "small" ? 0.76 : 1;
}

/**
 * The solid parts of a station, as circles in world space.
 *
 * Four discs walk the boom from the hub outward — hub, tank pair, radiator
 * bank, solar array — sized to swallow the drawing at each stop and to
 * overlap their neighbours, so the structure reads as one continuous body
 * rather than four beads with gaps between them. They are derived from the
 * local-space geometry in `drawBody`, so moving a part in the art moves what
 * the ship hits. The masts are deliberately absent: a lattice antenna is not
 * something a pilot can see well enough to be punished for clipping, and the
 * hub disc stops at the dome rather than at the habitat ring on the large
 * stations, so the berth stays reachable by the widest ship in the fleet.
 *
 * Nothing here reaches toward -x, which is where the berth arm is. That
 * leaves the approach corridor to the pad open from the front and solid from
 * every other angle: the way in is the way the lights point.
 */
export function stationColliders(station: Station, at: Vec2 = station.position) {
  const scale = stationScale(station);
  const cos = Math.cos(station.orientation);
  const sin = Math.sin(station.orientation);
  const local: [number, number][] = [
    [0, station.size === "large" ? 34 : 26], // dome, module block, hub core
    [31, 26], // propellant tanks
    [79, 34], // radiator bank
    [140, 38], // solar array
  ];
  return local.map(([along, radius]) => ({
    x: at.x + cos * along * scale,
    y: at.y + sin * along * scale,
    r: radius * scale,
  }));
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

  /* 10. per-station character module */
  drawCharacter(ctx, station, time, work);
}

/* ------------------------------------------------------------------ */
/* Per-station character modules — scaled with the body                 */
/*                                                                      */
/* Every station shares the boom, hub, radiators and array above; what  */
/* makes one recognisable at a glance is the industry bolted onto it.   */
/* These are drawn after the common body and before the berth, so they  */
/* never intrude on the arm or the pad (negative x around y = 0).       */
/* ------------------------------------------------------------------ */

/** One dark-red radiator panel, ribbed, with a hot edge along `hotEdge`. */
function radiatorPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, hotEdge: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 1);
  outlined(ctx, "#5b2f26", 0.9);
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = "rgba(0,0,0,.35)";
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (let rib = x; rib <= x + w; rib += 3) { ctx.moveTo(rib, y); ctx.lineTo(rib, y + h); }
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = "rgba(255,120,70,.35)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, hotEdge); ctx.lineTo(x + w, hotEdge); ctx.stroke();
}

/** Deterministic 0..1 noise, so the ore heap is the same heap every frame. */
function jitter(seed: number) {
  const n = Math.sin(seed * 12.9898) * 43758.5453;
  return n - Math.floor(n);
}

function drawCharacter(ctx: CanvasRenderingContext2D, station: Station, time: number, work: string) {
  switch (station.id) {
    /* -------------------------------------------------------------- */
    /* PILGRIM — commerce & habitation: a market ring people live on.   */
    /* -------------------------------------------------------------- */
    case "pilgrim": {
      ctx.strokeStyle = "#5b5549";
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(0, 0, 34, 0, TAU); ctx.stroke();
      ctx.strokeStyle = station.color;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, 38, 0, TAU); ctx.stroke();
      // hab pods bolted onto the ring, windows lit
      for (const angle of [0.8, 2.3, 3.9, 5.5]) {
        const x = Math.cos(angle) * 36;
        const y = Math.sin(angle) * 36;
        ctx.save();
        ctx.translate(x, y);
        ctx.beginPath();
        ctx.roundRect(-5, -3, 10, 6, 1.5);
        outlined(ctx, PAINT.steelDeep, 0.8);
        ctx.fillStyle = station.color;
        ctx.fillRect(-3.2, -0.6, 1.5, 1.2);
        ctx.fillRect(1.7, -0.6, 1.5, 1.2);
        ctx.restore();
      }
      // shift lamps around the ring, coming on out of step with each other
      for (let i = 0; i < 6; i += 1) {
        const angle = i * 1.05 + 0.3;
        light(ctx, Math.cos(angle) * 34, Math.sin(angle) * 34, work, 0.9, Math.sin(time * 1.1 + i) > -0.4);
      }
      break;
    }

    /* -------------------------------------------------------------- */
    /* SINTER — ore refinery: kilns burning, slag out the far end.      */
    /* -------------------------------------------------------------- */
    case "sinter": {
      ([[-20, -30], [-6, -34]] as const).forEach(([x, y], index) => {
        ctx.beginPath(); ctx.arc(x, y, 7, 0, TAU);
        outlined(ctx, "#4a4842", 1);
        const core = ctx.createRadialGradient(x, y, 0, x, y, 3.5);
        core.addColorStop(0, "rgba(255,138,60,.9)");
        core.addColorStop(1, "rgba(255,138,60,0)");
        ctx.globalAlpha = 0.55 + 0.3 * Math.sin(time * 1.7 + index);
        ctx.fillStyle = core;
        ctx.beginPath(); ctx.arc(x, y, 3.5, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      });
      // slag hopper
      ctx.beginPath();
      ctx.roundRect(50, -16, 16, 32, 2);
      outlined(ctx, PAINT.steelDeep, 1);
      ctx.fillStyle = PAINT.oxide;
      ctx.fillRect(50, -2, 16, 4);
      // the refinery needs more radiator than anyone else
      radiatorPanel(ctx, 30, -46, 34, 7, -46);
      radiatorPanel(ctx, 30, 39, 34, 7, 46);
      // heat shimmer above the kilns
      ctx.strokeStyle = "rgba(255,138,60,.12)";
      ctx.lineWidth = 1;
      for (const r of [10, 14, 18]) {
        ctx.beginPath(); ctx.arc(-13, -32, r, -2.6, -0.5); ctx.stroke();
      }
      break;
    }

    /* -------------------------------------------------------------- */
    /* ANVIL — shipyard: a hull in an open cradle, cranes over it.      */
    /* -------------------------------------------------------------- */
    case "anvil": {
      ctx.strokeStyle = PAINT.steelLight;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(-60, -70, 90, 36, 3); ctx.stroke();
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let x = -60; x <= 30; x += 15) { ctx.moveTo(x, -70); ctx.lineTo(x, -34); }
      ctx.stroke();
      // the ship taking shape: keel, ribs, and a cab already hung on the bow
      ctx.strokeStyle = PAINT.steel;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-52, -52); ctx.lineTo(22, -52); ctx.stroke();
      ctx.strokeStyle = PAINT.steelLight;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (const x of [-38, -18, 2]) { ctx.moveTo(x - 9, -52); ctx.arc(x, -52, 9, -Math.PI, 0); }
      ctx.stroke();
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = PAINT.bone;
      ctx.beginPath(); ctx.roundRect(10, -57, 12, 10, 2); ctx.fill();
      ctx.globalAlpha = 1;
      // gantry cranes leaning over the cradle
      ctx.strokeStyle = PAINT.steel;
      ctx.lineWidth = 2;
      ([[-60, -70, -45, -84], [30, -70, 15, -84]] as const).forEach(([x0, y0, x1, y1]) => {
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1, y1 + 4); ctx.stroke();
        light(ctx, x1, y1, work, 1);
      });
      // somebody is welding
      ([[-30, -53], [0, -53]] as const).forEach(([x, y], index) => {
        if (Math.sin(time * 17 + index * 3) > 0.6) light(ctx, x, y, PAINT.flameCore, 1.2);
      });
      break;
    }

    /* -------------------------------------------------------------- */
    /* DEEPWELL — mining concern: cages on a winch, ore stacked up.     */
    /* -------------------------------------------------------------- */
    case "deepwell": {
      // floodlight washing the shaft, drawn first so the hardware sits in it
      ctx.fillStyle = "rgba(242,181,68,.06)";
      ctx.beginPath();
      ctx.moveTo(0, 30); ctx.lineTo(-20, 100); ctx.lineTo(0, 100);
      ctx.closePath();
      ctx.fill();
      // winch tower and drum
      mast(ctx, -10, 22, 60);
      ctx.beginPath(); ctx.arc(-10, 24, 5, 0, TAU);
      outlined(ctx, PAINT.steelDeep, 1.2);
      // cable running down to the cages
      ctx.strokeStyle = PAINT.steel;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-10, 60); ctx.lineTo(-10, 96); ctx.stroke();
      const cage = (y: number) => {
        ctx.beginPath();
        ctx.roundRect(-16, y, 12, 10, 1);
        outlined(ctx, "#5c6b5a", 1);
        ctx.strokeStyle = PAINT.outline;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        for (const x of [-13, -10, -7]) { ctx.moveTo(x, y + 1); ctx.lineTo(x, y + 9); }
        ctx.stroke();
      };
      cage(96);
      cage(74 + Math.sin(time * 0.4) * 8);
      // ore heap on the deck
      for (let i = 0; i < 12; i += 1) {
        const x = 40 + jitter(i + 1) * 20;
        const y = 30 + jitter(i + 7.3) * 10;
        ctx.beginPath();
        ctx.arc(x, y, 1.5 + jitter(i + 19.7), 0, TAU);
        outlined(ctx, "#655e54", 0.5);
      }
      break;
    }

    /* -------------------------------------------------------------- */
    /* BLUEHOUR — ice processing: frosted spheres, cold plumbing.       */
    /* -------------------------------------------------------------- */
    case "bluehour": {
      for (const [x, y] of [[-60, -40], [-42, -46], [-24, -40]] as const) {
        ctx.beginPath(); ctx.arc(x, y, 8, 0, TAU);
        outlined(ctx, "#cfd9d5", 1);
        ctx.strokeStyle = PAINT.teal;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 8, 3.3, 4.9); ctx.stroke();
        ctx.strokeStyle = "rgba(112,170,164,.5)";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(x - 5, y - 3.4); ctx.lineTo(x + 4, y - 4.6);
        ctx.moveTo(x - 4.4, y + 1.2); ctx.lineTo(x + 5, y - 0.4);
        ctx.stroke();
      }
      // insulated line from the farm into the hub
      const pipe: [number, number][] = [[-24, -40], [-8, -30], [0, -22]];
      ctx.strokeStyle = PAINT.steelLight;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(pipe[0][0], pipe[0][1]);
      for (const [x, y] of pipe.slice(1)) ctx.lineTo(x, y);
      ctx.stroke();
      ctx.strokeStyle = PAINT.teal;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let leg = 0; leg < pipe.length - 1; leg += 1) {
        const [x0, y0] = pipe[leg];
        const [x1, y1] = pipe[leg + 1];
        const length = Math.hypot(x1 - x0, y1 - y0);
        const ux = (x1 - x0) / length;
        const uy = (y1 - y0) / length;
        for (let d = 3; d < length; d += 6) {
          ctx.moveTo(x0 + ux * d + uy * 2, y0 + uy * d - ux * 2);
          ctx.lineTo(x0 + ux * d - uy * 2, y0 + uy * d + ux * 2);
        }
      }
      ctx.stroke();
      // propellant drum, teal band: this is what they sell
      ctx.beginPath();
      ctx.roundRect(40, -44, 30, 14, 7);
      outlined(ctx, "#7a7e78", 1);
      ctx.fillStyle = PAINT.teal;
      ctx.fillRect(53, -44, 3, 14);
      light(ctx, -42, -56, PAINT.teal, 1);
      light(ctx, 40, -50, PAINT.teal, 1);
      break;
    }

    /* -------------------------------------------------------------- */
    /* QUIET — research platform: dishes, a long boom, keep-clear ring. */
    /* -------------------------------------------------------------- */
    case "quiet": {
      ctx.strokeStyle = "rgba(231,223,205,.8)";
      ctx.lineWidth = 1.2;
      for (const [x, y, r] of [[-30, -40, 9], [40, -44, 7], [30, 44, 7]] as const) {
        ctx.beginPath(); ctx.arc(x, y, r, 0.6, 2.8); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(1.7) * 5, y + Math.sin(1.7) * 5);
        ctx.stroke();
      }
      // listening boom, held away from everything warm
      ctx.strokeStyle = PAINT.steelLight;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -22); ctx.lineTo(0, -95);
      for (let y = -36; y >= -92; y -= 14) { ctx.moveTo(-6, y); ctx.lineTo(6, y); }
      ctx.stroke();
      light(ctx, 0, -97, PAINT.teal, 1.2);
      // keep-clear ring: do not fly through the instruments
      ctx.strokeStyle = "rgba(112,170,164,.2)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 8]);
      ctx.beginPath(); ctx.arc(0, 0, 110, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      break;
    }

    default:
      break;
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
  const { time, zoom, target, closingSpeed, shipDistance, at } = state;
  const scale = stationScale(station);
  const cold = station.id === "bluehour" || station.id === "quiet";
  const work = cold ? PAINT.teal : PAINT.marker;

  ctx.save();
  ctx.translate(at.x, at.y);
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
  ctx.arc(at.x, at.y, BERTH_CAPTURE, 0, TAU);
  if (target) {
    const fast = closingSpeed > 36;
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
