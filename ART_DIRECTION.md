# EMBERLINE — Art direction

One line: **working trucks in warm light.** Civilian orbital freight, seen from
above. Nothing on screen is heroic; everything is a tool somebody maintains.

## Reference

The key art (bone-white cab, open truss, strapped containers, one big engine
drum, a rust-gold planet behind a scaffold station) is the target. Ships follow
the Star Citizen *Hull* series logic: a small cab, a spine, cargo carried
externally along the spine, propulsion at the back. Read them as semi-trucks.

## Ships

Every ship is built from the same five parts, always in this order nose to tail:

1. **Cab** — bone-white pressurised module. Wraparound teal-glass windshield,
   an oxide stripe down each flank, mirrors, clearance lights on the corners,
   a sensor mast, and a push bar on the nose. Registry number on the roof.
2. **Hitch** — a visible dark coupling between cab and spine.
3. **Spine** — open steel truss (two rails, X bracing). One amber tie-down rail
   on the sunlit side. Amber side-marker lights along both rails.
4. **Cradles** — containers sit tight against the rails, lengthwise, and are held
   by amber straps. Empty cradles stay visible so an unloaded ship still reads as
   a truck with an empty bed.
5. **Engine drum** — a ribbed cylinder wider than the spine, an oxide band at its
   waist, a rear bumper with amber hazard chevrons, red tail lights, and a bell.

Upgrades are real hardware on the silhouette: the Copperbell drive is a bigger
copper bell, the long-range tank is a capsule slung along the spine, the wake
scanner replaces the mast with a dish, RCS pods sit on the shoulders, and the
cryogenic umbilical runs a teal line along the starboard rail.

Role changes proportion, not vocabulary. A courier has a short spine and one
drum. A hauler has a long spine and several. A tug has a short spine, an
oversized drum, and a grapple instead of cradles.

## Containers

One family of sage-green steel freight hardware. Cargo type is told by the shape
(crate, tank, ore bin, machine on a flatrack), a label stripe in the cargo's
accent colour at the rear end, the stencil code, and visible contents. Every unit
has corner castings, conspicuity tape along the bottom edge, two amber corner
markers at the front, and one status light at the rear: amber steady when sound,
red blinking when damaged, teal blinking when it is a powered cryogenic unit.
Like the ships, every unit takes one highlight line on the port
edge and one shade band on the starboard flank, and casts a short shadow to
starboard so it sits on the spine rather than floating over it. Crates are
corrugated; tanks are held to their skid by two amber saddle straps; ore lumps
have a lit facet; machines carry a control box with a lamp and a hydraulic ram.
Wear is rust that starts at the corner castings and seams, then spreads; a
damaged unit also carries a scorch smear and a dent. Drawings live in
`app/game/art/cargo.ts`.

## Stations

Stations are scaffold. A long main truss boom carries a hub (dome, module block,
two tanks), dark-red radiators, a lattice mast with a dish and a red beacon, and
a dark solar array at the far end. Warm work lights run along the boom; cold
stations (Bluehour, Quiet Arc) use teal instead of amber. Size changes the scale
of the body only.

The berth is the most readable thing on a station. It sits on the arm opposite
the solar array, at a fixed distance from the hub that never scales, as a lit
rectangular bay: a dashed bone outline, a berth mark, six chasing edge lights,
a five-light approach lane strobing inward, and two floodlight cones. Every
station shows a faint capture envelope; the targeted station's envelope is
dashed and coloured by state: red when the ship is too fast to dock, amber on
approach, teal when a dock is possible. Ships dock, undock and stage cargo
relative to the berth, so the pad always tells the truth. Drawings live in
`app/game/art/stations.ts`.

## Planets

Planets are background. They never collide with the ship, and they are drawn
with a little parallax (they move slower than the foreground and sit slightly
smaller than their true radius) so the working layer reads as closer. Gravity
still lives at the true position, marked by the guide ring.

One light source at upper left. Every body gets a globe gradient, a soft
terminator tinted per body (warm on Rayleigh, blue on Nernst), limb darkening,
a sub-solar sheen, and a lit limb; worlds with air also get haze thickening at
the lit limb and a thread of airglow on the night limb. Geology is painted once
per body into an offscreen surface from deterministic scatters (hashed
positions, never a visible spiral) and stamped under the lighting each frame,
so the flight view and the chart agree. Rayleigh is mottled like the key art:
ragged dark uplands over soft halos, pale salt flats with hard coastlines and a
cream glare, dry channels, six faint belts, polar hoods, two storms, city
lights on its night side, and elevator threads with blinking counterweights.
Nernst has blue-grey basins under frost plains, bright-edged fractures, a young
rayed crater, and a frost cap. Roche is an irregular polygon with coarse
regolith, a quarried flat face with bench lines, tunnel mouths, and two strings
of blinking navigation lamps. Drawings live in `app/game/art/planets.ts`.

