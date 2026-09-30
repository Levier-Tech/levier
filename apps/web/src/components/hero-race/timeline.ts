// Pure functions describing the race film. Every value is a function of the film clock `t` (seconds) and the loop counter.
// The film clock runs slower than real time through the photo finish (see `timeScale`).

export const PHASE = {
  grid: 3, // lights out, race starts
  race: 14, // winner crosses the line
  fade: 22, // fade out before the next loop
  loop: 23,
} as const;
export const LOOP = PHASE.loop;
export const RIDERS = 5;

const TOP_SPEED = 72; // m/s, about 260 km/h
const ACCEL = 1.2;
const COOL = 0.55; // deceleration after the line
export const START_X = 0;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
export const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

function racingX(t: number) {
  const u = Math.max(0, t - PHASE.grid);
  return START_X + TOP_SPEED * (u - (1 - Math.exp(-ACCEL * u)) / ACCEL);
}
function racingSpeed(t: number) {
  return t < PHASE.grid ? 0 : TOP_SPEED * (1 - Math.exp(-ACCEL * (t - PHASE.grid)));
}
export const FINISH_X = racingX(PHASE.race);
const FINISH_SPEED = racingSpeed(PHASE.race);

export function leaderX(t: number) {
  if (t <= PHASE.race) return racingX(t);
  const u = t - PHASE.race;
  return FINISH_X + (FINISH_SPEED * (1 - Math.exp(-COOL * u))) / COOL;
}
export function leaderSpeed(t: number) {
  if (t <= PHASE.race) return racingSpeed(t);
  return FINISH_SPEED * Math.exp(-COOL * (t - PHASE.race));
}
export const GANTRY_X = START_X + 2.5;

// The wipe: the winner crosses the line right past the lens. The lens sits just past the line, close to the winner's
// outside, so the fairing fills the frame. At WIPE_T the bike covers the whole frame and the world is cut away.
export const WIPE_X = FINISH_X + 1.0;
export const WIPE_OFFSET = 0.62; // lens distance from the winner's center line (m)
export const WIPE_T = (() => {
  let lo = PHASE.race - 1;
  let hi = PHASE.race + 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (leaderX(mid) < WIPE_X) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
})();
/** When the world is gone and only the logo remains. */
export const LOGO_T = WIPE_T;

/** Film seconds per real second: speed ramps on the big overtake and deep slow motion into the wipe. */
export function timeScale(t: number) {
  // Overtake: a hard dip to quarter speed and back.
  const overtake = smooth(seg(t, 6.35, 6.55)) * (1 - smooth(seg(t, 7.2, 7.6)));
  // Speed ramp: a surge just before the finish, then a snap into deep slow motion.
  const surge = smooth(seg(t, 12.55, 12.8)) * (1 - smooth(seg(t, 12.95, 13.05)));
  const finish = smooth(seg(t, 13.0, 13.15)) * (1 - smooth(seg(t, WIPE_T + 0.25, WIPE_T + 0.6)));
  const wipe = smooth(seg(t, WIPE_T - 0.09, WIPE_T - 0.03)) * (1 - smooth(seg(t, WIPE_T + 0.03, WIPE_T + 0.12)));
  return Math.max(0.05, 1 + 0.4 * surge - 0.75 * overtake - 0.83 * finish - 0.1 * wipe);
}

/** How deep in slow motion the film is, 0..1 (drives the high-speed-camera look and the muffled sound). */
export function slowAt(t: number) {
  return clamp01((1 - timeScale(t)) / 0.8);
}

/** Hard cuts between shots, in film time (whooshes in the sound design). */
export const SHOT_CUTS = [5.5, 8, 10, 13.2];

/** When each logo piece (grey, red, green) lights up, in film seconds after the wipe. */
export const REVEAL = [0.55, 0.9, 1.25];
/** When the caption fades in, in film seconds after the wipe. */
export const CAPTION_AT = 1.9;

/**
 * Boost 0..1 for bike i: fires while the bike is gaining places, and for the winner's last push to the line.
 */
export function boostAt(t: number, loop: number, i: number) {
  if (t < PHASE.grid || t > PHASE.race + 0.1) return 0;
  const gain = rankAt(t - 0.2, loop, i) - rankAt(t + 0.2, loop, i);
  let b = clamp01(gain * 3.5);
  if (i === rivals(loop).winner) b = Math.max(b, smooth(seg(t, 12.6, 13.1)));
  return b;
}

/** Camera-shake kicks on overtakes and lights out (0..1). */
export function impactAt(t: number) {
  let k = 0;
  for (const at of [PHASE.grid, 5.5, 6.4, 8, 10, 12, 13.02]) {
    const d = t - at;
    if (d >= 0 && d < 1) k = Math.max(k, Math.exp(-d * 7));
  }
  return k;
}

