# Hill Runner

2D physics-based driving platformer (see `SPEC.md`). Vanilla JS + Canvas + [Matter.js](https://brm.io/matter-js/) (vendored in `lib/`), no build step.

## Run locally

From this folder:

```
python -m http.server 8000
```

Then open **http://localhost:8000** in a browser.

(Any static file server works — the only requirement is HTTP, since ES modules don't load over `file://`.)

## Controls

| Action | Keys |
|---|---|
| Gas | `D` / `→` / `W` (or right touch pedal) |
| Brake / Reverse | `A` / `←` / `S` (or left touch pedal) |
| Air control | Gas = nose up, Brake = nose down |
| Restart | `R` |
| Pause | `Esc` / `P` (or tap top-right) |

## Project layout

```
index.html, style.css     app shell + menu styling
lib/matter.min.js         physics engine (Matter.js 0.19, vendored)
src/main.js               bootstrap + game loop
src/core/                 screen manager, input abstraction, save data (localStorage)
src/physics/              car (chassis + spring-damper suspension), terrain builder, world wrapper
src/data/                 vehicles & upgrade tiers, Farm/Town/City levels, economy rules
src/screens/              home, world/level select, garage, upgrades, gameplay, result overlay
src/ui/                   camera, HUD, touch pedals, WebAudio sound
test-sim.html             headless physics regression: bot-drives every level
                          (serve, then open /test-sim.html — expect WINs)
```

## Implemented (v1 scope)

Worlds 1–3 (Farm + Town + City, 10 levels each; each world unlocks by starring the previous world's final level); 3 vehicles (Pickup, Sports Car, Motorbike) with 4 upgrade tracks each (Engine, Suspension, Tires, Brakes) and 50% sell-back; coins, 3-star ratings, sequential unlocks, daily login bonus; flip-and-stuck + pit + sank fail states; air control; touch + keyboard input; engine-pitch audio and landing/crash/win stingers. Obstacles: wooden launch ramps, hole-in-wall jumps, seesaws, rope bridges (simple rope physics), mud dips, narrow bridges with overhead beams, reverse-run-up pockets, speed bumps, potholes, rooftop runs, fence hops, tree canopies that snag airborne cars, and the City set — oil slicks that boost or shove you back, swinging wrecking balls, cycling industrial presses, updraft fans, open waterways, and rider-triggered crane elevators.

Deferred (spec stretch/v2): Worlds 4+, Monster Truck/Muscle Car, Turbo/Chassis/Cosmetic upgrades, Gems, cloud save, ghosts/leaderboards/daily challenge, gamepad.
