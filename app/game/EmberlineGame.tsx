"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BODIES,
  CARGO,
  CONTRACTS,
  SALVAGE_ZONE,
  SHIPS,
  STATIONS,
  UPGRADES,
  WORLD,
} from "./data";
import type { CargoKind, CelestialBody, ContractDefinition, ShipDefinition, Station } from "./types";
import { drawCargoUnit } from "./art/cargo";
import { drawDebrisChunk } from "./art/debris";
import { ATMOSPHERE_TOP, drawPlanet, planetParallax, PLANET_SCALE, SURFACE_CONTACT } from "./art/planets";
import { drawShipPortrait, shipArtFor } from "./art/ships";
import { BERTH_CAPTURE, berthPoint, drawStation, stationColliders } from "./art/stations";
import { orbitRadius, stationPose } from "./orbits";

const TAU = Math.PI * 2;
const SAVE_KEY = "emberline-save-v1";

/* ------------------------------------------------------------------ */
/* Contact and damage                                                   */
/*                                                                      */
/* Station structure and planet surfaces are solid, and every contact is */
/* charged to the hull at a rate set by the closing speed alone. The     */
/* numbers below are the whole difficulty curve: a nudge under the scuff */
/* speed is free, a bad arrival is expensive, and a hard enough hit both */
/* tears freight off the spine and can end the shift.                    */
/* ------------------------------------------------------------------ */

/** Contact below this closing speed only scuffs paint. */
const SCUFF_SPEED = 18;
/** Hull points lost per m/s of closing speed above the scuff threshold. */
const DAMAGE_PER_SPEED = 1;
/** At or above this, the shock tears a container off its clamps. */
const SHED_SPEED = 55;
/** Fraction of the normal velocity a contact returns; the rest is damage. */
const RESTITUTION = 0.32;
/** Contact radius of the flown ship, by class. Matches the drawn silhouette. */
const HULL_RADIUS = { small: 22, standard: 30, large: 38 } as const;
/** Seconds between repeats of a standing warning, so it does not flood the net. */
const WARNING_INTERVAL = 2.2;
/** Seconds between minor impact reports. A serious hit ignores this entirely. */
const IMPACT_INTERVAL = 1;
/** Hull points that make an impact worth interrupting anything else to say. */
const URGENT_DAMAGE = 10;

/* ------------------------------------------------------------------ */
/* Arrears                                                              */
/*                                                                      */
/* Nobody dies in this game; they go broke. An account is allowed to go */
/* under, and being under is the failure state: dispatch holds back the */
/* work worth having and the yard stops selling you anything but the    */
/* propellant you need to earn your way back.                           */
/*                                                                      */
/* The one rule that must never break is that a pilot can always work.  */
/* Two things guarantee it: propellant is sold on the tab however deep  */
/* the hole is, and the ceiling below is set above the best-paying job  */
/* on Pilgrim's board — which is where every rescue puts you down.      */
/* ------------------------------------------------------------------ */

/** What the rescue tug bills for a recovery under power. */
const TOW_FEE = 1200;
/** The excess on a hull written off entirely. */
const INSURANCE_EXCESS = 1400;
/** The best-paying manifest dispatch will book to an overdrawn account. */
const ARREARS_CEILING = 3000;
/**
 * Ceiling on gravitational acceleration, m/s².
 *
 * Ships accelerate at 13-19 m/s² empty, so a capped well can be climbed out
 * of light and cannot be climbed straight out of loaded. That is the point:
 * a close pass with freight aboard has to be flown around, not through.
 */
const GRAVITY_CAP = 16;
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
const GRAVITY_FULL = 2.2;
const GRAVITY_REACH = 2.75;

/* ------------------------------------------------------------------ */
/* Freight condition                                                    */
/*                                                                      */
/* Two failure modes for a load in flight, not one. Fragile freight     */
/* cannot tolerate ordinary piloting — it wants the brake favored over   */
/* the throttle even on a light ship — while everything else shrugs off */
/* anything short of numbers a loaded ship ordinarily never produces.   */
/* A load that arrives too far gone is not merely worth less: the       */
/* destination refuses it outright, the same way a real consignee would */
/* turn away a shipment that failed inspection on the dock.             */
/* ------------------------------------------------------------------ */

/**
 * Acceleration, m/s², above which a FRAGILE load starts taking damage.
 *
 * Ships make 13-19 m/s² empty and about 10 loaded (see WORLD in data.ts),
 * so the threshold has to sit under the loaded floor or fragile freight
 * would never wear in ordinary flight. 9 does that: the retro burn a
 * loaded ship uses to slow down stays under it, but the main drive does
 * not, so flying a fragile contract well means favoring the brake over
 * the throttle rather than avoiding thrust altogether.
 */
const FRAGILE_LOAD_THRESHOLD = 9;
/**
 * Condition lost per second per m/s² of acceleration over the threshold.
 *
 * Calibrated against the three ways a pilot actually flies a ~5000 unit run
 * with one fragile unit aboard, where the main drive makes 15.5 m/s²:
 * holding the throttle down the whole way (36 s of burn) arrives at 0.42 and
 * is refused; flipping and burning both ways (24 s) arrives at 0.61 and is
 * paid at 61%; coasting and shedding speed on the retro, which sits under
 * the threshold, arrives at 0.87. Refusal is reserved for carelessness, and
 * the ordinary middle case costs money rather than the whole contract.
 */
const FRAGILE_WEAR_RATE = 0.0025;
/**
 * Acceleration threshold for ordinary freight.
 *
 * Set above what a loaded ship ordinarily produces, so it only bites an
 * empty-ish courier run at full thrust. Ordinary cargo is meant to take
 * its wear from contact, not from being flown competently.
 */
const ORDINARY_LOAD_THRESHOLD = 16;
/** Ordinary wear accrues at well under half the fragile rate. */
const ORDINARY_WEAR_RATE = 0.0015;
/** Average condition below which a destination refuses the manifest outright. */
const CONDITION_REJECT_THRESHOLD = 0.55;
/** Cut of the base reward charged when a load is refused for condition. */
const REJECTION_PENALTY_FRACTION = 0.4;

/* ------------------------------------------------------------------ */
/* Contract deadlines                                                   */
/*                                                                      */
/* timeLimit remains exactly what it always was: the bonus window. What */
/* is new is the hard stop beyond it, set wide enough that every        */
/* contract in the book is comfortably flyable — the tightest window in */
/* the system is elx-quiet's 92 s, against a typical loaded run of      */
/* 40-60 s — so missing it takes real inattention, not a slow ship. A   */
/* blown deadline is not a wreck: the freight already aboard survives   */
/* as salvage, worth less and sellable anywhere, but the manifest and   */
/* its full reward are gone.                                            */
/* ------------------------------------------------------------------ */

/** The hard deadline, as a multiple of the bonus window. */
const DEADLINE_MULTIPLIER = 2.5;
/** Cut of the base reward charged when a contract is voided by its deadline. */
const DEADLINE_PENALTY_FRACTION = 0.3;
/** Seconds ahead of the hard deadline that the net starts warning about it. */
const DEADLINE_WARNING_WINDOW = 20;
/** What expired contract freight is worth once downgraded to ordinary salvage. */
const EXPIRED_SALVAGE_VALUE_FRACTION = 0.5;

/* ------------------------------------------------------------------ */
/* The Wake                                                             */
/*                                                                      */
/* The zone is scenery until a ship is inside it, then it is the         */
/* sharpest risk/reward call in the game. The field is real, simulated   */
/* debris, added to `resolveContacts`' own solids list — never a second  */
/* damage model — so a hit is charged by the SAME closing-speed rule as  */
/* a station or a planet. A chunk's size changes nothing about how hard  */
/* it hits: it changes the contact radius, so a large chunk is simply    */
/* harder to miss than a small one. Sight follows the pickups' own rule  */
/* (215 units, 520 with a scanner) so a blind run is reckless by         */
/* construction, not by a special case. Debris is never saved; like      */
/* pickups and particles it re-seeds deterministically at the same       */
/* moment salvage does, keyed off the same index arithmetic the rest of  */
/* the seed data uses rather than Math.random, so the field is identical */
/* every session while still being cheap to simulate.                    */
/* ------------------------------------------------------------------ */

/** Hazard chunks seeded in the field. */
const DEBRIS_COUNT = 34;
/** Smallest chunk, world units: easy to graze, a scare more than a hit. */
const DEBRIS_MIN_RADIUS = 5;
/** Largest chunk: bigger than any hull radius, so it is never a graze. */
const DEBRIS_MAX_RADIUS = 30;
/**
 * Drift speed range, one axis. The Wake is a SLOW cloud — the zone's own
 * description says so — so debris is not what closes fast on a ship; a
 * ship's own speed through the field is. Keeping drift low keeps that
 * true, and keeps the boundary bounce (see `updateDebrisField`) gentle.
 */
const DEBRIS_MAX_DRIFT = 14;
/** How far inside SALVAGE_ZONE's ring a chunk's own edge must stay. */
const DEBRIS_EDGE_MARGIN = 0.4;
/**
 * Range from the zone centre inside which debris is simulated at all —
 * moved, bounced, checked for contact and for discovery. Outside it the
 * per-frame cost of the whole field is one distance check. Set outside
 * SALVAGE_ZONE's own radius so the field is already live by the time a
 * ship reaches the dust ring drawn around it.
 */
const DEBRIS_ACTIVE_RANGE = SALVAGE_ZONE.radius + 260;
/** id of the one rare recoverable seeded deep in the field. */
const WAKE_PRIZE_ID = "salvage-wake-core";
/**
 * What the listening core is worth intact, before condition. Contracts in
 * this system pay ₡1,550-7,200; this alone lands above every "standard" or
 * "express" job and below only the two hardest heavy/cryogenic contracts —
 * a single find worth a good contract's pay, in a system that can now cost
 * you hull to reach. See the constants above: SCUFF_SPEED is what a careful
 * approach costs (nothing), SHED_SPEED is what a careless one risks.
 */
const WAKE_PRIZE_VALUE = 6200;

type CargoItem = {
  id: string;
  kind: CargoKind;
  condition: number;
  source: "contract" | "salvage";
  value: number;
};

type Pickup = CargoItem & {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  angle: number;
  discovered: boolean;
  /**
   * Freight standing on a station's staging area, as an offset from that
   * station. Ports orbit, so staged units have to ride with the pad instead
   * of being left behind in space the moment the station moves on. Cleared
   * the instant a unit is clamped or shaken loose, after which it is an
   * ordinary object with its own velocity.
   */
  anchor?: { station: string; dx: number; dy: number };
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
};

/** One chunk of the Wake's hazard field: solid, unpowered, un-grabbable. */
type Debris = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  /** Collision radius, and the size `drawDebrisChunk` draws it at. */
  r: number;
  /** Silhouette select for `drawDebrisChunk`: 0 shard, 1 spar, 2 drum. */
  variant: number;
  discovered: boolean;
};

/** A ship drawn at an arbitrary pose: used by the flight view and by the title composition. */
type ShipPose = {
  x: number;
  y: number;
  angle: number;
  shipId: ShipDefinition["id"];
  cargo: CargoItem[];
  upgrades: string[];
  thrusting: boolean;
  showLabel: boolean;
  /** Extra multiplier on the art's own world scale. 1 = flight scale. */
  scale?: number;
};

type GameMutable = {
  ship: { x: number; y: number; vx: number; vy: number; angle: number; av: number; fuel: number; hull: number };
  shipId: ShipDefinition["id"];
  dockedId: string | null;
  targetId: string;
  activeContractId: string | null;
  contractTime: number;
  /** Seconds left before the active contract's hard deadline voids it. */
  contractDeadline: number;
  cargo: CargoItem[];
  pickups: Pickup[];
  particles: Particle[];
  debris: Debris[];
  credits: number;
  reputation: number;
  ownedShips: ShipDefinition["id"][];
  upgrades: string[];
  routeRuns: Record<string, number>;
  completed: number;
  salvageRecovered: number;
  discovered: string[];
  assist: boolean;
  paused: boolean;
  elapsed: number;
  lastSave: number;
  shake: number;
  message: string;
  messageUntil: number;
};

type UiSnapshot = {
  speed: number;
  fuel: number;
  hull: number;
  credits: number;
  reputation: number;
  cargo: CargoItem[];
  dockedId: string | null;
  targetId: string;
  activeContractId: string | null;
  contractTime: number;
  contractDeadline: number;
  assist: boolean;
  shipId: ShipDefinition["id"];
  upgrades: string[];
  ownedShips: ShipDefinition["id"][];
  completed: number;
  salvageRecovered: number;
  message: string;
  distance: number;
  /** Speed relative to the targeted port: what a clean arrival is measured by. */
  closing: number;
  loadingRemaining: number;
};

