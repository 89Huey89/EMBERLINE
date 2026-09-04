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

export type CelestialBody = {
  id: string;
  name: string;
  kind: string;
  position: Vec2;
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

