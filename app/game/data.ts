import type {
  CargoDefinition,
  CelestialBody,
  ContractDefinition,
  ShipDefinition,
  Station,
  UpgradeDefinition,
} from "./types";

/**
 * Scale of the system, and the one relationship that keeps it playable.
 *
 * A route is meant to be flown as burn / coast / flip / burn, so the trip
 * time comes from thrust-to-mass, not from the map alone. Ships accelerate
 * at 13-19 m/s² empty, which puts the typical Pilgrim - Sinter run near 30 s
 * empty and 40 s loaded, and the longest run in the system near 45 s. A
 * loaded round trip burns most of a tank: propellant is the budget you plan
 * a route against.
 *
 * Body `gravity` is quoted against the true squared distance, so it scales
 * with the square of any change to these positions. It was scaled with them
 * here, which leaves gravity per unit of ship acceleration the thing that
 * actually changed: a close pass now bends a loaded ship, and inside roughly
 * two radii of Rayleigh a loaded courier can no longer climb straight out.
 */
export const WORLD = { width: 35000, height: 35000 };

export const CARGO: Record<string, CargoDefinition> = {
  ore: { id: "ore", name: "Nickel ore", short: "ORE", mass: 18, value: 260, color: "#655e54", accent: "#d29a54", shape: "ore" },
  water: { id: "water", name: "Process water", short: "H₂O", mass: 14, value: 340, color: "#526d73", accent: "#9bc8cc", shape: "tank" },
  metals: { id: "metals", name: "Refined metals", short: "RM", mass: 20, value: 520, color: "#77766f", accent: "#e2b25e", shape: "crate" },
  components: { id: "components", name: "Machine components", short: "MCH", mass: 12, value: 680, color: "#70674d", accent: "#dfb957", shape: "crate" },
  electronics: { id: "electronics", name: "Flight electronics", short: "ELX", mass: 6, value: 920, color: "#335c5a", accent: "#7bd0c2", shape: "crate" },
  food: { id: "food", name: "Habitat provisions", short: "PRO", mass: 8, value: 460, color: "#6d513a", accent: "#d89c64", shape: "crate" },
  cryo: { id: "cryo", name: "Cryogenic cultures", short: "CRYO", mass: 10, value: 1280, color: "#ced9d5", accent: "#83d7d0", shape: "tank" },
  machinery: { id: "machinery", name: "Oversized machinery", short: "HVY", mass: 44, value: 1480, color: "#5a5147", accent: "#ef7b45", shape: "machine" },
  science: { id: "science", name: "Survey instruments", short: "SCI", mass: 7, value: 1100, color: "#5b6570", accent: "#d5bd70", shape: "crate" },
};

/**
 * The star and the worlds, all in one list so gravity, the hazard rings and
 * the contact solver treat them alike. Cinder carries no orbit — it is what
 * everything else orbits — and is marked so the art and the hazard radii can
 * tell a corona from a surface.
 *
 * Periods follow Kepler from the innermost lane outward (T proportional to
 * r^1.5), which is what makes alignments drift and lanes open and close. The
 * base period is set so the fastest body still moves at 35 m/s, well under
 * what any ship cruises at: a world you cannot catch is not a destination.
 */
export const BODIES: CelestialBody[] = [
  {
    id: "star",
    name: "Cinder",
    kind: "system primary",
    position: { x: 0, y: 0 },
    radius: 900,
    gravity: 40000000,
    color: "#f6bd63",
    atmosphere: "#ffd89a",
    star: true,
    description: "The system's own furnace, and the reason every hold in it is warm. Nothing that goes near it comes back.",
  },
  {
    id: "cinder",
    name: "Rayleigh",
    kind: "temperate industrial world",
    position: { x: 0, y: 8400 },
    orbit: { around: "star", period: 2467 },
    radius: 705,
    gravity: 21900000,
    color: "#9e522f",
    atmosphere: "#e39959",
    description: "A rust-gold world under a scattering amber sky. Its orbital elevators feed the oldest yards in the system.",
  },
  {
    id: "morrow",
    name: "Nernst",
    kind: "ice moon",
    position: { x: 12817, y: -7400 },
    orbit: { around: "star", period: 5769 },
    radius: 350,
    gravity: 4250000,
    color: "#6b7e83",
    atmosphere: "#9cc4c4",
    description: "A fractured moon a few degrees above absolute quiet, rich in water ice and deep blue shadow.",
  },
  {
    id: "brindle",
    name: "Roche",
    kind: "captured metallic body",
    position: { x: -3007, y: -1094 },
    orbit: { around: "star", period: 580 },
    radius: 215,
    gravity: 1560000,
    color: "#625749",
    description: "A nickel-iron body caught at the edge of its limit, cut through with tunnels and navigation lamps.",
  },
];

