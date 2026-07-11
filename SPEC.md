\# Hill Runner (working title)

\## Game Design Specification v0.1



\---



\## 1. Concept Overview



\*\*Genre:\*\* 2D physics-based driving platformer

\*\*Perspective:\*\* Side-on 2D, procedurally/hand-authored 2D terrain (hills, gaps, walls, jumps)

\*\*Platforms:\*\* Desktop (browser/PC) and Mobile (touch), single codebase

\*\*Core Loop:\*\* Drive a level → survive terrain hazards → finish → earn currency → upgrade car/garage → unlock harder levels and new vehicles → repeat



\*\*Elevator Pitch:\*\* A physics-driven "Hill Climb"-style platformer where the player drives through hand-crafted, obstacle-filled 2D levels themed like a world atlas (farm, city, castle, underground, etc.), earning money to build out a garage of specialized vehicles, each suited to different challenge types. Simple two/three-button controls, deep upgrade progression, short session length, and a difficulty curve designed to hook new players in the first ten levels and keep veterans chasing better times and rarer cars.



\---



\## 2. Core Gameplay



\### 2.1 Player Goal

\- Drive from the level start to the level finish line without the car flipping and getting stuck, or falling into a pit/off a broken jump.

\- Levels are completed for time + intact-car bonuses; money payout scales with performance.



\### 2.2 Fail States

The player loses/restarts the level when:

1\. \*\*Flip-and-stuck:\*\* The car flips onto its roof/side and cannot right itself (no wheel contact with ground for X seconds while stationary or wedged against terrain).

2\. \*\*Pit/Fall-through:\*\* The car misses a jump and falls into a bottomless pit, hole in a wall, or off the bottom of the level geometry.

3\. \*(Optional stretch goal)\* Fuel depletion on longer levels (ties into the engine upgrade tree) — off by default in v1, can be a "hard mode" toggle.



\### 2.3 Win State

\- Reaching the finish flag/gate with the car still "alive" (not flipped/fallen).

\- Score is based on: time taken, distance/style bonuses (air time, near-misses), and whether damage-sensitive upgrades were preserved (optional).



\---



\## 3. Physics \& Car Handling



This is the heart of the feel of the game, inspired by suspension-based driving games but simplified for platformer pacing.



\### 3.1 Suspension Model

\- Each car is modeled as a \*\*chassis body\*\* with \*\*two (or more) wheel points\*\* connected via spring-damper suspension joints.

\- Each wheel is an independent physics body (circle collider) connected to the chassis by:

&#x20; - A \*\*spring\*\* (controls ride height / softness — upgradeable "Suspension" stat)

&#x20; - A \*\*damper\*\* (controls bounciness / settling speed — upgradeable "Suspension" stat, paired with springs)

\- Suspension travel has a min/max range; bottoming out at max compression can cause chassis-terrain collision (damage, or "flip risk" if hit at bad angle).

\- Wheel-ground contact uses the terrain's local surface normal for grip and torque application (not just flat friction).



\### 3.2 Driving Forces

\- \*\*Gas (accelerate):\*\* Applies torque to the driven wheel(s) while grounded. Torque curve depends on engine tier.

\- \*\*Brake/Reverse:\*\* Single input, context sensitive:

&#x20; - Moving forward + input = braking (reduces speed).

&#x20; - Stopped or input held after full stop = reverse.

\- \*\*Air Control (key differentiator):\*\*

&#x20; - While airborne, holding Gas rotates the chassis \*\*nose-up\*\* (clockwise-ish depending on facing) at a rate defined by an "Air Control" stat (tunable per vehicle, upgradeable).

&#x20; - Holding Brake/Reverse rotates the chassis \*\*nose-down\*\*.

&#x20; - This is the primary skill-expression mechanic: landing flat vs. nose-first vs. tail-first affects whether the car flips.

\- \*\*Landing Physics:\*\* Landing angle relative to the ground slope determines a "flip risk" impulse. Steep mismatched angles increase flip chance; matched angles (wheels-first, roughly parallel to slope) are safe.



