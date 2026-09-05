import type { StarSystem, Vec2 } from "./types";
import { bodyPose, fieldPose, stationPose } from "./orbits";
import { SURFACE_CONTACT } from "./art/planets";
import { CORONA_REACH } from "./art/star";
import { stationColliders } from "./art/stations";

/**
 * The flight model, in one place.
 *
 * Everything here used to live inside the flight view, which was fine while
 * only the contact solver read it. It is shared now because the ship also
 * looks ahead: the track a pilot is warned about has to be flown by the same
 * gravity and stopped by the same solids the simulation itself uses, or the
 * warning is a lie. One law, two readers — the frame that is happening and
 * the frames that are about to.
 */

/* ------------------------------------------------------------------ */
/* Gravity                                                              */
/* ------------------------------------------------------------------ */

/**
 * Ceiling on gravitational acceleration, m/s².
 *
 * Ships accelerate at 13-19 m/s² empty, so a capped well can be climbed out
 * of light and cannot be climbed straight out of loaded. That is the point:
 * a close pass with freight aboard has to be flown around, not through.
 */
export const GRAVITY_CAP = 16;
/**
 * Where a body's pull stops mattering, in multiples of its radius.
 *
 * Full strength inside GRAVITY_FULL, nothing beyond GRAVITY_REACH, eased
 * between. The ports hold an authored circle rather than a true orbit (see
 * `orbits.ts`), so they are not moving fast enough to balance a real pull at
 * their radius. Reach is set just inside the closest of them, which leaves
 * every port in quiet space where a ship parked alongside one stays parked.
 * Every hazard — the deck at SURFACE_CONTACT, the atmosphere at
 * ATMOSPHERE_TOP — sits deep inside the full-strength zone, so buying that
 * quiet costs nothing where the danger actually is.
 */
export const GRAVITY_FULL = 2.2;
export const GRAVITY_REACH = 2.75;

/** The pull every body in the system exerts on one point, summed. */
export function gravityAt(system: StarSystem, at: Vec2, time: number): Vec2 {
  let ax = 0;
  let ay = 0;
  for (const body of system.bodies) {
    const pose = bodyPose(system, body, time);
    const dx = pose.x - at.x;
    const dy = pose.y - at.y;
    const distSq = dx * dx + dy * dy;
    const dist = Math.sqrt(distSq);
    const radii = dist / body.radius;
    if (radii >= GRAVITY_REACH) continue;
    const fade = Math.max(0, Math.min(1, (GRAVITY_REACH - radii) / (GRAVITY_REACH - GRAVITY_FULL)));
    const pull = Math.min(GRAVITY_CAP, body.gravity / Math.max(42000, distSq)) * fade * fade * (3 - 2 * fade);
    ax += (dx / Math.max(1, dist)) * pull;
    ay += (dy / Math.max(1, dist)) * pull;
  }
  return { x: ax, y: ay };
}

/* ------------------------------------------------------------------ */
/* Solids                                                               */
/* ------------------------------------------------------------------ */

/**
 * One solid thing, as a moving disc.
 *
 * `what` is the sentence the net says when the hull actually reaches it;
 * `label` is the short form an instrument has room for. Both come from here
 * so a warning and the impact that follows it name the same object.
 */
export type Solid = {
  kind: "world" | "star" | "structure" | "debris";
  what: string;
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
};

/** A debris chunk, in its own field's frame — the shape the flight view holds them in. */
type Chunk = { fieldId: string; x: number; y: number; r: number; vx: number; vy: number };

/** How far past its centre a station's outermost collider reaches, at the largest scale. */
const STATION_EXTENT = 220;

/**
 * Everything solid that a ship at `at` could reach within `reach` units.
 *
 * The cull is the whole reason this is a function rather than a list: a
 * system holds several hundred circles once a debris field is counted, and
 * a ship in open space can touch none of them. Contact resolution passes its
 * hull radius and gets the handful it might be inside of; the track
 * projection passes how far the ship could travel before the horizon and
 * gets everything it could run into on the way.
 */
