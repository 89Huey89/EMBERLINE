import type { CelestialBody, Vec2 } from "../types";

/**
 * Planet art lives here, separate from simulation code.
 *
 * Planets are BACKGROUND. They are painted at a parallax-shifted centre and
 * at 92% of their true radius, so they drift more slowly than the stations
 * and freight that share the camera transform. The simulation is untouched
 * by this: gravity and the gravity guide rings still use the true position
 * and the true radius. The surface a ship strikes is derived from the drawn
 * disc — see SURFACE_CONTACT — so the hard deck is where the eye puts it.
 *
 * `drawPlanet` paints in planet-local space with the disc centred on the
 * origin, so the caller translates to `planetParallax(body, camera)` first
 * and the drawing uses the matching drawn radius. See ART_DIRECTION.md.
 *
 * Terrain is painted once per body into an offscreen canvas (`surfaceFor`)
 * from deterministic scatters, then stamped under the lighting every frame.
 * That keeps soft-edged geology cheap, and makes the chart portrait and the
 * flight view agree pixel for pixel. Only lamps and lights are live.
 */

const TAU = Math.PI * 2;

/** How much of the camera's motion a planet ignores. 1 = pinned to the world. */
export const PLANET_PARALLAX = 0.85;
/** Drawn radius as a fraction of the body's true (simulation) radius. */
export const PLANET_SCALE = 0.92;

/**
 * Ship distance from a body's TRUE centre at which it touches the DRAWN
 * surface, as a multiple of the body's true radius.
 *
 * The parallax shift is proportional to the camera's own offset from the
 * body, and the camera rides the ship, so a ship `d` out sits `d * PLANET_
 * PARALLAX` from the drawn centre. Setting that equal to the drawn radius
 * leaves a constant: contact always happens at the same multiple of the
 * radius, whatever the body or the range. That is what the simulation
 * collides against, and what the terrain warning ring is drawn at, so the
 * hard deck agrees with the painting instead of with the raw radius.
 */
export const SURFACE_CONTACT = PLANET_SCALE / PLANET_PARALLAX;

/**
 * Top of the atmosphere on bodies that have one, as a multiple of the true
 * radius. Between here and SURFACE_CONTACT a ship meets drag and heating:
 * the band is the warning that the deck is coming, and a way to shed speed
 * for free if the pilot is willing to cook the freight.
 */
export const ATMOSPHERE_TOP = 1.3;

/** System light angle. Everything on every planet is lit from here. */
const LIGHT = -2.53; // sun at upper left, toward the busy side of the system
const LIGHT_DIR = { x: Math.cos(LIGHT), y: Math.sin(LIGHT) };
/** Belt tilt on Rayleigh; the terrain and storms follow it. */
const TILT = -0.18;
/** The cached surface covers this many radii from the centre. */
const SURFACE_SPAN = 1.04;

export type PlanetArtState = {
  time: number;
  /** Camera zoom; keeps hairlines and lamp dots readable at any zoom. */
  zoom: number;
};

type RGB = readonly [number, number, number];

type PlanetPaint = {
  highlight: string;
  dark: string;
  /** Colour the night side falls into. Warm on Rayleigh, blue on Nernst. */
  shadow: string;
  /** Pixel size of the cached surface. Bigger bodies get more. */
  surfacePx: number;
};

const PAINT: Record<string, PlanetPaint> = {
  cinder: { highlight: "#e3a068", dark: "#1a1210", shadow: "#0c0704", surfacePx: 1280 },
  morrow: { highlight: "#e6efec", dark: "#0b1214", shadow: "#06111c", surfacePx: 768 },
  brindle: { highlight: "#9c8670", dark: "#1a1412", shadow: "#070605", surfacePx: 512 },
};
const DEFAULT_PAINT: PlanetPaint = { highlight: "#c8b79c", dark: "#141210", shadow: "#060809", surfacePx: 768 };

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */
/** `#rrggbb` plus an alpha, as an `rgba()` string. */
function tint(hex: string, alpha: number) {
  const value = parseInt(hex.replace("#", ""), 16);
  return rgba([(value >> 16) & 255, (value >> 8) & 255, value & 255], alpha);
}

