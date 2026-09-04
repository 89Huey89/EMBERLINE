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
import type { CargoKind, ContractDefinition, ShipDefinition, Station } from "./types";
import { drawShipPortrait, shipArtFor } from "./art/ships";

const TAU = Math.PI * 2;
const SAVE_KEY = "emberline-save-v1";

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

type GameMutable = {
  ship: { x: number; y: number; vx: number; vy: number; angle: number; av: number; fuel: number; hull: number };
  shipId: ShipDefinition["id"];
  dockedId: string | null;
  targetId: string;
  activeContractId: string | null;
  contractTime: number;
  cargo: CargoItem[];
  pickups: Pickup[];
  particles: Particle[];
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
  assist: boolean;
  shipId: ShipDefinition["id"];
  upgrades: string[];
  ownedShips: ShipDefinition["id"][];
  completed: number;
  salvageRecovered: number;
  message: string;
  distance: number;
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
const money = (value: number) => `₡${Math.max(0, Math.round(value)).toLocaleString("en-US")}`;
const seconds = (value: number) => `${Math.max(0, Math.floor(value / 60))}:${String(Math.max(0, Math.floor(value % 60))).padStart(2, "0")}`;

function freshGame(): GameMutable {
  const start = STATIONS[0];
  return {
    ship: { x: start.position.x - 96, y: start.position.y + 20, vx: 0, vy: 0, angle: 0, av: 0, fuel: SHIPS[0].fuelCapacity, hull: 100 },
    shipId: "courier",
    dockedId: start.id,
    targetId: STATIONS[1].id,
    activeContractId: null,
    contractTime: 0,
    cargo: [],
    pickups: [],
    particles: [],
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
    const game = { ...base, ...saved, ship: { ...base.ship, ...saved.ship }, particles: [], pickups: [] };
    if (!SHIPS.some((ship) => ship.id === game.shipId)) return null;
    if (!stationById(game.dockedId) && game.dockedId) game.dockedId = "pilgrim";
    if (game.dockedId) {
      const station = stationById(game.dockedId) ?? STATIONS[0];
      game.ship.x = station.position.x - 96;
      game.ship.y = station.position.y + 20;
      game.ship.vx = 0;
      game.ship.vy = 0;
    }
    const active = contractById(game.activeContractId);
    if (active) {
      const alreadyLoaded = game.cargo.filter((item) => item.source === "contract").length;
      const cargo = CARGO[active.cargo];
      for (let index = alreadyLoaded; index < active.quantity; index += 1) {
        game.pickups.push({
          id: `contract-${active.id}-restored-${index}`,
          kind: active.cargo,
          condition: 1,
          source: "contract",
          value: cargo.value,
          x: game.ship.x - 58 - (index - alreadyLoaded) * 28,
          y: game.ship.y + 34 + (index - alreadyLoaded) * 22,
          vx: game.ship.vx,
          vy: game.ship.vy,
          spin: index % 2 ? -0.05 : 0.05,
          angle: game.ship.angle,
          discovered: true,
        });
      }
    }
    return game;
  } catch {
    return null;
  }
}

function snapshot(game: GameMutable): UiSnapshot {
  const target = stationById(game.targetId);
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
    assist: game.assist,
    shipId: game.shipId,
    upgrades: [...game.upgrades],
    ownedShips: [...game.ownedShips],
    completed: game.completed,
    salvageRecovered: game.salvageRecovered,
    message: game.message,
    distance: target ? distance(game.ship, target.position) : 0,
    loadingRemaining: active ? Math.max(0, active.quantity - game.cargo.filter((item) => item.source === "contract").length) : 0,
  };
}

function saveGame(game: GameMutable) {
  const serializable = { ...game, particles: [], pickups: [] };
  localStorage.setItem(SAVE_KEY, JSON.stringify(serializable));
}