export function solidsNear(system: StarSystem, at: Vec2, time: number, reach: number, debris: Chunk[]): Solid[] {
  const solids: Solid[] = [];
  const near = (x: number, y: number, r: number) => Math.hypot(at.x - x, at.y - y) <= reach + r;

  for (const body of system.bodies) {
    const pose = bodyPose(system, body, time);
    const r = body.radius * (body.star ? CORONA_REACH : SURFACE_CONTACT);
    if (!near(pose.x, pose.y, r)) continue;
    solids.push({
      kind: body.star ? "star" : "world",
      what: body.star ? `Contact with ${body.name} itself` : `Surface contact on ${body.name}`,
      label: body.star ? `${body.name} corona` : `${body.name} surface`,
      x: pose.x,
      y: pose.y,
      vx: pose.vx,
      vy: pose.vy,
      r,
    });
  }

  for (const station of system.stations) {
    const pose = stationPose(system, station, time);
    if (!near(pose.x, pose.y, STATION_EXTENT)) continue;
    for (const circle of stationColliders(station, pose)) {
      solids.push({
        kind: "structure",
        what: `Contact with ${station.name} structure`,
        label: `${station.callSign} structure`,
        vx: pose.vx,
        vy: pose.vy,
        ...circle,
      });
    }
  }

  /* A field's chunks are offsets in the field's own frame, so the cloud is
     placed once and every chunk in it is carried by that one pose. */
  for (const field of system.fields) {
    const cloud = fieldPose(system, field, time);
    if (!near(cloud.x, cloud.y, field.radius)) continue;
    for (const chunk of debris) {
      if (chunk.fieldId !== field.id) continue;
      solids.push({
        kind: "debris",
        what: `Debris strike in ${field.name}`,
        label: `${field.name} debris`,
        x: cloud.x + chunk.x,
        y: cloud.y + chunk.y,
        vx: cloud.vx + chunk.vx,
        vy: cloud.vy + chunk.vy,
        r: chunk.r,
      });
    }
  }

  return solids;
}

/* ------------------------------------------------------------------ */
/* Looking ahead                                                        */
/*                                                                      */
/* A ship carrying freight at 300 m/s covers a planet's radius in two    */
/* seconds and needs eight to shed the speed. Nothing on the flight view */
/* could tell a pilot that in time, because everything on it described   */
/* where the ship IS. The track below describes where it is GOING: the   */
/* same integration the simulation runs, run forward, against the same   */
/* solids the contact solver charges for.                                */
/* ------------------------------------------------------------------ */

/** The shortest and longest the horizon may be, in seconds. */
export const TRACK_HORIZON = { min: 9, max: 90 };
/** Seconds between samples. The step count follows from the horizon, up to the cap. */
const TRACK_RESOLUTION = 0.25;
const TRACK_MAX_STEPS = 180;

export type Threat = {
  kind: Solid["kind"];
  /** The sentence the net will say if this is not flown around. */
  what: string;
  /** The short form, for an instrument. */
  label: string;
  /** Seconds until the hull reaches it, coasting. */
  time: number;
  /** Closing speed at that moment: what the contact would be charged at. */
  speed: number;
  /** Clear distance from the hull to it right now. */
  range: number;
  /** Where the contact happens, in world coordinates. */
  at: Vec2;
};

export type Track = {
  /** Sampled positions, starting at the ship and ending at the horizon or the contact. */
  points: Vec2[];
  /** Seconds between samples. */
  step: number;
  threat: Threat | null;
};

/**
 * Fly the ship forward without touching the controls, and report the first
 * solid it reaches.
 *
 * Coasting is the honest assumption: the track answers "what happens if I do
 * nothing", which is the only question a warning can be built on. Gravity is
 * integrated because it is what turns a near miss into a contact, and it is
 * why the drawn track bends toward a world rather than running straight.
 * The solids move too — at their own velocity, held linear, which is exact
 * enough over a horizon that is seconds long and orbits that are hours.
 */
export function projectTrack(
  system: StarSystem,
  ship: { x: number; y: number; vx: number; vy: number },
  options: { time: number; hullRadius: number; debris: Chunk[]; horizon?: number },
): Track {
  const horizon = options.horizon ?? TRACK_HORIZON.min;
  const steps = Math.min(TRACK_MAX_STEPS, Math.max(8, Math.round(horizon / TRACK_RESOLUTION)));
  const step = horizon / steps;
  const speed = Math.hypot(ship.vx, ship.vy);
  /* Everything the ship could reach in the horizon, with room for the pull
     of a well to bend it further than its present speed suggests. */
  const solids = solidsNear(system, ship, options.time, speed * horizon + options.hullRadius + 400, options.debris);

  const points: Vec2[] = [{ x: ship.x, y: ship.y }];
  let x = ship.x;
  let y = ship.y;
  let vx = ship.vx;
  let vy = ship.vy;
  let threat: Threat | null = null;

  for (let index = 1; index <= steps && !threat; index += 1) {
    const from = { x, y };
    const at = index * step;
    const pull = gravityAt(system, from, options.time + at);
    vx += pull.x * step;
    vy += pull.y * step;
    x += vx * step;
    y += vy * step;
    points.push({ x, y });

    for (const solid of solids) {
      const reach = solid.r + options.hullRadius;
      const sx = solid.x + solid.vx * at;
      const sy = solid.y + solid.vy * at;
      if (Math.hypot(x - sx, y - sy) > reach) continue;
      /* Somewhere in this quarter-second. Bisect the segment rather than
         report the sample, so a countdown at 300 m/s is not rounded to the
         nearest 75 units of approach. */
      let lo = 0;
      let hi = 1;
      for (let pass = 0; pass < 6; pass += 1) {
        const mid = (lo + hi) / 2;
        const t = at - step * (1 - mid);
        const gap = Math.hypot(
          from.x + (x - from.x) * mid - (solid.x + solid.vx * t),
          from.y + (y - from.y) * mid - (solid.y + solid.vy * t),
        ) - reach;
        if (gap > 0) lo = mid; else hi = mid;
      }
      const contact = at - step * (1 - hi);
      threat = {
        kind: solid.kind,
        what: solid.what,
        label: solid.label,
        time: Math.max(0, contact),
        speed: Math.hypot(vx - solid.vx, vy - solid.vy),
        range: Math.max(0, Math.hypot(ship.x - solid.x, ship.y - solid.y) - reach),
        at: { x: from.x + (x - from.x) * hi, y: from.y + (y - from.y) * hi },
      };
      break;
    }
  }

  return { points, step, threat };
}