/** The two riders fighting for the win this loop. The winner rotates every loop. */
export function rivals(loop: number) {
  const winner = loop % RIDERS;
  const rival = winner === RIDERS - 1 ? winner - 1 : winner + 1; // adjacent lane
  return { winner, rival };
}

const KEYS = [PHASE.grid, 5.5, 8, 10, 12, PHASE.race];
let planLoop = -1;
let plan: number[][] = [];

// plan[k][bike] = rank at key time k. The rival pair trades the lead at every key; the rest shuffle behind.
function rankPlan(loop: number) {
  if (loop === planLoop) return plan;
  const { winner, rival } = rivals(loop);
  const others = [0, 1, 2, 3, 4].filter((i) => i !== winner && i !== rival);
  const next: number[][] = [];
  const shuffles = [
    [0, 1, 2],
    [1, 0, 2],
    [1, 2, 0],
    [2, 1, 0],
    [2, 0, 1],
    [0, 2, 1],
  ];
  for (let k = 0; k < KEYS.length; k++) {
    const ranks = new Array<number>(RIDERS);
    if (k === 0) {
      // Grid: the pair starts on the front row, rival on pole.
      ranks[rival] = 0;
      ranks[winner] = 1;
    } else {
      const winnerLeads = k % 2 === 0 || k === KEYS.length - 1;
      ranks[winner] = winnerLeads ? 0 : 1;
      ranks[rival] = winnerLeads ? 1 : 0;
    }
    const order = shuffles[(k + loop) % shuffles.length];
    others.forEach((bike, j) => {
      ranks[bike] = 2 + order[j];
    });
    next.push(ranks);
  }
  plan = next;
  planLoop = loop;
  return plan;
}

export function rankAt(t: number, loop: number, i: number) {
  const p = rankPlan(loop);
  if (t <= KEYS[0]) return p[0][i];
  if (t >= KEYS[KEYS.length - 1]) return p[p.length - 1][i];
  let k = 0;
  while (t >= KEYS[k + 1]) k++;
  const s = smoother(seg(t, KEYS[k], KEYS[k + 1]));
  return lerp(p[k][i], p[k + 1][i], s);
}

function gapAt(t: number) {
  if (t < PHASE.grid) return 2.4;
  if (t < 5.5) return lerp(2.4, 3.2, smooth(seg(t, PHASE.grid, 5.5)));
  if (t < 11.5) return 3.2;
  if (t < PHASE.race) return lerp(3.2, 1.2, smooth(seg(t, 11.5, PHASE.race)));
  return lerp(1.2, 6, smooth(seg(t, PHASE.race, PHASE.race + 3)));
}

export interface BikeState {
  x: number;
  z: number;
  roll: number;
  yaw: number;
  rank: number;
  visible: boolean;
}
export const newBikeStates = (): BikeState[] =>
  Array.from({ length: RIDERS }, () => ({ x: 0, z: 0, roll: 0, yaw: 0, rank: 0, visible: true }));

export function bikeStates(t: number, loop: number, out: BikeState[]) {
  const gap = gapAt(t);
  const lead = leaderX(t);
  const ramp = smooth(seg(t, 3, 4.5)) * (1 - smooth(seg(t, PHASE.race + 1, PHASE.race + 3)));
  const { winner, rival } = rivals(loop);
  const center = laneCenter(loop);
  // The rival pair squeezes together while fighting, fairing to fairing.
  const squeeze = smooth(seg(t, 4, 6)) * (1 - smooth(seg(t, PHASE.race + 0.5, PHASE.race + 2.5)));
  for (let i = 0; i < RIDERS; i++) {
    const s = out[i];
    const rank = rankAt(t, loop, i);
    s.rank = rank;
    s.x = lead - gap * rank;
    let z = (i - 2) * 0.95;
    if (i === winner || i === rival) {
      const side = i === Math.min(winner, rival) ? -1 : 1;
      z = lerp(z, center + side * 0.36, squeeze);
    }
    // Pair weaves in sync, like two riders feinting at each other.
    const phase = i === winner || i === rival ? 0 : i * 1.7;
    s.z = z + Math.sin(t * 0.9 + phase) * 0.22 * ramp;
    s.roll = -0.3 * Math.cos(t * 0.9 + phase) * ramp * (1 - smooth(seg(t, 12.8, 13.6)));
    s.yaw = 0.04 * Math.cos(t * 0.9 + phase) * ramp;
    s.visible = t < WIPE_T + 1;
  }
}

/** Bike indexes sorted by current rank, leader first. */
export function orderAt(t: number, loop: number, out: number[]) {
  const ranks = Array.from({ length: RIDERS }, (_, i) => rankAt(Math.min(t, PHASE.race), loop, i));
  for (let i = 0; i < RIDERS; i++) out[i] = i;
  out.sort((a, b) => ranks[a] - ranks[b]);
}