function rgba([r, g, b]: RGB, alpha: number) {
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Deterministic point `index` of a golden-angle spiral filling the disc. */
function scatter(index: number, radius: number, spread = 0.95): Vec2 {
  const angle = index * 2.39996;
  const r = radius * spread * Math.sqrt(((index * 37 + 11) % 97) / 97);
  return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
}

/** A repeatable 0..1 value for `index`, so scatters never change between frames. */
function noise(index: number, salt = 0) {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/** A hashed position inside the disc, with no visible structure between neighbours. */
function spot(index: number, radius: number, spread: number, salt: number): Vec2 {
  const angle = noise(index, salt) * TAU;
  const r = radius * spread * Math.sqrt(noise(index, salt + 0.5));
  return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
}

/**
 * A hard-edged irregular patch: a ragged polygon, squashed and rotated.
 * The coastlines of Rayleigh's salt flats and the edges of its uplands.
 */
function shard(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rotation: number, color: RGB, alpha: number, seed: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(rx, ry);
  ctx.fillStyle = rgba(color, alpha);
  ctx.beginPath();
  const points = 14;
  for (let index = 0; index < points; index += 1) {
    const angle = (index / points) * TAU;
    const r = 0.62 + noise(seed + index, 9) * 0.42;
    const px = Math.cos(angle) * r;
    const py = Math.sin(angle) * r;
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * A soft-edged patch: an ellipse whose colour fades out towards its rim.
 * Everything geological is built from these, so nothing reads as a coin.
 */
function blob(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rotation: number, color: RGB, alpha: number, core = 0.35) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(rx, ry);
  const fade = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  fade.addColorStop(0, rgba(color, alpha));
  fade.addColorStop(core, rgba(color, alpha * 0.85));
  fade.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = fade;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** A wandering polyline: dry channels on Rayleigh, fractures on Nernst. */
function channel(ctx: CanvasRenderingContext2D, start: Vec2, heading: number, step: number, segments: number, wobble: number, seed: number) {
  let { x, y } = start;
  let angle = heading;
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let segment = 0; segment < segments; segment += 1) {
    angle += (noise(seed + segment) - 0.5) * wobble;
    x += Math.cos(angle) * step;
    y += Math.sin(angle) * step;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/** The 24-vertex irregular outline Roche is built from. */
function rocheOutline(radius: number): Vec2[] {
  return Array.from({ length: 24 }, (_, index) => {
    const angle = (index * TAU) / 24;
    const r = radius * (1 + 0.08 * Math.sin(index * 1.7) + 0.05 * Math.sin(index * 3.1 + 1));
    return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
  });
}

/**
 * The drawn centre and drawn radius of a body, given the camera.
 *
 * The body keeps its true position in the simulation; only the painting
 * moves, by the fraction of the camera's offset the parallax lets through.
 */
export function planetParallax(body: CelestialBody, camera: { x: number; y: number }) {
  const slip = 1 - PLANET_PARALLAX;
  return {
    x: body.position.x + (camera.x - body.position.x) * slip,
    y: body.position.y + (camera.y - body.position.y) * slip,
    radius: body.radius * PLANET_SCALE,
  };
}

/* ------------------------------------------------------------------ */
/* RAYLEIGH — rust-gold world under a scattering amber sky              */
/* ------------------------------------------------------------------ */
const RAYLEIGH = {
  umber: [64, 26, 14] as RGB,
  rust: [150, 66, 32] as RGB,
  ochre: [214, 150, 84] as RGB,
  salt: [244, 220, 176] as RGB,
  cream: [255, 240, 210] as RGB,
};

/** Static geology: uplands, salt basins, mottling, channels, belts, hoods, storms. */
function paintRayleighSurface(ctx: CanvasRenderingContext2D, radius: number) {
  /* continents of dark rust upland: a soft halo under a ragged hard edge, tilted with the belts */
  for (let index = 0; index < 9; index += 1) {
    const at = spot(index, radius, 0.85, 1);
    const rx = radius * (0.22 + noise(index, 1) * 0.18);
    const ry = rx * (0.4 + noise(index, 2) * 0.3);
    const rotation = TILT + (noise(index, 3) - 0.5) * 0.5;
    blob(ctx, at.x, at.y, rx * 1.25, ry * 1.4, rotation, RAYLEIGH.umber, 0.32, 0.3);
    shard(ctx, at.x, at.y, rx, ry, rotation, RAYLEIGH.umber, 0.16, index * 13);
  }
  /* mid-tone rust mottling everywhere */
  for (let index = 0; index < 90; index += 1) {
    const at = spot(index, radius, 1, 4);
    const rx = radius * (0.04 + noise(index, 5) * 0.09);
    const warm = noise(index, 6) > 0.5;
    blob(ctx, at.x, at.y, rx, rx * (0.4 + noise(index, 7) * 0.4), TILT + (noise(index, 8) - 0.5) * 0.8, warm ? RAYLEIGH.ochre : RAYLEIGH.rust, warm ? 0.22 : 0.28, 0.55);
  }
  /* pale salt basins: the bright flats in the key art, hard coastlines with a soft glare */
  for (let index = 0; index < 15; index += 1) {
    const at = spot(index, radius, 0.9, 20);
    const rx = radius * (0.07 + noise(index, 21) * 0.13);
    const ry = rx * (0.35 + noise(index, 22) * 0.35);
    const rotation = TILT + (noise(index, 23) - 0.5) * 0.6;
    blob(ctx, at.x, at.y, rx * 1.3, ry * 1.5, rotation, RAYLEIGH.salt, 0.18, 0.3);
    shard(ctx, at.x, at.y, rx, ry, rotation, RAYLEIGH.salt, 0.34, index * 7 + 3);
    shard(ctx, at.x + rx * 0.15, at.y, rx * 0.5, ry * 0.5, rotation, RAYLEIGH.cream, 0.3, index * 7 + 40);
  }
  /* small bright flecks and dark pits */
  for (let index = 0; index < 140; index += 1) {
    const at = spot(index, radius, 1, 30);
    const r = radius * (0.01 + noise(index, 31) * 0.03);
    const bright = noise(index, 32) > 0.35;
    if (bright) shard(ctx, at.x, at.y, r * 1.6, r, TILT, RAYLEIGH.cream, 0.24, index * 3);
    else blob(ctx, at.x, at.y, r * 1.6, r, TILT, RAYLEIGH.umber, 0.32, 0.5);
  }
  /* dry channels running down from the uplands */
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let index = 0; index < 10; index += 1) {
    const start = spot(index, radius, 0.75, 40);
    ctx.strokeStyle = rgba(RAYLEIGH.cream, 0.16);
    ctx.lineWidth = radius * 0.006;
    channel(ctx, start, noise(index, 12) * TAU, radius * 0.06, 9, 1.4, index * 31);
    ctx.strokeStyle = rgba(RAYLEIGH.umber, 0.25);
    ctx.lineWidth = radius * 0.0025;
    channel(ctx, start, noise(index, 12) * TAU, radius * 0.06, 9, 1.4, index * 31);
  }
  /* belts: six bands of alternating haze */
  const belts = [-0.62, -0.38, -0.12, 0.14, 0.4, 0.66];
  const heights = [0.1, 0.16, 0.12, 0.18, 0.11, 0.14];
  belts.forEach((offset, index) => {
    const y = radius * offset;
    blob(ctx, -Math.sin(TILT) * y, Math.cos(TILT) * y, radius * 1.1, radius * heights[index], TILT, index % 2 === 0 ? RAYLEIGH.ochre : RAYLEIGH.umber, index % 2 === 0 ? 0.16 : 0.2, 0.6);
  });
  /* polar hoods */
  for (const sign of [-1, 1]) {
    blob(ctx, -Math.sin(TILT) * radius * 0.88 * sign, Math.cos(TILT) * radius * 0.88 * sign, radius * 0.7, radius * 0.13, TILT, RAYLEIGH.salt, 0.22, 0.5);
  }
  /* two long-lived storms, each with a bright eye */
  for (const [x, y, rx] of [[0.3, 0.35, 0.13], [-0.45, -0.2, 0.1]] as const) {
    blob(ctx, radius * x, radius * y, radius * rx, radius * rx * 0.42, TILT, RAYLEIGH.cream, 0.26, 0.3);
    blob(ctx, radius * x + radius * rx * 0.25, radius * y, radius * rx * 0.4, radius * rx * 0.18, TILT, RAYLEIGH.cream, 0.4, 0.4);
  }
  /* grain */
  for (let index = 0; index < 700; index += 1) {
    const at = scatter(index + 900, radius, 1.02);
    ctx.fillStyle = index % 2 === 0 ? rgba(RAYLEIGH.umber, 0.16) : rgba(RAYLEIGH.cream, 0.1);
    ctx.fillRect(at.x, at.y, radius * 0.006, radius * 0.004);
  }
}

/** Live: city lights on the night side, only in the settled latitudes. */
function drawRayleighLights(ctx: CanvasRenderingContext2D, radius: number, zoom: number) {
  const side = Math.max(1.5, 1.6 / zoom);
  for (let index = 0; index < 110; index += 1) {
    const angle = index * 2.399;
    const r = radius * (0.15 + ((index * 37) % 80) / 100);
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (x * LIGHT_DIR.x + y * LIGHT_DIR.y >= -0.15 * radius) continue;
    if (Math.abs(y) >= radius * 0.45) continue;
    ctx.fillStyle = index % 5 === 0 ? tint("#ffd98a", 0.95) : tint("#f2b544", 0.8);
    ctx.fillRect(x, y, side, side);
    if (index % 4 === 0) {
      ctx.fillStyle = tint("#f2b544", 0.5);
      ctx.fillRect(x + side * 1.6, y + side * 0.6, side * 0.8, side * 0.8);
    }
  }
}

/** Orbital elevator threads, with counterweights, drawn outside the disc. */
function drawRayleighElevators(ctx: CanvasRenderingContext2D, radius: number, zoom: number, time: number) {
  const angles = [LIGHT + 2.2, LIGHT + 2.9, LIGHT + 3.5];
  ctx.strokeStyle = "rgba(242,181,68,.35)";
  ctx.lineWidth = 1 / zoom;
  ctx.beginPath();
  for (const angle of angles) {
    ctx.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    ctx.lineTo(Math.cos(angle) * radius * 1.12, Math.sin(angle) * radius * 1.12);
  }
  ctx.stroke();
  const dot = Math.max(1.2, 1.5 / zoom);
  angles.forEach((angle, index) => {
    ctx.fillStyle = Math.sin(time * 1.6 + index * 2) > -0.4 ? "#f2b544" : "#7a5a2a";
    ctx.beginPath();
    ctx.arc(Math.cos(angle) * radius * 1.12, Math.sin(angle) * radius * 1.12, dot, 0, TAU);
    ctx.fill();
  });
}

/* ------------------------------------------------------------------ */
/* NERNST — fractured ice moon                                          */
/* ------------------------------------------------------------------ */
const NERNST = {
  basin: [52, 76, 94] as RGB,
  frost: [236, 246, 246] as RGB,
  ice: [160, 198, 200] as RGB,
};

function paintNernstSurface(ctx: CanvasRenderingContext2D, radius: number) {
  /* albedo: dull blue-grey basins under bright frost plains */
  for (let index = 0; index < 12; index += 1) {
    const at = spot(index, radius, 0.85, 1);
    const r = radius * (0.14 + noise(index, 1) * 0.16);
    blob(ctx, at.x, at.y, r, r * (0.6 + noise(index, 2) * 0.3), noise(index, 3) * TAU, NERNST.basin, 0.36, 0.3);
  }
  for (let index = 0; index < 30; index += 1) {
    const at = spot(index, radius, 1, 4);
    const r = radius * (0.05 + noise(index, 5) * 0.1);
    blob(ctx, at.x, at.y, r, r * 0.7, noise(index, 6) * TAU, NERNST.frost, 0.2, 0.3);
    if (index % 2 === 0) shard(ctx, at.x, at.y, r * 0.7, r * 0.5, noise(index, 6) * TAU, NERNST.frost, 0.16, index * 5);
  }
  /* frost cap */
  blob(ctx, 0, -radius * 0.86, radius * 0.55, radius * 0.15, 0, NERNST.frost, 0.3, 0.4);

  /* fracture systems: long cracks walking in from the limb, bright-edged */
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let index = 0; index < 11; index += 1) {
    const angle = index * 0.6 + 0.2;
    const start = { x: Math.cos(angle) * radius * 0.92, y: Math.sin(angle) * radius * 0.92 };
    ctx.strokeStyle = rgba(NERNST.ice, 0.45);
    ctx.lineWidth = radius * 0.007;
    channel(ctx, start, angle + Math.PI, radius * 0.2, 5, 1.1, index * 17);
    ctx.strokeStyle = rgba(NERNST.frost, 0.55);
    ctx.lineWidth = radius * 0.0025;
    channel(ctx, start, angle + Math.PI, radius * 0.2, 5, 1.1, index * 17);
  }

  /* craters: a young rayed one, then the old population */
  const craters = [
    { x: radius * 0.34, y: -radius * 0.18, r: radius * 0.15 },
    ...Array.from({ length: 9 }, (_, index) => {
      const angle = index * 2.1;
      const distance = radius * (0.2 + ((index * 13) % 50) / 100);
      return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance, r: radius * (0.04 + (index % 3) * 0.035) };
    }),
  ];
  ctx.strokeStyle = rgba(NERNST.frost, 0.28);
  ctx.lineWidth = radius * 0.004;
  ctx.beginPath();
  for (let index = 0; index < 13; index += 1) {
    const angle = index * 0.49 + 0.3;
    const length = craters[0].r * (1.6 + noise(index, 6) * 1.8);
    ctx.moveTo(craters[0].x + Math.cos(angle) * craters[0].r * 1.05, craters[0].y + Math.sin(angle) * craters[0].r * 1.05);
    ctx.lineTo(craters[0].x + Math.cos(angle) * length, craters[0].y + Math.sin(angle) * length);
  }
  ctx.stroke();
  for (const crater of craters) {
    ctx.fillStyle = "rgba(0,0,0,.16)";
    ctx.beginPath();
    ctx.arc(crater.x, crater.y, crater.r, 0, TAU);
    ctx.fill();
    blob(ctx, crater.x, crater.y, crater.r * 0.5, crater.r * 0.5, 0, NERNST.frost, 0.1, 0.3);
    ctx.strokeStyle = "rgba(255,255,255,.32)";
    ctx.lineWidth = radius * 0.005;
    ctx.beginPath();
    ctx.arc(crater.x, crater.y, crater.r, LIGHT - 1.2, LIGHT + 1.2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,.42)";
    ctx.lineWidth = radius * 0.006;
    ctx.beginPath();
    ctx.arc(crater.x, crater.y, crater.r, LIGHT + 1.9, LIGHT + 4.4);
    ctx.stroke();
  }

  /* ice glints */
  ctx.fillStyle = rgba(NERNST.frost, 0.3);
  for (let index = 0; index < 160; index += 1) {
    const at = scatter(index + 300, radius, 0.98);
    ctx.fillRect(at.x, at.y, radius * 0.008, radius * 0.008);
  }
}

/* ------------------------------------------------------------------ */
/* ROCHE — nickel-iron body, tunnelled and lamped                       */
/* ------------------------------------------------------------------ */
const ROCHE = {
  grain: [196, 176, 150] as RGB,
  pit: [0, 0, 0] as RGB,
  face: [210, 190, 160] as RGB,
};

/** Lamp positions on Roche's worked face, shared by the static tunnel mouths and the live lamps. */
const ROCHE_RUNS = [
  { count: 8, start: 2.6, sweep: 1.6, reach: 0.55 },
  { count: 4, start: 3.9, sweep: 0.7, reach: 0.78 },
];
function rocheLamp(index: number, count: number, start: number, sweep: number, reach: number, radius: number): Vec2 {
  const angle = LIGHT + start + (index / (count - 1)) * sweep;
  return { x: Math.cos(angle) * radius * reach, y: Math.sin(angle) * radius * reach };
}

function paintRocheSurface(ctx: CanvasRenderingContext2D, radius: number) {
  /* regolith: a coarse speckle of light and dark grains */
  for (let index = 0; index < 140; index += 1) {
    const at = spot(index, radius, 1.04, 1);
    const r = radius * (0.015 + noise(index, 2) * 0.04);
    const bright = noise(index, 3) > 0.66;
    if (bright) shard(ctx, at.x, at.y, r * 1.5, r, noise(index, 4) * TAU, ROCHE.grain, 0.22, index * 3);
    else blob(ctx, at.x, at.y, r * 1.5, r, noise(index, 4) * TAU, ROCHE.pit, 0.34, 0.45);
  }
  /* the cut face: one flat bright facet where the body was quarried */
  const face = LIGHT + 0.55;
  ctx.fillStyle = rgba(ROCHE.face, 0.18);
  ctx.beginPath();
  ctx.moveTo(Math.cos(face - 0.32) * radius * 0.98, Math.sin(face - 0.32) * radius * 0.98);
  ctx.lineTo(Math.cos(face + 0.3) * radius * 0.98, Math.sin(face + 0.3) * radius * 0.98);
  ctx.lineTo(Math.cos(face + 0.2) * radius * 0.5, Math.sin(face + 0.2) * radius * 0.5);
  ctx.lineTo(Math.cos(face - 0.25) * radius * 0.52, Math.sin(face - 0.25) * radius * 0.52);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.45)";
  ctx.lineWidth = radius * 0.008;
  ctx.stroke();
  /* bench lines across the face */
  ctx.strokeStyle = "rgba(0,0,0,.25)";
  ctx.lineWidth = radius * 0.004;
  for (const step of [0.62, 0.74, 0.86]) {
    ctx.beginPath();
    ctx.moveTo(Math.cos(face - 0.28) * radius * step, Math.sin(face - 0.28) * radius * step);
    ctx.lineTo(Math.cos(face + 0.26) * radius * step, Math.sin(face + 0.26) * radius * step);
    ctx.stroke();
  }
  /* craters */
  for (let index = 0; index < 6; index += 1) {
    const angle = index * 1.9;
    const cx = Math.cos(angle) * radius * 0.5;
    const cy = Math.sin(angle) * radius * 0.5;
    ctx.fillStyle = "rgba(0,0,0,.38)";
    ctx.beginPath();
    ctx.ellipse(cx, cy, radius * 0.12, radius * 0.08, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = rgba(ROCHE.grain, 0.5);
    ctx.lineWidth = radius * 0.008;
    ctx.beginPath();
    ctx.ellipse(cx, cy, radius * 0.12, radius * 0.08, 0, LIGHT - 1.2, LIGHT + 1.2);
    ctx.stroke();
  }
  /* the tunnel runs and three tunnel mouths on the worked face */
  ctx.strokeStyle = "rgba(242,181,68,.22)";
  ctx.lineWidth = radius * 0.006;
  for (const run of ROCHE_RUNS) {
    ctx.beginPath();
    for (let index = 0; index < run.count; index += 1) {
      const at = rocheLamp(index, run.count, run.start, run.sweep, run.reach, radius);
      if (index === 0) ctx.moveTo(at.x, at.y);
      else ctx.lineTo(at.x, at.y);
    }
    ctx.stroke();
  }
  for (let index = 0; index < 3; index += 1) {
    const at = rocheLamp(index, 3, 2.75, 1.3, 0.66, radius);
    ctx.fillStyle = "rgba(0,0,0,.6)";
    ctx.beginPath();
    ctx.ellipse(at.x, at.y, radius * 0.05, radius * 0.035, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = rgba(ROCHE.grain, 0.45);
    ctx.lineWidth = radius * 0.007;
    ctx.beginPath();
    ctx.ellipse(at.x, at.y, radius * 0.05, radius * 0.035, 0, LIGHT - 1.1, LIGHT + 1.1);
    ctx.stroke();
  }
}

/** Live: the navigation lamps along Roche's tunnel runs. */
function drawRocheLamps(ctx: CanvasRenderingContext2D, radius: number, state: PlanetArtState) {
  const dot = Math.max(1.2, 1.4 / state.zoom);
  ROCHE_RUNS.forEach((run, runIndex) => {
    for (let index = 0; index < run.count; index += 1) {
      if (Math.sin(state.time * 2 + index + runIndex * 1.7) <= 0) continue;
      const at = rocheLamp(index, run.count, run.start, run.sweep, run.reach, radius);
      ctx.fillStyle = index % 2 === 0 ? "#d8402c" : "#f2b544";
      ctx.beginPath();
      ctx.arc(at.x, at.y, dot, 0, TAU);
      ctx.fill();
    }
  });
}

/* ------------------------------------------------------------------ */
/* Surface cache                                                        */
/* ------------------------------------------------------------------ */
const surfaces = new Map<string, HTMLCanvasElement>();

/**
 * The body's static geology, painted once at `surfacePx` and reused. Painted
 * in planet units, so it drops straight onto the disc at any zoom.
 */
function surfaceFor(body: CelestialBody, radius: number, paint: PlanetPaint) {
  const cached = surfaces.get(body.id);
  if (cached) return cached;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = paint.surfacePx;
  canvas.height = paint.surfacePx;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const scale = paint.surfacePx / (2 * radius * SURFACE_SPAN);
  ctx.translate(paint.surfacePx / 2, paint.surfacePx / 2);
  ctx.scale(scale, scale);
  if (body.id === "brindle") paintRocheSurface(ctx, radius);
  else if (body.id === "morrow") paintNernstSurface(ctx, radius);
  else paintRayleighSurface(ctx, radius);
  surfaces.set(body.id, canvas);
  return canvas;
}

/* ------------------------------------------------------------------ */
/* The common pass                                                      */
/* ------------------------------------------------------------------ */
/**
 * Paints one body in planet-local space, centred on the origin, at the
 * drawn radius `planetParallax` reports. The caller translates first.
 */
export function drawPlanet(ctx: CanvasRenderingContext2D, body: CelestialBody, state: PlanetArtState) {
  const { zoom } = state;
  const radius = body.radius * PLANET_SCALE;
  const paint = PAINT[body.id] ?? DEFAULT_PAINT;
  const atmosphere = body.atmosphere;
  const airless = !atmosphere;
  const roche = body.id === "brindle";
  const outline = roche ? rocheOutline(radius) : null;

  /** The body's silhouette: a disc, or Roche's irregular outline. */
  const shape = () => {
    ctx.beginPath();
    if (outline) {
      outline.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
      ctx.closePath();
    } else {
      ctx.arc(0, 0, radius, 0, TAU);
    }
  };

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  /* 1. atmosphere: a soft shell of scattered light around the limb, brighter towards the sun */
  if (atmosphere) {
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 1.16);
    glow.addColorStop(0, tint(atmosphere, 0));
    glow.addColorStop(0.78, tint(atmosphere, 0.35));
    glow.addColorStop(1, tint(atmosphere, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.16, 0, TAU);
    ctx.fill();
    const sx = LIGHT_DIR.x * radius * 0.6;
    const sy = LIGHT_DIR.y * radius * 0.6;
    const sunward = ctx.createRadialGradient(sx, sy, radius * 0.3, sx, sy, radius * 1.1);
    sunward.addColorStop(0, tint(atmosphere, 0.22));
    sunward.addColorStop(1, tint(atmosphere, 0));
    ctx.fillStyle = sunward;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.16, 0, TAU);
    ctx.fill();
  }

  /* 2. globe: one light source, offset towards it */
  const lx = LIGHT_DIR.x * radius * 0.45;
  const ly = LIGHT_DIR.y * radius * 0.45;
  const globe = ctx.createRadialGradient(lx, ly, radius * 0.05, lx, ly, radius * 1.2);
  globe.addColorStop(0, paint.highlight);
  globe.addColorStop(0.55, body.color);
  globe.addColorStop(1, paint.dark);
  ctx.fillStyle = globe;
  shape();
  ctx.fill();

  /* 3-5. surface, lights, terminator and limb darkening, all inside the silhouette */
  ctx.save();
  shape();
  ctx.clip();

  const surface = surfaceFor(body, radius, paint);
  if (surface) {
    const span = radius * SURFACE_SPAN;
    ctx.drawImage(surface, -span, -span, span * 2, span * 2);
  }
  if (body.id === "cinder") drawRayleighLights(ctx, radius, zoom);
  if (roche) drawRocheLamps(ctx, radius, state);

  /* sub-solar sheen */
  const sheen = ctx.createRadialGradient(lx, ly, 0, lx, ly, radius * 0.55);
  sheen.addColorStop(0, "rgba(255,248,230,.13)");
  sheen.addColorStop(1, "rgba(255,248,230,0)");
  ctx.fillStyle = sheen;
  shape();
  ctx.fill();

  const terminator = ctx.createLinearGradient(
    LIGHT_DIR.x * radius * 0.1,
    LIGHT_DIR.y * radius * 0.1,
    -LIGHT_DIR.x * radius * 0.9,
    -LIGHT_DIR.y * radius * 0.9,
  );
  terminator.addColorStop(0, tint(paint.shadow, 0));
  terminator.addColorStop(0.45, tint(paint.shadow, 0.55));
  terminator.addColorStop(1, tint(paint.shadow, 0.94));
  ctx.fillStyle = terminator;
  shape();
  ctx.fill();

  const limb = ctx.createRadialGradient(0, 0, radius * 0.78, 0, 0, radius);
  limb.addColorStop(0, "rgba(0,0,0,0)");
  limb.addColorStop(1, "rgba(0,0,0,.55)");
  ctx.fillStyle = limb;
  shape();
  ctx.fill();

  /* haze thickening towards the lit limb, where the air is seen edge-on */
  if (atmosphere) {
    const haze = ctx.createRadialGradient(0, 0, radius * 0.86, 0, 0, radius);
    haze.addColorStop(0, tint(atmosphere, 0));
    haze.addColorStop(1, tint(atmosphere, 0.42));
    ctx.fillStyle = haze;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, LIGHT - 1.75, LIGHT + 1.75);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  /* 6. the lit limb, and a hard edge on anything without air */
  ctx.strokeStyle = tint(roche ? paint.highlight : (atmosphere ?? paint.highlight), 0.7);
  ctx.lineWidth = 2 / zoom;
  ctx.beginPath();
  if (outline) {
    /* the lit run of Roche's own outline; a true circle would cut across the rock */
    const lit = outline
      .map((point, index) => ({ point, offset: Math.atan2(Math.sin((index * TAU) / 24 - LIGHT), Math.cos((index * TAU) / 24 - LIGHT)) }))
      .filter((vertex) => Math.abs(vertex.offset) <= 1.6)
      .sort((a, b) => a.offset - b.offset);
    lit.forEach((vertex, index) => (index === 0 ? ctx.moveTo(vertex.point.x, vertex.point.y) : ctx.lineTo(vertex.point.x, vertex.point.y)));
  } else {
    ctx.arc(0, 0, radius, LIGHT - 1.6, LIGHT + 1.6);
  }
  ctx.stroke();
  if (airless) {
    ctx.strokeStyle = "rgba(0,0,0,.6)";
    ctx.lineWidth = 1.5 / zoom;
    shape();
    ctx.stroke();
  } else {
    /* airglow: the thinnest thread of atmosphere still visible on the night limb */
    ctx.strokeStyle = tint(atmosphere, 0.22);
    ctx.lineWidth = 1.2 / zoom;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.005, LIGHT + Math.PI - 1.3, LIGHT + Math.PI + 1.3);
    ctx.stroke();
  }

  /* elevators hang outside the disc, so they come after the limb */
  if (body.id === "cinder") drawRayleighElevators(ctx, radius, zoom, state.time);

  ctx.restore();
}
