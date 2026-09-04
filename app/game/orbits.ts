import { BODIES } from "./data";
import type { Station, Vec2 } from "./types";

const TAU = Math.PI * 2;

/**
 * Where the ports are, moment to moment.
 *
 * Stations hold a circular station-keeping orbit around a primary body. A
 * station's authored `position` in `data.ts` is its position at the start of
 * a shift, and it is the whole orbit definition: the distance to its primary
 * fixes the radius, and the bearing fixes the phase. Nothing else is stored,
 * so moving a station in the data moves its orbit with it, and a save that
 * records `elapsed` records where every port was.
 *
 * The periods are AUTHORED, not derived. A true orbit at Pilgrim's radius
 * runs near 105 m/s and laps in two minutes, which would move a port most of
 * a route's length during a single delivery and turn every arrival into a
 * 105 m/s rendezvous. The ships in this game are trucks. The periods in
 * `data.ts` are instead chosen so a port drifts a tenth or so of a route
 * while you fly it: enough that you lead the target and match velocity on
 * approach, not so much that a delivery becomes an intercept problem. They
 * are ordered the way Kepler would order them — further out is slower — so
 * the system still reads as a system.
 */
export type StationPose = Vec2 & { vx: number; vy: number };

/** The body a station holds its orbit around. */
function primaryOf(station: Station) {
  return BODIES.find((body) => body.id === station.orbit.around) ?? BODIES[0];
}

/**
 * A station's position and velocity at `time` seconds into the shift.
 *
 * Velocity matters as much as position here: it is what a docked ship rides,
 * what it inherits when it releases the berth, what an arrival has to match,
 * and what a contact is measured against.
 */
export function stationPose(station: Station, time: number): StationPose {
  const primary = primaryOf(station);
  const dx = station.position.x - primary.position.x;
  const dy = station.position.y - primary.position.y;
  const radius = Math.hypot(dx, dy);
  const rate = TAU / station.orbit.period;
  const angle = Math.atan2(dy, dx) + rate * time;
  return {
    x: primary.position.x + Math.cos(angle) * radius,
    y: primary.position.y + Math.sin(angle) * radius,
    vx: -Math.sin(angle) * radius * rate,
    vy: Math.cos(angle) * radius * rate,
  };
}

/** A station's orbital radius, for the chart and for tuning. */
export function orbitRadius(station: Station) {
  const primary = primaryOf(station);
  return Math.hypot(station.position.x - primary.position.x, station.position.y - primary.position.y);
}
