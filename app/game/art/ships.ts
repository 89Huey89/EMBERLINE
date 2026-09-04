import type { ShipDefinition, Vec2 } from "../types";

/**
 * Ship art lives here, separate from simulation code.
 *
 * Every ship is drawn in its own local space: the nose points along +x,
 * +y is the ship's starboard side, and the caller applies position,
 * rotation and `scale`. See ART_DIRECTION.md for the rules these
 * drawings follow.
 */

export type ShipArtState = {
  upgrades: string[];
  thrusting: boolean;
  showLabel: boolean;
  time: number;
};

export type ShipArt = {
  /** World scale applied by the caller before drawing. */
  scale: number;
  /** Ship-local clamp positions, in slot order. Cargo is centred on these. */
  clamps: Vec2[];
  /** Scale applied to a cargo unit sitting in a clamp. */
  cargoScale: number;
  /** Ship-local x of the exhaust origin (negative = behind centre). */
  exhaust: number;
  /** Whether cargo is painted before ("under") or after ("over") the hull. */
  cargoLayer: "under" | "over";
  /** Ship-local mount points for the retro-thruster upgrade: port (-y) then starboard (+y). */
  retroPorts: [Vec2, Vec2];
  drawHull: (ctx: CanvasRenderingContext2D, state: ShipArtState) => void;
  /** Painted after cargo, once per clamp. Used for cradles and tie-down straps. */
  drawClamp?: (ctx: CanvasRenderingContext2D, slot: number, occupied: boolean) => void;
};

const TAU = Math.PI * 2;

/* ------------------------------------------------------------------ */
/* Shared palette. Keep this list short; see ART_DIRECTION.md.          */
/* ------------------------------------------------------------------ */
export const PAINT = {
  outline: "#1b1a16",
  bone: "#e3dccb",
  boneLight: "#f6f1e4",
  boneShade: "#b6ad98",
  oxide: "#b8452f",
  oxideDeep: "#7d2c1f",
  steel: "#3b3a35",
  steelLight: "#5c5a50",
  steelDeep: "#26251f",
  amber: "#d9a24a",
  amberLight: "#f4c76a",
  copper: "#9c6a3c",
  copperLight: "#c98c52",
  glass: "#213f3c",
  glassLight: "#4f8b84",
  teal: "#70aaa4",
  tail: "#d8402c",
  marker: "#f2b544",
  flameCore: "#fff1c8",
  flame: "#f0a94a",
};

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */
function outlined(ctx: CanvasRenderingContext2D, fill: string, width = 1.4) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = PAINT.outline;
  ctx.lineWidth = width;
  ctx.stroke();
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function light(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, r = 1.3) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

/* ------------------------------------------------------------------ */
/* KESTREL U-3 — light courier (starting ship)                          */
/*                                                                      */
/* A small orbital truck: pressurised cab up front, open truss spine     */
/* with two container cradles either side, one engine drum behind.      */
/* Length ≈ 86 units nose to bell, width ≈ 44 units across the cradles. */
/* ------------------------------------------------------------------ */
const KESTREL_CLAMPS: Vec2[] = [
  { x: -5, y: -13.6 },
  { x: -5, y: 13.6 },
  { x: -28, y: -13.6 }, // Loadmaster clamps upgrade
];

/** Retro-thruster mount points: clear spine between the two cradles, outside the rails. */
const KESTREL_RETRO_PORTS: [Vec2, Vec2] = [
  { x: -14, y: -10.5 },
  { x: -14, y: 10.5 },
];

