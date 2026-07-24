// Vehicle definitions: base stats + linear upgrade tiers per stat (spec §6.2, §6.3).
// Stats consumed by physics/Car.js:
//   engine.torque      – wheel spin-up acceleration (rad/s^2 toward target)
//   engine.topSpeed    – max wheel angular velocity (rad/s)
//   tires.grip         – wheel friction coefficient
//   suspension.stiffness / damping – Matter constraint params
//   suspension.travel  – rest length multiplier (ride height)
//   brakes.power       – braking/reverse torque multiplier
//   airControl         – airborne rotation rate (rad/s), boosted by brakes tier
//
// body.sprite is drawn at exactly body.width x body.height (keep width/height
// at the sprite's aspect ratio). The chassis COLLIDER is only the bottom half
// of that box (width x height/2, flush with the sprite's bottom edge) — the
// cabin/rider above it is visual-only. Chassis mass = density*width*height/2.
// body.wheelY is the TUNING KNOB for wheel height: px from the sprite center
// DOWN to where the wheel hub hangs at rest (suspension travel is added on
// top). Raise it to drop the wheels lower / lower it to tuck them into the
// sprite's wheel arches.
// body.comY drops the centre of mass below the sprite's centre (px, y-down).
// Tall sprite colliders put the geometric centre high, which makes the car
// wheelie under throttle and flip on landings; raise comY to plant it.
//
// body.wheelSprite is rim-only art (sprites/wheel-sprites/, cropped tight to
// the rim) — GameScreen draws the rubber itself around it, sized off the
// physics wheel radius. Each tire tier's `look` drives that rubber:
//   thick – tire wall thickness as a fraction of wheelRadius (rim shrinks to fit)
//   tread – 'slick' (smooth + sheen) | 'street' (shallow sipes) | 'blocks' (knobby lugs)
// Purely visual; grip is the only stat physics reads.

