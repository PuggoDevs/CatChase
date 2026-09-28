// Tuning. Every number the cat or the director uses lives here so the four
// difficulties can be compared side by side.

export const DIFFICULTIES = {
  easy: {
    label: 'Easy',
    blurb: 'It moves slowly and loses track of you. You can struggle free twice.',
    catWalk: 1.35, catRun: 3.9, catRunMax: 4.3,
    sightRange: 11, sightFov: 100, detectRate: 0.55, hearing: 0.7,
    memory: 8, searchTime: 16, loseTrack: 4.0,
    checkBase: 0.12, checkPerUse: 0.1, checkSeenEntering: 0.6,
    ambush: 0.05, fakeLeave: 0.0, deception: 0.0, stalk: 0.25,
    learnRate: 0.4, distractionTolerance: 4,
    doorBreak: 0, doorBreakTime: 0, ventUse: 0.25,
    struggles: 2, relaxTime: 50, menaceLimit: 0.9, leash: 0.35,
    eventRate: 0.8, outageAggro: 1.2, outageChance: 0.5,
    batteryDrain: 0.6, staminaDrain: 0.8, silentMove: 0.0,
    grabRange: 1.15,
  },
  normal: {
    label: 'Normal',
    blurb: 'It searches rooms, remembers where you were and sometimes waits for you.',
    catWalk: 1.6, catRun: 4.4, catRunMax: 4.85,
    sightRange: 14, sightFov: 110, detectRate: 1.0, hearing: 1.0,
    memory: 16, searchTime: 26, loseTrack: 5.5,
    checkBase: 0.28, checkPerUse: 0.18, checkSeenEntering: 0.92,
    ambush: 0.15, fakeLeave: 0.15, deception: 0.2, stalk: 0.4,
    learnRate: 0.7, distractionTolerance: 3,
    doorBreak: 0, doorBreakTime: 0, ventUse: 0.5,
    struggles: 1, relaxTime: 32, menaceLimit: 1.2, leash: 0.55,
    eventRate: 1.0, outageAggro: 1.3, outageChance: 0.8,
    batteryDrain: 0.8, staminaDrain: 1.0, silentMove: 0.15,
    grabRange: 1.25,
  },
  hard: {
    label: 'Hard',
    blurb: 'Faster, sharper, checks hiding spots and punishes repeated tricks.',
    catWalk: 1.95, catRun: 4.9, catRunMax: 5.35,
    sightRange: 17, sightFov: 122, detectRate: 1.45, hearing: 1.3,
    memory: 26, searchTime: 36, loseTrack: 7.5,
    checkBase: 0.48, checkPerUse: 0.25, checkSeenEntering: 1.0,
    ambush: 0.3, fakeLeave: 0.35, deception: 0.5, stalk: 0.55,
    learnRate: 1.0, distractionTolerance: 2,
    doorBreak: 0.6, doorBreakTime: 7, ventUse: 0.7,
    struggles: 0, relaxTime: 20, menaceLimit: 1.6, leash: 0.75,
    eventRate: 1.2, outageAggro: 1.4, outageChance: 1.0,
    batteryDrain: 1.0, staminaDrain: 1.1, silentMove: 0.3,
    grabRange: 1.3,
  },
  nightmare: {
    label: 'Nightmare',
    blurb: 'Relentless. It lies, it waits, it never lets you breathe.',
    catWalk: 2.25, catRun: 5.3, catRunMax: 5.85,
    sightRange: 21, sightFov: 132, detectRate: 1.9, hearing: 1.6,
    memory: 40, searchTime: 50, loseTrack: 10,
    checkBase: 0.66, checkPerUse: 0.3, checkSeenEntering: 1.0,
    ambush: 0.5, fakeLeave: 0.6, deception: 0.9, stalk: 0.7,
    learnRate: 1.4, distractionTolerance: 1,
    doorBreak: 1.0, doorBreakTime: 3.5, ventUse: 0.9,
    struggles: 0, relaxTime: 9, menaceLimit: 2.4, leash: 0.95,
    eventRate: 1.5, outageAggro: 1.5, outageChance: 1.0,
    batteryDrain: 1.2, staminaDrain: 1.2, silentMove: 0.5,
    grabRange: 1.35,
  },
};

export const PLAYER = {
  radius: 0.28,
  walk: 2.1, sprint: 4.8, crouch: 1.15, prone: 0.62,
  height: { stand: 1.72, crouch: 1.12, prone: 0.5 },
  eye: { stand: 1.6, crouch: 1.0, prone: 0.34 },
  staminaMax: 100, sprintCost: 13, staminaRegen: 11, staminaRegenIdle: 17, exhaustedUntil: 35,
  batteryDrainPerSec: 0.28, // % per second on Normal
  reach: 2.1,
  breathMax: 7,
};

export const NOISE = {
  walk: 5.5, sprint: 14, crouch: 1.8, prone: 1.0, land: 7,
  doorOpen: 7, doorQuiet: 1.2, doorSlam: 20, doorShut: 6, lock: 3,
  barricade: 16, exhaustedBreath: 4.5, gasp: 7, creak: 9,
  switch: 3, flashlight: 1.2, pickup: 2, piano: 22, tvOn: 14,
  throwWhoosh: 3.5,
};

export const QUALITY = {
  low: { pixelRatio: 0.7, shadowMap: 512, bloom: false, mirrors: false },
  medium: { pixelRatio: 1.0, shadowMap: 1024, bloom: true, mirrors: true },
  high: { pixelRatio: 1.5, shadowMap: 2048, bloom: true, mirrors: true },
};

export const DEFAULT_SETTINGS = {
  sensitivity: 1.0,
  invertY: false,
  volume: 0.85,
  musicVolume: 0.8,
  fov: 72,
  quality: 'medium',
  brightness: 1.0,
  reduceFlashes: false,
  reduceShake: false,
  subtitles: true,
  crouchToggle: true,
};