function drawKestrelHull(ctx: CanvasRenderingContext2D, state: ShipArtState) {
  const { upgrades, thrusting, showLabel, time } = state;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  /* --- exhaust (behind everything) --- */
  if (thrusting) {
    const flicker = 0.85 + Math.sin(time * 41) * 0.08 + Math.random() * 0.1;
    const length = 30 * flicker;
    const flame = ctx.createLinearGradient(-57 - length, 0, -57, 0);
    flame.addColorStop(0, "rgba(240,169,74,0)");
    flame.addColorStop(0.55, "rgba(240,169,74,.7)");
    flame.addColorStop(1, PAINT.flameCore);
    ctx.fillStyle = flame;
    ctx.beginPath();
    ctx.moveTo(-55, -7.5);
    ctx.quadraticCurveTo(-58 - length * 0.6, -4.5, -57 - length, 0);
    ctx.quadraticCurveTo(-58 - length * 0.6, 4.5, -55, 7.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = PAINT.flameCore;
    ctx.beginPath();
    ctx.ellipse(-58, 0, 4 + flicker * 3, 3.6, 0, 0, TAU);
    ctx.fill();
  }

  /* --- engine drum --- */
  const hasBell = upgrades.includes("engine");
  // thermal shroud / rear bumper with hazard chevrons
  // bell (larger with the Copperbell upgrade), drawn first so the shroud overlaps it
  ctx.beginPath();
  if (hasBell) {
    ctx.moveTo(-50, -7); ctx.lineTo(-60, -11.5); ctx.lineTo(-60, 11.5); ctx.lineTo(-50, 7);
  } else {
    ctx.moveTo(-50, -6); ctx.lineTo(-56, -8.5); ctx.lineTo(-56, 8.5); ctx.lineTo(-50, 6);
  }
  ctx.closePath();
  outlined(ctx, hasBell ? PAINT.copper : PAINT.steelDeep, 1.2);
  ctx.strokeStyle = hasBell ? PAINT.copperLight : PAINT.steelLight;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(hasBell ? -56 : -53, hasBell ? -9.5 : -7.5); ctx.lineTo(hasBell ? -56 : -53, hasBell ? 9.5 : 7.5); ctx.stroke();
  // thermal shroud / rear bumper with hazard chevrons
  rounded(ctx, -52, -13.5, 7, 27, 1.5);
  outlined(ctx, PAINT.steelDeep);
  ctx.save();
  ctx.beginPath();
  ctx.rect(-51.5, -13, 6, 26);
  ctx.clip();
  ctx.fillStyle = PAINT.amber;
  for (let y = -16; y < 14; y += 6) {
    ctx.beginPath();
    ctx.moveTo(-52, y); ctx.lineTo(-45, y + 3.5); ctx.lineTo(-45, y + 6.5); ctx.lineTo(-52, y + 3);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // drum body
  rounded(ctx, -46, -12, 15, 24, 4);
  outlined(ctx, PAINT.steel);
  ctx.strokeStyle = PAINT.steelDeep;
  ctx.lineWidth = 1;
  for (let x = -44; x <= -33; x += 2.4) {
    ctx.beginPath(); ctx.moveTo(x, -11); ctx.lineTo(x, 11); ctx.stroke();
  }
  ctx.strokeStyle = PAINT.steelLight;
  ctx.beginPath(); ctx.moveTo(-44, -10.4); ctx.lineTo(-33, -10.4); ctx.stroke();
  // oxide band around the drum's waist
  ctx.fillStyle = PAINT.oxide;
  ctx.fillRect(-40.5, -12, 3, 24);
  ctx.fillStyle = PAINT.oxideDeep;
  ctx.fillRect(-40.5, 8.5, 3, 3.5);
  // tail lights on the bumper corners
  light(ctx, -49, -14.6, PAINT.tail, 1.2);
  light(ctx, -49, 14.6, PAINT.tail, 1.2);

  /* --- spine truss --- */
  // long-range tank slung along the centreline, beneath the rails
  if (upgrades.includes("tank")) {
    rounded(ctx, -29, -4.2, 24, 8.4, 4.2);
    outlined(ctx, PAINT.steelLight, 1.2);
    ctx.strokeStyle = PAINT.teal;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-25, -4.2); ctx.lineTo(-25, 4.2); ctx.moveTo(-9, -4.2); ctx.lineTo(-9, 4.2); ctx.stroke();
  }
  // cross bracing
  ctx.strokeStyle = PAINT.steelLight;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  for (let x = -32; x < 8; x += 8) {
    ctx.moveTo(x, -5); ctx.lineTo(x + 8, 5);
    ctx.moveTo(x, 5); ctx.lineTo(x + 8, -5);
  }
  ctx.stroke();
  // rails
  ctx.strokeStyle = PAINT.outline;
  ctx.lineWidth = 3.2;
  ctx.beginPath(); ctx.moveTo(-33, -5.5); ctx.lineTo(8, -5.5); ctx.moveTo(-33, 5.5); ctx.lineTo(8, 5.5); ctx.stroke();
  ctx.strokeStyle = PAINT.steel;
  ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.moveTo(-33, -5.5); ctx.lineTo(8, -5.5); ctx.moveTo(-33, 5.5); ctx.lineTo(8, 5.5); ctx.stroke();
  // amber tie-down rail on the port side (sunlit edge)
  ctx.strokeStyle = PAINT.amber;
  ctx.lineWidth = 0.9;
  ctx.beginPath(); ctx.moveTo(-32, -6.6); ctx.lineTo(7, -6.6); ctx.stroke();
  // side marker lights along both rails
  const blink = Math.sin(time * 2.2) > -0.2;
  for (let x = -30; x <= 6; x += 12) {
    light(ctx, x, -7.4, blink ? PAINT.marker : PAINT.copper, 0.9);
    light(ctx, x, 7.4, blink ? PAINT.marker : PAINT.copper, 0.9);
  }
  // cryogenic umbilical runs along the starboard rail to the cradles
  if (upgrades.includes("cryo")) {
    ctx.strokeStyle = PAINT.teal;
    ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(4, 5.5); ctx.lineTo(-30, 5.5); ctx.lineTo(-30, 8); ctx.stroke();
    ctx.fillStyle = PAINT.teal;
    ctx.fillRect(-2, 6.5, 5, 3);
  }

  /* --- fifth-wheel hitch between cab and spine --- */
  rounded(ctx, 5, -3.6, 6, 7.2, 1);
  outlined(ctx, PAINT.steelDeep, 1.2);

  /* --- cab --- */
  ctx.beginPath();
  ctx.moveTo(9, -9);
  ctx.lineTo(22, -9);
  ctx.quadraticCurveTo(28.5, -8.5, 29, -3);
  ctx.lineTo(29, 3);
  ctx.quadraticCurveTo(28.5, 8.5, 22, 9);
  ctx.lineTo(9, 9);
  ctx.quadraticCurveTo(7.5, 9, 7.5, 7);
  ctx.lineTo(7.5, -7);
  ctx.quadraticCurveTo(7.5, -9, 9, -9);
  ctx.closePath();
  outlined(ctx, PAINT.bone, 1.4);
  // warm shade on the starboard flank, highlight on the port flank
  ctx.fillStyle = PAINT.boneShade;
  ctx.beginPath();
  ctx.moveTo(9, 6); ctx.lineTo(23, 6); ctx.quadraticCurveTo(27, 6, 27.5, 3); ctx.lineTo(27.5, 8); ctx.quadraticCurveTo(27, 8.2, 22, 8.4); ctx.lineTo(9, 8.4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = PAINT.boneLight;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(9.5, -7.6); ctx.lineTo(22, -7.6); ctx.stroke();
  // roof panel seams
  ctx.strokeStyle = "rgba(27,26,22,.35)";
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(14, -8.5); ctx.lineTo(14, 8.5); ctx.moveTo(20.5, -8.5); ctx.lineTo(20.5, 8.5); ctx.stroke();
  // oxide cab stripe, both flanks
  ctx.fillStyle = PAINT.oxide;
  ctx.fillRect(9, -6.4, 12.5, 1.8);
  ctx.fillRect(9, 4.6, 12.5, 1.8);
  // windshield wraps the nose
  ctx.beginPath();
  ctx.moveTo(22.5, -7.2);
  ctx.quadraticCurveTo(27.6, -6.6, 27.9, -2.5);
  ctx.lineTo(27.9, 2.5);
  ctx.quadraticCurveTo(27.6, 6.6, 22.5, 7.2);
  ctx.lineTo(22.5, 4.6);
  ctx.quadraticCurveTo(25.4, 4.4, 25.6, 2);
  ctx.lineTo(25.6, -2);
  ctx.quadraticCurveTo(25.4, -4.4, 22.5, -4.6);
  ctx.closePath();
  outlined(ctx, PAINT.glass, 0.9);
  ctx.strokeStyle = PAINT.glassLight;
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(23.2, -6.2); ctx.quadraticCurveTo(26.6, -5.6, 26.9, -2.4); ctx.stroke();
  // side windows
  ctx.fillStyle = PAINT.glass;
  ctx.fillRect(15, -9, 5, 1.9);
  ctx.fillRect(15, 7.1, 5, 1.9);
  // mirrors
  ctx.fillStyle = PAINT.steelDeep;
  ctx.fillRect(20, -11.2, 2.2, 2.4);
  ctx.fillRect(20, 8.8, 2.2, 2.4);
  // push bar on the nose
  ctx.strokeStyle = PAINT.steelDeep;
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(29.6, -5); ctx.lineTo(29.6, 5); ctx.stroke();
  // clearance lights on the cab corners
  light(ctx, 27.2, -7.4, PAINT.marker, 1.1);
  light(ctx, 27.2, 7.4, PAINT.marker, 1.1);
  light(ctx, 9.4, -9.3, PAINT.marker, 0.9);
  light(ctx, 9.4, 9.3, PAINT.marker, 0.9);
  // sensor mast / wake scanner dish on the roof
  if (upgrades.includes("scanner")) {
    ctx.strokeStyle = PAINT.steelDeep;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(12, -8); ctx.lineTo(12, -13.5); ctx.stroke();
    ctx.beginPath(); ctx.arc(12, -14.5, 2.6, 0, TAU);
    outlined(ctx, PAINT.boneShade, 0.8);
    light(ctx, 12, -14.5, PAINT.teal, 0.8);
  } else {
    ctx.strokeStyle = PAINT.steelDeep;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(12, -8); ctx.lineTo(12, -13); ctx.stroke();
    light(ctx, 12, -13.4, PAINT.tail, 0.8);
  }
  // quad RCS pods on the cab and drum shoulders
  if (upgrades.includes("rcs")) {
    ctx.fillStyle = PAINT.steelLight;
    for (const [x, y] of [[10, -11.5], [10, 9.5], [-38, -15], [-38, 13]] as const) {
      ctx.fillRect(x, y, 4.5, 2);
    }
    ctx.fillStyle = PAINT.teal;
    for (const [x, y] of [[10.5, -12.2], [10.5, 11.2], [-37.5, -15.7], [-37.5, 14.7]] as const) {
      ctx.fillRect(x, y, 3.5, 0.9);
    }
  }
  // retro thruster pods on the spine, nozzles opening toward the nose
  if (upgrades.includes("retro")) {
    KESTREL_RETRO_PORTS.forEach((port) => drawKestrelRetroPod(ctx, port));
  }
  // registry on the roof
  if (showLabel) {
    ctx.fillStyle = PAINT.oxideDeep;
    ctx.font = "700 4.2px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("U-3", 17.2, 0.4);
  }
}

/** One retro-thruster pod, drawn nose-forward; mirrored onto the port side via a y-flip. */
function drawKestrelRetroPod(ctx: CanvasRenderingContext2D, at: Vec2) {
  const side = Math.sign(at.y) || 1;
  const y = Math.abs(at.y);
  ctx.save();
  ctx.translate(at.x, 0);
  ctx.scale(1, side);
  rounded(ctx, -3.6, y - 2, 7.2, 4, 1.1);
  outlined(ctx, PAINT.steelLight, 1.1);
  ctx.strokeStyle = PAINT.steelDeep;
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(-3.2, y); ctx.lineTo(3.2, y); ctx.stroke();
  // nozzle cone opening toward the nose (+x): this is what fires when braking or reversing
  ctx.fillStyle = PAINT.steelDeep;
  ctx.beginPath();
  ctx.moveTo(3.6, y - 1.6); ctx.lineTo(7.2, y); ctx.lineTo(3.6, y + 1.6);
  ctx.closePath();
  ctx.fill();
  light(ctx, -2.4, y, PAINT.teal, 0.75);
  ctx.restore();
}

function drawKestrelClamp(ctx: CanvasRenderingContext2D, slot: number, occupied: boolean) {
  const at = KESTREL_CLAMPS[slot];
  if (!at) return;
  const side = Math.sign(at.y) || 1;
  ctx.save();
  ctx.translate(at.x, 0);
  // cradle arms reaching out from the rail
  ctx.strokeStyle = PAINT.outline;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(-7, side * 5.5); ctx.lineTo(-7, side * 8);
  ctx.moveTo(7, side * 5.5); ctx.lineTo(7, side * 8);
  ctx.stroke();
  ctx.strokeStyle = PAINT.steelLight;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  if (occupied) {
    // amber tie-down straps over the container, hooked to the rail
    ctx.strokeStyle = PAINT.outline;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-7, side * 6); ctx.lineTo(-7, side * 22);
    ctx.moveTo(7, side * 6); ctx.lineTo(7, side * 22);
    ctx.stroke();
    ctx.strokeStyle = PAINT.amber;
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.fillStyle = PAINT.amberLight;
    ctx.fillRect(-8, side * 13.6 - 1.2, 2, 2.4);
    ctx.fillRect(6, side * 13.6 - 1.2, 2, 2.4);
    ctx.fillStyle = PAINT.outline;
    ctx.fillRect(-8, side * 22 - 0.8, 2, 1.6);
    ctx.fillRect(6, side * 22 - 0.8, 2, 1.6);
  } else {
    // empty cradle: a bed frame flush with the rail so the ship reads as an unloaded truck
    ctx.strokeStyle = PAINT.steel;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-10, side * 8); ctx.lineTo(10, side * 8);
    ctx.moveTo(-10, side * 8); ctx.lineTo(-10, side * 11.5);
    ctx.moveTo(10, side * 8); ctx.lineTo(10, side * 11.5);
    ctx.stroke();
    ctx.strokeStyle = PAINT.amber;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-10, side * 8.9); ctx.lineTo(10, side * 8.9);
    ctx.stroke();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Legacy generic hull — still used by the Mule, Atlas and Mastiff      */
/* until each gets its own drawing in a later art pass.                 */
/* ------------------------------------------------------------------ */
/** Retro-thruster mount points shared by every legacy hull: a clear gap between the two RCS shoulders. */
const LEGACY_RETRO_PORTS: [Vec2, Vec2] = [
  { x: 1.5, y: -12 },
  { x: 1.5, y: 12 },
];

function legacyClamps(ship: ShipDefinition, count: number): Vec2[] {
  return Array.from({ length: count }, (_, index) => {
    const row = index % 2 === 0 ? -1 : 1;
    const column = Math.floor(index / 2);
    return { x: -2 - column * 24, y: row * (ship.id === "hauler" ? 24 : 19) };
  });
}

function legacyHull(ship: ShipDefinition) {
  return (ctx: CanvasRenderingContext2D, state: ShipArtState) => {
    const { upgrades, thrusting, showLabel } = state;
    ctx.lineJoin = "round";
    if (upgrades.includes("tank")) {
      ctx.fillStyle = "#4a5c5e";
      ctx.beginPath();
      ctx.roundRect(-22, -6, 32, 12, 6);
      ctx.fill();
      ctx.strokeStyle = "#8facaa";
      ctx.stroke();
    }
    ctx.strokeStyle = "#655e51";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-22, -11); ctx.lineTo(12, -11); ctx.lineTo(24, 0); ctx.lineTo(12, 11); ctx.lineTo(-22, 11);
    ctx.stroke();
    const hull = ctx.createLinearGradient(-20, -12, 22, 12);
    hull.addColorStop(0, "#5f5c53");
    hull.addColorStop(0.45, ship.color);
    hull.addColorStop(1, "#857c69");
    ctx.fillStyle = hull;
    ctx.beginPath();
    ctx.moveTo(-17, -10); ctx.lineTo(11, -10); ctx.lineTo(24, 0); ctx.lineTo(11, 10); ctx.lineTo(-17, 10); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#201f1b";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "#202728";
    ctx.beginPath();
    ctx.moveTo(11, -7); ctx.lineTo(20, -1); ctx.lineTo(11, -1); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(11, 7); ctx.lineTo(20, 1); ctx.lineTo(11, 1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#d9b04c";
    ctx.fillRect(2, -10, 3, 20);
    ctx.fillStyle = "#ba5638";
    ctx.fillRect(-4, -9, 2, 18);

    ctx.fillStyle = "#272923";
    ctx.beginPath();
    ctx.moveTo(-18, -9); ctx.lineTo(-27, -13); ctx.lineTo(-27, 13); ctx.lineTo(-18, 9); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#80765f";
    ctx.stroke();
    ctx.fillStyle = "#c4743f";
    ctx.fillRect(-29, -8, 4, 16);

    if (thrusting) {
      const flame = ctx.createLinearGradient(-65, 0, -24, 0);
      flame.addColorStop(0, "rgba(217,100,49,0)");
      flame.addColorStop(0.65, "rgba(226,116,62,.75)");
      flame.addColorStop(1, "#f7e0a4");
      ctx.fillStyle = flame;
      ctx.beginPath();
      ctx.moveTo(-27, -7); ctx.lineTo(-50 - Math.random() * 12, 0); ctx.lineTo(-27, 7); ctx.closePath();
      ctx.fill();
    }

    if (upgrades.includes("engine")) {
      ctx.strokeStyle = "#d8a24b";
      ctx.lineWidth = 2;
      ctx.strokeRect(-33, -10, 6, 20);
    }
    if (upgrades.includes("rcs")) {
      ctx.fillStyle = "#6fa7a2";
      ctx.fillRect(-10, -15, 7, 5);
      ctx.fillRect(-10, 10, 7, 5);
      ctx.fillRect(11, -12, 5, 4);
      ctx.fillRect(11, 8, 5, 4);
    }
    if (upgrades.includes("retro")) {
      ctx.fillStyle = "#9aa39e";
      ctx.fillRect(-1, -14, 5, 4);
      ctx.fillRect(-1, 10, 5, 4);
      // nozzle cones opening toward the nose: this is what fires when braking or reversing
      ctx.fillStyle = "#23241f";
      ctx.beginPath(); ctx.moveTo(4, -13); ctx.lineTo(7.4, -12); ctx.lineTo(4, -11); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(4, 13); ctx.lineTo(7.4, 12); ctx.lineTo(4, 11); ctx.closePath(); ctx.fill();
    }
    if (upgrades.includes("scanner")) {
      ctx.strokeStyle = "#c8b66b";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(2, -10); ctx.lineTo(5, -19); ctx.lineTo(9, -21); ctx.stroke();
      ctx.beginPath(); ctx.arc(9, -21, 2, 0, TAU); ctx.stroke();
    }
    if (upgrades.includes("cryo")) {
      ctx.strokeStyle = "#73c4c0";
      ctx.beginPath(); ctx.moveTo(-5, 10); ctx.lineTo(-1, 16); ctx.lineTo(8, 16); ctx.stroke();
    }

    ctx.fillStyle = "#f6e8b4";
    ctx.beginPath(); ctx.arc(17, -8, 1.5, 0, TAU); ctx.fill();
    ctx.fillStyle = "#d44f36";
    ctx.beginPath(); ctx.arc(17, 8, 1.5, 0, TAU); ctx.fill();
    if (showLabel) {
      ctx.fillStyle = "rgba(16,20,19,.7)";
      ctx.font = "700 5px ui-monospace, monospace";
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(ship.model, -5, 2);
    }
  };
}

function legacyClampStrut(ctx: CanvasRenderingContext2D, clamps: Vec2[], slot: number) {
  const at = clamps[slot];
  if (!at) return;
  const row = Math.sign(at.y) || 1;
  ctx.strokeStyle = "#817158";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(at.x, row * 8);
  ctx.lineTo(at.x, at.y - row * 9);
  ctx.stroke();
}

/* ------------------------------------------------------------------ */
/* Registry                                                             */
/* ------------------------------------------------------------------ */
export function shipArtFor(ship: ShipDefinition): ShipArt {
  if (ship.id === "courier") {
    return {
      scale: 1,
      clamps: KESTREL_CLAMPS,
      cargoScale: 0.66,
      exhaust: -57,
      cargoLayer: "over",
      retroPorts: KESTREL_RETRO_PORTS,
      drawHull: drawKestrelHull,
      drawClamp: drawKestrelClamp,
    };
  }
  const clamps = legacyClamps(ship, ship.slots + 1);
  return {
    scale: ship.id === "hauler" ? 1.35 : 1.12,
    clamps,
    cargoScale: ship.id === "hauler" ? 0.92 : 0.72,
    exhaust: -27,
    cargoLayer: "under",
    retroPorts: LEGACY_RETRO_PORTS,
    drawHull: legacyHull(ship),
    drawClamp: (ctx, slot, occupied) => {
      if (occupied) legacyClampStrut(ctx, clamps, slot);
    },
  };
}

/**
 * Paints a ship on its own, nose to the right, fitted inside a box.
 * Used by the shipyard cards so the card shows exactly what flies.
 */
export function drawShipPortrait(ctx: CanvasRenderingContext2D, ship: ShipDefinition, width: number, height: number) {
  const art = shipArtFor(ship);
  const bounds = ship.id === "courier" ? { left: -60, right: 32, top: -26, bottom: 26 } : { left: -36, right: 26, top: -28, bottom: 28 };
  const fit = Math.min((width - 16) / (bounds.right - bounds.left), (height - 10) / (bounds.bottom - bounds.top));
  ctx.save();
  ctx.translate(width / 2 - ((bounds.left + bounds.right) / 2) * fit, height / 2);
  ctx.scale(fit, fit);
  art.drawHull(ctx, { upgrades: [], thrusting: false, showLabel: true, time: 0 });
  art.clamps.slice(0, ship.slots).forEach((_, slot) => art.drawClamp?.(ctx, slot, false));
  ctx.restore();
}