type AudioRig = {
  context: AudioContext;
  engine: OscillatorNode;
  engineGain: GainNode;
  filter: BiquadFilterNode;
  master: GainNode;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const stationById = (id: string | null) => STATIONS.find((station) => station.id === id);
const shipById = (id: ShipDefinition["id"]) => SHIPS.find((ship) => ship.id === id) ?? SHIPS[0];
const contractById = (id: string | null) => CONTRACTS.find((contract) => contract.id === id);
/** Signed, because an account can be overdrawn and has to look overdrawn. */
const money = (value: number) => {
  const rounded = Math.round(value);
  return `${rounded < 0 ? "−" : ""}₡${Math.abs(rounded).toLocaleString("en-US")}`;
};
const seconds = (value: number) => `${Math.max(0, Math.floor(value / 60))}:${String(Math.max(0, Math.floor(value % 60))).padStart(2, "0")}`;

/* ------------------------------------------------------------------ */
/* Title composition                                                    */
/*                                                                      */
/* The opening frame is posed by hand, not by the simulation: a loaded   */
/* Kestrel low left, engine lit, nose on Pilgrim Exchange, with Cinder   */
/* filling the right edge. See SPEC / ART_DIRECTION.md.                  */
/* ------------------------------------------------------------------ */
const TITLE_STATION = STATIONS[0];
const TITLE_CARGO: CargoItem[] = [
  { id: "title-water", kind: "water", condition: 1, source: "contract", value: 0 },
  { id: "title-metals", kind: "metals", condition: 1, source: "contract", value: 0 },
];
/** Screen fractions the composition places things at, per breakpoint. */
const TITLE_VIEW = {
  wide: { zoom: 0.78, station: { x: 0.55, y: 0.55 }, ship: { x: 0.27, y: 0.76 }, shipScale: 2.4 },
  narrow: { zoom: 0.5, station: { x: 0.56, y: 0.6 }, ship: { x: 0.5, y: 0.8 }, shipScale: 1.8 },
};

/**
 * Camera that lands Pilgrim on its mark, plus the world point the truck
 * flies at. Pilgrim is in orbit even on the title screen, so the mark is
 * taken from where it is now and the whole composition travels with it.
 */
function titleLayout(width: number, height: number, at: { x: number; y: number }) {
  const view = width < 760 ? TITLE_VIEW.narrow : TITLE_VIEW.wide;
  const zoom = view.zoom;
  const camera = {
    zoom,
    x: at.x - (view.station.x * width - width / 2) / zoom,
    y: at.y - (view.station.y * height - height / 2) / zoom,
  };
  const anchor = {
    x: camera.x + (view.ship.x * width - width / 2) / zoom,
    y: camera.y + (view.ship.y * height - height / 2) / zoom,
  };
  return { camera, anchor, shipScale: view.shipScale, station: at };
}

/** Bob and sway around the anchor; nose held on Pilgrim. */
function titleShipPose(anchor: { x: number; y: number }, scale: number, time: number, station: { x: number; y: number }): ShipPose {
  const heading = Math.atan2(station.y - anchor.y, station.x - anchor.x);
  return {
    x: anchor.x + Math.sin(time * 0.9) * 3,
    y: anchor.y + Math.cos(time * 0.7) * 2.5,
    angle: heading + Math.sin(time * Math.PI) * 0.03,
    shipId: "courier",
    cargo: TITLE_CARGO,
    upgrades: [],
    thrusting: true,
    showLabel: true,
    scale,
  };
}

function freshGame(): GameMutable {
  const start = STATIONS[0];
  const berth = berthPoint(start, 100);
  return {
    ship: { x: berth.x, y: berth.y, vx: 0, vy: 0, angle: start.orientation, av: 0, fuel: SHIPS[0].fuelCapacity, hull: 100 },
    shipId: "courier",
    dockedId: start.id,
    targetId: STATIONS[1].id,
    activeContractId: null,
    contractTime: 0,
    contractDeadline: 0,
    cargo: [],
    pickups: [],
    particles: [],
    debris: [],
    credits: 2800,
    reputation: 0,
    ownedShips: ["courier"],
    upgrades: [],
    routeRuns: {},
    completed: 0,
    salvageRecovered: 0,
    discovered: [],
    assist: true,
    paused: false,
    elapsed: 0,
    lastSave: 0,
    shake: 0,
    message: "Pilgrim traffic control welcomes Kestrel U-3.",
    messageUntil: 8,
  };
}

function safeLoad(): GameMutable | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<GameMutable>;
    const base = freshGame();
    const game = { ...base, ...saved, ship: { ...base.ship, ...saved.ship }, particles: [] as Particle[], pickups: [] as Pickup[], debris: [] as Debris[] };
    if (!SHIPS.some((ship) => ship.id === game.shipId)) return null;
    if (!stationById(game.dockedId) && game.dockedId) game.dockedId = "pilgrim";
    if (game.dockedId) {
      const station = stationById(game.dockedId) ?? STATIONS[0];
      const pose = stationPose(station, game.elapsed);
      const berth = berthPoint(station, 100, pose);
      game.ship.x = berth.x;
      game.ship.y = berth.y;
      game.ship.angle = station.orientation;
      game.ship.vx = pose.vx;
      game.ship.vy = pose.vy;
    }
    const active = contractById(game.activeContractId);
    if (active) {
      /* An older save, or one from between saves, may carry no deadline or
         a stale one. There is no way to know how long the contract has
         actually been outstanding, so a restored shift gets the benefit
         of the doubt: the full hard deadline, counted from now. */
      if (active.timeLimit && game.contractDeadline <= 0) {
        game.contractDeadline = active.timeLimit * DEADLINE_MULTIPLIER;
      }
      const origin = stationById(active.origin);
      if (origin) {
        /* Whatever was not clamped before the shift ended is back on its pad,
           which is where the incomplete-manifest message already sends you. */
        const alreadyLoaded = game.cargo.filter((item) => item.source === "contract").length;
        game.pickups.push(...stagedPickups(active, origin, game.elapsed, alreadyLoaded));
      }
    }
    return game;
  } catch {
    return null;
  }
}

/**
 * The freight a contract stands on its origin pad, from `fromIndex` on.
 *
 * Anchored to the station rather than to a point in space: ports orbit, and
 * a pallet left at a fixed coordinate would be abandoned by its own dock
 * within a minute. The anchor is a plain offset because a station's bearing
 * never changes, only where it is.
 */
function stagedPickups(contract: ContractDefinition, station: Station, time: number, fromIndex = 0): Pickup[] {
  const pose = stationPose(station, time);
  // clear of the lengthened berth: the same 24 units beyond the pad edge the staging always had
  const staging = berthPoint(station, 182, pose);
  const cargo = CARGO[contract.cargo];
  const units: Pickup[] = [];
  for (let index = fromIndex; index < contract.quantity; index += 1) {
    const across = 42 + (index - (contract.quantity - 1) / 2) * 52;
    const x = staging.x - Math.sin(station.orientation) * across;
    const y = staging.y + Math.cos(station.orientation) * across;
    units.push({
      id: `contract-${contract.id}-${index}`,
      kind: contract.cargo,
      condition: 1,
      source: "contract",
      value: cargo.value,
      x,
      y,
      vx: pose.vx,
      vy: pose.vy,
      spin: index % 2 ? -0.05 : 0.05,
      angle: station.orientation,
      discovered: true,
      anchor: { station: station.id, dx: x - pose.x, dy: y - pose.y },
    });
  }
  return units;
}

function snapshot(game: GameMutable): UiSnapshot {
  const target = stationById(game.targetId);
  const targetPose = target ? stationPose(target, game.elapsed) : null;
  const active = contractById(game.activeContractId);
  return {
    speed: Math.hypot(game.ship.vx, game.ship.vy),
    fuel: game.ship.fuel,
    hull: game.ship.hull,
    credits: game.credits,
    reputation: game.reputation,
    cargo: [...game.cargo],
    dockedId: game.dockedId,
    targetId: game.targetId,
    activeContractId: game.activeContractId,
    contractTime: game.contractTime,
    contractDeadline: game.contractDeadline,
    assist: game.assist,
    shipId: game.shipId,
    upgrades: [...game.upgrades],
    ownedShips: [...game.ownedShips],
    completed: game.completed,
    salvageRecovered: game.salvageRecovered,
    message: game.message,
    distance: targetPose ? distance(game.ship, targetPose) : 0,
    closing: targetPose ? Math.hypot(game.ship.vx - targetPose.vx, game.ship.vy - targetPose.vy) : 0,
    loadingRemaining: active ? Math.max(0, active.quantity - game.cargo.filter((item) => item.source === "contract").length) : 0,
  };
}

function saveGame(game: GameMutable) {
  // Debris re-seeds deterministically alongside salvage (see update()), same as pickups and particles.
  const serializable = { ...game, particles: [], pickups: [], debris: [] };
  localStorage.setItem(SAVE_KEY, JSON.stringify(serializable));
}

function makeSalvage(): Pickup[] {
  const kinds: CargoKind[] = ["components", "electronics", "ore", "science", "machinery", "metals"];
  const common: Pickup[] = kinds.map((kind, index) => {
    const angle = index * 2.17 + 0.4;
    const radius = 140 + (index * 97) % 430;
    return {
      id: `salvage-${index}`,
      kind,
      condition: 0.55 + (index % 4) * 0.11,
      source: "salvage",
      value: CARGO[kind].value * (1.1 + index * 0.18),
      x: SALVAGE_ZONE.center.x + Math.cos(angle) * radius,
      y: SALVAGE_ZONE.center.y + Math.sin(angle) * radius,
      vx: Math.cos(angle + Math.PI / 2) * (3 + index),
      vy: Math.sin(angle + Math.PI / 2) * (3 + index),
      spin: (index % 2 ? -1 : 1) * (0.08 + index * 0.015),
      angle,
      discovered: false,
    };
  });
  /*
   * The Wake's own description promises "one persistent unknown return":
   * a single rare recoverable, seeded close to the zone centre rather than
   * spread across it like the common salvage above, so reaching it means
   * crossing the densest part of the debris field (see makeDebris) instead
   * of skimming the rim. It is otherwise an ordinary salvage pickup — same
   * clamp range, same scanner-gated discovery, same recovered: bookkeeping
   * — so the fiction stays a salvage operator's rare find, not a treasure
   * chest with its own rules.
   */
  const prize: Pickup = {
    id: WAKE_PRIZE_ID,
    kind: "science",
    condition: 0.94,
    source: "salvage",
    value: WAKE_PRIZE_VALUE,
    x: SALVAGE_ZONE.center.x + Math.cos(0.83) * SALVAGE_ZONE.radius * 0.16,
    y: SALVAGE_ZONE.center.y + Math.sin(0.83) * SALVAGE_ZONE.radius * 0.16,
    vx: 2.6,
    vy: -1.7,
    spin: 0.05,
    angle: 0.83,
    discovered: false,
  };
  return [...common, prize];
}

/**
 * The Wake's hazard field: real objects with position, velocity and spin,
 * seeded the same way the common salvage above is — index arithmetic, never
 * Math.random, so a fresh session and a loaded one scatter identically.
 * Radius is sampled uniformly in r rather than in area, which (unlike a
 * true uniform disc, which would use sqrt) naturally packs more chunks per
 * unit area near the centre than at the rim: the field gets thicker on the
 * way to the prize `makeSalvage` seeds deep inside it, not thinner.
 * `updateDebrisField` keeps every chunk drifting and bounces it off
 * SALVAGE_ZONE's boundary, so the cloud never disperses over a session.
 */
function makeDebris(): Debris[] {
  return Array.from({ length: DEBRIS_COUNT }, (_, index) => {
    const angle = index * 2.399 + 1.1;
    const radius = (index * 71 + 30) % (SALVAGE_ZONE.radius - 40);
    const drift = index * 1.777 + 0.5;
    return {
      x: SALVAGE_ZONE.center.x + Math.cos(angle) * radius,
      y: SALVAGE_ZONE.center.y + Math.sin(angle) * radius,
      vx: Math.cos(drift) * (2 + (index * 7) % DEBRIS_MAX_DRIFT),
      vy: Math.sin(drift) * (2 + (index * 11) % DEBRIS_MAX_DRIFT),
      angle: index * 0.83,
      spin: (index % 2 ? -1 : 1) * (0.15 + (index % 5) * 0.11),
      r: DEBRIS_MIN_RADIUS + (index * 53) % (DEBRIS_MAX_RADIUS - DEBRIS_MIN_RADIUS + 1),
      variant: index % 3,
      discovered: false,
    };
  });
}

function rewardFor(contract: ContractDefinition, routeRuns: Record<string, number>) {
  const saturation = Math.min(0.35, (routeRuns[`${contract.origin}-${contract.destination}`] ?? 0) * 0.08);
  return Math.round(contract.baseReward * (1 - saturation));
}