/* ------------------------------------------------------------------ */
/* What it would take to avoid it                                       */
/* ------------------------------------------------------------------ */

export type Avoidance = {
  /** Seconds spent swinging the nose onto the vector before any of it burns off. */
  flip: number;
  /** Seconds of burn needed to bring the contact down to a harmless speed. */
  brake: number;
  /** The two together: the lead time this contact demands. */
  need: number;
  /** Lead time in hand. Zero or below means the hull is already going to pay. */
  slack: number;
};

/** Time to swing through `angle` radians, accelerating for half of it and stopping the swing over the other. */
const swing = (angle: number, angular: number) => (angular > 0 ? 2 * Math.sqrt(Math.abs(angle) / angular) : Infinity);

/**
 * How far ahead this ship, loaded the way it is loaded, has to look.
 *
 * A fixed horizon cannot work. A loaded hauler at cruise needs the better
 * part of a minute to shed its speed and a courier nudging into a berth
 * needs three seconds, and a horizon shorter than the stopping time can only
 * ever deliver news that is already too late — which is the whole complaint
 * the proximity net exists to answer. So the ship looks exactly as far as it
 * would need to stop from here, taking the worst case of a half turn first,
 * plus the lead time the warning is meant to buy.
 */
export function lookAhead(options: {
  speed: number;
  harmless: number;
  angular: number;
  decel: number;
  retro: boolean;
  /** Seconds of warning wanted on top of the stopping time. */
  lead: number;
}): number {
  const shed = Math.max(0, options.speed - options.harmless);
  const stop = options.decel > 0 ? shed / options.decel : 0;
  const turn = options.retro ? 0 : swing(Math.PI, options.angular);
  /* A third again, because a ship falling into a well arrives faster than it
     is going now, and the burn that has to be answered is the one at
     contact. Without the margin the horizon lands just short of the point
     where a warning would still be a caution, and every hazard would
     announce itself already critical. */
  return Math.min(TRACK_HORIZON.max, Math.max(TRACK_HORIZON.min, (stop + turn) * 1.35 + options.lead));
}

/**
 * How long this ship needs to make a coming contact harmless, and whether it
 * still has that long.
 *
 * The answer is different for every hull on the board, which is the point.
 * A stock ship has to turn its nose onto the vector before it can slow at
 * all, and a loaded hauler turns slowly; a ship with retro pods fitted just
 * holds the brake. Contact under the scuff speed costs nothing, so only the
 * excess above it has to be burned off — the warning is about damage, not
 * about stopping.
 */
export function avoidance(options: {
  time: number;
  speed: number;
  /** Closing speed a contact may happen at for free. */
  harmless: number;
  /** Where the nose points now, and the vector it would have to be swung onto. */
  heading: number;
  vx: number;
  vy: number;
  /** Angular acceleration available from the RCS, rad/s². */
  angular: number;
  /** Deceleration available against the vector, m/s². */
  decel: number;
  /** Retro pods brake without turning the ship first. */
  retro: boolean;
  /** With a dry tank nothing can be done at all. */
  fuel: number;
}): Avoidance {
  const shed = Math.max(0, options.speed - options.harmless);
  if (shed <= 0) return { flip: 0, brake: 0, need: 0, slack: options.time };
  if (options.fuel <= 0 || options.decel <= 0) {
    return { flip: 0, brake: Infinity, need: Infinity, slack: -Infinity };
  }
  let flip = 0;
  if (!options.retro) {
    /* Retrograde is where the nose has to end up. A ship already pointed
       there pays nothing; one flying backwards pays for the half turn. */
    const retrograde = Math.atan2(-options.vy, -options.vx);
    const delta = Math.atan2(Math.sin(retrograde - options.heading), Math.cos(retrograde - options.heading));
    flip = swing(delta, options.angular);
  }
  const brake = shed / options.decel;
  const need = flip + brake;
  return { flip, brake, need, slack: options.time - need };
}