**Naming.** The star is Cinder. Worlds are named for physicists whose work fits
the body, kept a little obscure: Rayleigh (scattering, the amber sky), Nernst
(the cold limit), Roche (the tidal limit, a captured body). New bodies follow the
same rule: a surname, one word, tied to what the place is.

## Station character

Every station shares the common body and berth, then carries one module that
says what it does: Pilgrim's market ring and hab pods, Sinter's glowing kiln
stacks, Anvil's construction cradle with a hull under way, Deepwell's winch and
ore cages, Bluehour's cryo spheres and propellant drum, Quiet Arc's dishes and
listening boom. Character is one module, not a different vocabulary.

## Trucking cues

Amber marker lights, red tail lights, hazard chevrons on the bumper, a stripe on
the cab, mirrors, a registry number, tie-down straps. Use at least three on
every vehicle. They are what makes a shape feel driven rather than piloted.

## Paint

Palette lives in `app/game/art/ships.ts` (`PAINT`) and `app/globals.css`.

## Interface

The menus are freight paperwork pinned to steel, not a holographic HUD. Rules
in `app/globals.css`:

- **Plates.** Panels are dark steel plates (`.plate`) with a twist-lock casting
  in each corner, a faint brushed grain, and a hard ink drop shadow. No blur, no
  glow. The dock panel, the chart and the guide wear a hazard-chevron band along
  the top edge; the top bar carries a run of conspicuity tape.
- **Registry plate.** The brand block is bone with ink lettering and an oxide
  stripe, the same plate that sits on a cab roof.
- **Switch plates.** Primary controls are amber plates with ink lettering, a
  status lamp, and a 3px ink shadow that compresses on press. Card controls are
  small dark plates with an amber lamp that fill amber under the hand. Keycaps
  are bone with an ink shadow; emphasised keys are amber.
- **Paperwork.** A contract is a manifest ticket: the cargo's own label stripe
  down the left, a rotated oxide stamp for the contract kind (teal for
  cryogenic), the reward as a price tag, the units drawn by the cargo art, and a
  perforated tear line above the accept control. Locked tickets hatch their
  stripe. Dock tabs are folder tabs; the active one is bone.
- **Instruments.** Teal is reserved for telemetry: speed, range, propellant.
  Gauges are strips of ten lamps. Hull is amber. Everything else on a panel is
  bone, amber or oxide.
- **Type.** Labels are stencil: bold monospace, uppercase, letterspaced, never
  below 8px. The mono face is aliased on `body` (where next/font declares it),
  not on `:root`, or the alias fails to resolve.
- **Same drawings.** Anything the menus show that also flies is drawn by the
  same code: ships on the shipyard cards, cargo on the manifests, planets on the
  chart (`usePortrait` in `EmberlineGame.tsx`).
- **The cockpit.** On a phone the flight deck is one instrument, not a set of
  plates pinned around a window. A dash runs along the top edge (registry,
  account, utilities; speed, range, the two gauges, the assist lamp; and a
  ledger strip whose cells unfold the manifest or the gate checklist as a
  drawer), a console of keycaps runs along the bottom, and the window is
  what lies between. Nothing floats over the window. Held on its side, the
  console splits into a thumb pod at each edge and the dock sheet stands
  beside the berth instead of under it. The ship is always drawn at the
  centre of whatever window the furniture leaves clear.

| Use | Colour |
| --- | --- |
| Hull, cabs, anything pressurised | bone `#e3dccb` |
| Structure, drums, rails | steel `#3b3a35` |
| Stripes, bands, warnings | oxide `#b8452f` |
| Straps, rails, marker lights, exhaust | amber `#d9a24a` |
| Glass, instruments, anything cold | teal `#70aaa4` |
| Outlines | ink `#1b1a16` |

Teal is reserved. It marks glass, sensors, cryogenics and the velocity vector,
nothing else. Warm colours belong to structure and light.

## Line and light

- Flat fills with one dark outline weight. One highlight line on the sunlit
  (port, −y) edge, one shade band on the starboard flank. No gradients on hulls;
  gradients are for planets, atmospheres and exhaust.
- Top-down orthographic. The nose points along +x in ship space.
- Ships are drawn in code, in `app/game/art/ships.ts`, from a shared part
  vocabulary. The shipyard card renders the same drawing as the flight view.

## Order of work

1. Kestrel U-3 (starting ship) — done.
2. Cargo containers — done.
3. Stations and berths — done.
4. Title composition to match the key art — done.
5. Planets, naming, parallax — done.
6. Station character modules — done.
7. Mule, Atlas, Mastiff on the same vocabulary.
8. The Wake: debris built from the same parts vocabulary — done.
