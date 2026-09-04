export type Vec2 = { x: number; y: number };

export type CargoKind =
  | "ore"
  | "water"
  | "metals"
  | "components"
  | "electronics"
  | "food"
  | "cryo"
  | "machinery"
  | "science";

export type ContractKind =
  | "standard"
  | "express"
  | "bulk"
  | "fragile"
  | "cryogenic"
  | "heavy"
  | "salvage";

export type CargoDefinition = {
  id: CargoKind;
  name: string;
  short: string;
  mass: number;
  value: number;
  color: string;
  accent: string;
  shape: "crate" | "tank" | "ore" | "machine";
};

/** The surface painters a world can choose from. */
export type PlanetSurface = "rocky" | "ice" | "metallic";

/** Colours a world may override on top of its surface's palette. */
export type PlanetPaintOverride = {
  highlight?: string;
  dark?: string;
  shadow?: string;
  surfacePx?: number;
};

/** The character module a port carries on its boom. */
export type StationModule = "none" | "market" | "kiln" | "shipyard" | "mine" | "cryoworks" | "observatory";

export type CelestialBody = {
  id: string;
  name: string;
  kind: string;
  /**
   * Position at the start of a shift, and the whole definition of the body's
   * orbit: its distance from the star fixes the radius and its bearing fixes
   * the phase. Use `bodyPose` for where a body actually is; this is only the
   * anchor that orbit is derived from. The star itself carries no orbit and
   * simply sits here.
   */
  position: Vec2;
  /** The body it orbits, and seconds for one lap. Absent for the star. */
  orbit?: { around: string; period: number };
  /** Marks the system primary: it lights everything, and its edge is a corona rather than a surface. */
  star?: true;
  /**
   * Which surface painter renders this world, and what its silhouette does.
   *
   * These are declarations, not identities. The art used to pick a painter by
   * matching the body's id, which meant a world in a new system silently
   * rendered as Rayleigh with nothing to explain why. A world now says what
   * it looks like and the art obeys, so a new system picks from the looks
   * that exist rather than needing one written for it.
   */
  surface?: PlanetSurface;
  /** A captured body rather than a sphere: ragged outline instead of a disc. */
  irregular?: boolean;
  /** Inhabited: settlement lights on the night side, and orbital elevators. */
  settled?: boolean;
  /** Per-body colour overrides, layered over the surface's own palette. */
  paint?: PlanetPaintOverride;
  radius: number;
  gravity: number;
  color: string;
  atmosphere?: string;
  description: string;
};

export type Station = {
  id: string;
  name: string;
  callSign: string;
  kind: string;
  /**
   * Position at the start of a shift, and the whole definition of the
   * station's orbit: its distance from the primary fixes the radius and its
   * bearing fixes the phase. Use `stationPose` for where a station actually
   * is; this is only the anchor that orbit is derived from.
   */
  position: Vec2;
  /** The body it holds station around, and seconds for one lap. */
  orbit: { around: string; period: number };
  /** Which character module the art draws on the boom. Declared, not inferred from the id. */
  module?: StationModule;
  /** A cold station: teal work lights rather than amber. */
  cold?: boolean;
  color: string;
  orientation: number;
  size: "small" | "standard" | "large";
  produces: CargoKind[];
  consumes: CargoKind[];
  services: string[];
  description: string;
};

export type ShipDefinition = {
  id: "courier" | "freighter" | "hauler" | "tug";
  name: string;
  model: string;
  role: string;
  cost: number;
  dryMass: number;
  thrust: number;
  reverseThrust: number;
  rotation: number;
  fuelCapacity: number;
  slots: number;
  towRating: number;
  size: "small" | "standard" | "large";
  color: string;
  description: string;
};

export type ContractDefinition = {
  id: string;
  title: string;
  kind: ContractKind;
  origin: string;
  destination: string;
  cargo: CargoKind;
  quantity: number;
  baseReward: number;
  timeLimit?: number;
  minReputation: number;
  minSlots?: number;
  requiredShip?: ShipDefinition["id"];
  description: string;
};

export type UpgradeDefinition = {
  id: "engine" | "rcs" | "tank" | "clamps" | "scanner" | "cryo";
  name: string;
  cost: number;
  description: string;
};

export type SalvageField = {
  id: string;
  name: string;
  /** Position at the start of a shift; see CelestialBody.position for the convention. */
  center: Vec2;
  orbit: { around: string; period: number };
  radius: number;
  description: string;
};

/**
 * One system's worth of world. `bodies`, `stations`, `contracts` and
 * `fields` only ever reference ids within the same system — a body's
 * `orbit.around`, a contract's `origin`/`destination`, a pickup's
 * `anchor.frame` — so a second system is another entry in `SYSTEMS`
 * (see `data.ts`) and nothing else.
 */
/**
 * A star system, and everything in it.
 *
 * Ids must be unique across ALL systems, not just within one. The art caches
 * a body's painted surface by its id alone, so two systems that both called a
 * world "star" would share one cached texture and one of them would be drawn
 * wrong. Prefixing with the system, or simply naming things distinctly, both
 * work.
 */
export type StarSystem = {
  id: string;
  name: string;
  /** Playable bounds, centred on the star. */
  bounds: { width: number; height: number };
  bodies: CelestialBody[];
  stations: Station[];
  contracts: ContractDefinition[];
  fields: SalvageField[];
};