/**
 * The ports.
 *
 * Each `position` is where the station stands at the start of a shift and is
 * also its orbit: distance from the primary is the radius, bearing is the
 * phase. `orbit.period` is authored for play rather than derived from the
 * primary's mass — see `orbits.ts` for why — but the periods are ordered as
 * Kepler would order them, so the wider orbits are the slower ones.
 */
export const STATIONS: Station[] = [
  {
    id: "pilgrim",
    name: "Pilgrim Exchange",
    callSign: "PX-01",
    kind: "commerce & habitation",
    position: { x: -1975, y: 8200 },
    orbit: { around: "cinder", period: 900 },
    color: "#d9b15f",
    orientation: 0.08,
    size: "standard",
    produces: ["food", "electronics"],
    consumes: ["water", "cryo"],
    services: ["contracts", "fuel", "repair"],
    description: "A warm ring of markets, bunkrooms, and shift-change traffic above Rayleigh.",
  },
  {
    id: "sinter",
    name: "Sinter Refinery",
    callSign: "SN-44",
    kind: "ore refinery",
    position: { x: 1975, y: 9850 },
    orbit: { around: "cinder", period: 1220 },
    color: "#d66b3c",
    orientation: -0.55,
    size: "large",
    produces: ["metals", "components"],
    consumes: ["ore", "water"],
    services: ["contracts", "fuel"],
    description: "Kilns and radiators burn copper-bright against Rayleigh’s night side.",
  },
  {
    id: "anvil",
    name: "Anvil Gate Shipyard",
    callSign: "AG-17",
    kind: "shipyard",
    position: { x: -2900, y: 10400 },
    orbit: { around: "cinder", period: 2100 },
    color: "#ca8e52",
    orientation: 0.35,
    size: "large",
    produces: ["machinery"],
    consumes: ["metals", "components", "electronics"],
    services: ["contracts", "fuel", "repair", "upgrades", "ships"],
    description: "A lattice of construction docks where working ships are rebuilt in full view.",
  },
  {
    id: "deepwell",
    name: "Deepwell Extraction",
    callSign: "DW-3",
    kind: "mining concern",
    position: { x: -2407, y: -1269 },
    orbit: { around: "brindle", period: 360 },
    color: "#af7a45",
    orientation: 0.82,
    size: "standard",
    produces: ["ore", "machinery"],
    consumes: ["food", "components"],
    services: ["contracts", "fuel"],
    description: "Ore cages emerge from Roche’s shadow on slow industrial winches.",
  },
  {
    id: "bluehour",
    name: "Bluehour Depot",
    callSign: "BH-08",
    kind: "ice processing & fuel",
    position: { x: 12267, y: -8225 },
    orbit: { around: "morrow", period: 480 },
    color: "#75a8a7",
    orientation: -0.24,
    size: "standard",
    produces: ["water", "cryo"],
    consumes: ["machinery", "food"],
    services: ["contracts", "fuel", "repair"],
    description: "Blue work lamps drift above the moon’s pale scarps and cryogenic farms.",
  },
  {
    id: "quiet",
    name: "Quiet Arc Laboratory",
    callSign: "QA-12",
    kind: "research platform",
    position: { x: 14067, y: -6200 },
    orbit: { around: "morrow", period: 1100 },
    color: "#88aaa7",
    orientation: 0.12,
    size: "small",
    produces: ["science"],
    consumes: ["electronics", "cryo"],
    services: ["contracts", "fuel", "upgrades"],
    description: "A delicate instrument platform listening beyond the traffic lanes.",
  },
];

export const SHIPS: ShipDefinition[] = [
  {
    id: "courier", name: "Kestrel", model: "U-3", role: "Light courier", cost: 0,
    dryMass: 32, thrust: 620, reverseThrust: 300, rotation: 2.9, fuelCapacity: 110,
    slots: 2, towRating: 18, size: "small", color: "#d8d0bd",
    description: "Quick, frugal, and welcome at every dock. A tiny ship with excellent hands.",
  },
  {
    id: "freighter", name: "Mule", model: "F-12", role: "General freighter", cost: 17800,
    dryMass: 72, thrust: 1010, reverseThrust: 470, rotation: 1.7, fuelCapacity: 150,
    slots: 4, towRating: 42, size: "standard", color: "#bba06f",
    description: "The system’s familiar working ship: four clamps, long range, honest handling.",
  },
  {
    id: "hauler", name: "Atlas", model: "H-40", role: "Bulk carrier", cost: 62000,
    dryMass: 155, thrust: 2100, reverseThrust: 900, rotation: 0.9, fuelCapacity: 240,
    slots: 8, towRating: 85, size: "large", color: "#9e8358",
    description: "A slow external-frame hauler. Expensive to move, magnificent when fully loaded.",
  },
  {
    id: "tug", name: "Mastiff", model: "T-9", role: "Salvage tug", cost: 29500,
    dryMass: 88, thrust: 1320, reverseThrust: 780, rotation: 2.3, fuelCapacity: 165,
    slots: 2, towRating: 110, size: "standard", color: "#b96541",
    description: "Compact, over-engined, and built around a deep-frame grapple drum.",
  },
];

