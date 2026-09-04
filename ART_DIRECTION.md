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

## Trucking cues

Amber marker lights, red tail lights, hazard chevrons on the bumper, a stripe on
the cab, mirrors, a registry number, tie-down straps. Use at least three on
every vehicle. They are what makes a shape feel driven rather than piloted.

## Paint

Palette lives in `app/game/art/ships.ts` (`PAINT`) and `app/globals.css`.

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
2. Cargo containers: one shared container body per shape, colour-coded by a
   label stripe rather than the whole box.
3. Mule, Atlas, Mastiff on the same vocabulary.
4. Stations as scaffold: masts, tanks, panels, warm work lights.
5. Title composition to match the key art (ship low-left, station, planet).