function useAudio() {
  const rigRef = useRef<AudioRig | null>(null);

  const ensure = useCallback(() => {
    if (rigRef.current) {
      void rigRef.current.context.resume();
      return rigRef.current;
    }
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const context = new AudioContextClass();
    const master = context.createGain();
    master.gain.value = 0.22;
    master.connect(context.destination);
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 180;
    filter.Q.value = 2;
    const engineGain = context.createGain();
    engineGain.gain.value = 0;
    const engine = context.createOscillator();
    engine.type = "sawtooth";
    engine.frequency.value = 43;
    engine.connect(filter);
    filter.connect(engineGain);
    engineGain.connect(master);
    engine.start();
    rigRef.current = { context, engine, engineGain, filter, master };
    return rigRef.current;
  }, []);

  const setEngine = useCallback((amount: number, muted: boolean) => {
    const rig = rigRef.current;
    if (!rig) return;
    const now = rig.context.currentTime;
    rig.engine.frequency.setTargetAtTime(38 + amount * 34, now, 0.05);
    rig.filter.frequency.setTargetAtTime(110 + amount * 370, now, 0.06);
    rig.engineGain.gain.setTargetAtTime(muted ? 0 : amount * 0.13, now, 0.035);
  }, []);

  const tone = useCallback((kind: "ui" | "clamp" | "dock" | "success" | "impact" | "scan", muted = false) => {
    const rig = ensure();
    if (muted) return;
    const now = rig.context.currentTime;
    const sequences: Record<typeof kind, number[]> = {
      ui: [620], clamp: [110, 82], dock: [74, 58, 220], success: [330, 495, 660], impact: [48], scan: [740, 920],
    };
    sequences[kind].forEach((frequency, index) => {
      const osc = rig.context.createOscillator();
      const gain = rig.context.createGain();
      osc.type = kind === "impact" || kind === "dock" ? "sawtooth" : "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0, now + index * 0.08);
      gain.gain.linearRampToValueAtTime(kind === "impact" ? 0.28 : 0.14, now + index * 0.08 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.08 + (kind === "dock" ? 0.32 : 0.18));
      osc.connect(gain);
      gain.connect(rig.master);
      osc.start(now + index * 0.08);
      osc.stop(now + index * 0.08 + 0.38);
    });
  }, [ensure]);

  const mute = useCallback((muted: boolean) => {
    if (!rigRef.current) return;
    rigRef.current.master.gain.setTargetAtTime(muted ? 0 : 0.22, rigRef.current.context.currentTime, 0.08);
  }, []);

  return useMemo(() => ({ ensure, setEngine, tone, mute }), [ensure, mute, setEngine, tone]);
}

/**
 * A canvas sized to its CSS box that repaints with `paint` whenever `deps`
 * change. The menus use it to show the same drawings that fly: ships on the
 * shipyard cards, cargo on the manifests, planets on the chart.
 */