export interface CameraPose {
  px: number;
  py: number;
  pz: number;
  tx: number;
  ty: number;
  tz: number;
  fov: number;
  shake: number;
  /** Camera roll (radians) for tilted shots. */
  dutch: number;
  /** Motion blur amount 0..1 and its style: 0 = horizontal pan blur, 1 = radial zoom blur. */
  blur: number;
  blurMode: number;
}
export const newCameraPose = (): CameraPose => ({
  px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0, fov: 35, shake: 0, dutch: 0, blur: 0, blurMode: 0,
});

function set(o: CameraPose, px: number, py: number, pz: number, tx: number, ty: number, tz: number, fov: number) {
  o.px = px; o.py = py; o.pz = pz; o.tx = tx; o.ty = ty; o.tz = tz; o.fov = fov;
}

export interface Pair {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Lane center of the pair; constant for a loop so the finish shot and the crane line up exactly. */
  zc: number;
}

export function laneCenter(loop: number) {
  const { winner, rival } = rivals(loop);
  return ((winner + rival) / 2 - 2) * 0.95;
}

/** Broadcast and on-bike shots. `p` holds the winner (a) and rival (b) positions. */
export function cameraAt(t: number, p: Pair, out: CameraPose) {
  out.dutch = 0;
  out.shake = 0.012;
  out.blur = 0;
  out.blurMode = 0;
  const xm = (p.ax + p.bx) / 2;
  const zm = (p.az + p.bz) / 2;
  if (t < PHASE.grid) {
    // Grid: close in front of the two rivals, slow push toward their visors.
    const k = smooth(t / PHASE.grid);
    set(out, xm + 4.4 - k * 1.1, 0.95, zm + 1.6 - k * 0.4, xm, 1.0, zm, 34);
    out.shake = 0.006;
  } else if (t < 5.5) {
    // Launch: tracking vehicle just ahead, the pair storms at the lens with smoke billowing behind.
    set(out, xm + 6.5, 0.75, zm + 0.5, xm - 2, 0.8, zm, 36);
    out.shake = 0.05;
    out.blur = 0.7;
    out.blurMode = 1;
  } else if (t < 8) {
    // Side by side: tight tracking shot on the pair, fairing to fairing.
    set(out, xm + 0.4 * Math.sin(t * 0.6), 0.95, zm + 4.1, xm, 0.8, zm, 30);
    out.shake = 0.03;
    out.dutch = 0.03;
    out.blur = 0.85;
  } else if (t < 10) {
    // Low rear three-quarter beside whoever is behind, hunting the one ahead.
    const aAhead = p.ax >= p.bx;
    const hx = aAhead ? p.bx : p.ax;
    const hz = aAhead ? p.bz : p.az;
    const lx = aAhead ? p.ax : p.bx;
    const lz = aAhead ? p.az : p.bz;
    set(out, hx - 3.4, 0.55, hz + 2.0, lx + 1.5, 0.75, lz, 38);
    out.shake = 0.035;
    out.dutch = -0.05;
    out.blur = 0.6;
    out.blurMode = 1;
  } else if (t < 13.2) {
    // Head-on telephoto: the pack charges at the lens.
    set(out, xm + 17, 0.65, zm + 0.6, xm, 0.95, zm, 16);
    out.shake = 0.02;
    out.blur = 0.25;
    out.blurMode = 1;
  } else {
    // The wipe: low at the line on the winner's outside. The lens pans with the winner until the fairing fills the
    // frame, then freezes on that heading while the bike clears, revealing the logo.
    const side = wipeSide(p);
    const cz = p.az + side * WIPE_OFFSET;
    if (t < WIPE_T) {
      set(out, WIPE_X, 0.62, cz, p.ax, 0.6, p.az, 38);
      out.shake = 0.02 + 0.03 * seg(t, 13.2, WIPE_T);
      out.dutch = 0.04 * side;
      out.blur = 0.45;
    } else {
      // After the cut the lens keeps its heading (square to the track) and slowly pushes in on the logo.
      const push = smooth(seg(t, WIPE_T, PHASE.fade + 1)) * 3.5;
      set(out, WIPE_X, 0.62, p.zc + side * (0.36 + WIPE_OFFSET) - side * push, WIPE_X, 0.6, -side * 100, 38);
    }
  }
}

/** Which side of the winner the wipe lens sits on: the outside, away from the rival. */
export function wipeSide(p: Pair) {
  return p.az >= p.bz ? 1 : -1;
}

/** Where the logo stands after the wipe, square to the lens. */
export const LOGO_DISTANCE = 13;

export function startLightsOn(t: number) {
  // Five lights, one every half second, all out at the start of the race.
  return t >= PHASE.grid ? 0 : Math.max(0, Math.min(5, Math.floor((t - 0.4) / 0.5) + 1));
}

/** Black fade between loops: out at the end, in at the start. */
export function fadeAt(t: number) {
  if (t >= PHASE.fade) return smooth(seg(t, PHASE.fade, LOOP));
  if (t < 0.7) return 1 - smooth(t / 0.7);
  return 0;
}