\### 3.3 Damage / Flip Recovery (optional depth)

\- Minor tips (car on 2 wheels, or resting at >90° briefly) can be "self-corrected" by rocking (rapid gas/reverse alternation), rewarding player skill instead of instant fail.

\- A car is only "stuck" (fail state) if it's inverted/wedged AND has near-zero velocity for a grace window (e.g., 1.5s) — this avoids cheap deaths from a bumpy landing that's still recoverable.



\### 3.4 Terrain Interaction

\- Terrain is built from 2D spline/polygon chains (hills), with embedded set-pieces: ramps, gaps, moving platforms, breakable walls, loop-de-loops (later levels), narrow corridors, and holes.

\- Surface types affect grip: dirt, mud, ice, metal grating, wood, stone — each with a friction coefficient, relevant to level theming (e.g., farm = mud, underground = wet stone, castle = old wood/stone).



\---



\## 4. Controls



Design goal: \*\*one axis of movement + one axis of air rotation, using the same two inputs.\*\* No separate "jump" button — jumps come from terrain, not player input.



| Platform | Gas | Brake/Reverse |

|---|---|---|

| Desktop (Keyboard 1) | D or → | A or ← |

| Desktop (Keyboard 2 / alt) | W | S |

| Mobile | Right on-screen pedal (right half of screen or dedicated pedal icon) | Left on-screen pedal |

| Gamepad (stretch) | Right trigger / A button | Left trigger / B button |



\- No separate steering — direction of travel is fixed left-to-right per level (occasional level segments may require a brief reverse-to-backtrack, but overall flow is unidirectional to keep controls dead simple).

\- Pause / restart level: single tap/button, always accessible.

\- Mobile pedals are large, semi-transparent, thumb-anchored to bottom corners; auto-scale to screen size; support simultaneous multi-touch for edge cases (rocking to self-correct).



\---



\## 5. Level Design \& Progression



\### 5.1 Structure

\- Levels are organized into \*\*Worlds\*\* (themes), each containing \~8-15 levels.

\- Levels are linear, left-to-right, with a fixed start and finish per level (no branching paths in v1).

\- Each level has 1–3 star performance ratings (e.g., Finish / Finish without flipping / Finish under target time) used for bonus payouts and optional cosmetic unlocks.



\### 5.2 Difficulty Curve

\- Global difficulty trends upward across the game but is allowed to dip slightly between levels to create breathing room (e.g., a "palate cleanser" level after a hard one).

\- \*\*Levels 1–10 (Tutorial Arc, Theme: Farm):\*\* Each introduces exactly one new concept in isolation before combining them:

&#x20; 1. Basic driving, gentle hills — teaches Gas/Brake feel.

&#x20; 2. First small gap (jump) — teaches momentum-based jumping.

&#x20; 3. First air-rotation moment (small gap + suspended landing) — teaches nose-up/down control.

&#x20; 4. Steeper hills, first flip-risk slope — teaches suspension limits.

&#x20; 5. Narrow bridge / wall gap — teaches precision driving.

&#x20; 6. Reverse required (short backtrack around an obstacle) — teaches reverse mechanic.

&#x20; 7. Combined gaps + hills — first real test of jump + air control together.

&#x20; 8. Introduces a hole-in-wall obstacle (must be airborne at the right height to pass through) — teaches jump-height timing.

&#x20; 9. Longer combo level mixing all above mechanics with a mild time pressure.

&#x20; 10. "Graduation" level — a compact gauntlet of everything learned, gates entry into World 2.

\- After level 10, new mechanics are introduced more sparingly (roughly 1 new element per world), and levels lean harder on combining existing mechanics in tighter, less forgiving arrangements.



\### 5.3 Level Themes (Worlds)

Each theme introduces its own visual identity, terrain material (affecting grip), and 1–2 signature obstacle types.



| World | Theme | Signature Obstacles | Terrain Grip |

|---|---|---|---|

| 1 | Farm | Hay bale ramps, fences, mud pits | Dirt/mud (low-med) |

