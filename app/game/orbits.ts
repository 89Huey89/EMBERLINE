import type { CelestialBody, LineGate, SalvageField, Station, StarSystem, Vec2 } from "./types";

const TAU = Math.PI * 2;

/**
 * Where everything is, moment to moment.
 *
 * Every orbit in the game is defined the same way and stored nowhere: an
 * authored `position` in `data.ts` is where that thing stands at the start of
 * a shift, and it IS the orbit — its distance from its primary fixes the
 * radius, its bearing fixes the phase. Nothing else is recorded, so moving
 * something in the data moves its orbit with it, and a save that records
 * `elapsed` already records where the whole system was.
 *
 * The layers compose. A station's lane is drawn around its planet, and its
 * planet's lane is drawn around the star, so a station's true motion is the
 * sum of the two and a berthed ship rides both. `orbitAbout` is that sum, and
 * it recurses, so a moon of a planet would need no new code.
 *
 * Planet periods follow Kepler from the inner lane out (T proportional to
 * r^1.5). That is what makes alignments drift: lanes between worlds lengthen
 * and shorten as they pass, and a route that is cheap this shift may not be
 * the next. Station periods are authored instead — see the note in `data.ts`
 * — because a station moving at its true orbital speed could not be caught.
 *
 * Every function below takes the `StarSystem` explicitly rather than reading
 * a module-level world: an `orbit.around` (on a body, a station or a field)
 * is only ever an id within that same system, so passing the system in is
 * what lets more than one of them exist without this file knowing how many
 * there are.
 */
export type Pose = Vec2 & { vx: number; vy: number };

const STATIC: Pose = { x: 0, y: 0, vx: 0, vy: 0 };

/**
 * One orbital layer: carry `base` along, then add a circle around it.
 *
 * The circle is described by where the orbiting thing was authored relative
 * to its primary's authored anchor, which is why both anchors are passed
 * rather than the primary's live pose — the live pose supplies the motion,
 * the anchors supply the shape.
 */
function orbitAbout(base: Pose, anchorOf: Vec2, anchor: Vec2, period: number, time: number): Pose {
  const radius = Math.hypot(anchor.x - anchorOf.x, anchor.y - anchorOf.y);
  const rate = TAU / period;
  const angle = Math.atan2(anchor.y - anchorOf.y, anchor.x - anchorOf.x) + rate * time;
  return {
    x: base.x + Math.cos(angle) * radius,
    y: base.y + Math.sin(angle) * radius,
    vx: base.vx - Math.sin(angle) * radius * rate,
    vy: base.vy + Math.cos(angle) * radius * rate,
  };
}

const bodyById = (system: StarSystem, id: string) => system.bodies.find((body) => body.id === id);

/** Where a body is and how fast it is going. The star carries no orbit and does not move. */
export function bodyPose(system: StarSystem, body: CelestialBody, time: number): Pose {
  if (!body.orbit) return { x: body.position.x, y: body.position.y, vx: 0, vy: 0 };
  const primary = bodyById(system, body.orbit.around);
  if (!primary) return { x: body.position.x, y: body.position.y, vx: 0, vy: 0 };
  return orbitAbout(bodyPose(system, primary, time), primary.position, body.position, body.orbit.period, time);
}

/**
 * A station's position and velocity at `time`, carried by its planet.
 *
 * Velocity matters as much as position: it is what a docked ship rides, what
 * it inherits when it releases the berth, what an arrival has to match, and
 * what a contact is measured against. Now that the planet moves too, that
 * velocity is the sum of both lanes, so a port on a fast inner world is
 * genuinely harder to come alongside than one further out.
 */
export function stationPose(system: StarSystem, station: Station, time: number): Pose {
  const primary = bodyById(system, station.orbit.around);
  if (!primary) return STATIC;
  return orbitAbout(bodyPose(system, primary, time), primary.position, station.position, station.orbit.period, time);
}

/**
 * A salvage field's centre and velocity at `time`, carried by whatever it
 * orbits. Debris and salvage held inside a field travel with it for the same
 * reason a station's staged freight does: without an anchor, anything set
 * down would be left behind by the very thing it belongs to within a minute.
 */
export function fieldPose(system: StarSystem, field: SalvageField, time: number): Pose {
  const primary = bodyById(system, field.orbit.around);
  if (!primary) return { ...STATIC, x: field.center.x, y: field.center.y };
  return orbitAbout(bodyPose(system, primary, time), primary.position, field.center, field.orbit.period, time);
}

/**
 * A gate's position and velocity. Gates orbit like everything else, so the
 * lane running out of one turns with it: a run-up flown a minute later is
 * flown on a slightly different bearing.
 */
export function gatePose(system: StarSystem, gate: LineGate, time: number): Pose {
  const primary = system.bodies.find((body) => body.id === gate.orbit.around);
  if (!primary) return { ...STATIC, x: gate.position.x, y: gate.position.y };
  return orbitAbout(bodyPose(system, primary, time), primary.position, gate.position, gate.orbit.period, time);
}

/** A station's lane radius around its own planet, for the chart and for tuning. */
export function orbitRadius(system: StarSystem, station: Station) {
  const primary = bodyById(system, station.orbit.around);
  if (!primary) return 0;
  return Math.hypot(station.position.x - primary.position.x, station.position.y - primary.position.y);
}

/** A body's lane radius around the star. Zero for the star itself. */
export function bodyOrbitRadius(system: StarSystem, body: CelestialBody) {
  if (!body.orbit) return 0;
  const primary = bodyById(system, body.orbit.around);
  if (!primary) return 0;
  return Math.hypot(body.position.x - primary.position.x, body.position.y - primary.position.y);
}
