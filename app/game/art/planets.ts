import type { CelestialBody, Vec2 } from "../types";

/**
 * Planet art lives here, separate from simulation code.
 *
 * Planets are BACKGROUND. They are painted at a parallax-shifted centre and
 * at 92% of their true radius, so they drift more slowly than the stations
 * and freight that share the camera transform. The simulation is untouched
 * by this: gravity and the gravity guide rings still use the true position
 * and the true radius. Nothing in the world collides with a planet.
 *
 * `drawPlanet` paints in planet-local space with the disc centred on the
 * origin, so the caller translates to `planetParallax(body, camera)` first
 * and the drawing uses the matching drawn radius. See ART_DIRECTION.md.
 */

const TAU = Math.PI * 2;

/** How much of the camera's motion a planet ignores. 1 = pinned to the world. */
export const PLANET_PARALLAX = 0.85;
/** Drawn radius as a fraction of the body's true (simulation) radius. */
export const PLANET_SCALE = 0.92;

/** System light angle. Everything on every planet is lit from here. */
const LIGHT = -2.53; // sun at upper left, toward the busy side of the system
const LIGHT_DIR = { x: Math.cos(LIGHT), y: Math.sin(LIGHT) };

export type PlanetArtState = {
  time: number;
  /** Camera zoom; keeps hairlines and lamp dots readable at any zoom. */
  zoom: number;
};

type PlanetPaint = { highlight: string; dark: string };