| 2 | Town/Suburbs | Rooftops, fences, moving school-bus platforms | Asphalt (high) |

| 3 | City | Rooftop-to-rooftop gaps, construction gaps, rebar walls | Concrete/metal (med) |

| 4 | Underground/Mines | Narrow tunnels, mine carts, collapsing floors, wet stone | Wet stone (low) |

| 5 | Castle | Drawbridges, crumbling battlements, moving portcullis walls | Old stone (med) |

| 6 | Industrial/Factory | Conveyor belts, pistons, metal grating | Metal (variable/oil patches) |

| 7 (stretch) | Arctic | Ice physics, avalanches, cracking ice floors | Ice (very low) |

| 8 (stretch) | Volcanic | Lava pits (instant fail), crumbling rock, heat-warped ramps | Rock (med) |



\- Each world ends with a \*\*Boss Level\*\*: a long, punishing gauntlet combining every mechanic in that world, with the best money/star payout.



\### 5.4 Session \& Retention Design

\- Levels are short (60–120 seconds ideal completion time) to support "one more try" mobile session patterns.

\- Instant restart (<1 second) on fail — no loading friction.

\- Daily login bonus (bonus currency or a free "loot" upgrade part).

\- Optional \*\*Time Trial / Ghost mode\*\* on completed levels for replay value and leaderboard chasing.

\- Daily/weekly rotating challenge level with fixed vehicle (no upgrades) and global leaderboard — a strong long-term retention hook.

\- Milestone unlocks (new vehicle, cosmetic, or upgrade tier) every few levels to maintain a steady "next thing to reach" feeling.



\---



\## 6. Economy \& Progression



\### 6.1 Currency

\- \*\*Coins\*\* (soft currency): earned per level based on completion, stars, and style bonuses (air time, near misses, no-flip runs). Used for standard upgrades and vehicle purchases.

\- \*\*Gems\*\* (optional premium/rare currency, stretch goal for monetization): earned rarely via perfect runs/daily challenges, or purchased. Used to skip grind or buy cosmetic-only items — never pay-to-win on core physics stats, to preserve skill-based fairness.



\### 6.2 Upgrade Categories (per car)

Each vehicle has an independent upgrade tree. Categories:



1\. \*\*Engine\*\* — increases torque/top speed. Progresses through named tiers, e.g.:

&#x20;  `2.0L I4 → 2.5L I4 → 2.5L V6 → 3.5L V6 Turbo`

2\. \*\*Turbo/Boost\*\* — unlockable add-on (not all cars start with one); adds a burst-speed meter mechanic, refills over time or via clean landings.

3\. \*\*Suspension\*\* — spring stiffness \& damping tiers (softer = better absorption on rough terrain, stiffer = better air-control responsiveness and less bottoming-out). Presented as a slider/tier choice with trade-offs, not a strict upgrade, to add build variety.

4\. \*\*Tires\*\* — grip and rolling resistance tiers (e.g., Street → All-Terrain → Off-Road Knobby → Racing Slick), each suited to different terrain types.

5\. \*\*Brakes\*\* — improves brake responsiveness and reverse torque (helps air-control precision too, since brake input doubles as nose-down rotation).

6\. \*\*Chassis/Frame\*\* (stretch) — affects weight and center of mass, changing flip resistance vs. agility trade-off.

7\. \*\*Cosmetic\*\* — paint, decals, wheels — no gameplay effect, pure monetization/expression layer.



\- Upgrades are tiered and \*\*linear per car\*\* (no branching within a stat) to keep the system easy to understand, but the \*choice of which stat to invest in next\* is the strategic layer.

\- Respec/sell-back at reduced value to allow experimentation without total lock-in.



\### 6.3 Vehicle Roster

Vehicles differ in base stats and are suited to different level archetypes, encouraging a garage of specialists rather than one "best" car.



| Vehicle | Best For | Traits |

|---|---|---|

| \*\*Pickup/SUV\*\* | Farm \& off-road-heavy levels | High suspension travel, good grip on dirt/mud, moderate speed, forgiving flip recovery (higher chassis, but also higher flip torque — trade-off) |