export const UPGRADES: UpgradeDefinition[] = [
  { id: "engine", name: "Copperbell main drive", cost: 4200, description: "A larger expansion bell. +16% main thrust." },
  { id: "rcs", name: "Quad RCS pods", cost: 3100, description: "Visible maneuvering clusters. +22% turning authority." },
  { id: "tank", name: "Long-range tank", cost: 3800, description: "An external propellant drum. +35% capacity." },
  { id: "clamps", name: "Loadmaster clamps", cost: 5200, description: "Reinforced cargo arms. +1 external slot." },
  { id: "scanner", name: "Wake scanner", cost: 4600, description: "Reveals distant salvage and its value." },
  { id: "cryo", name: "Cryogenic umbilical", cost: 6400, description: "Powers specialized insulated cargo tanks." },
];

export const CONTRACTS: ContractDefinition[] = [
  { id: "water-sinter", title: "Cooling the kilns", kind: "standard", origin: "pilgrim", destination: "sinter", cargo: "water", quantity: 2, baseReward: 1550, minReputation: 0, description: "Two process-water tanks for Sinter’s night-shift furnaces." },
  { id: "express-quiet", title: "A quiet correction", kind: "express", origin: "pilgrim", destination: "quiet", cargo: "electronics", quantity: 1, baseReward: 2800, timeLimit: 105, minReputation: 0, description: "A guidance board is needed before the next observation window." },
  { id: "food-deepwell", title: "Third shift provisions", kind: "fragile", origin: "pilgrim", destination: "deepwell", cargo: "food", quantity: 1, baseReward: 2100, minReputation: 1, description: "Fresh provisions. Keep the acceleration civil and the seals intact." },
  { id: "metal-anvil", title: "Keel stock", kind: "bulk", origin: "sinter", destination: "anvil", cargo: "metals", quantity: 3, baseReward: 3400, minReputation: 1, minSlots: 3, description: "Refined spars for a survey ship taking shape in Anvil’s outer cradle." },
  { id: "parts-deepwell", title: "Crusher bearings", kind: "standard", origin: "sinter", destination: "deepwell", cargo: "components", quantity: 2, baseReward: 2650, minReputation: 0, description: "Machine parts for Roche’s aging extraction drums." },
  { id: "water-pilgrim", title: "Habitat reserve", kind: "bulk", origin: "bluehour", destination: "pilgrim", cargo: "water", quantity: 3, baseReward: 3900, minReputation: 2, minSlots: 3, description: "A routine water transfer made urgent by a failed recycler bank." },
  { id: "cryo-quiet", title: "Cold garden", kind: "cryogenic", origin: "bluehour", destination: "quiet", cargo: "cryo", quantity: 2, baseReward: 5600, minReputation: 4, description: "Living cultures under hard vacuum. Powered cryogenic handling required." },
  { id: "rig-bluehour", title: "Ice-field walking rig", kind: "heavy", origin: "anvil", destination: "bluehour", cargo: "machinery", quantity: 1, baseReward: 7200, minReputation: 6, requiredShip: "tug", description: "An asymmetric crawler chassis. A rated tug is strongly advised." },
  { id: "parts-anvil", title: "Toolroom consignment", kind: "standard", origin: "deepwell", destination: "anvil", cargo: "ore", quantity: 2, baseReward: 2400, minReputation: 0, description: "Selected nickel-rich samples for Anvil’s specialty foundry." },
  { id: "science-pilgrim", title: "The long envelope", kind: "fragile", origin: "quiet", destination: "pilgrim", cargo: "science", quantity: 1, baseReward: 4100, minReputation: 3, description: "A sealed instrument case containing six months of outer-system listening." },
  { id: "elx-quiet", title: "Array synchronization", kind: "express", origin: "anvil", destination: "quiet", cargo: "electronics", quantity: 1, baseReward: 3600, timeLimit: 92, minReputation: 3, description: "A clock package for Quiet Arc. Delivery bonus decays with every second." },
  { id: "food-bluehour", title: "Bluehour pantry", kind: "standard", origin: "deepwell", destination: "bluehour", cargo: "food", quantity: 2, baseReward: 3350, minReputation: 2, description: "Vacuum-packed provisions exchanged through Pilgrim’s mining cooperative." },
];

export const SALVAGE_ZONE = {
  name: "The Wake",
  /**
   * Co-orbital with Rayleigh: the same lane and the same period, trailing it
   * by 40 degrees. A cloud parked at a fixed point would be swept by
   * Rayleigh's own station system twice an orbit, and there is no fixed
   * radius that clears every lane — so it keeps station with the world whose
   * launch debris it is, which is also what the guide has always claimed.
   */
  center: { x: 5399, y: 6434 },
  orbit: { around: "star", period: 2467 },
  radius: 620,
  description: "A slow cloud of launch hardware, dead relays, and one persistent unknown return.",
};