function usePortrait(paint: (ctx: CanvasRenderingContext2D, width: number, height: number) => void, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    paint(ctx, width, height);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

function ShipPortrait({ ship }: { ship: ShipDefinition }) {
  const ref = usePortrait((ctx, width, height) => drawShipPortrait(ctx, ship, width, height), [ship]);
  return <canvas ref={ref} className="ship-portrait portrait" aria-hidden="true" />;
}

/** The units on a manifest, laid side by side the way they sit on a spine. */
function CargoPortrait({ kind, count = 1, condition = 1 }: { kind: CargoKind; count?: number; condition?: number }) {
  const ref = usePortrait((ctx, width, height) => {
    const units = Math.max(1, Math.min(4, count));
    const pitch = 34;
    const size = Math.min((width - 6) / (units * pitch), (height - 6) / 24);
    ctx.translate(width / 2 - ((units - 1) / 2) * pitch * size, height / 2);
    for (let index = 0; index < units; index += 1) {
      ctx.save();
      ctx.translate(index * pitch * size, 0);
      drawCargoUnit(ctx, kind, { size, condition, time: 0 });
      ctx.restore();
    }
  }, [kind, count, condition]);
  return <canvas ref={ref} className="cargo-portrait portrait" aria-hidden="true" />;
}

/** A body from the flight view, fitted into a square with its atmosphere. */
function PlanetPortrait({ body }: { body: CelestialBody }) {
  const ref = usePortrait((ctx, width, height) => {
    const fit = Math.min(width, height) / 2 / (body.radius * PLANET_SCALE * 1.18);
    ctx.translate(width / 2, height / 2);
    ctx.scale(fit, fit);
    drawPlanet(ctx, body, { time: 1, zoom: fit });
  }, [body]);
  return <canvas ref={ref} className="map-planet portrait" aria-hidden="true" />;
}

export default function EmberlineGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<GameMutable>(freshGame());
  const keysRef = useRef<Record<string, boolean>>({});
  const uiTimerRef = useRef(0);
  const actionLatchRef = useRef(false);
  const actionRequestRef = useRef(false);
  const salvageSeededRef = useRef(false);
  const lastWarningRef = useRef(0);
  const lastImpactRef = useRef(0);
  /** What last took hull off the ship, so a loss can say what caused it. */
  const lastHarmRef = useRef("a hard contact");
  const cameraRef = useRef({ x: -320, y: 30, zoom: 0.78 });
  const titlePoseRef = useRef<ShipPose | null>(null);
  const starRef = useRef(Array.from({ length: 340 }, (_, index) => ({
    x: ((index * 1877) % 10000) / 10000,
    y: ((index * 3463 + 997) % 10000) / 10000,
    size: 0.35 + ((index * 43) % 13) / 12,
    alpha: 0.18 + ((index * 71) % 77) / 100,
    warm: index % 11 === 0,
  })));
  const [screen, setScreen] = useState<"title" | "game">("title");
  const [ui, setUi] = useState<UiSnapshot>(() => snapshot(gameRef.current));
  const [panel, setPanel] = useState<"contracts" | "service" | "fleet">("contracts");
  const [mapOpen, setMapOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [hasSave, setHasSave] = useState(false);
  const [savePulse, setSavePulse] = useState(false);
  const audio = useAudio();

  const notify = useCallback((message: string, duration = 4) => {
    const game = gameRef.current;
    game.message = message;
    game.messageUntil = game.elapsed + duration;
    setUi(snapshot(game));
  }, []);

  useEffect(() => {
    setHasSave(Boolean(localStorage.getItem(SAVE_KEY)));
  }, []);

  const start = useCallback((continueSave: boolean) => {
    const loaded = continueSave ? safeLoad() : null;
    gameRef.current = loaded ?? freshGame();
    salvageSeededRef.current = false;
    cameraRef.current = { x: gameRef.current.ship.x, y: gameRef.current.ship.y, zoom: 1.15 };
    audio.ensure();
    audio.tone("ui", muted);
    setUi(snapshot(gameRef.current));
    setScreen("game");
    setPanel("contracts");
    setHelpOpen(false);
    setMapOpen(false);
  }, [audio, muted]);

  const stageContract = useCallback((contract: ContractDefinition) => {
    const game = gameRef.current;
    const ship = shipById(game.shipId);
    const cargo = CARGO[contract.cargo];
    if (game.activeContractId) return notify("Complete or abandon the active contract first.");
    if (game.dockedId !== contract.origin) return notify("This freight is staged at another port.");
    if (game.reputation < contract.minReputation) return notify(`Requires reputation ${contract.minReputation}.`);
    if (game.credits < 0 && contract.baseReward > ARREARS_CEILING) return notify(`Dispatch holds anything over ${money(ARREARS_CEILING)} while the account is overdrawn.`);
    if ((contract.minSlots ?? contract.quantity) > ship.slots + (game.upgrades.includes("clamps") ? 1 : 0)) return notify("This load needs more cargo clamps.");
    if (contract.requiredShip && contract.requiredShip !== game.shipId) return notify(`Dispatch requires the ${shipById(contract.requiredShip).name} tug.`);
    if (contract.kind === "cryogenic" && !game.upgrades.includes("cryo")) return notify("A powered cryogenic umbilical is required.");
    const station = stationById(contract.origin)!;
    game.activeContractId = contract.id;
    game.contractTime = contract.timeLimit ?? 0;
    game.contractDeadline = contract.timeLimit ? contract.timeLimit * DEADLINE_MULTIPLIER : 0;
    game.targetId = contract.destination;
    game.pickups = stagedPickups(contract, station, game.elapsed);
    audio.tone("ui", muted);
    notify(`${cargo.name} staged outside. Undock, drift close, then clamp each unit.`);
  }, [audio, muted, notify]);

  const undock = useCallback(() => {
    const game = gameRef.current;
    const station = stationById(game.dockedId);
    if (!station) return;
    game.dockedId = null;
    const pose = stationPose(station, game.elapsed);
    const clear = berthPoint(station, 105, pose);
    const heading = station.orientation + Math.PI;
    game.ship.x = clear.x;
    game.ship.y = clear.y;
    /* You leave carrying the port's motion, the way you would stepping off
       anything moving. Without it every release would start with a drift
       back through the station you just left. */
    game.ship.vx = pose.vx + Math.cos(heading) * 6;
    game.ship.vy = pose.vy + Math.sin(heading) * 6;
    game.ship.angle = heading;
    game.ship.av = 0;
    audio.tone("dock", muted);
    notify("Umbilicals clear. You have flight control.");
  }, [audio, muted, notify]);

  const abandonContract = useCallback(() => {
    const game = gameRef.current;
    if (!game.activeContractId) return;
    game.cargo = game.cargo.filter((item) => item.source !== "contract");
    game.pickups = game.pickups.filter((item) => item.source !== "contract");
    game.activeContractId = null;
    game.contractTime = 0;
    game.contractDeadline = 0;
    game.reputation = Math.max(0, game.reputation - 1);
    notify("Contract released. Dispatch records a small reputation loss.");
  }, [notify]);

  const service = useCallback((kind: "fuel" | "repair") => {
    const game = gameRef.current;
    if (!game.dockedId) return;
    const ship = shipById(game.shipId);
    const fuelCapacity = ship.fuelCapacity * (game.upgrades.includes("tank") ? 1.35 : 1);
    const amount = kind === "fuel" ? fuelCapacity - game.ship.fuel : 100 - game.ship.hull;
    const cost = Math.ceil(amount * (kind === "fuel" ? 4 : 18));
    if (cost <= 0) return notify(kind === "fuel" ? "Propellant tanks already full." : "No hull work required.");
    /* Propellant goes on the tab at any balance. A pilot who cannot buy fuel
       cannot earn, and a debt you cannot work off is not a setback. Hull work
       is elective by comparison, so it waits for a settled account. */
    if (kind === "repair" && game.credits < cost) return notify(`Hull work is ${money(cost)} and the yard wants a settled account first.`);
    game.credits -= cost;
    if (kind === "fuel") game.ship.fuel = fuelCapacity;
    else game.ship.hull = 100;
    audio.tone("ui", muted);
    const onTab = kind === "fuel" && game.credits < 0;
    notify(`${kind === "fuel" ? "Propellant loaded" : "Hull work complete"}. ${money(cost)} ${onTab ? `on the tab. Account stands at ${money(game.credits)}.` : "debited."}`);
  }, [audio, muted, notify]);

  const buyUpgrade = useCallback((id: string) => {
    const game = gameRef.current;
    const upgrade = UPGRADES.find((item) => item.id === id);
    const station = stationById(game.dockedId);
    if (!upgrade || !station?.services.includes("upgrades")) return notify("Upgrade work is only available at a fitted yard.");
    if (game.upgrades.includes(id)) return;
    if (game.credits < 0) return notify("The yard will not open a refit against an overdrawn account.");
    if (game.credits < upgrade.cost) return notify("The account does not cover this refit.");
    game.credits -= upgrade.cost;
    game.upgrades.push(id);
    if (id === "tank") game.ship.fuel += shipById(game.shipId).fuelCapacity * 0.35;
    audio.tone("success", muted);
    notify(`${upgrade.name} fitted. The hardware is now visible on the ship.`);
  }, [audio, muted, notify]);

  const buyOrSwitchShip = useCallback((id: ShipDefinition["id"]) => {
    const game = gameRef.current;
    const station = stationById(game.dockedId);
    const ship = shipById(id);
    if (!station?.services.includes("ships")) return notify("Owned vessels are berthed at Anvil Gate.");
    if (game.activeContractId || game.cargo.length) return notify("Unload the current ship before changing vessels.");
    if (!game.ownedShips.includes(id)) {
      /* Moving between hulls you already own stays free at any balance; it is
         only buying another one that waits for the account to be square. */
      if (game.credits < 0) return notify("No broker will sell to an overdrawn account. Clear it first.");
      if (game.credits < ship.cost) return notify(`Purchase requires ${money(ship.cost)}.`);
      game.credits -= ship.cost;
      game.ownedShips.push(id);
    }
    game.shipId = id;
    game.ship.fuel = ship.fuelCapacity * (game.upgrades.includes("tank") ? 1.35 : 1);
    game.ship.hull = 100;
    audio.tone("success", muted);
    notify(`${ship.name} ${ship.model} is now on the active cradle.`);
  }, [audio, muted, notify]);

  const emergencyTow = useCallback(() => {
    const game = gameRef.current;
    const cost = TOW_FEE;
    const station = STATIONS[0];
    const pose = stationPose(station, game.elapsed);
    const berth = berthPoint(station, 100, pose);
    game.credits -= cost;
    game.ship = { x: berth.x, y: berth.y, vx: pose.vx, vy: pose.vy, angle: station.orientation, av: 0, fuel: Math.max(20, shipById(game.shipId).fuelCapacity * 0.18), hull: Math.max(35, game.ship.hull) };
    game.dockedId = station.id;
    game.cargo = game.cargo.filter((item) => item.source === "salvage");
    game.pickups = [];
    game.activeContractId = null;
    game.contractTime = 0;
    game.contractDeadline = 0;
    game.reputation = Math.max(0, game.reputation - 1);
    notify(`Pilgrim rescue tug recovered the vessel. ${money(cost)} billed; account stands at ${money(game.credits)}.`, 7);
  }, [notify]);

  const setTarget = useCallback((id: string) => {
    gameRef.current.targetId = id;
    setUi(snapshot(gameRef.current));
    setMapOpen(false);
    audio.tone("ui", muted);
  }, [audio, muted]);

  const setTouch = useCallback((key: string, value: boolean) => {
    keysRef.current[key] = value;
    audio.ensure();
  }, [audio]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      keysRef.current[key] = true;
      if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) event.preventDefault();
      if (event.repeat) return;
      if (key === " ") actionRequestRef.current = true;
      if (key === "m") setMapOpen((open) => !open);
      if (key === "h") setHelpOpen((open) => !open);
      if (key === "f") {
        gameRef.current.assist = !gameRef.current.assist;
        notify(`Flight assist ${gameRef.current.assist ? "engaged" : "released"}.`);
      }
      if (key === "escape") {
        setMapOpen(false);
        setHelpOpen(false);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => { keysRef.current[event.key.toLowerCase()] = false; };
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", () => { keysRef.current = {}; });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [notify]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    let frame = 0;
    let last = performance.now();

    const act = (game: GameMutable) => {
      if (game.dockedId) {
        undock();
        return;
      }
      const shipDef = shipById(game.shipId);
      const slots = shipDef.slots + (game.upgrades.includes("clamps") ? 1 : 0);
      const nearest = game.pickups
        .map((pickup) => ({ pickup, dist: distance(game.ship, pickup), relative: Math.hypot(game.ship.vx - pickup.vx, game.ship.vy - pickup.vy) }))
        .sort((a, b) => a.dist - b.dist)[0];
      if (nearest && nearest.dist < 92) {
        if (game.cargo.length >= slots) return notify("No free cargo clamp.");
        if (nearest.relative > 42) return notify("Match velocity before engaging the clamp.");
        game.cargo.push({ id: nearest.pickup.id, kind: nearest.pickup.kind, condition: nearest.pickup.condition, source: nearest.pickup.source, value: nearest.pickup.value });
        game.pickups = game.pickups.filter((pickup) => pickup.id !== nearest.pickup.id);
        if (nearest.pickup.source === "salvage" && !game.discovered.includes(`recovered:${nearest.pickup.id}`)) {
          game.discovered.push(`recovered:${nearest.pickup.id}`);
        }
        game.shake = 5;
        audio.tone("clamp", muted);
        if (nearest.pickup.source === "salvage") {
          notify(nearest.pickup.id === WAKE_PRIZE_ID
            ? "Whatever it is, it's still faintly warm. Deliver it to any port and let someone with the right instruments tell you what you found."
            : `${CARGO[nearest.pickup.kind].name} secured. Deliver it to any port for assessment.`);
        } else {
          const active = contractById(game.activeContractId);
          const loaded = game.cargo.filter((item) => item.source === "contract").length;
          notify(loaded >= (active?.quantity ?? 0) ? "Load secure. Destination beacon is active." : `Clamp ${loaded} secure. Collect the remaining unit.`);
        }
        return;
      }
      const nearbyStation = STATIONS
        .map((station) => {
          const pose = stationPose(station, game.elapsed);
          return { station, pose, dist: distance(game.ship, pose) };
        })
        .sort((a, b) => a.dist - b.dist)[0];
      if (nearbyStation && nearbyStation.dist < BERTH_CAPTURE) {
        const closing = Math.hypot(game.ship.vx - nearbyStation.pose.vx, game.ship.vy - nearbyStation.pose.vy);
        if (closing > 36) return notify(`Closing too fast: ${Math.round(closing)} m/s on the pad. Match its motion, then clamp.`);
        dock(game, nearbyStation.station);
        return;
      }
      notify("No grapple or docking fixture within reach.");
    };

    const dock = (game: GameMutable, station: Station) => {
      game.dockedId = station.id;
      const pose = stationPose(station, game.elapsed);
      const berth = berthPoint(station, 100, pose);
      game.ship.x = berth.x;
      game.ship.y = berth.y;
      game.ship.vx = pose.vx;
      game.ship.vy = pose.vy;
      game.ship.av = 0;
      game.ship.angle = station.orientation;
      game.shake = 4;
      audio.tone("dock", muted);

      const wasOverdrawn = game.credits < 0;
      let note = `Docking capture confirmed at ${station.name}.`;
      const salvage = game.cargo.filter((item) => item.source === "salvage");
      if (salvage.length) {
        const salvagePay = Math.round(salvage.reduce((sum, item) => sum + item.value * item.condition, 0));
        game.credits += salvagePay;
        game.salvageRecovered += salvage.length;
        /* Only genuine recoveries earn standing. Freight marked down after a
           missed deadline is sold at the same desk, and without this test a
           failed science run would earn more standing than the miss cost. */
        const recovered = salvage.filter((item) => item.id.startsWith("salvage-"));
        if (recovered.length) game.reputation += recovered.some((item) => item.kind === "science") ? 2 : 1;
        game.cargo = game.cargo.filter((item) => item.source !== "salvage");
        note = `Salvage assessed: ${money(salvagePay)} credited.`;
      }

      const contract = contractById(game.activeContractId);
      if (contract && contract.destination === station.id) {
        const carried = game.cargo.filter((item) => item.source === "contract");
        if (carried.length >= contract.quantity) {
          const base = rewardFor(contract, game.routeRuns);
          const condition = carried.reduce((sum, item) => sum + item.condition, 0) / carried.length;
          /* A station inspects what shows up. Below CONDITION_REJECT_THRESHOLD
             it will not sign for the load at any price — the reward already
             scales with condition above that line, so refusal is the only
             lever left for freight that arrived genuinely ruined. */
          if (condition < CONDITION_REJECT_THRESHOLD) {
            const penalty = Math.round(base * REJECTION_PENALTY_FRACTION);
            game.credits -= penalty;
            game.reputation = Math.max(0, game.reputation - 1);
            audio.tone("impact", muted);
            note = `Dispatch refuses the load: condition too poor to accept. ${money(penalty)} charged and the freight is written off.`;
          } else {
            const timeBonus = contract.timeLimit ? clamp(game.contractTime / contract.timeLimit, 0, 1) * 0.25 : 0;
            const reward = Math.round(base * condition * (1 + timeBonus));
            const route = `${contract.origin}-${contract.destination}`;
            game.credits += reward;
            game.reputation += condition > 0.92 ? 2 : 1;
            game.completed += 1;
            game.routeRuns[route] = (game.routeRuns[route] ?? 0) + 1;
            audio.tone("success", muted);
            note = `Freight delivered cleanly. ${money(reward)} credited to your account.`;
          }
          game.cargo = game.cargo.filter((item) => item.source !== "contract");
          game.activeContractId = null;
          game.contractTime = 0;
          game.contractDeadline = 0;
          game.pickups = game.pickups.filter((item) => item.source !== "contract");
        } else {
          note = "Destination reached, but the manifest is incomplete. Return for the remaining freight.";
        }
      }
      const capacity = shipById(game.shipId).fuelCapacity * (game.upgrades.includes("tank") ? 1.35 : 1);
      if (game.ship.fuel < Math.min(8, capacity * 0.08)) {
        /* Always granted and always charged in full. Metering it by the
           balance would strand exactly the pilot who needs it. */
        const emergency = Math.min(14, capacity - game.ship.fuel);
        const cost = Math.ceil(emergency * 5);
        game.ship.fuel += emergency;
        game.credits -= cost;
        note += ` Emergency reserve added for ${money(cost)}.`;
      }
      if (wasOverdrawn && game.credits >= 0) note += " Account settled. Dispatch reopens the full board.";
      else if (game.credits < 0) note += ` Account stands at ${money(game.credits)}.`;
      saveGame(game);
      setSavePulse(true);
      window.setTimeout(() => setSavePulse(false), 900);
      notify(note, 6);
    };

    /**
     * A contract that outlives its hard deadline.
     *
     * The manifest voids and dispatch takes its cut whether the ship is
     * near the destination or nowhere close. Freight already clamped is
     * not destroyed — it converts to ordinary salvage at a marked-down
     * value, sellable at any port — but anything still waiting uncollected
     * on the origin pad is simply cleared, the way an unclaimed pallet
     * would be swept off a dock.
     */
    const expireContract = (game: GameMutable, contract: ContractDefinition) => {
      const penalty = Math.round(rewardFor(contract, game.routeRuns) * DEADLINE_PENALTY_FRACTION);
      game.cargo.forEach((item) => {
        if (item.source !== "contract") return;
        item.source = "salvage";
        item.value *= EXPIRED_SALVAGE_VALUE_FRACTION;
      });
      game.pickups = game.pickups.filter((item) => item.source !== "contract");
      game.activeContractId = null;
      game.contractTime = 0;
      game.contractDeadline = 0;
      game.credits -= penalty;
      game.reputation = Math.max(0, game.reputation - 1);
      audio.tone("impact", muted);
      notify(`${contract.title} missed its deadline. Dispatch voids the manifest and bills ${money(penalty)}; any freight aboard is marked down to salvage. Account stands at ${money(game.credits)}.`, 8);
    };

    /** A standing warning that repeats no more often than WARNING_INTERVAL. */
    const nag = (game: GameMutable, message: string, duration = 4) => {
      if (game.elapsed - lastWarningRef.current < WARNING_INTERVAL) return;
      lastWarningRef.current = game.elapsed;
      notify(message, duration);
    };

    /**
     * Impact chatter, on its own timer.
     *
     * A serious hit always speaks. Striking something is the most important
     * thing the net has to say, and it must not be swallowed by a scrape
     * along the same surface or by the atmosphere warning that usually
     * comes just before it.
     */
    const report = (game: GameMutable, message: string, duration: number, urgent: boolean) => {
      if (!urgent && game.elapsed - lastImpactRef.current < IMPACT_INTERVAL) return;
      lastImpactRef.current = game.elapsed;
      notify(message, duration);
    };

    /** Sparks and torn insulation, thrown back out along the contact normal. */
    const impactSpray = (game: GameMutable, nx: number, ny: number, strength: number) => {
      const count = Math.min(18, 3 + Math.round(strength * 0.25));
      for (let index = 0; index < count; index += 1) {
        const spread = (Math.random() - 0.5) * 1.9;
        const speed = 40 + Math.random() * strength * 1.6;
        game.particles.push({
          x: game.ship.x + nx * 8,
          y: game.ship.y + ny * 8,
          vx: (nx * Math.cos(spread) - ny * Math.sin(spread)) * speed,
          vy: (nx * Math.sin(spread) + ny * Math.cos(spread)) * speed,
          life: 0.45,
          maxLife: 0.45,
          size: 1 + Math.random() * 2,
          color: Math.random() > 0.5 ? "#f6d27b" : "#e0653a",
        });
      }
    };

    /**
     * Charge one contact to the ship.
     *
     * Everything scales off the closing speed. Under the scuff threshold a
     * contact costs nothing but a bump; above it the hull pays a point per
     * m/s, the freight takes the same shock, and a hard enough hit tears the
     * outermost container off its clamps and leaves it tumbling clear, where
     * it can be chased down and re-clamped like any other loose cargo.
     */
    const applyImpact = (game: GameMutable, closing: number, nx: number, ny: number, what: string) => {
      const damage = Math.max(0, closing - SCUFF_SPEED) * DAMAGE_PER_SPEED;
      game.shake = Math.max(game.shake, Math.min(24, 3 + damage * 0.4));
      if (damage <= 0) {
        audio.tone("clamp", muted);
        return;
      }
      impactSpray(game, nx, ny, damage);
      audio.tone("impact", muted);
      lastHarmRef.current = what.charAt(0).toLowerCase() + what.slice(1);
      game.ship.hull = Math.max(0, game.ship.hull - damage);
      game.cargo.forEach((item) => {
        item.condition = Math.max(0.15, item.condition - damage * 0.006);
      });

      if (closing >= SHED_SPEED && game.cargo.length) {
        const lost = game.cargo[game.cargo.length - 1];
        game.cargo = game.cargo.slice(0, -1);
        const tumble = 70 + Math.random() * 60;
        game.pickups.push({
          ...lost,
          condition: Math.max(0.2, lost.condition - 0.2),
          x: game.ship.x + nx * 46,
          y: game.ship.y + ny * 46,
          vx: game.ship.vx + nx * tumble,
          vy: game.ship.vy + ny * tumble,
          spin: (Math.random() - 0.5) * 1.4,
          angle: game.ship.angle,
          discovered: true,
        });
        report(game, `${what}. ${CARGO[lost.kind].name} torn off the spine and tumbling clear.`, 7, true);
        return;
      }
      report(game, `${what} at ${Math.round(closing)} m/s. Hull at ${Math.round(game.ship.hull)}%.`, 5, damage >= URGENT_DAMAGE);
    };

    /**
     * Push the ship out of anything solid it has entered, and charge it.
     *
     * The ship is a disc and every obstacle is a disc, so the resolution is
     * the ordinary one: lift the ship back to the surface, reflect the part
     * of its velocity that pointed into the obstacle, and leave the part
     * that did not, so a glancing pass scrapes along instead of stopping
     * dead. Station colliders come from the art, and a planet's deck is set
     * where its painted surface appears rather than at its raw radius.
     */
    const resolveContacts = (game: GameMutable, hullRadius: number) => {
      const solids: { x: number; y: number; r: number; vx: number; vy: number; what: string }[] = [];
      for (const station of STATIONS) {
        const pose = stationPose(station, game.elapsed);
        if (distance(game.ship, pose) > 320) continue;
        for (const circle of stationColliders(station, pose)) {
          solids.push({ ...circle, vx: pose.vx, vy: pose.vy, what: `Contact with ${station.name} structure` });
        }
      }
      for (const body of BODIES) {
        solids.push({
          x: body.position.x,
          y: body.position.y,
          r: body.radius * SURFACE_CONTACT,
          vx: 0,
          vy: 0,
          what: `Surface contact on ${body.name}`,
        });
      }
      /* The Wake's hazard field only joins the list this close to it, so a
         ship anywhere else in the system pays nothing for 30-plus circles
         it could never reach. Reuses this same loop and applyImpact below —
         a debris hit is a contact like any other, not a second damage rule. */
      if (distance(game.ship, SALVAGE_ZONE.center) < DEBRIS_ACTIVE_RANGE) {
        for (const chunk of game.debris) {
          solids.push({ x: chunk.x, y: chunk.y, r: chunk.r, vx: chunk.vx, vy: chunk.vy, what: "Debris strike in the Wake" });
        }
      }

      for (const solid of solids) {
        const dx = game.ship.x - solid.x;
        const dy = game.ship.y - solid.y;
        const reach = solid.r + hullRadius;
        const dist = Math.hypot(dx, dy);
        if (dist >= reach) continue;
        const nx = dist > 0.001 ? dx / dist : 1;
        const ny = dist > 0.001 ? dy / dist : 0;
        game.ship.x = solid.x + nx * reach;
        game.ship.y = solid.y + ny * reach;
        /* Closing speed against the obstacle's own motion: riding alongside
           a port costs nothing, and a port sweeping into a parked ship is
           still a collision. */
        const into = (game.ship.vx - solid.vx) * nx + (game.ship.vy - solid.vy) * ny;
        if (into >= 0) continue;
        game.ship.vx -= (1 + RESTITUTION) * into * nx;
        game.ship.vy -= (1 + RESTITUTION) * into * ny;
        game.ship.av = clamp(game.ship.av - (Math.random() - 0.5) * into * 0.012, -2.6, 2.6);
        applyImpact(game, -into, nx, ny, solid.what);
      }
    };

    /**
     * Drag and heating in the band above a body that has an atmosphere.
     *
     * The band exists so the hard deck is never a surprise: it slows the
     * ship, cooks the freight, and says so on the net well before the
     * surface is reached. A pilot willing to pay for it can also use it to
     * shed speed without spending propellant.
     */
    const applyAtmosphere = (game: GameMutable, dt: number) => {
      for (const body of BODIES) {
        if (!body.atmosphere) continue;
        const top = body.radius * ATMOSPHERE_TOP;
        const dist = distance(game.ship, body.position);
        if (dist > top) continue;
        const deck = body.radius * SURFACE_CONTACT;
        const depth = clamp((top - dist) / Math.max(1, top - deck), 0, 1);
        const speed = Math.hypot(game.ship.vx, game.ship.vy);
        const drag = depth * depth * 0.55 * dt;
        game.ship.vx -= game.ship.vx * drag;
        game.ship.vy -= game.ship.vy * drag;
        const heat = depth * speed * 0.02 * dt;
        if (heat > 0.004) {
          lastHarmRef.current = `heating in ${body.name}'s atmosphere`;
          game.ship.hull = Math.max(0, game.ship.hull - heat);
          game.cargo.forEach((item) => {
            item.condition = Math.max(0.15, item.condition - heat * 0.004);
          });
          game.shake = Math.max(game.shake, depth * 4);
          if (Math.random() < dt * 40) {
            game.particles.push({
              x: game.ship.x,
              y: game.ship.y,
              vx: game.ship.vx * -0.2 + (Math.random() - 0.5) * 40,
              vy: game.ship.vy * -0.2 + (Math.random() - 0.5) * 40,
              life: 0.5,
              maxLife: 0.5,
              size: 1.5 + Math.random() * 2.5,
              color: Math.random() > 0.45 ? body.atmosphere : "#f4b56a",
            });
          }
        }
        nag(game, `${body.name} atmosphere. Drag building and the hull is heating — climb out.`, 3);
      }
    };

    /**
     * Drifts the Wake's hazard field and keeps it inside SALVAGE_ZONE: a
     * chunk that reaches the boundary bounces off it rather than escaping,
     * so the cloud never disperses over a session. Gated the same way
     * `resolveContacts` gates debris contact, and for the same reason — a
     * ship elsewhere in the system does not pay to simulate 30-plus objects
     * it cannot see or reach. Discovery follows the pickups' own rule (215
     * units, 520 with the scanner upgrade), so an unlit chunk is invisible
     * right up until it is either close or scanned — not before.
     */
    const updateDebrisField = (game: GameMutable, dt: number) => {
      if (distance(game.ship, SALVAGE_ZONE.center) >= DEBRIS_ACTIVE_RANGE) return;
      const scanRange = game.upgrades.includes("scanner") ? 520 : 215;
      game.debris.forEach((chunk) => {
        chunk.x += chunk.vx * dt;
        chunk.y += chunk.vy * dt;
        chunk.angle += chunk.spin * dt;
        const dx = chunk.x - SALVAGE_ZONE.center.x;
        const dy = chunk.y - SALVAGE_ZONE.center.y;
        const dist = Math.hypot(dx, dy);
        const limit = SALVAGE_ZONE.radius - chunk.r * DEBRIS_EDGE_MARGIN;
        if (dist > limit && dist > 0.001) {
          const nx = dx / dist;
          const ny = dy / dist;
          chunk.x = SALVAGE_ZONE.center.x + nx * limit;
          chunk.y = SALVAGE_ZONE.center.y + ny * limit;
          const into = chunk.vx * nx + chunk.vy * ny;
          if (into > 0) {
            chunk.vx -= 2 * into * nx;
            chunk.vy -= 2 * into * ny;
          }
        }
        if (distance(game.ship, chunk) < scanRange) chunk.discovered = true;
      });
    };

    /* The truck in the title composition burns while the simulation is idle. */
    const titleExhaust = (game: GameMutable, dt: number) => {
      const pose = titlePoseRef.current;
      if (!pose) return;
      const art = shipArtFor(shipById(pose.shipId));
      const scale = art.scale * (pose.scale ?? 1);
      const behind = -art.exhaust * scale;
      if (Math.random() < dt * 28) {
        game.particles.push({
          x: pose.x - Math.cos(pose.angle) * behind,
          y: pose.y - Math.sin(pose.angle) * behind,
          vx: -Math.cos(pose.angle) * (45 + Math.random() * 35) * (pose.scale ?? 1),
          vy: -Math.sin(pose.angle) * (45 + Math.random() * 35) * (pose.scale ?? 1),
          life: 0.7,
          maxLife: 0.7,
          size: (2 + Math.random() * 3) * (pose.scale ?? 1),
          color: Math.random() > 0.4 ? "#e68449" : "#f6d27b",
        });
      }
      game.particles.forEach((particle) => {
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.life -= dt;
      });
      game.particles = game.particles.filter((particle) => particle.life > 0).slice(-160);
    };

    const update = (game: GameMutable, dt: number) => {
      game.elapsed += dt;
      if (!salvageSeededRef.current) {
        const recovered = new Set(game.discovered.filter((id) => id.startsWith("recovered:" )).map((id) => id.slice(10)));
        game.pickups.push(...makeSalvage().filter((pickup) => !recovered.has(pickup.id)));
        // Debris carries no recovered state of its own — it is scenery to dodge, not cargo to keep — so it always re-seeds in full.
        game.debris = makeDebris();
        salvageSeededRef.current = true;
      }
      if (screen !== "game" || game.paused || mapOpen || helpOpen) {
        audio.setEngine(0, muted);
        if (screen === "title") titleExhaust(game, dt);
        return;
      }

      if (game.dockedId) {
        audio.setEngine(0, muted);
        /* Berthed: the port is in orbit, so the ship rides it rather than
           hanging at a fixed point while its own dock travels away. */
        const berthedAt = stationById(game.dockedId);
        if (berthedAt) {
          const pose = stationPose(berthedAt, game.elapsed);
          const berth = berthPoint(berthedAt, 100, pose);
          game.ship.x = berth.x;
          game.ship.y = berth.y;
          game.ship.vx = pose.vx;
          game.ship.vy = pose.vy;
        }
        game.ship.av = 0;
        game.shake *= Math.max(0, 1 - dt * 7);
        if (actionRequestRef.current || (keysRef.current[" "] && !actionLatchRef.current)) {
          actionRequestRef.current = false;
          actionLatchRef.current = true;
          act(game);
        }
        if (!keysRef.current[" "]) actionLatchRef.current = false;
        return;
      }

      const active = contractById(game.activeContractId);
      if (active?.timeLimit) {
        if (game.contractTime > 0) game.contractTime = Math.max(0, game.contractTime - dt);
        game.contractDeadline = Math.max(0, game.contractDeadline - dt);
        if (game.contractDeadline <= 0) {
          expireContract(game, active);
        } else if (game.contractDeadline < DEADLINE_WARNING_WINDOW) {
          nag(game, `${active.title}: hard deadline in ${Math.ceil(game.contractDeadline)}s. Miss it and the freight goes to salvage.`, 3);
        }
      }
      const shipDef = shipById(game.shipId);
      const cargoMass = game.cargo.reduce((sum, item) => sum + CARGO[item.kind].mass, 0);
      const totalMass = shipDef.dryMass + cargoMass;
      const engineFactor = game.upgrades.includes("engine") ? 1.16 : 1;
      const rcsFactor = game.upgrades.includes("rcs") ? 1.22 : 1;
      const tankFactor = game.upgrades.includes("tank") ? 1.35 : 1;
      const capacity = shipDef.fuelCapacity * tankFactor;
      const thrusting = Boolean(keysRef.current.w || keysRef.current.arrowup);
      const reversing = Boolean(keysRef.current.s || keysRef.current.arrowdown);
      const turning = (keysRef.current.a || keysRef.current.arrowleft ? -1 : 0) + (keysRef.current.d || keysRef.current.arrowright ? 1 : 0);
      const strafing = (keysRef.current.q ? -1 : 0) + (keysRef.current.e ? 1 : 0);
      const braking = Boolean(keysRef.current.shift);
      let engineAmount = 0;
      let appliedForce = 0;

      if (game.ship.fuel > 0) {
        if (thrusting) {
          appliedForce = shipDef.thrust * engineFactor;
          game.ship.vx += Math.cos(game.ship.angle) * (appliedForce / totalMass) * dt;
          game.ship.vy += Math.sin(game.ship.angle) * (appliedForce / totalMass) * dt;
          engineAmount = 1;
        }
        if (reversing) {
          appliedForce = Math.max(appliedForce, shipDef.reverseThrust);
          game.ship.vx -= Math.cos(game.ship.angle) * (shipDef.reverseThrust / totalMass) * dt;
          game.ship.vy -= Math.sin(game.ship.angle) * (shipDef.reverseThrust / totalMass) * dt;
          engineAmount = Math.max(engineAmount, 0.48);
        }
        if (strafing) {
          const force = shipDef.reverseThrust * 0.72;
          game.ship.vx += Math.cos(game.ship.angle + Math.PI / 2) * (force / totalMass) * strafing * dt;
          game.ship.vy += Math.sin(game.ship.angle + Math.PI / 2) * (force / totalMass) * strafing * dt;
          appliedForce = Math.max(appliedForce, force);
          engineAmount = Math.max(engineAmount, 0.34);
        }
        if (braking) {
          const speed = Math.hypot(game.ship.vx, game.ship.vy);
          if (speed > 0.4) {
            const decel = Math.min(speed / dt, shipDef.reverseThrust * 1.25 / totalMass);
            game.ship.vx -= (game.ship.vx / speed) * decel * dt;
            game.ship.vy -= (game.ship.vy / speed) * decel * dt;
            appliedForce = Math.max(appliedForce, shipDef.reverseThrust * 1.25);
            engineAmount = Math.max(engineAmount, 0.56);
          }
        }
        if (appliedForce > 0) {
          const loadFactor = 0.72 + totalMass / shipDef.dryMass * 0.34;
          game.ship.fuel = Math.max(0, game.ship.fuel - (appliedForce / shipDef.thrust) * loadFactor * dt);
        }
      }
      audio.setEngine(engineAmount, muted);

      const cargoInertia = 1 + cargoMass / Math.max(1, shipDef.dryMass) * 0.8;
      if (turning) game.ship.av += turning * shipDef.rotation * rcsFactor / cargoInertia * dt;
      if (!turning && game.assist) game.ship.av *= Math.max(0, 1 - dt * 4.2);
      game.ship.av = clamp(game.ship.av, -2.6, 2.6);
      game.ship.angle += game.ship.av * dt;

      for (const body of BODIES) {
        const dx = body.position.x - game.ship.x;
        const dy = body.position.y - game.ship.y;
        const distSq = dx * dx + dy * dy;
        const dist = Math.sqrt(distSq);
        const radii = dist / body.radius;
        if (radii >= GRAVITY_REACH) continue;
        const fade = clamp((GRAVITY_REACH - radii) / (GRAVITY_REACH - GRAVITY_FULL), 0, 1);
        const grav = Math.min(GRAVITY_CAP, body.gravity / Math.max(42000, distSq)) * fade * fade * (3 - 2 * fade);
        game.ship.vx += (dx / Math.max(1, dist)) * grav * dt;
        game.ship.vy += (dy / Math.max(1, dist)) * grav * dt;
      }

      /* Flight wear on the freight aboard. Fragile cargo takes it starting
         well under what any loaded ship can produce; everything else only
         above what a loaded ship ordinarily reaches, so ordinary freight's
         wear comes mostly from contact instead (see resolveContacts). Both
         floor at the same 0.15 a hard impact would leave it at. */
      const accelerationLoad = appliedForce / Math.max(1, totalMass);
      if (active) {
        const fragile = active.kind === "fragile";
        const threshold = fragile ? FRAGILE_LOAD_THRESHOLD : ORDINARY_LOAD_THRESHOLD;
        if (accelerationLoad > threshold) {
          const rate = fragile ? FRAGILE_WEAR_RATE : ORDINARY_WEAR_RATE;
          const wear = (accelerationLoad - threshold) * rate * dt;
          game.cargo.filter((item) => item.source === "contract").forEach((item) => {
            item.condition = Math.max(0.15, item.condition - wear);
          });
        }
      }

      applyAtmosphere(game, dt);

      game.ship.x += game.ship.vx * dt;
      game.ship.y += game.ship.vy * dt;
      if (Math.abs(game.ship.x) > WORLD.width / 2 || Math.abs(game.ship.y) > WORLD.height / 2) {
        game.ship.vx += (-game.ship.x / WORLD.width) * 6 * dt;
        game.ship.vy += (-game.ship.y / WORLD.height) * 6 * dt;
      }
      updateDebrisField(game, dt);
      resolveContacts(game, HULL_RADIUS[shipDef.size]);

      game.pickups.forEach((pickup) => {
        const anchored = pickup.anchor ? stationById(pickup.anchor.station) : null;
        if (pickup.anchor && anchored) {
          const pose = stationPose(anchored, game.elapsed);
          pickup.x = pose.x + pickup.anchor.dx;
          pickup.y = pose.y + pickup.anchor.dy;
          pickup.vx = pose.vx;
          pickup.vy = pose.vy;
        } else {
          pickup.x += pickup.vx * dt;
          pickup.y += pickup.vy * dt;
        }
        pickup.angle += pickup.spin * dt;
        if (distance(game.ship, pickup) < (game.upgrades.includes("scanner") ? 520 : 215)) pickup.discovered = true;
      });

      if (engineAmount > 0.2 && Math.random() < dt * 28) {
        const art = shipArtFor(shipDef);
        const exhaust = -art.exhaust * art.scale;
        game.particles.push({
          x: game.ship.x - Math.cos(game.ship.angle) * exhaust,
          y: game.ship.y - Math.sin(game.ship.angle) * exhaust,
          vx: game.ship.vx - Math.cos(game.ship.angle) * (45 + Math.random() * 35),
          vy: game.ship.vy - Math.sin(game.ship.angle) * (45 + Math.random() * 35),
          life: 0.7,
          maxLife: 0.7,
          size: 2 + Math.random() * 3,
          color: Math.random() > 0.4 ? "#e68449" : "#f6d27b",
        });
      }
      game.particles.forEach((particle) => {
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.life -= dt;
      });
      game.particles = game.particles.filter((particle) => particle.life > 0).slice(-160);
      game.shake *= Math.max(0, 1 - dt * 7);

      if (game.ship.hull <= 0) {
        game.credits -= INSURANCE_EXCESS;
        game.reputation = Math.max(0, game.reputation - 2);
        game.cargo = [];
        game.pickups = [];
        game.activeContractId = null;
        const home = stationPose(STATIONS[0], game.elapsed);
        const rescue = berthPoint(STATIONS[0], 100, home);
        game.ship = { x: rescue.x, y: rescue.y, vx: home.vx, vy: home.vy, angle: STATIONS[0].orientation, av: 0, fuel: 24, hull: 52 };
        game.dockedId = "pilgrim";
        salvageSeededRef.current = false;
        saveGame(game);
        notify(`Hull lost to ${lastHarmRef.current}. Pilgrim recovered the wreck. Excess ${money(INSURANCE_EXCESS)}; account stands at ${money(game.credits)}.`, 9);
      }

      if (actionRequestRef.current || (keysRef.current[" "] && !actionLatchRef.current)) {
        actionRequestRef.current = false;
        actionLatchRef.current = true;
        act(game);
      }
      if (!keysRef.current[" "]) actionLatchRef.current = false;

      if (game.elapsed - game.lastSave > 4) {
        saveGame(game);
        game.lastSave = game.elapsed;
      }
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      return { width: rect.width, height: rect.height, dpr };
    };

    const drawCargo = (ctx: CanvasRenderingContext2D, kind: CargoKind, size = 1, condition = 1) => {
      drawCargoUnit(ctx, kind, { size, condition, time: gameRef.current.elapsed });
    };

    /** Paints any ship at any pose: the flown vessel, or the truck in the title composition. */
    const drawShip = (ctx: CanvasRenderingContext2D, pose: ShipPose, time: number) => {
      const ship = shipById(pose.shipId);
      const art = shipArtFor(ship);
      ctx.save();
      const scale = art.scale * (pose.scale ?? 1);
      ctx.translate(pose.x, pose.y);
      ctx.rotate(pose.angle);
      ctx.scale(scale, scale);

      const paintCargo = () => {
        pose.cargo.forEach((item, index) => {
          const at = art.clamps[index] ?? art.clamps[art.clamps.length - 1];
          ctx.save();
          ctx.translate(at.x, at.y);
          drawCargo(ctx, item.kind, art.cargoScale, item.condition);
          ctx.restore();
        });
      };
      const paintClamps = () => {
        const slots = ship.slots + (pose.upgrades.includes("clamps") ? 1 : 0);
        art.clamps.slice(0, slots).forEach((_, slot) => art.drawClamp?.(ctx, slot, slot < pose.cargo.length));
      };

      const state = { upgrades: pose.upgrades, thrusting: pose.thrusting, showLabel: pose.showLabel, time };
      if (art.cargoLayer === "under") {
        paintClamps();
        paintCargo();
        art.drawHull(ctx, state);
      } else {
        art.drawHull(ctx, state);
        paintCargo();
        paintClamps();
      }
      ctx.restore();
    };

    const draw = (game: GameMutable, dims: { width: number; height: number; dpr: number }) => {
      const { width, height, dpr } = dims;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      const bg = context.createRadialGradient(width * 0.7, height * 0.25, 0, width * 0.5, height * 0.5, width);
      bg.addColorStop(0, "#132020");
      bg.addColorStop(0.45, "#080e10");
      bg.addColorStop(1, "#030607");
      context.fillStyle = bg;
      context.fillRect(0, 0, width, height);

      const cam = cameraRef.current;
      const speed = Math.hypot(game.ship.vx, game.ship.vy);
      const target = stationById(game.targetId);
      const targetPose = target ? stationPose(target, game.elapsed) : null;
      const targetDist = targetPose ? distance(game.ship, targetPose) : 9999;
      const desiredZoom = game.dockedId ? 1.25 : targetDist < 300 ? 1.12 : clamp(0.92 - speed / 700, 0.3, 0.95);
      const title = screen === "title" ? titleLayout(width, height, stationPose(TITLE_STATION, game.elapsed)) : null;
      if (title) {
        cam.zoom = lerp(cam.zoom, title.camera.zoom, 0.02);
        cam.x = lerp(cam.x, title.camera.x, 0.02);
        cam.y = lerp(cam.y, title.camera.y, 0.02);
        titlePoseRef.current = titleShipPose(title.anchor, title.shipScale, game.elapsed, title.station);
      } else {
        cam.zoom = lerp(cam.zoom, desiredZoom, 0.025);
        cam.x = lerp(cam.x, game.ship.x + game.ship.vx * 1.4, 0.055);
        cam.y = lerp(cam.y, game.ship.y + game.ship.vy * 1.4, 0.055);
      }
      const shakeX = (Math.random() - 0.5) * game.shake;
      const shakeY = (Math.random() - 0.5) * game.shake;

      starRef.current.forEach((star) => {
        const layer = 0.04 + (star.size % 1) * 0.04;
        const x = ((star.x * width * 1.8 - cam.x * layer) % (width * 1.8) + width * 1.8) % (width * 1.8) - width * 0.4;
        const y = ((star.y * height * 1.8 - cam.y * layer) % (height * 1.8) + height * 1.8) % (height * 1.8) - height * 0.4;
        context.fillStyle = star.warm ? `rgba(230,183,113,${star.alpha})` : `rgba(196,215,210,${star.alpha})`;
        context.fillRect(x, y, star.size, star.size);
      });

      context.save();
      context.translate(width / 2 + shakeX, height / 2 + shakeY);
      context.scale(cam.zoom, cam.zoom);
      context.translate(-cam.x, -cam.y);

      /*
        * Hazard rings, drawn at the bodies' TRUE centres rather than at the
        * parallax-shifted centres they are painted at. The painting is
        * background; these rings describe the simulation, which is where
        * the ship actually is. Outermost is the old gravity guide, then the
        * top of the atmosphere, then the deck — and the deck brightens as
        * the ship closes on it, so the last ring is the loudest.
        */
      /* The lanes the ports run on, faint enough to stay background. */
      context.strokeStyle = "rgba(125,144,137,.055)";
      context.lineWidth = 1 / cam.zoom;
      STATIONS.forEach((station) => {
        const primary = BODIES.find((body) => body.id === station.orbit.around);
        if (!primary) return;
        context.beginPath();
        context.arc(primary.position.x, primary.position.y, orbitRadius(station), 0, TAU);
        context.stroke();
      });

      BODIES.forEach((body) => {
        const deck = body.radius * SURFACE_CONTACT;
        context.lineWidth = 1 / cam.zoom;
        context.strokeStyle = "rgba(125,144,137,.08)";
        context.beginPath(); context.arc(body.position.x, body.position.y, body.radius * GRAVITY_REACH, 0, TAU); context.stroke();
        if (body.atmosphere) {
          context.strokeStyle = "rgba(150,190,190,.14)";
          context.setLineDash([14 / cam.zoom, 18 / cam.zoom]);
          context.beginPath(); context.arc(body.position.x, body.position.y, body.radius * ATMOSPHERE_TOP, 0, TAU); context.stroke();
          context.setLineDash([]);
        }
        const near = clamp(1 - (distance(game.ship, body.position) - deck) / (body.radius * 0.9), 0, 1);
        context.strokeStyle = `rgba(214,86,58,${(0.15 + near * 0.6).toFixed(3)})`;
        context.lineWidth = (1 + near * 1.5) / cam.zoom;
        context.setLineDash([5 / cam.zoom, 9 / cam.zoom]);
        context.beginPath(); context.arc(body.position.x, body.position.y, deck, 0, TAU); context.stroke();
        context.setLineDash([]);
      });

      context.save();
      context.translate(SALVAGE_ZONE.center.x, SALVAGE_ZONE.center.y);
      const dust = context.createRadialGradient(0, 0, 10, 0, 0, SALVAGE_ZONE.radius);
      dust.addColorStop(0, "rgba(123,105,74,.07)");
      dust.addColorStop(0.6, "rgba(102,92,73,.035)");
      dust.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = dust;
      context.beginPath(); context.arc(0, 0, SALVAGE_ZONE.radius, 0, TAU); context.fill();
      context.strokeStyle = "rgba(175,137,79,.12)";
      context.setLineDash([3, 13]);
      context.beginPath(); context.arc(0, 0, SALVAGE_ZONE.radius * 0.72, 0, TAU); context.stroke();
      context.setLineDash([]);
      context.restore();
      /* The specks that used to stand in for debris are gone: the field is
         now real, simulated hazard chunks, drawn with the traffic below
         once discovered (see game.debris.forEach further down). */

      /* Planets sit behind the traffic and drift with parallax, not with the world. */
      BODIES.forEach((body) => {
        const at = planetParallax(body, cam);
        context.save();
        context.translate(at.x, at.y);
        drawPlanet(context, body, { time: game.elapsed, zoom: cam.zoom });
        context.restore();
      });

      if (targetPose && !game.dockedId) {
        context.strokeStyle = "rgba(211,165,79,.18)";
        context.lineWidth = 1 / cam.zoom;
        context.setLineDash([9 / cam.zoom, 13 / cam.zoom]);
        context.beginPath(); context.moveTo(game.ship.x, game.ship.y); context.lineTo(targetPose.x, targetPose.y); context.stroke();
        context.setLineDash([]);
      }

      STATIONS.forEach((station) => {
        const pose = stationPose(station, game.elapsed);
        drawStation(context, station, {
          time: game.elapsed,
          zoom: cam.zoom,
          target: station.id === game.targetId,
          closingSpeed: Math.hypot(game.ship.vx - pose.vx, game.ship.vy - pose.vy),
          shipDistance: distance(game.ship, pose),
          at: pose,
        });
      });
      /* Debris draws under the pickups so a grabbable find stays the readable
         thing on screen where the two overlap. An undiscovered chunk still
         hits the ship (see resolveContacts) — it simply is not drawn yet. */
      game.debris.forEach((chunk) => {
        if (!chunk.discovered) return;
        context.save();
        context.translate(chunk.x, chunk.y);
        context.rotate(chunk.angle);
        drawDebrisChunk(context, { r: chunk.r, variant: chunk.variant });
        if (distance(game.ship, chunk) < chunk.r + 130) {
          context.strokeStyle = "rgba(214,86,58,.55)";
          context.lineWidth = 1 / cam.zoom;
          context.beginPath(); context.arc(0, 0, chunk.r + 10 + Math.sin(game.elapsed * 3) * 2, 0, TAU); context.stroke();
        }
        context.restore();
      });
      game.pickups.forEach((pickup) => {
        if (!pickup.discovered && pickup.source === "salvage") return;
        context.save();
        context.translate(pickup.x, pickup.y);
        context.rotate(pickup.angle);
        drawCargo(context, pickup.kind, pickup.source === "salvage" ? 0.9 : 1, pickup.condition);
        if (distance(game.ship, pickup) < 145) {
          context.strokeStyle = pickup.source === "salvage" ? "rgba(102,185,174,.58)" : "rgba(231,177,80,.62)";
          context.lineWidth = 1 / cam.zoom;
          context.beginPath(); context.arc(0, 0, 28 + Math.sin(game.elapsed * 3) * 3, 0, TAU); context.stroke();
        }
        context.restore();
      });
      game.particles.forEach((particle) => {
        context.globalAlpha = particle.life / particle.maxLife;
        context.fillStyle = particle.color;
        context.beginPath(); context.arc(particle.x, particle.y, particle.size, 0, TAU); context.fill();
      });
      context.globalAlpha = 1;

      if (!game.dockedId && !title) {
        context.strokeStyle = "rgba(115,198,187,.62)";
        context.lineWidth = 1.2 / cam.zoom;
        context.beginPath();
        context.moveTo(game.ship.x, game.ship.y);
        context.lineTo(game.ship.x + game.ship.vx * 3.2, game.ship.y + game.ship.vy * 3.2);
        context.stroke();
        context.fillStyle = "rgba(115,198,187,.85)";
        context.beginPath(); context.arc(game.ship.x + game.ship.vx * 3.2, game.ship.y + game.ship.vy * 3.2, 2.5 / cam.zoom, 0, TAU); context.fill();
      }
      const shipPose: ShipPose = title && titlePoseRef.current ? titlePoseRef.current : {
        x: game.ship.x,
        y: game.ship.y,
        angle: game.ship.angle,
        shipId: game.shipId,
        cargo: game.cargo,
        upgrades: game.upgrades,
        thrusting: Boolean((keysRef.current.w || keysRef.current.arrowup) && game.ship.fuel > 0 && screen === "game"),
        showLabel: cam.zoom > 0.75,
      };
      drawShip(context, shipPose, game.elapsed);

      if (cam.zoom > 0.42) {
        context.font = `${11 / cam.zoom}px ui-monospace, monospace`;
        context.textAlign = "center";
        STATIONS.forEach((station) => {
          const pose = stationPose(station, game.elapsed);
          context.fillStyle = station.id === game.targetId ? "#f0c46b" : "rgba(226,221,204,.72)";
          context.fillText(`${station.callSign}  ${station.name.toUpperCase()}`, pose.x, pose.y + 76 / cam.zoom);
        });
      }
      context.restore();

      if (!game.dockedId && targetPose) {
        const tx = (targetPose.x - cam.x) * cam.zoom + width / 2;
        const ty = (targetPose.y - cam.y) * cam.zoom + height / 2;
        if (tx < 60 || tx > width - 60 || ty < 80 || ty > height - 70) {
          const cx = width / 2;
          const cy = height / 2;
          const angle = Math.atan2(ty - cy, tx - cx);
          const radiusX = width / 2 - 48;
          const radiusY = height / 2 - 70;
          const factor = Math.min(Math.abs(radiusX / Math.cos(angle)), Math.abs(radiusY / Math.sin(angle)));
          const x = cx + Math.cos(angle) * factor;
          const y = cy + Math.sin(angle) * factor;
          context.save();
          context.translate(x, y);
          context.rotate(angle);
          context.fillStyle = "#e5b658";
          context.beginPath(); context.moveTo(12, 0); context.lineTo(-7, -6); context.lineTo(-4, 0); context.lineTo(-7, 6); context.closePath(); context.fill();
          context.restore();
        }
      }
      const vignette = context.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.22, width / 2, height / 2, Math.max(width, height) * 0.7);
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(0,0,0,.55)");
      context.fillStyle = vignette;
      context.fillRect(0, 0, width, height);
    };

    const loop = (now: number) => {
      const dt = Math.min(0.034, Math.max(0, (now - last) / 1000));
      last = now;
      const game = gameRef.current;
      update(game, dt);
      const dims = resize();
      draw(game, dims);
      uiTimerRef.current += dt;
      if (uiTimerRef.current > 0.12) {
        uiTimerRef.current = 0;
        setUi(snapshot(game));
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [audio, helpOpen, mapOpen, muted, notify, screen, undock]);

  const docked = stationById(ui.dockedId);
  const target = stationById(ui.targetId) ?? STATIONS[0];
  const active = contractById(ui.activeContractId);
  const currentShip = shipById(ui.shipId);
  const fuelCapacity = currentShip.fuelCapacity * (ui.upgrades.includes("tank") ? 1.35 : 1);
  const cargoMass = ui.cargo.reduce((sum, item) => sum + CARGO[item.kind].mass, 0);
  const contractsHere = useMemo(() => CONTRACTS.filter((contract) => contract.origin === ui.dockedId), [ui.dockedId]);
  const carriedFreight = ui.cargo.filter((item) => item.source === "contract");
  /** 1 before anything is clamped, so the manifest starts looking pristine rather than warned-about. */
  const carriedCondition = carriedFreight.length ? carriedFreight.reduce((sum, item) => sum + item.condition, 0) / carriedFreight.length : 1;

  return (
    <main className={`game-shell ${screen === "title" ? "is-title" : "is-playing"}`}>
      <canvas ref={canvasRef} className="space-canvas" aria-label="The Cinder star system flight view" />
      <div className="scanline" aria-hidden="true" />

      {screen === "title" && (
        <section className="title-screen" aria-labelledby="game-title">
          <div className="title-copy">
            <p className="eyebrow"><span>INDEPENDENT OPERATOR LICENSE 07</span><span>CINDER SYSTEM</span></p>
            <h1 id="game-title">EMBERLINE</h1>
            <p className="subtitle">Civilian orbital freight</p>
            <div className="title-rule" aria-hidden="true" />
            <p className="intro">There are no heroes on the manifest. Only mass, momentum, and the quiet satisfaction of bringing a difficult load home.</p>
            <div className="title-actions">
              <button className="primary-button" onClick={() => start(false)}>Begin a new shift <span>→</span></button>
              {hasSave && <button className="ghost-button" onClick={() => start(true)}>Continue saved shift</button>}
            </div>
            <div className="feature-line"><span>NEWTONIAN FLIGHT</span><span>PHYSICAL FREIGHT</span><span>LOCAL SAVE</span></div>
          </div>
          <div className="title-log">
            <span className="status-light" />
            <div><strong>PILGRIM TRAFFIC</strong><small>Local sunrise in 18 minutes. Freight lanes remain clear.</small></div>
          </div>
        </section>
      )}

      {screen === "game" && (
        <>
          <header className="topbar">
            <div className="brand"><b>EMBERLINE</b><span>OPERATOR 07 / {currentShip.name.toUpperCase()} {currentShip.model}</span></div>
            <div className="top-readouts">
              <div><span>{ui.credits < 0 ? "IN ARREARS" : "ACCOUNT"}</span><strong className={ui.credits < 0 ? "arrears" : ""}>{money(ui.credits)}</strong></div>
              <div><span>STANDING</span><strong>{String(ui.reputation).padStart(2, "0")}</strong></div>
              <div><span>JOBS</span><strong>{String(ui.completed).padStart(2, "0")}</strong></div>
            </div>
            <nav className="utility-nav" aria-label="Game utilities">
              <button onClick={() => setMapOpen(true)}><kbd>M</kbd> System</button>
              <button onClick={() => setHelpOpen(true)}><kbd>H</kbd> Guide</button>
              <button aria-label={muted ? "Enable audio" : "Mute audio"} onClick={() => { setMuted((value) => { audio.mute(!value); return !value; }); }}>{muted ? "Audio off" : "Audio on"}</button>
              <button aria-label="Enter fullscreen" onClick={() => void document.documentElement.requestFullscreen?.()}>Expand</button>
            </nav>
          </header>

          <aside className="mission-card plate">
            <div className="panel-kicker">{active ? "ACTIVE MANIFEST" : "OPEN SHIFT"}<span className={`stamp ${active?.kind === "cryogenic" ? "cold" : ""}`}>{active?.kind ?? "self-directed"}</span></div>
            {active ? (
              <>
                <h2>{active.title}</h2>
                <p>{active.description}</p>
                <div className="manifest-line">
                  <CargoPortrait kind={active.cargo} count={active.quantity} condition={carriedCondition} />
                  <div>
                    <b>{CARGO[active.cargo].name}</b>{CARGO[active.cargo].short} × {active.quantity} · {CARGO[active.cargo].mass * active.quantity} t
                    {carriedFreight.length > 0 && (
                      <span className={`condition-readout ${carriedCondition < CONDITION_REJECT_THRESHOLD ? "danger" : carriedCondition < 0.8 ? "warn" : ""}`}>
                        Condition {Math.round(carriedCondition * 100)}%{carriedCondition < CONDITION_REJECT_THRESHOLD ? " · will be refused" : ""}
                      </span>
                    )}
                  </div>
                </div>
                <div className="route-line"><span>{stationById(active.origin)?.callSign}</span><i /><span>{stationById(active.destination)?.callSign}</span></div>
                <div className="objective">
                  <small>NEXT ACTION</small>
                  <strong>{ui.loadingRemaining > 0 ? `Secure ${ui.loadingRemaining} staged unit${ui.loadingRemaining > 1 ? "s" : ""}` : `Dock at ${stationById(active.destination)?.name}`}</strong>
                </div>
                {active.timeLimit && (
                  <>
                    <div className={`timer ${ui.contractTime < 30 ? "urgent" : ""}`}><span>TIME BONUS</span><b>{seconds(ui.contractTime)}</b></div>
                    <div className={`timer deadline ${ui.contractDeadline < DEADLINE_WARNING_WINDOW ? "urgent" : ""}`}><span>HARD DEADLINE</span><b>{seconds(ui.contractDeadline)}</b></div>
                  </>
                )}
                <button className="text-button danger" onClick={abandonContract}>Abandon contract</button>
              </>
            ) : (
              <>
                <h2>Choose your next line</h2>
                <p>Dock at a station to review local work, or set a course for The Wake and hunt salvage.</p>
                <button className="text-button" onClick={() => setMapOpen(true)}>Open system chart →</button>
              </>
            )}
          </aside>

          <aside className="telemetry-card plate">
            <div className="velocity-readout"><span>SPEED</span><strong>{Math.round(ui.speed)}</strong><small>m/s</small></div>
            <div className="telemetry-row"><span>RANGE TO {target.callSign}</span><b>{Math.round(ui.distance)} km</b></div>
            <div className="telemetry-row"><span>CLOSING</span><b className={ui.closing > 36 ? "hot" : ""}>{Math.round(ui.closing)} m/s</b></div>
            <div className="bar-row"><span>PROPELLANT</span><div className="meter"><i style={{ width: `${clamp(ui.fuel / fuelCapacity * 100, 0, 100)}%` }} /></div><b>{Math.round(ui.fuel)}</b></div>
            <div className="bar-row"><span>HULL</span><div className="meter hull"><i style={{ width: `${ui.hull}%` }} /></div><b>{Math.round(ui.hull)}%</b></div>
            <div className="telemetry-row"><span>PAYLOAD</span><b>{cargoMass} t / {ui.cargo.length} clamps</b></div>
            <button className={`assist-toggle ${ui.assist ? "active" : ""}`} onClick={() => { gameRef.current.assist = !gameRef.current.assist; setUi(snapshot(gameRef.current)); }}><span className="status-light" /> FLIGHT ASSIST {ui.assist ? "ON" : "OFF"} <kbd>F</kbd></button>
            {!ui.dockedId && ui.fuel < 9 && <button className="tow-button" onClick={emergencyTow}>Request rescue tow · {money(TOW_FEE)}</button>}
          </aside>

          {docked && (
            <section className="dock-panel plate">
              <div className="dock-heading">
                <div>
                  <span>BERTHED AT {docked.callSign}</span>
                  <h2>{docked.name}</h2>
                  <small className="kind">{docked.kind}</small>
                  <p>{docked.description}</p>
                  <div className="services">{docked.services.map((item) => <span className="tag" key={item}>{item}</span>)}</div>
                </div>
                <button className="primary-button compact" onClick={undock}>Release berth <span>→</span></button>
              </div>
              <div className="dock-tabs" role="tablist">
                <button className={panel === "contracts" ? "active" : ""} onClick={() => setPanel("contracts")}>Contract board</button>
                <button className={panel === "service" ? "active" : ""} onClick={() => setPanel("service")}>Service & refit</button>
                <button className={panel === "fleet" ? "active" : ""} onClick={() => setPanel("fleet")}>Shipyard</button>
              </div>
              <div className="dock-content">
                {panel === "contracts" && (
                  <div className="contract-list">
                    {contractsHere.map((contract) => {
                      const reward = rewardFor(contract, gameRef.current.routeRuns);
                      const withheld = ui.credits < 0 && contract.baseReward > ARREARS_CEILING;
                      const locked = withheld || ui.reputation < contract.minReputation || Boolean(contract.requiredShip && contract.requiredShip !== ui.shipId) || (contract.kind === "cryogenic" && !ui.upgrades.includes("cryo")) || (contract.minSlots ?? contract.quantity) > currentShip.slots + (ui.upgrades.includes("clamps") ? 1 : 0);
                      const cargo = CARGO[contract.cargo];
                      return (
                        <article className={`contract ${locked ? "locked" : ""}`} key={contract.id} style={{ "--accent": cargo.accent } as React.CSSProperties}>
                          <div className="contract-top"><span className={`stamp ${contract.kind === "cryogenic" ? "cold" : ""}`}>{contract.kind}</span><b>{money(reward)}</b></div>
                          <div className="contract-body">
                            <div><h3>{contract.title}</h3><p>{contract.description}</p></div>
                            <CargoPortrait kind={contract.cargo} count={contract.quantity} />
                          </div>
                          <div className="manifest"><span>{cargo.short} × {contract.quantity}</span><span>{cargo.mass * contract.quantity} t</span><span>{stationById(contract.origin)?.callSign} → {stationById(contract.destination)?.callSign}</span>{contract.timeLimit && <span>{seconds(contract.timeLimit)} bonus window</span>}</div>
                          <div className="tear" aria-hidden="true" />
                          {withheld ? <small className="requirement">Withheld while the account is overdrawn</small> : locked ? <small className="requirement">Requires rep {contract.minReputation}{contract.requiredShip ? ` · ${shipById(contract.requiredShip).name}` : ""}{contract.kind === "cryogenic" ? " · Cryo umbilical" : ""}{(contract.minSlots ?? contract.quantity) > currentShip.slots + (ui.upgrades.includes("clamps") ? 1 : 0) ? ` · ${contract.minSlots ?? contract.quantity} clamps` : ""}</small> : <button disabled={Boolean(ui.activeContractId)} onClick={() => stageContract(contract)}>Accept manifest</button>}
                        </article>
                      );
                    })}
                  </div>
                )}
                {panel === "service" && (
                  <div className="service-grid">
                    <article><span>PROPELLANT</span><h3>{Math.round(ui.fuel)} / {Math.round(fuelCapacity)}</h3><p>{ui.credits < 0 ? "Refined monopropellant. The yard meters it onto your tab until the account is square — you can always fly." : "Refined monopropellant, metered at this port’s posted rate."}</p><button onClick={() => service("fuel")}>Fill tanks · {money(Math.ceil((fuelCapacity - ui.fuel) * 4))}</button></article>
                    <article><span>HULL & RIGGING</span><h3>{Math.round(ui.hull)}% integrity</h3><p>{ui.credits < 0 ? "Pressure shell, radiator, clamp, and RCS inspection. Withheld until the account is settled." : "Pressure shell, radiator, clamp, and RCS inspection."}</p><button disabled={ui.credits < 0} onClick={() => service("repair")}>Authorize work · {money(Math.ceil((100 - ui.hull) * 18))}</button></article>
                    {UPGRADES.map((upgrade) => (
                      <article className={`${!docked.services.includes("upgrades") || ui.credits < 0 ? "locked" : ""} ${ui.upgrades.includes(upgrade.id) ? "fitted" : ""}`} key={upgrade.id}><span>{ui.upgrades.includes(upgrade.id) ? "INSTALLED" : "SHIP REFIT"}</span><h3>{upgrade.name}</h3><p>{upgrade.description}</p>{ui.upgrades.includes(upgrade.id) ? <small className="installed">Hardware fitted</small> : <button disabled={!docked.services.includes("upgrades") || ui.credits < 0} onClick={() => buyUpgrade(upgrade.id)}>Install · {money(upgrade.cost)}</button>}</article>
                    ))}
                  </div>
                )}
                {panel === "fleet" && (
                  <div className="ship-list">
                    {SHIPS.map((ship) => {
                      const owned = ui.ownedShips.includes(ship.id);
                      return <article className={`${ui.shipId === ship.id ? "selected" : ""} ${!docked.services.includes("ships") ? "locked" : ""}`} key={ship.id}><ShipPortrait ship={ship} /><span>{ship.role.toUpperCase()}</span><h3>{ship.name} <small>{ship.model}</small></h3><p>{ship.description}</p><div className="ship-stats"><span>{ship.slots} clamps</span><span>{ship.fuelCapacity} fuel</span><span>{ship.dryMass} t dry</span></div><button disabled={!docked.services.includes("ships") || ui.shipId === ship.id || (!owned && ui.credits < 0)} onClick={() => buyOrSwitchShip(ship.id)}>{ui.shipId === ship.id ? "Active vessel" : owned ? "Move to active berth" : `Purchase · ${money(ship.cost)}`}</button></article>;
                    })}
                  </div>
                )}
              </div>
            </section>
          )}

          {!docked && (
            <div className="flight-controls plate" aria-label="Flight controls">
              <div><kbd>A</kbd><kbd>D</kbd><span>ROTATE</span></div>
              <div><kbd>Q</kbd><kbd>E</kbd><span>STRAFE</span></div>
              <div><kbd>W</kbd><span>MAIN DRIVE</span></div>
              <div><kbd>S</kbd><span>RETRO</span></div>
              <div className="emphasis"><kbd>SHIFT</kbd><span>ASSISTED BRAKE</span></div>
              <div className="emphasis"><kbd>SPACE</kbd><span>CLAMP / DOCK</span></div>
            </div>
          )}

          {!docked && (
            <div className="touch-controls" aria-label="Touch flight controls" onContextMenu={(event) => event.preventDefault()}>
              <div><button onPointerDown={() => setTouch("a", true)} onPointerUp={() => setTouch("a", false)} onPointerLeave={() => setTouch("a", false)}>↺</button><button onPointerDown={() => setTouch("d", true)} onPointerUp={() => setTouch("d", false)} onPointerLeave={() => setTouch("d", false)}>↻</button></div>
              <button className="touch-thrust" onPointerDown={() => setTouch("w", true)} onPointerUp={() => setTouch("w", false)} onPointerLeave={() => setTouch("w", false)}>THRUST</button>
              <button onPointerDown={() => setTouch("shift", true)} onPointerUp={() => setTouch("shift", false)} onPointerLeave={() => setTouch("shift", false)}>BRAKE</button>
              <button onClick={() => { actionRequestRef.current = true; }}>CLAMP</button>
            </div>
          )}

          {ui.message && gameRef.current.elapsed < gameRef.current.messageUntil && <div className="radio-toast"><span>PILGRIM NET</span><p>{ui.message}</p></div>}
          <div className={`save-indicator ${savePulse ? "pulse" : ""}`}><span /> SHIFT LOG SAVED LOCALLY</div>
        </>
      )}

      {mapOpen && (
        <section className="modal map-modal plate" role="dialog" aria-modal="true" aria-labelledby="map-title">
          <button className="modal-close" onClick={() => setMapOpen(false)}>Close <kbd>ESC</kbd></button>
          <div className="map-copy"><p className="eyebrow">COMPRESSED NAVIGATION CHART / NOT TO SCALE</p><h2 id="map-title">The Cinder system</h2><p>Learn the working lines. Mine to refinery, refinery to shipyard, ice moon to habitat. Every port is drawn at its mean position and every one of them is moving, so the best route is the one your current ship can fly cleanly to where the port will be.</p></div>
          <div className="system-map">
            <div className="orbit orbit-one" /><div className="orbit orbit-two" />
            {BODIES.map((body) => <div className={`map-body ${body.id}`} key={body.id}><PlanetPortrait body={body} /><span>{body.name.toUpperCase()}<small>{body.kind}</small></span></div>)}
            <div className="wake-zone"><i />THE WAKE</div>
            {STATIONS.map((station) => <button key={station.id} className={`map-station station-${station.id} ${station.id === ui.targetId ? "active" : ""}`} onClick={() => setTarget(station.id)}><i /><b>{station.callSign}</b><span>{station.name}</span></button>)}
          </div>
          <div className="map-legend"><span><i className="legend-port" /> SELECT A PORT TO SET BEACON</span><span><i className="legend-wake" /> SALVAGE REGION</span><span>Current range to {target.callSign}: {Math.round(ui.distance)} km</span></div>
        </section>
      )}

      {helpOpen && (
        <section className="modal guide-modal plate" role="dialog" aria-modal="true" aria-labelledby="guide-title">
          <button className="modal-close" onClick={() => setHelpOpen(false)}>Close <kbd>ESC</kbd></button>
          <div className="guide-heading"><p className="eyebrow">KESTREL U-3 / QUICK REFERENCE</p><h2 id="guide-title">Momentum is the road.</h2><p>Thrust changes velocity. Releasing the controls does not stop the ship. Turn early, brake earlier, and arrive slowly.</p></div>
          <div className="guide-grid">
            <article><span>01</span><h3>Take local work</h3><p>While docked, choose a manifest from the contract board. Repeated routes gradually pay less as local demand is met. Every manifest with a bonus window also carries a hard deadline well beyond it — miss that and the contract voids, but freight already aboard survives as marked-down salvage rather than being lost outright. Nobody dies out here — they go broke. A tow or a written-off hull is billed whether you can cover it or not, and an overdrawn account is held to small work until you fly it back.</p></article>
            <article><span>02</span><h3>Secure the load</h3><p>Release the berth, drift within 92 m of each staged unit, match its speed, then press <kbd>SPACE</kbd>. Staged freight rides its pad around with the port. Cargo changes mass and handling — and fragile freight cannot take the main drive the way sturdier cargo can, so favor the brake over the throttle. The manifest card shows condition as you fly; arrive below half strength and the destination refuses the load outright, penalty included.</p></article>
            <article><span>03</span><h3>Fly the vector</h3><p><kbd>W</kbd> drives forward. <kbd>A</kbd>/<kbd>D</kbd> rotate. <kbd>Q</kbd>/<kbd>E</kbd> strafe. The teal line is your true velocity. Burn, coast, flip, brake — a loaded round trip costs most of a tank, so the coast is free and the burn is not. Aim where the beacon is going, not where it sits.</p></article>
            <article><span>04</span><h3>Make a clean arrival</h3><p>Ports orbit, so an arrival is a rendezvous. <b>CLOSING</b> on the panel is your speed relative to the pad, and it has to be under 36 m/s to clamp — matching a port’s motion matters more than stopping. Structure is solid: contact above 18 m/s costs hull, above 55 m/s it tears a container off the spine.</p></article>
            <article><span>05</span><h3>Respect the deck</h3><p>The red ring is a planet’s surface and it is solid. The dashed ring above it is atmosphere: drag and heat, survivable briefly, useful for shedding speed. Loaded, you cannot climb straight out of a deep well.</p></article>
            <article><span>06</span><h3>Work The Wake</h3><p>A slow debris field sits northeast of Rayleigh, and it is solid — the same closing-speed rule that governs a station or a planet governs it. A scanner shows it from 520 units out instead of 215; without one, flying in fast is a gamble. Salvage pays well, and something worth more sits deep in the field.</p></article>
          </div>
          <button className="primary-button" onClick={() => setHelpOpen(false)}>Return to the flight deck <span>→</span></button>
        </section>
      )}
    </main>
  );
}