export const VEHICLES = {
  pickup: {
    id: 'pickup',
    name: 'Pickup',
    icon: '🛻',
    desc: 'High suspension travel, great grip on dirt. Forgiving all-rounder for the farm.',
    price: 0, // starter vehicle
    // truck-sprite.png is 800x353.
    body: {
      width: 145, height: 60, wheelRadius: 18, wheelBase: 78, density: 0.0064,
      sprite: 'sprites/truck-sprite.png', wheelY: 26, comY: 22,
      wheelSprite: 'sprites/wheel-sprites/truck-wheel.png',
    },
    airControl: 1.2,
    tiers: {
      engine: [
        { name: '2.0L I4',       torque: 0.60, topSpeed: 60, cost: 0 },
        { name: '2.5L I4',       torque: 0.85, topSpeed: 70, cost: 1000 },
        { name: '2.5L V6',       torque: 1.0, topSpeed: 85, cost: 3000 },
        { name: '3.5L V6 Turbo', torque: 1.2, topSpeed: 100, cost: 7500 },
      ],
      suspension: [
        { name: 'Stock Springs',  stiffness: 0.055, damping: 0.08, travel: 1.00, cost: 0 },
        { name: 'Heavy Duty',     stiffness: 0.070, damping: 0.10, travel: 1.05, cost: 800 },
        { name: 'Off-Road Kit',   stiffness: 0.085, damping: 0.13, travel: 1.10, cost: 2400 },
        { name: 'Pro Long-Travel',stiffness: 0.100, damping: 0.16, travel: 1.15, cost: 5500 },
      ],
      tires: [
        { name: 'Street',          grip: 0.85, cost: 0,    look: { thick: 0.26, tread: 'street' } },
        { name: 'All-Terrain',     grip: 1.00, cost: 700,  look: { thick: 0.33, tread: 'street' } },
        { name: 'Off-Road Knobby', grip: 1.15, cost: 2000, look: { thick: 0.40, tread: 'blocks' } },
        { name: 'Racing Slick',    grip: 1.30, cost: 4800, look: { thick: 0.31, tread: 'slick' } },
      ],
      brakes: [
        { name: 'Stock Drums',    power: 1.0, cost: 0 },
        { name: 'Discs',          power: 1.3, cost: 700 },
        { name: 'Vented Discs',   power: 1.6, cost: 1800 },
        { name: 'Racing Calipers',power: 2.0, cost: 4500 },
      ],
    },
  },

  sports: {
    id: 'sports',
    name: 'Sports Car',
    icon: '🏎️',
    desc: 'Fast and low. Loves big ramps and flat landings — hates rough ground.',
    price: 16000,
    // sports_car-sprite.png is 800x319.
    body: {
      width: 145, height: 50, wheelRadius: 15, wheelBase: 85, density: 0.0032,
      sprite: 'sprites/sports_car-sprite.png', wheelY: 14, comY: 15,
      wheelSprite: 'sprites/wheel-sprites/sports_car-wheel.png',
    },
    airControl: 0.6,
    tiers: {
      engine: [
        { name: '2.5L Flat-4',   torque: 0.70, topSpeed: 50, cost: 0 },
        { name: '3.0L V6',       torque: 0.90, topSpeed: 60, cost: 1100 },
        { name: '4.0L V8',       torque: 1.12, topSpeed: 75, cost: 3200 },
        { name: '4.0L V8 Turbo', torque: 1.60, topSpeed: 95, cost: 8000 },
      ],
      suspension: [
        { name: 'Stock Coils',    stiffness: 0.055, damping: 0.09, travel: 0.90, cost: 0 },
        { name: 'Sport Coils',    stiffness: 0.070, damping: 0.11, travel: 0.92, cost: 900 },
        { name: 'Coilovers',      stiffness: 0.105, damping: 0.14, travel: 0.94, cost: 2600 },
        { name: 'Track Package',  stiffness: 0.120, damping: 0.17, travel: 0.96, cost: 6000 },
      ],
      tires: [
        { name: 'Street',       grip: 0.90, cost: 0,    look: { thick: 0.22, tread: 'street' } },
        { name: 'Sport',        grip: 1.05, cost: 800,  look: { thick: 0.25, tread: 'street' } },
        { name: 'Semi-Slick',   grip: 1.20, cost: 2200, look: { thick: 0.27, tread: 'street' } },
        { name: 'Racing Slick', grip: 1.38, cost: 5200, look: { thick: 0.30, tread: 'slick' } },
      ],
      brakes: [
        { name: 'Stock Discs',   power: 1.1, cost: 0 },
        { name: 'Sport Discs',   power: 1.4, cost: 800 },
        { name: 'Big Brake Kit', power: 1.8, cost: 2100 },
        { name: 'Carbon Ceramic',power: 2.2, cost: 5000 },
      ],
    },
  },

  bike: {
    id: 'bike',
    name: 'Motorbike',
    icon: '🏍️',
    desc: 'Narrow, light, incredible air control. Unstable landings — flips punish hard.',
    price: 7000,
    // motorcycle-sprite.png is 513x230 → 72x32 (sprite includes the rider).
    body: {
      width: 72, height: 32, wheelRadius: 13, wheelBase: 52, density: 0.0020,
      sprite: 'sprites/motorcycle-sprite.png', wheelY: 15, comY: 4,
      wheelSprite: 'sprites/wheel-sprites/motorcycle-wheel.png',
    },
    airControl: 3.6,
    tiers: {
      engine: [
        { name: '250cc Single',  torque: 0.50, topSpeed: 40, cost: 0 },
        { name: '450cc Single',  torque: 0.68, topSpeed: 50, cost: 900 },
        { name: '600cc Twin',    torque: 0.88, topSpeed: 65, cost: 2800 },
        { name: '1000cc Four',   torque: 1.25, topSpeed: 80, cost: 6800 },
      ],
      suspension: [
        { name: 'Stock Forks',    stiffness: 0.010, damping: 0.08, travel: 0.30, cost: 0 },
        { name: 'Trail Forks',    stiffness: 0.025, damping: 0.10, travel: 0.56, cost: 800 },
        { name: 'Enduro Kit',     stiffness: 0.040, damping: 0.13, travel: 0.82, cost: 2200 },
        { name: 'Factory MX',     stiffness: 0.070, damping: 0.16, travel: 1.00, cost: 5200 },
      ],
      tires: [
        { name: 'Street',     grip: 0.85, cost: 0,    look: { thick: 0.28, tread: 'street' } },
        { name: 'Dual-Sport', grip: 1.00, cost: 650,  look: { thick: 0.35, tread: 'street' } },
        { name: 'Knobby',     grip: 1.15, cost: 1900, look: { thick: 0.42, tread: 'blocks' } },
        { name: 'Race Compound', grip: 1.32, cost: 4600, look: { thick: 0.33, tread: 'slick' } },
      ],
      brakes: [
        { name: 'Stock',        power: 1.0, cost: 0 },
        { name: 'Wave Rotors',  power: 1.35, cost: 650 },
        { name: 'Dual Discs',   power: 1.7, cost: 1800 },
        { name: 'Race Spec',    power: 2.1, cost: 4400 },
      ],
    },
  },
};

export const UPGRADE_STATS = ['engine', 'suspension', 'tires', 'brakes'];

export const STAT_LABELS = {
  engine: 'Engine',
  suspension: 'Suspension',
  tires: 'Tires',
  brakes: 'Brakes',
};

export function getVehicleDef(id) {
  return VEHICLES[id];
}

// Cost to buy the NEXT tier above `currentTier`, or null if maxed.
export function getUpgradeCost(id, stat, currentTier) {
  const tiers = VEHICLES[id].tiers[stat];
  if (currentTier >= tiers.length - 1) return null;
  return tiers[currentTier + 1].cost;
}

// Resolved stat block for a vehicle at the given upgrade tiers.
export function getStatsAtTiers(id, upgrades) {
  const v = VEHICLES[id];
  const engine = v.tiers.engine[upgrades.engine];
  const susp = v.tiers.suspension[upgrades.suspension];
  const tires = v.tiers.tires[upgrades.tires];
  const brakes = v.tiers.brakes[upgrades.brakes];
  return {
    body: v.body,
    torque: engine.torque,
    topSpeed: engine.topSpeed,
    stiffness: susp.stiffness,
    damping: susp.damping,
    travel: susp.travel,
    grip: tires.grip,
    tireLook: tires.look,
    brakePower: brakes.power,
    // Brakes also sharpen air control (spec §6.2 item 5).
    airControl: v.airControl * (1 + 0.08 * upgrades.brakes),
  };
}