const PAINT: Record<string, PlanetPaint> = {
  cinder: { highlight: "#dc9560", dark: "#1a1412" },
  morrow: { highlight: "#dfe9e6", dark: "#0b1214" },
  brindle: { highlight: "#96806a", dark: "#1a1412" },
};
const DEFAULT_PAINT: PlanetPaint = { highlight: "#c8b79c", dark: "#141210" };

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */
/** `#rrggbb` plus an alpha, as an `rgba()` string. */
function tint(hex: string, alpha: number) {
  const value = parseInt(hex.replace("#", ""), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r},${g},${b},${alpha})`;
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
function drawRayleighSurface(ctx: CanvasRenderingContext2D, radius: number, zoom: number) {
  const belts = [-0.62, -0.38, -0.12, 0.14, 0.4, 0.66];
  const heights = [0.1, 0.16, 0.12, 0.18, 0.11, 0.14];
  belts.forEach((offset, index) => {
    ctx.fillStyle = index % 2 === 0 ? "rgba(244,196,134,.10)" : "rgba(107,58,36,.14)";
    ctx.beginPath();
    ctx.ellipse(0, radius * offset, radius * 1.05, radius * heights[index], -0.18, 0, TAU);
    ctx.fill();
  });

  /* two long-lived storms, drifting with the belts */
  ctx.fillStyle = "rgba(255,220,180,.18)";
  ctx.beginPath();
  ctx.ellipse(radius * 0.3, radius * 0.35, radius * 0.12, radius * 0.05, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-radius * 0.45, -radius * 0.2, radius * 0.09, radius * 0.04, 0, 0, TAU);
  ctx.fill();

  /* city lights, only on the night side and only in the settled latitudes */
  const side = Math.max(1.5, 1.6 / zoom);
  ctx.fillStyle = tint("#f2b544", 0.85);
  for (let index = 0; index < 90; index += 1) {
    const angle = index * 2.399;
    const r = radius * (0.15 + ((index * 37) % 80) / 100);
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (x * LIGHT_DIR.x + y * LIGHT_DIR.y >= -0.15 * radius) continue;
    if (Math.abs(y) >= radius * 0.45) continue;
    ctx.fillRect(x, y, side, side);
  }
}

/** Orbital elevator threads, drawn outside the disc so they read as tethers. */
function drawRayleighElevators(ctx: CanvasRenderingContext2D, radius: number, zoom: number) {
  ctx.strokeStyle = "rgba(242,181,68,.35)";
  ctx.lineWidth = 1 / zoom;
  ctx.beginPath();
  for (const angle of [LIGHT + 2.2, LIGHT + 2.9, LIGHT + 3.5]) {
    ctx.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    ctx.lineTo(Math.cos(angle) * radius * 1.12, Math.sin(angle) * radius * 1.12);
  }
  ctx.stroke();
}

/* ------------------------------------------------------------------ */
/* NERNST — fractured ice moon                                          */
/* ------------------------------------------------------------------ */
function drawNernstSurface(ctx: CanvasRenderingContext2D, radius: number) {
  /* fracture systems: three-segment polylines walking in from the limb */
  for (let index = 0; index < 9; index += 1) {
    const angle = index * 0.7;
    let x = Math.cos(angle) * radius * 0.9;
    let y = Math.sin(angle) * radius * 0.9;
    let heading = angle + Math.PI;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let segment = 0; segment < 3; segment += 1) {
      heading += (index + segment) % 2 === 0 ? 0.5 : -0.5;
      x += Math.cos(heading) * radius * 0.35;
      y += Math.sin(heading) * radius * 0.35;
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(157,196,196,.45)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.strokeStyle = "rgba(220,240,240,.5)";
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  /* craters: a lit rim towards the light, a hard shadow rim away from it */
  for (let index = 0; index < 7; index += 1) {
    const angle = index * 2.1;
    const distance = radius * (0.2 + ((index * 13) % 50) / 100);
    const cx = Math.cos(angle) * distance;
    const cy = Math.sin(angle) * distance;
    const r = radius * (0.05 + (index % 3) * 0.035);
    ctx.fillStyle = "rgba(0,0,0,.12)";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, LIGHT - 1.2, LIGHT + 1.2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,.38)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, LIGHT + 1.9, LIGHT + 4.4);
    ctx.stroke();
  }
}

/* ------------------------------------------------------------------ */
/* ROCHE — nickel-iron body, tunnelled and lamped                       */
/* ------------------------------------------------------------------ */
function drawRocheSurface(ctx: CanvasRenderingContext2D, radius: number, state: PlanetArtState) {
  for (let index = 0; index < 6; index += 1) {
    const angle = index * 1.9;
    const cx = Math.cos(angle) * radius * 0.5;
    const cy = Math.sin(angle) * radius * 0.5;
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.beginPath();
    ctx.ellipse(cx, cy, radius * 0.12, radius * 0.08, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(150,128,106,.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx, cy, radius * 0.12, radius * 0.08, 0, LIGHT - 1.2, LIGHT + 1.2);
    ctx.stroke();
  }

  /* the worked face: a tunnel run with eight navigation lamps along it */
  const lamp = (index: number) => {
    const angle = LIGHT + 2.6 + (index / 7) * 1.6;
    return { x: Math.cos(angle) * radius * 0.55, y: Math.sin(angle) * radius * 0.55 };
  };
  ctx.strokeStyle = "rgba(242,181,68,.2)";
  ctx.lineWidth = 1 / state.zoom;
  ctx.beginPath();
  for (let index = 0; index < 8; index += 1) {
    const at = lamp(index);
    if (index === 0) ctx.moveTo(at.x, at.y);
    else ctx.lineTo(at.x, at.y);
  }
  ctx.stroke();
  const dot = Math.max(1.2, 1.4 / state.zoom);
  for (let index = 0; index < 8; index += 1) {
    if (Math.sin(state.time * 2 + index) <= 0) continue;
    const at = lamp(index);
    ctx.fillStyle = index % 2 === 0 ? "#d8402c" : "#f2b544";
    ctx.beginPath();
    ctx.arc(at.x, at.y, dot, 0, TAU);
    ctx.fill();
  }
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

  /* 1. atmosphere: a soft shell of scattered light around the limb */
  if (atmosphere) {
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 1.16);
    glow.addColorStop(0, tint(atmosphere, 0));
    glow.addColorStop(0.78, tint(atmosphere, 0.35));
    glow.addColorStop(1, tint(atmosphere, 0));
    ctx.fillStyle = glow;
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

  /* 3-5. surface, terminator and limb darkening, all inside the silhouette */
  ctx.save();
  shape();
  ctx.clip();

  if (roche) drawRocheSurface(ctx, radius, state);
  else if (body.id === "morrow") drawNernstSurface(ctx, radius);
  else drawRayleighSurface(ctx, radius, zoom);

  const terminator = ctx.createLinearGradient(
    LIGHT_DIR.x * radius * 0.1,
    LIGHT_DIR.y * radius * 0.1,
    -LIGHT_DIR.x * radius * 0.9,
    -LIGHT_DIR.y * radius * 0.9,
  );
  terminator.addColorStop(0, "rgba(6,8,10,0)");
  terminator.addColorStop(1, "rgba(6,8,10,.92)");
  ctx.fillStyle = terminator;
  shape();
  ctx.fill();

  const limb = ctx.createRadialGradient(0, 0, radius * 0.78, 0, 0, radius);
  limb.addColorStop(0, "rgba(0,0,0,0)");
  limb.addColorStop(1, "rgba(0,0,0,.55)");
  ctx.fillStyle = limb;
  shape();
  ctx.fill();
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
  }

  /* elevators hang outside the disc, so they come after the limb */
  if (body.id === "cinder") drawRayleighElevators(ctx, radius, zoom);

  ctx.restore();
}