| \*\*Sports Car\*\* | High-speed jump levels (City, Town) | High top speed and acceleration, low ride height (better landings on flat ramps, but low ground clearance = risk on rough terrain), best turbo synergy |

| \*\*Motorbike\*\* | Precision-gap levels (Underground, narrow castle corridors) | Narrowest profile, lightest, most air-control responsiveness, but least stable landing (single track = higher flip sensitivity), and no "self-correct rocking" — flips are more punishing |

| \*\*Monster Truck (unlockable, later game)\*\* | Extreme off-road/late-game gauntlets | Huge suspension travel, very high flip resistance, but slow top speed and poor air-rotation (heavy chassis) |

| \*\*Muscle Car (unlockable)\*\* | Balanced all-rounder / boss levels | Mid stats across the board, high raw torque, good for players who want one reliable car for most levels |



\- Each vehicle is purchased with Coins (or unlocked via world-completion milestones) and then upgraded independently — this creates a long-term "collect and build out the whole garage" meta-goal.

\- A \*\*pre-level vehicle select screen\*\* shows recommended vehicle type per level (soft guidance, not a hard restriction) so players understand \*why\* their SUV struggles on the City rooftops level.



\---



\## 7. Platform \& Technical Requirements



\- \*\*Engine-agnostic requirement:\*\* must run in-browser (HTML5/WebGL or Canvas) for desktop, and be packageable for iOS/Android (via a wrapper like Capacitor, or a native-friendly engine such as Unity/Godot/Phaser+Box2D).

\- \*\*Physics:\*\* requires a 2D rigid-body physics engine with spring/joint support (e.g., Box2D, Matter.js, or engine-native 2D physics) capable of the suspension model in Section 3.

\- \*\*Input abstraction layer:\*\* a single internal "Gas/Brake" input state, mapped from keyboard, touch, or gamepad — ensures parity of feel across platforms.

\- \*\*Performance target:\*\* stable 60fps on mid-range mobile devices; level geometry should use simplified collision meshes distinct from higher-detail visual art.

\- \*\*Save data:\*\* cloud-synced player profile (currency, owned vehicles, upgrade levels, level stars) so progress carries across devices — important for a mobile+desktop game.

\- \*\*Responsive UI:\*\* garage/upgrade menus and HUD must scale cleanly from small phone screens to widescreen desktop.



\---



\## 8. Art \& Audio Direction (Brief)



\- \*\*Visual style:\*\* clean, readable 2D silhouettes with painterly or flat-shaded backgrounds per theme; strong foreground/background contrast so terrain hazards are always readable at speed.

\- \*\*Car readability:\*\* wheels and chassis silhouette must clearly communicate current rotation/orientation at a glance (critical for the air-control skill mechanic).

\- \*\*Audio:\*\* engine pitch scales with RPM/speed (reinforces upgrade feel — a bigger engine should \*sound\* bigger); distinct impact/crash stingers for flips vs. clean landings vs. pit falls, to give immediate, satisfying feedback.

\- \*\*Feedback/juice:\*\* screen shake on hard landings, slow-mo micro-pause on near-misses or big air, confetti/coin-burst on level completion — these small touches materially support the "one more try" retention loop.



\---



\## 9. Stretch Goals / Future Considerations



\- Level editor + community-shared levels.

\- Ghost-replay time trials and global leaderboards per level.

\- Seasonal events with limited-time worlds/cosmetics.

\- Weather/dynamic hazards (rain reducing grip mid-level, wind affecting air control).

\- Co-op or async "race your friend's ghost" mode.

\- Fuel/damage hard-mode toggle for players wanting extra challenge.



\---



\## 10. Open Design Questions



\- Should flipped-but-not-stuck states ever cost time/currency penalties even if recovered, to add stakes without hard failure?

\- How aggressively should the game gate vehicle purchases behind world-completion vs. pure currency, to balance progression pacing vs. player freedom?

\- Should premium currency exist at all in v1, or should the game launch currency-simple (one coin type) and add complexity later based on retention data?

