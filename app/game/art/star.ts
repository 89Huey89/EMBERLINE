import type { CelestialBody, Vec2 } from "../types";
import { PAINT } from "./ships";

/**
 * Star art lives here, separate from simulation code.
 *
 * Cinder system has one star, Cinder, sitting at the world origin with true
 * radius 900 — the largest thing in the game by a wide margin (planets run
 * 215-705). It is not background like the planets: it is the light every
 * other body is lit by, and past a point it is lethal. `drawStar` paints it
 * in star-local space with the disc centred on the origin, the way
 * `drawPlanet` paints a planet; the caller translates to the true position
 * first — there is no parallax function here, because unlike a planet the
 * star's drawn position is never allowed to drift from where the simulation
 * says it is (see STAR_SCALE).
 *
 * It is emissive rather than lit: no terrain, no day/night terminator, no
 * offset toward a light source, because it IS the light source. What gives
 * it shape instead is radial falloff (a near-white core fading to the warm
 * limb) plus two textures baked once into an offscreen canvas the way
 * `surfaceFor` bakes planet terrain in planets.ts — granulation mottling the
 * disc, and streamers filling the corona out to CORONA_REACH. That texture
 * is stamped once a frame and given its drift by rotating it under a live
 * `ctx.rotate`, so the corona's slow shift costs one transform, not a
 * repaint; a slow, shallow brightness `pulse` on top of the cached texture
 * is the only other thing recomputed every frame.
 *
 * `starLight` hands out the angle a world point is lit from, given Cinder's
 * true position, in the same convention `planets.ts` hardcodes as LIGHT —
 * see the doc comment on `starLight` for the exact correspondence.
 */

const TAU = Math.PI * 2;

/**
 * Drawn radius as a fraction of the star's true (simulation) radius.
 *
 * Planets shrink to 92% (`PLANET_SCALE` in planets.ts) because they are
 * pure background that nothing collides with — the gap between the painted
 * disc and the true radius costs nothing and buys a little breathing room.
 * Cinder's true radius is not free: it is the boundary between "cooking in
 * the corona" and "dead on the surface" (see CORONA_REACH), so the drawn
 * disc has to sit exactly where the simulation puts it, or the last thing a
 * pilot sees before dying disagrees with what killed them. STAR_SCALE stays
 * at 1 for that reason — the constant exists, matching PLANET_SCALE's
 * shape, so the choice is a single documented value rather than a bare
 * `star.radius` scattered through this file.
 */
export const STAR_SCALE = 1;

/**
 * Outer edge of the lethal corona, as a multiple of the star's true radius.
 *
 * This lives here rather than as a number the simulation invents on its
 * own, for the same reason `PLANET_SCALE` lives in planets.ts and not in
 * the physics code: the art is what the player is actually reading, so the
 * boundary the simulation enforces has to be read off the same file that
 * paints it, or a ship can visibly clear the glow and still be told it
 * burned. 1.7 is where the baked corona texture (see `paintCorona`) fades
 * to nothing under the outer glow — past it Cinder is just a bright thing
 * in the sky again, which is where "cooks a ship" should stop being true.
 */
export const CORONA_REACH = 1.7;

export type StarArtState = {
  time: number;
  /** Camera zoom; keeps the limb a hairline even when Cinder is a couple of pixels wide. */
  zoom: number;
};

/* ------------------------------------------------------------------ */
/* Small helpers — mirrors the shape of the ones in planets.ts, kept    */
/* local rather than shared so this file stays a self-contained unit.   */
/* ------------------------------------------------------------------ */
/** `#rrggbb` plus an alpha, as an `rgba()` string. */
function tint(hex: string, alpha: number) {
  const value = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
}