function makeSalvage(): Pickup[] {
  const kinds: CargoKind[] = ["components", "electronics", "ore", "science", "machinery", "metals"];
  return kinds.map((kind, index) => {
    const angle = index * 2.17 + 0.4;
    const radius = 80 + (index * 61) % 260;
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

function ShipPortrait({ ship }: { ship: ShipDefinition }) {
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
    drawShipPortrait(ctx, ship, width, height);
  }, [ship]);
  return <canvas ref={ref} className="ship-portrait" aria-hidden="true" />;
}

export default function EmberlineGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<GameMutable>(freshGame());
  const keysRef = useRef<Record<string, boolean>>({});
  const uiTimerRef = useRef(0);
  const actionLatchRef = useRef(false);
  const actionRequestRef = useRef(false);
  const salvageSeededRef = useRef(false);
  const cameraRef = useRef({ x: -320, y: 30, zoom: 0.78 });
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
    if ((contract.minSlots ?? contract.quantity) > ship.slots + (game.upgrades.includes("clamps") ? 1 : 0)) return notify("This load needs more cargo clamps.");
    if (contract.requiredShip && contract.requiredShip !== game.shipId) return notify(`Dispatch requires the ${shipById(contract.requiredShip).name} tug.`);
    if (contract.kind === "cryogenic" && !game.upgrades.includes("cryo")) return notify("A powered cryogenic umbilical is required.");
    const station = stationById(contract.origin)!;
    game.activeContractId = contract.id;
    game.contractTime = contract.timeLimit ?? 0;
    game.targetId = contract.destination;
    game.pickups = Array.from({ length: contract.quantity }, (_, index) => {
      const spacing = (index - (contract.quantity - 1) / 2) * 52;
      return {
        id: `contract-${contract.id}-${index}`,
        kind: contract.cargo,
        condition: 1,
        source: "contract" as const,
        value: cargo.value,
        x: station.position.x - 142,
        y: station.position.y + 42 + spacing,
        vx: 0,
        vy: 0,
        spin: index % 2 ? -0.05 : 0.05,
        angle: station.orientation,
        discovered: true,
      };
    });
    audio.tone("ui", muted);
    notify(`${cargo.name} staged outside. Undock, drift close, then clamp each unit.`);
  }, [audio, muted, notify]);

  const undock = useCallback(() => {
    const game = gameRef.current;
    const station = stationById(game.dockedId);
    if (!station) return;
    game.dockedId = null;
    game.ship.x = station.position.x - 105;
    game.ship.y = station.position.y;
    game.ship.vx = -6;
    game.ship.vy = 0;
    game.ship.angle = Math.PI;
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
    if (game.credits < cost) return notify(`Service estimate is ${money(cost)}. Insufficient balance.`);
    game.credits -= cost;
    if (kind === "fuel") game.ship.fuel = fuelCapacity;
    else game.ship.hull = 100;
    audio.tone("ui", muted);
    notify(`${kind === "fuel" ? "Propellant loaded" : "Hull work complete"}. ${money(cost)} debited.`);
  }, [audio, muted, notify]);

  const buyUpgrade = useCallback((id: string) => {
    const game = gameRef.current;
    const upgrade = UPGRADES.find((item) => item.id === id);
    const station = stationById(game.dockedId);
    if (!upgrade || !station?.services.includes("upgrades")) return notify("Upgrade work is only available at a fitted yard.");
    if (game.upgrades.includes(id)) return;
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
    const cost = Math.min(900, Math.max(0, game.credits));
    const station = STATIONS[0];
    game.credits -= cost;
    game.ship = { x: station.position.x - 96, y: station.position.y, vx: 0, vy: 0, angle: 0, av: 0, fuel: Math.max(20, shipById(game.shipId).fuelCapacity * 0.18), hull: Math.max(35, game.ship.hull) };
    game.dockedId = station.id;
    game.cargo = game.cargo.filter((item) => item.source === "salvage");
    game.pickups = [];
    game.activeContractId = null;
    game.contractTime = 0;
    notify(`Pilgrim rescue tug recovered the vessel. ${money(cost)} debited.`);
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
          notify(`${CARGO[nearest.pickup.kind].name} secured. Deliver it to any port for assessment.`);
        } else {
          const active = contractById(game.activeContractId);
          const loaded = game.cargo.filter((item) => item.source === "contract").length;
          notify(loaded >= (active?.quantity ?? 0) ? "Load secure. Destination beacon is active." : `Clamp ${loaded} secure. Collect the remaining unit.`);
        }
        return;
      }
      const nearbyStation = STATIONS
        .map((station) => ({ station, dist: distance(game.ship, station.position) }))
        .sort((a, b) => a.dist - b.dist)[0];
      const speed = Math.hypot(game.ship.vx, game.ship.vy);
      if (nearbyStation && nearbyStation.dist < 105) {
        if (speed > 36) return notify(`Approach too fast: ${Math.round(speed)} m/s. Hold SHIFT to brake.`);
        dock(game, nearbyStation.station);
        return;
      }
      notify("No grapple or docking fixture within reach.");
    };

    const dock = (game: GameMutable, station: Station) => {
      game.dockedId = station.id;
      game.ship.x = station.position.x - 96;
      game.ship.y = station.position.y;
      game.ship.vx = 0;
      game.ship.vy = 0;
      game.ship.av = 0;
      game.ship.angle = 0;
      game.shake = 4;
      audio.tone("dock", muted);

      let note = `Docking capture confirmed at ${station.name}.`;
      const salvage = game.cargo.filter((item) => item.source === "salvage");
      if (salvage.length) {
        const salvagePay = Math.round(salvage.reduce((sum, item) => sum + item.value * item.condition, 0));
        game.credits += salvagePay;
        game.salvageRecovered += salvage.length;
        game.reputation += salvage.some((item) => item.kind === "science") ? 2 : 1;
        game.cargo = game.cargo.filter((item) => item.source !== "salvage");
        note = `Salvage assessed: ${money(salvagePay)} credited.`;
      }

      const contract = contractById(game.activeContractId);
      if (contract && contract.destination === station.id) {
        const carried = game.cargo.filter((item) => item.source === "contract");
        if (carried.length >= contract.quantity) {
          const base = rewardFor(contract, game.routeRuns);
          const condition = carried.reduce((sum, item) => sum + item.condition, 0) / carried.length;
          const timeBonus = contract.timeLimit ? clamp(game.contractTime / contract.timeLimit, 0, 1) * 0.25 : 0;
          const reward = Math.round(base * condition * (1 + timeBonus));
          const route = `${contract.origin}-${contract.destination}`;
          game.credits += reward;
          game.reputation += condition > 0.92 ? 2 : 1;
          game.completed += 1;
          game.routeRuns[route] = (game.routeRuns[route] ?? 0) + 1;
          game.cargo = game.cargo.filter((item) => item.source !== "contract");
          game.activeContractId = null;
          game.contractTime = 0;
          game.pickups = game.pickups.filter((item) => item.source !== "contract");
          audio.tone("success", muted);
          note = `Freight delivered cleanly. ${money(reward)} credited to your account.`;
        } else {
          note = "Destination reached, but the manifest is incomplete. Return for the remaining freight.";
        }
      }
      const capacity = shipById(game.shipId).fuelCapacity * (game.upgrades.includes("tank") ? 1.35 : 1);
      if (game.ship.fuel < Math.min(8, capacity * 0.08)) {
        const emergency = Math.min(14, capacity - game.ship.fuel);
        const cost = Math.min(game.credits, Math.ceil(emergency * 5));
        game.ship.fuel += cost / 5;
        game.credits -= cost;
        note += ` Emergency reserve added for ${money(cost)}.`;
      }
      saveGame(game);
      setSavePulse(true);
      window.setTimeout(() => setSavePulse(false), 900);
      notify(note, 6);
    };

    const update = (game: GameMutable, dt: number) => {
      game.elapsed += dt;
      if (!salvageSeededRef.current) {
        const recovered = new Set(game.discovered.filter((id) => id.startsWith("recovered:" )).map((id) => id.slice(10)));
        game.pickups.push(...makeSalvage().filter((pickup) => !recovered.has(pickup.id)));
        salvageSeededRef.current = true;
      }
      if (screen !== "game" || game.paused || mapOpen || helpOpen) {
        audio.setEngine(0, muted);
        return;
      }

      if (game.dockedId) {
        audio.setEngine(0, muted);
        game.ship.vx = 0;
        game.ship.vy = 0;
        game.ship.av = 0;
        if (actionRequestRef.current || (keysRef.current[" "] && !actionLatchRef.current)) {
          actionRequestRef.current = false;
          actionLatchRef.current = true;
          act(game);
        }
        if (!keysRef.current[" "]) actionLatchRef.current = false;
        return;
      }

      const active = contractById(game.activeContractId);
      if (active?.timeLimit && game.contractTime > 0) game.contractTime = Math.max(0, game.contractTime - dt);
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
          game.ship.fuel = Math.max(0, game.ship.fuel - (appliedForce / shipDef.thrust) * loadFactor * dt * 0.52);
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
        const grav = Math.min(34, body.gravity / Math.max(42000, distSq));
        game.ship.vx += (dx / Math.max(1, dist)) * grav * dt;
        game.ship.vy += (dy / Math.max(1, dist)) * grav * dt;
        if (dist < body.radius + 18) {
          const nx = -dx / Math.max(1, dist);
          const ny = -dy / Math.max(1, dist);
          game.ship.x = body.position.x + nx * (body.radius + 19);
          game.ship.y = body.position.y + ny * (body.radius + 19);
          const inward = game.ship.vx * -nx + game.ship.vy * -ny;
          const impact = Math.hypot(game.ship.vx, game.ship.vy);
          if (inward > 0) {
            game.ship.vx += nx * inward * 1.25;
            game.ship.vy += ny * inward * 1.25;
          }
          if (impact > 18) {
            game.ship.hull = Math.max(0, game.ship.hull - (impact - 18) * 0.32);
            game.cargo.forEach((item) => { item.condition = Math.max(0.28, item.condition - impact * 0.0025); });
            game.shake = Math.min(16, impact * 0.12);
            audio.tone("impact", muted);
            notify(`Hull contact at ${Math.round(impact)} m/s. Cargo restraints report the shock.`);
          }
        }
      }

      const accelerationLoad = appliedForce / Math.max(1, totalMass);
      if (active?.kind === "fragile" && accelerationLoad > 54) {
        game.cargo.filter((item) => item.source === "contract").forEach((item) => {
          item.condition = Math.max(0.45, item.condition - (accelerationLoad - 54) * dt * 0.0014);
        });
      }

      game.ship.x += game.ship.vx * dt;
      game.ship.y += game.ship.vy * dt;
      if (Math.abs(game.ship.x) > WORLD.width / 2 || Math.abs(game.ship.y) > WORLD.height / 2) {
        game.ship.vx += (-game.ship.x / WORLD.width) * 6 * dt;
        game.ship.vy += (-game.ship.y / WORLD.height) * 6 * dt;
      }

      game.pickups.forEach((pickup) => {
        pickup.x += pickup.vx * dt;
        pickup.y += pickup.vy * dt;
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
        game.credits = Math.max(0, game.credits - 1400);
        game.reputation = Math.max(0, game.reputation - 1);
        game.cargo = [];
        game.pickups = [];
        game.activeContractId = null;
        game.ship = { x: STATIONS[0].position.x - 96, y: STATIONS[0].position.y, vx: 0, vy: 0, angle: 0, av: 0, fuel: 24, hull: 52 };
        game.dockedId = "pilgrim";
        salvageSeededRef.current = false;
        notify("Pilgrim rescue recovered the hull. Insurance excess: ₡1,400.", 7);
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
      const cargo = CARGO[kind];
      ctx.save();
      ctx.scale(size, size);
      if (cargo.shape === "tank") {
        ctx.fillStyle = "#20292a";
        ctx.fillRect(-14, -10, 28, 20);
        ctx.fillStyle = cargo.color;
        ctx.beginPath();
        ctx.roundRect(-11, -13, 22, 26, 9);
        ctx.fill();
        ctx.strokeStyle = cargo.accent;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = "#14191a";
        ctx.fillRect(-13, -7, 26, 3);
        ctx.fillRect(-13, 5, 26, 3);
        ctx.fillStyle = cargo.accent;
        ctx.fillRect(-3, -17, 6, 4);
      } else if (cargo.shape === "ore") {
        ctx.fillStyle = "#292725";
        ctx.fillRect(-15, -11, 30, 22);
        ctx.strokeStyle = cargo.accent;
        ctx.lineWidth = 2;
        ctx.strokeRect(-15, -11, 30, 22);
        ctx.fillStyle = cargo.color;
        for (let i = 0; i < 7; i += 1) {
          ctx.beginPath();
          ctx.arc(-10 + (i * 13) % 23, -5 + (i * 9) % 12, 4 + (i % 3), 0, TAU);
          ctx.fill();
        }
      } else if (cargo.shape === "machine") {
        ctx.fillStyle = cargo.color;
        ctx.fillRect(-18, -9, 31, 18);
        ctx.fillStyle = "#22201c";
        ctx.beginPath();
        ctx.arc(10, 0, 9, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = cargo.accent;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(10, 0, 5, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = cargo.accent;
        ctx.fillRect(-20, -13, 7, 26);
      } else {
        ctx.fillStyle = cargo.color;
        ctx.fillRect(-15, -11, 30, 22);
        ctx.strokeStyle = cargo.accent;
        ctx.lineWidth = 2;
        ctx.strokeRect(-15, -11, 30, 22);
        ctx.strokeStyle = "rgba(255,255,255,.18)";
        ctx.beginPath();
        ctx.moveTo(-15, -11); ctx.lineTo(15, 11);
        ctx.moveTo(15, -11); ctx.lineTo(-15, 11);
        ctx.stroke();
      }
      ctx.fillStyle = condition < 0.72 ? "#e9613d" : "#f0e3c3";
      ctx.font = "700 6px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(cargo.short, 0, 2);
      ctx.restore();
    };

    const drawShip = (ctx: CanvasRenderingContext2D, game: GameMutable, zoom: number) => {
      const ship = shipById(game.shipId);
      const art = shipArtFor(ship);
      const thrusting = Boolean((keysRef.current.w || keysRef.current.arrowup) && game.ship.fuel > 0 && screen === "game");
      ctx.save();
      ctx.translate(game.ship.x, game.ship.y);
      ctx.rotate(game.ship.angle);
      ctx.scale(art.scale, art.scale);

      const paintCargo = () => {
        game.cargo.forEach((item, index) => {
          const at = art.clamps[index] ?? art.clamps[art.clamps.length - 1];
          ctx.save();
          ctx.translate(at.x, at.y);
          drawCargo(ctx, item.kind, art.cargoScale, item.condition);
          ctx.restore();
        });
      };
      const paintClamps = () => {
        const slots = ship.slots + (game.upgrades.includes("clamps") ? 1 : 0);
        art.clamps.slice(0, slots).forEach((_, slot) => art.drawClamp?.(ctx, slot, slot < game.cargo.length));
      };

      const state = { upgrades: game.upgrades, thrusting, showLabel: zoom > 0.75, time: game.elapsed };
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

    const drawBody = (ctx: CanvasRenderingContext2D, body: (typeof BODIES)[number], camera: typeof cameraRef.current) => {
      const radius = body.radius;
      ctx.save();
      ctx.translate(body.position.x, body.position.y);
      if (body.atmosphere) {
        const atmosphere = ctx.createRadialGradient(0, 0, radius * 0.76, 0, 0, radius * 1.12);
        atmosphere.addColorStop(0, "rgba(0,0,0,0)");
        atmosphere.addColorStop(0.86, `${body.atmosphere}55`);
        atmosphere.addColorStop(1, `${body.atmosphere}00`);
        ctx.fillStyle = atmosphere;
        ctx.beginPath(); ctx.arc(0, 0, radius * 1.13, 0, TAU); ctx.fill();
      }
      const globe = ctx.createRadialGradient(-radius * 0.38, -radius * 0.48, radius * 0.1, 0, 0, radius * 1.15);
      globe.addColorStop(0, body.id === "cinder" ? "#dc9560" : body.id === "morrow" ? "#a9c1bd" : "#96806a");
      globe.addColorStop(0.48, body.color);
      globe.addColorStop(0.8, "#34261f");
      globe.addColorStop(1, "#090b0b");
      ctx.fillStyle = globe;
      ctx.beginPath(); ctx.arc(0, 0, radius, 0, TAU); ctx.fill();
      ctx.save();
      ctx.beginPath(); ctx.arc(0, 0, radius - 1, 0, TAU); ctx.clip();
      ctx.globalAlpha = 0.18;
      for (let i = 0; i < 13; i += 1) {
        ctx.strokeStyle = i % 2 ? "#f4c486" : "#3d4e4e";
        ctx.lineWidth = 7 + (i % 4) * 5;
        ctx.beginPath();
        ctx.ellipse(-radius * 0.1, -radius * 0.7 + i * radius * 0.12, radius * (0.78 + (i % 3) * 0.08), radius * 0.07, -0.18, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.5;
      const night = ctx.createLinearGradient(-radius, 0, radius, 0);
      night.addColorStop(0, "rgba(3,6,7,.92)");
      night.addColorStop(0.52, "rgba(3,6,7,.34)");
      night.addColorStop(0.7, "rgba(3,6,7,0)");
      ctx.fillStyle = night;
      ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
      if (body.id === "cinder") {
        ctx.fillStyle = "#dda34d";
        for (let i = 0; i < 54; i += 1) {
          const angle = i * 2.37;
          const r = radius * (0.25 + ((i * 31) % 60) / 100);
          const x = Math.cos(angle) * r - radius * 0.28;
          const y = Math.sin(angle) * r;
          if (x < radius * 0.12) ctx.fillRect(x, y, 1.6, 1.1);
        }
      }
      ctx.restore();
      ctx.strokeStyle = body.atmosphere ?? "#8c7961";
      ctx.lineWidth = 3 / Math.max(0.3, camera.zoom);
      ctx.beginPath(); ctx.arc(0, 0, radius, 0, TAU); ctx.stroke();
      ctx.restore();
    };

    const drawStation = (ctx: CanvasRenderingContext2D, station: Station, time: number, target: boolean) => {
      const s = station.size === "large" ? 1.22 : station.size === "small" ? 0.76 : 1;
      ctx.save();
      ctx.translate(station.position.x, station.position.y);
      ctx.rotate(station.orientation);
      ctx.scale(s, s);
      if (target) {
        ctx.strokeStyle = "rgba(224,175,84,.22)";
        ctx.lineWidth = 1.4;
        ctx.setLineDash([7, 8]);
        ctx.beginPath(); ctx.arc(0, 0, 84 + Math.sin(time * 2) * 4, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.strokeStyle = "#7c725f";
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(-62, 0); ctx.lineTo(58, 0); ctx.stroke();
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-58, -10); ctx.lineTo(55, 10); ctx.moveTo(-58, 10); ctx.lineTo(55, -10);
      for (let x = -55; x <= 45; x += 20) { ctx.moveTo(x, -11); ctx.lineTo(x + 10, 11); }
      ctx.stroke();
      ctx.fillStyle = "#393a35";
      ctx.fillRect(-24, -16, 48, 32);
      ctx.strokeStyle = station.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(-24, -16, 48, 32);
      ctx.fillStyle = "#171b1b";
      ctx.fillRect(-17, -11, 34, 22);
      ctx.fillStyle = station.color;
      for (let i = -12; i <= 12; i += 8) ctx.fillRect(i, -7, 3, 2);
      ctx.fillStyle = "#6e6b5f";
      ctx.beginPath(); ctx.roundRect(-48, -25, 17, 50, 8); ctx.fill();
      ctx.beginPath(); ctx.roundRect(33, -23, 15, 46, 7); ctx.fill();
      ctx.strokeStyle = "#a59a7d";
      ctx.stroke();
      ctx.fillStyle = "#2c3130";
      ctx.fillRect(-70, -30, 18, 60);
      ctx.fillStyle = station.id === "bluehour" || station.id === "quiet" ? "#456b6a" : "#69442e";
      for (let y = -27; y < 28; y += 7) ctx.fillRect(-68, y, 14, 3);
      ctx.strokeStyle = "#96886c";
      ctx.beginPath(); ctx.moveTo(24, 0); ctx.lineTo(67, -34); ctx.lineTo(72, -34); ctx.stroke();
      ctx.beginPath(); ctx.arc(73, -35, 8, Math.PI * 0.1, Math.PI * 1.25); ctx.stroke();
      ctx.fillStyle = station.color;
      ctx.beginPath(); ctx.arc(-62, 0, 3 + Math.sin(time * 3) * 0.7, 0, TAU); ctx.fill();
      ctx.fillStyle = "#ca493c";
      ctx.beginPath(); ctx.arc(58, 0, 2.2, 0, TAU); ctx.fill();
      if (station.size === "large") {
        ctx.strokeStyle = "#5b5549";
        ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(0, 0, 41, 0, TAU); ctx.stroke();
        ctx.strokeStyle = station.color;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(0, 0, 46, 0, TAU); ctx.stroke();
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
      const targetDist = target ? distance(game.ship, target.position) : 9999;
      const desiredZoom = game.dockedId ? 1.25 : targetDist < 260 ? 1.12 : clamp(0.88 - speed / 340, 0.48, 0.92);
      cam.zoom = lerp(cam.zoom, screen === "title" ? 0.78 : desiredZoom, 0.025);
      const lead = screen === "title" ? { x: -260, y: 60 } : { x: game.ship.vx * 1.15, y: game.ship.vy * 1.15 };
      cam.x = lerp(cam.x, (screen === "title" ? -210 : game.ship.x) + lead.x, screen === "title" ? 0.01 : 0.055);
      cam.y = lerp(cam.y, (screen === "title" ? 10 : game.ship.y) + lead.y, screen === "title" ? 0.01 : 0.055);
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

      context.strokeStyle = "rgba(125,144,137,.08)";
      context.lineWidth = 1 / cam.zoom;
      BODIES.forEach((body) => {
        context.beginPath(); context.arc(body.position.x, body.position.y, body.radius + 255, 0, TAU); context.stroke();
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
      for (let i = 0; i < 24; i += 1) {
        const angle = i * 2.41;
        const radius = 40 + (i * 73) % 330;
        context.fillStyle = i % 3 ? "#3f403a" : "#7b6547";
        context.fillRect(Math.cos(angle) * radius, Math.sin(angle) * radius, 2 + (i % 4), 1 + (i % 3));
      }
      context.restore();

      BODIES.forEach((body) => drawBody(context, body, cam));

      if (target && !game.dockedId) {
        context.strokeStyle = "rgba(211,165,79,.18)";
        context.lineWidth = 1 / cam.zoom;
        context.setLineDash([9 / cam.zoom, 13 / cam.zoom]);
        context.beginPath(); context.moveTo(game.ship.x, game.ship.y); context.lineTo(target.position.x, target.position.y); context.stroke();
        context.setLineDash([]);
      }

      STATIONS.forEach((station) => drawStation(context, station, game.elapsed, station.id === game.targetId));
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

      if (!game.dockedId) {
        context.strokeStyle = "rgba(115,198,187,.62)";
        context.lineWidth = 1.2 / cam.zoom;
        context.beginPath();
        context.moveTo(game.ship.x, game.ship.y);
        context.lineTo(game.ship.x + game.ship.vx * 3.2, game.ship.y + game.ship.vy * 3.2);
        context.stroke();
        context.fillStyle = "rgba(115,198,187,.85)";
        context.beginPath(); context.arc(game.ship.x + game.ship.vx * 3.2, game.ship.y + game.ship.vy * 3.2, 2.5 / cam.zoom, 0, TAU); context.fill();
      }
      drawShip(context, game, cam.zoom);

      if (cam.zoom > 0.42) {
        context.font = `${11 / cam.zoom}px ui-monospace, monospace`;
        context.textAlign = "center";
        STATIONS.forEach((station) => {
          context.fillStyle = station.id === game.targetId ? "#f0c46b" : "rgba(226,221,204,.72)";
          context.fillText(`${station.callSign}  ${station.name.toUpperCase()}`, station.position.x, station.position.y + 76 / cam.zoom);
        });
      }
      context.restore();

      if (!game.dockedId && target) {
        const tx = (target.position.x - cam.x) * cam.zoom + width / 2;
        const ty = (target.position.y - cam.y) * cam.zoom + height / 2;
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
              <div><span>ACCOUNT</span><strong>{money(ui.credits)}</strong></div>
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

          <aside className="mission-card">
            <div className="panel-kicker">{active ? "ACTIVE MANIFEST" : "OPEN SHIFT"}<span>{active?.kind.toUpperCase() ?? "SELF-DIRECTED"}</span></div>
            {active ? (
              <>
                <h2>{active.title}</h2>
                <p>{CARGO[active.cargo].name} · {active.quantity} unit{active.quantity > 1 ? "s" : ""}</p>
                <div className="route-line"><span>{stationById(active.origin)?.callSign}</span><i /><span>{stationById(active.destination)?.callSign}</span></div>
                <div className="objective">
                  <small>NEXT ACTION</small>
                  <strong>{ui.loadingRemaining > 0 ? `Secure ${ui.loadingRemaining} staged unit${ui.loadingRemaining > 1 ? "s" : ""}` : `Dock at ${stationById(active.destination)?.name}`}</strong>
                </div>
                {active.timeLimit && <div className={`timer ${ui.contractTime < 30 ? "urgent" : ""}`}><span>TIME BONUS</span><b>{seconds(ui.contractTime)}</b></div>}
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

          <aside className="telemetry-card">
            <div className="velocity-readout"><span>SPEED</span><strong>{Math.round(ui.speed)}</strong><small>m/s</small></div>
            <div className="telemetry-row"><span>RANGE TO {target.callSign}</span><b>{Math.round(ui.distance)} km</b></div>
            <div className="bar-row"><span>PROPELLANT</span><div className="meter"><i style={{ width: `${clamp(ui.fuel / fuelCapacity * 100, 0, 100)}%` }} /></div><b>{Math.round(ui.fuel)}</b></div>
            <div className="bar-row"><span>HULL</span><div className="meter hull"><i style={{ width: `${ui.hull}%` }} /></div><b>{Math.round(ui.hull)}%</b></div>
            <div className="telemetry-row"><span>PAYLOAD</span><b>{cargoMass} t / {ui.cargo.length} clamps</b></div>
            <button className={`assist-toggle ${ui.assist ? "active" : ""}`} onClick={() => { gameRef.current.assist = !gameRef.current.assist; setUi(snapshot(gameRef.current)); }}><span className="status-light" /> FLIGHT ASSIST {ui.assist ? "ON" : "OFF"} <kbd>F</kbd></button>
            {!ui.dockedId && ui.fuel < 9 && <button className="tow-button" onClick={emergencyTow}>Request rescue tow · up to ₡900</button>}
          </aside>

          {docked && (
            <section className="dock-panel">
              <div className="dock-heading">
                <div><span>BERTHED AT {docked.callSign}</span><h2>{docked.name}</h2><p>{docked.description}</p></div>
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
                      const locked = ui.reputation < contract.minReputation || Boolean(contract.requiredShip && contract.requiredShip !== ui.shipId) || (contract.kind === "cryogenic" && !ui.upgrades.includes("cryo")) || (contract.minSlots ?? contract.quantity) > currentShip.slots + (ui.upgrades.includes("clamps") ? 1 : 0);
                      return (
                        <article className={`contract ${locked ? "locked" : ""}`} key={contract.id}>
                          <div className="contract-top"><span>{contract.kind.toUpperCase()}</span><b>{money(reward)}</b></div>
                          <h3>{contract.title}</h3>
                          <p>{contract.description}</p>
                          <div className="manifest"><span>{CARGO[contract.cargo].short} × {contract.quantity}</span><span>{CARGO[contract.cargo].mass * contract.quantity} t</span><span>→ {stationById(contract.destination)?.callSign}</span></div>
                          {locked ? <small className="requirement">Requires rep {contract.minReputation}{contract.requiredShip ? ` · ${shipById(contract.requiredShip).name}` : ""}{contract.kind === "cryogenic" ? " · Cryo umbilical" : ""}</small> : <button disabled={Boolean(ui.activeContractId)} onClick={() => stageContract(contract)}>Accept manifest</button>}
                        </article>
                      );
                    })}
                  </div>
                )}
                {panel === "service" && (
                  <div className="service-grid">
                    <article><span>PROPELLANT</span><h3>{Math.round(ui.fuel)} / {Math.round(fuelCapacity)}</h3><p>Refined monopropellant, metered at this port’s posted rate.</p><button onClick={() => service("fuel")}>Fill tanks · {money(Math.ceil((fuelCapacity - ui.fuel) * 4))}</button></article>
                    <article><span>HULL & RIGGING</span><h3>{Math.round(ui.hull)}% integrity</h3><p>Pressure shell, radiator, clamp, and RCS inspection.</p><button onClick={() => service("repair")}>Authorize work · {money(Math.ceil((100 - ui.hull) * 18))}</button></article>
                    {UPGRADES.map((upgrade) => (
                      <article className={!docked.services.includes("upgrades") ? "locked" : ""} key={upgrade.id}><span>{ui.upgrades.includes(upgrade.id) ? "INSTALLED" : "SHIP REFIT"}</span><h3>{upgrade.name}</h3><p>{upgrade.description}</p>{ui.upgrades.includes(upgrade.id) ? <small className="installed">Hardware fitted</small> : <button disabled={!docked.services.includes("upgrades")} onClick={() => buyUpgrade(upgrade.id)}>Install · {money(upgrade.cost)}</button>}</article>
                    ))}
                  </div>
                )}
                {panel === "fleet" && (
                  <div className="ship-list">
                    {SHIPS.map((ship) => {
                      const owned = ui.ownedShips.includes(ship.id);
                      return <article className={`${ui.shipId === ship.id ? "selected" : ""} ${!docked.services.includes("ships") ? "locked" : ""}`} key={ship.id}><ShipPortrait ship={ship} /><span>{ship.role.toUpperCase()}</span><h3>{ship.name} <small>{ship.model}</small></h3><p>{ship.description}</p><div className="ship-stats"><span>{ship.slots} clamps</span><span>{ship.fuelCapacity} fuel</span><span>{ship.dryMass} t dry</span></div><button disabled={!docked.services.includes("ships") || ui.shipId === ship.id} onClick={() => buyOrSwitchShip(ship.id)}>{ui.shipId === ship.id ? "Active vessel" : owned ? "Move to active berth" : `Purchase · ${money(ship.cost)}`}</button></article>;
                    })}
                  </div>
                )}
              </div>
            </section>
          )}

          {!docked && (
            <div className="flight-controls" aria-label="Flight controls">
              <div><kbd>A</kbd><kbd>D</kbd><span>ROTATE</span></div>
              <div><kbd>Q</kbd><kbd>E</kbd><span>STRAFE</span></div>
              <div><kbd>W</kbd><span>MAIN DRIVE</span></div>
              <div><kbd>S</kbd><span>RETRO</span></div>
              <div className="emphasis"><kbd>SHIFT</kbd><span>ASSISTED BRAKE</span></div>
              <div className="emphasis"><kbd>SPACE</kbd><span>CLAMP / DOCK</span></div>
            </div>
          )}

          {!docked && (
            <div className="touch-controls" aria-label="Touch flight controls">
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
        <section className="modal map-modal" role="dialog" aria-modal="true" aria-labelledby="map-title">
          <button className="modal-close" onClick={() => setMapOpen(false)}>Close <kbd>ESC</kbd></button>
          <div className="map-copy"><p className="eyebrow">COMPRESSED NAVIGATION CHART / NOT TO SCALE</p><h2 id="map-title">The Cinder system</h2><p>Learn the working lines. Mine to refinery, refinery to shipyard, ice moon to habitat. The best route is the one your current ship can fly cleanly.</p></div>
          <div className="system-map">
            <div className="orbit orbit-one" /><div className="orbit orbit-two" />
            <div className="map-body cinder"><i /><span>CINDER</span></div>
            <div className="map-body morrow"><i /><span>MORROW</span></div>
            <div className="map-body brindle"><i /><span>BRINDLE</span></div>
            <div className="wake-zone"><i />THE WAKE</div>
            {STATIONS.map((station) => <button key={station.id} className={`map-station station-${station.id} ${station.id === ui.targetId ? "active" : ""}`} onClick={() => setTarget(station.id)}><i /><b>{station.callSign}</b><span>{station.name}</span></button>)}
          </div>
          <div className="map-legend"><span><i className="legend-port" /> SELECT A PORT TO SET BEACON</span><span><i className="legend-wake" /> SALVAGE REGION</span><span>Current range to {target.callSign}: {Math.round(ui.distance)} km</span></div>
        </section>
      )}

      {helpOpen && (
        <section className="modal guide-modal" role="dialog" aria-modal="true" aria-labelledby="guide-title">
          <button className="modal-close" onClick={() => setHelpOpen(false)}>Close <kbd>ESC</kbd></button>
          <div className="guide-heading"><p className="eyebrow">KESTREL U-3 / QUICK REFERENCE</p><h2 id="guide-title">Momentum is the road.</h2><p>Thrust changes velocity. Releasing the controls does not stop the ship. Turn early, brake earlier, and arrive slowly.</p></div>
          <div className="guide-grid">
            <article><span>01</span><h3>Take local work</h3><p>While docked, choose a manifest from the contract board. Repeated routes gradually pay less as local demand is met.</p></article>
            <article><span>02</span><h3>Secure the load</h3><p>Release the berth, drift within 92 m of each staged unit, match its speed, then press <kbd>SPACE</kbd>. Cargo changes mass and handling.</p></article>
            <article><span>03</span><h3>Fly the vector</h3><p><kbd>W</kbd> drives forward. <kbd>A</kbd>/<kbd>D</kbd> rotate. <kbd>Q</kbd>/<kbd>E</kbd> strafe. The teal line is your true velocity.</p></article>
            <article><span>04</span><h3>Make a clean arrival</h3><p>Hold <kbd>SHIFT</kbd> for assisted braking. Enter a station’s capture envelope below 36 m/s, then press <kbd>SPACE</kbd>.</p></article>
            <article><span>05</span><h3>Read gravity</h3><p>Curved guide rings mark strong gravity wells. Close planetary passes bend your route and can save propellant.</p></article>
            <article><span>06</span><h3>Work The Wake</h3><p>Unmarked debris lies northeast of Cinder. Fit a better scanner, recover useful objects, and deliver salvage to any port.</p></article>
          </div>
          <button className="primary-button" onClick={() => setHelpOpen(false)}>Return to the flight deck <span>→</span></button>
        </section>
      )}
    </main>
  );
}