/** A repeatable 0..1 value for `index`, so the granulation and corona never change between frames. */
function noise(index: number, salt = 0) {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/** A hashed position inside radius `radius`, with no visible structure between neighbours. */
function spot(index: number, radius: number, spread: number, salt: number): Vec2 {
  const angle = noise(index, salt) * TAU;
  const r = radius * spread * Math.sqrt(noise(index, salt + 0.5));
  return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
}

/** A soft-edged patch: a disc whose colour fades out towards its rim. Every cell and lobe is built from these. */
function blob(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rotation: number, hex: string, alpha: number, core = 0.35) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(rx, ry);
  const fade = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  fade.addColorStop(0, tint(hex, alpha));
  fade.addColorStop(core, tint(hex, alpha * 0.85));
  fade.addColorStop(1, tint(hex, 0));
  ctx.fillStyle = fade;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** A tapered ray of escaping light, from `innerR` to `outerR` along `angle`. The corona's streamers. */
function streamer(ctx: CanvasRenderingContext2D, angle: number, innerR: number, outerR: number, width: number, hex: string, alpha: number) {
  ctx.save();
  ctx.rotate(angle);
  const ray = ctx.createLinearGradient(innerR, 0, outerR, 0);
  ray.addColorStop(0, tint(hex, alpha));
  ray.addColorStop(1, tint(hex, 0));
  ctx.strokeStyle = ray;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(innerR, 0);
  ctx.lineTo(outerR, 0);
  ctx.stroke();
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Baked texture: granulation on the disc, streamers in the corona      */
/* ------------------------------------------------------------------ */
/** How many radii from the centre the cached texture covers — enough to hold the corona out to CORONA_REACH. */
const TEXTURE_SPAN = CORONA_REACH + 0.05;
/** Pixel size of the cached texture. Cinder is the biggest thing on screen, so it gets the most detail. */
const TEXTURE_PX = 1280;

/**
 * Static mottling across the disc: broad warm/cool cells, then a finer
 * grain on top, then a few quiet patches — never fully dark, because this
 * is a light source, not terrain in shadow. No directional light: cells are
 * scattered isotropically, unlike a planet's day-side geology.
 */
function paintGranulation(ctx: CanvasRenderingContext2D, radius: number) {
  /* broad cells: the visible "boiling" texture of the photosphere */
  for (let index = 0; index < 70; index += 1) {
    const at = spot(index, radius, 0.98, 1);
    const r = radius * (0.05 + noise(index, 2) * 0.09);
    const hot = noise(index, 3) > 0.4;
    blob(ctx, at.x, at.y, r, r * (0.75 + noise(index, 4) * 0.35), noise(index, 5) * TAU, hot ? PAINT.amberLight : PAINT.oxide, hot ? 0.16 : 0.13, 0.5);
  }
  /* fine grain: the texture that only reads up close */
  for (let index = 0; index < 360; index += 1) {
    const at = spot(index, radius, 1, 30);
    const s = radius * (0.006 + noise(index, 31) * 0.009);
    ctx.fillStyle = noise(index, 32) > 0.5 ? tint(PAINT.flameCore, 0.14) : tint(PAINT.oxideDeep, 0.15);
    ctx.fillRect(at.x, at.y, s, s);
  }
  /* a few quiet patches: cooler regions, softened to a whisper, never black */
  const quiet: Array<readonly [number, number, number]> = [[0.42, -0.3, 0.16], [-0.5, 0.18, 0.13], [0.08, 0.46, 0.1]];
  quiet.forEach(([x, y, r], index) => {
    blob(ctx, radius * x, radius * y, radius * r, radius * r * 0.8, noise(index, 40) * TAU, PAINT.oxideDeep, 0.2, 0.4);
  });
}

/**
 * Static corona: tapered streamers spread by the golden angle (so nothing
 * lines up into a visible wheel), plus a handful of soft blobs so the band
 * reads as gas rather than wire. Covers `radius` out to `radius * CORONA_REACH`.
 */
function paintCorona(ctx: CanvasRenderingContext2D, radius: number) {
  const inner = radius * 0.99;
  const outer = radius * CORONA_REACH;
  for (let index = 0; index < 56; index += 1) {
    const angle = index * 2.39996;
    const reach = inner + (outer - inner) * (0.3 + noise(index, 6) * 0.7);
    const width = radius * (0.008 + noise(index, 7) * 0.018);
    const hot = noise(index, 8) > 0.55;
    streamer(ctx, angle, inner, reach, width, hot ? PAINT.amberLight : PAINT.oxide, hot ? 0.24 : 0.15);
  }
  for (let index = 0; index < 14; index += 1) {
    const angle = index * 2.39996 + 1;
    const dist = radius * (1.08 + noise(index, 9) * 0.4);
    const r = radius * (0.1 + noise(index, 10) * 0.13);
    blob(ctx, Math.cos(angle) * dist, Math.sin(angle) * dist, r, r, 0, PAINT.amber, 0.13, 0.4);
  }
}

const textures = new Map<string, HTMLCanvasElement>();

/**
 * The star's granulation and corona, painted once at `TEXTURE_PX` and
 * reused. Painted in star units, so it drops onto the disc and corona at
 * any zoom. Same reasoning as `surfaceFor` in planets.ts: hundreds of small
 * deterministic scatters are cheap once and expensive every frame, so they
 * are baked once and only ever stamped (and, here, rotated).
 */
function textureFor(star: CelestialBody, radius: number): HTMLCanvasElement | null {
  const cached = textures.get(star.id);
  if (cached) return cached;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_PX;
  canvas.height = TEXTURE_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const scale = TEXTURE_PX / (2 * radius * TEXTURE_SPAN);
  ctx.translate(TEXTURE_PX / 2, TEXTURE_PX / 2);
  ctx.scale(scale, scale);
  paintGranulation(ctx, radius);
  paintCorona(ctx, radius);
  textures.set(star.id, canvas);
  return canvas;
}

/* ------------------------------------------------------------------ */
/* Live per-frame elements                                              */
/* ------------------------------------------------------------------ */
/** Radians/second the baked texture drifts. Slow: one full turn takes several minutes. */
const DRIFT_RATE = 0.02;
/** Pulse rate and depth: a slow, shallow brightness wobble. Never fast enough to strobe. */
const PULSE_RATE = 0.17;
const PULSE_DEPTH = 0.05;

/**
 * Paints Cinder in star-local space, centred on the origin, at the drawn
 * radius `STAR_SCALE` reports. The caller translates to the star's true
 * position first, the same contract `drawPlanet` uses.
 */
export function drawStar(ctx: CanvasRenderingContext2D, star: CelestialBody, state: StarArtState) {
  const { time, zoom } = state;
  const radius = star.radius * STAR_SCALE;
  const pulse = 1 + Math.sin(time * PULSE_RATE) * PULSE_DEPTH;

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  /* 1. outer glow: a soft halo well past the corona, so Cinder reads as a bright point from any distance */
  const haloReach = radius * CORONA_REACH * 1.5;
  const halo = ctx.createRadialGradient(0, 0, radius * 0.6, 0, 0, haloReach);
  halo.addColorStop(0, tint(PAINT.amber, 0.16 * pulse));
  halo.addColorStop(0.4, tint(PAINT.amber, 0.06));
  halo.addColorStop(1, tint(PAINT.amber, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, haloReach, 0, TAU);
  ctx.fill();

  /* 2. granulation + corona: the cached texture, drifting under a live rotation */
  const texture = textureFor(star, radius);
  if (texture) {
    ctx.save();
    ctx.rotate(time * DRIFT_RATE);
    const span = radius * TEXTURE_SPAN;
    ctx.drawImage(texture, -span, -span, span * 2, span * 2);
    ctx.restore();
  }

  /* 3. core: a near-white centre fading out before the limb, so granulation still reads at the edge */
  const coreReach = radius * 0.85;
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, coreReach);
  core.addColorStop(0, tint(PAINT.flameCore, 0.95 * pulse));
  core.addColorStop(0.45, tint(PAINT.amberLight, 0.55 * pulse));
  core.addColorStop(1, tint(PAINT.amber, 0));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, coreReach, 0, TAU);
  ctx.fill();

  /* 4. limb: the crisp warm edge that still reads when Cinder is a couple of pixels wide */
  ctx.strokeStyle = tint(PAINT.amberLight, 0.85 * pulse);
  ctx.lineWidth = Math.max(radius * 0.01, 1.4 / zoom);
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  ctx.stroke();

  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Lighting                                                              */
/* ------------------------------------------------------------------ */
/**
 * The angle light arrives from at world point `at`, given the star's true
 * position `starAt`.
 *
 * planets.ts hardcodes `const LIGHT = -2.53` and derives
 * `LIGHT_DIR = { x: Math.cos(LIGHT), y: Math.sin(LIGHT) }`, then uses
 * LIGHT_DIR as the direction FROM a lit body TOWARD the sun: the globe
 * gradient's hot spot is offset by `LIGHT_DIR * radius`, the terminator
 * gradient runs from the LIGHT_DIR side to the `-LIGHT_DIR` side, and the
 * lit limb is the arc centred on angle `LIGHT`. This function returns that
 * same angle, computed from real positions instead of guessed: the angle of
 * the vector from `at` to `starAt`, so `{ x: Math.cos(result), y: Math.sin(result) }`
 * points from the lit point toward Cinder, exactly like LIGHT_DIR does now.
 * A caller can use the result as a drop-in replacement for LIGHT wherever
 * planets.ts reads that constant.
 */
export function starLight(at: Vec2, starAt: Vec2): number {
  return Math.atan2(starAt.y - at.y, starAt.x - at.x);
}
