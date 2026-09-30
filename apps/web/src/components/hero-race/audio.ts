// Sound for the hero race: real MotoGP recordings, cinematic hits and an action music bed, all CC0
// (sources in public/audio/README.md). Cues fire from the film clock, and the continuous beds (music, engines)
// follow the film's slow motion, so the whole mix slows down with the picture.
// Browsers only allow sound after a user gesture, so the page creates this on the first "Sound on" click.

import { LOOP, PHASE, REVEAL, WIPE_T } from './timeline';

const FILES = [
  'race-music',
  'grid-launch',
  'pack-pass',
  'pass-by',
  'pass-by-fast',
  'hit',
  'riser-impact',
  'hit-distorted',
  'braam',
  'crowd',
  'whoosh',
  'logo-sting',
] as const;
type Name = (typeof FILES)[number];

interface Bed {
  src: AudioBufferSourceNode;
  gain: GainNode;
  /** How much the slow motion bends this bed (1 = fully tape-locked to the film). */
  bend: number;
}

interface Cue {
  at: number;
  run: () => void;
}

export class HeroSound {
  private ctx: AudioContext;
  private master: GainNode;
  private bus: GainNode;
  /** Beds (music, engines) pass through this low-pass, which closes in slow motion. Hits stay clear. */
  private bedBus: GainNode;
  private muffle: BiquadFilterNode;
  private buffers = new Map<Name, AudioBuffer>();
  private beds = new Map<string, Bed>();
  private cues: Cue[];
  private prevT = -1;
  private volume = 0.8;
  private on = false;
  private paused = false;
  private ready: Promise<void>;

  constructor() {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    this.master.connect(comp).connect(this.ctx.destination);
    this.bus = this.ctx.createGain();
    this.bus.connect(this.master);
    this.muffle = this.ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.muffle.Q.value = 0.9;
    this.bedBus = this.ctx.createGain();
    this.bedBus.connect(this.muffle).connect(this.bus);
    this.ready = this.load();

    const one = (name: Name, gain: number) => () => this.play(name, gain);
    this.cues = [
      // Grid: engines revving, music drops in.
      {
        at: 0.02,
        run: () => {
          this.startBed('music', 'race-music', 0.42, 0.6, true);
          this.startBed('engines', 'grid-launch', 1, 1);
        },
      },
      // Lights out.
      {
        at: PHASE.grid,
        run: () => {
          this.play('hit-distorted', 0.8);
          this.play('whoosh', 1.6);
        },
      },
      // The pack screams past on the first cut.
      { at: 5.3, run: () => this.startBed('pack', 'pack-pass', 0.9, 1, false, 0.4) },
      // Overtakes.
      { at: 7.4, run: one('pass-by', 0.9) },
      { at: 8, run: one('hit', 0.45) },
      { at: 10, run: one('hit', 0.5) },
      { at: 11.4, run: one('pass-by', 1) },
      { at: 12, run: one('hit-distorted', 0.55) },
      // Build into the photo finish.
      { at: 12.95, run: one('riser-impact', 1.1) },
      // The wipe: the winner rips past the lens, the world is cut, a huge hit and the crowd.
      { at: WIPE_T - 0.12, run: one('pass-by-fast', 1.2) },
      {
        at: WIPE_T,
        run: () => {
          this.stopBed('music', 0.12);
          this.stopBed('engines', 0.2);
          this.stopBed('pack', 0.2);
          this.play('hit', 1.1);
          this.play('hit-distorted', 0.9);
          this.play('crowd', 0.35);
        },
      },
      // The logo sting lands with the pieces lighting up.
      { at: WIPE_T + REVEAL[0] - 0.25, run: one('logo-sting', 1) },
      { at: WIPE_T + REVEAL[2], run: one('braam', 0.5) },
      // Fade out before the loop restarts.
      { at: PHASE.fade, run: () => this.duck() },
    ];
  }

  private async load() {
    await Promise.all(
      FILES.map(async (name) => {
        const res = await fetch(`/audio/${name}.mp3`);
        const data = await res.arrayBuffer();
        this.buffers.set(name, await this.ctx.decodeAudioData(data));
      }),
    );
  }

  /** Turn sound on or off (fades). */
  async setEnabled(on: boolean) {
    this.on = on;
    if (on) {
      await this.ctx.resume();
      await this.ready;
      this.catchUp();
    }
    this.applyLevel();
  }

  // Sound switched on mid-film: start the beds at the right point instead of waiting for the next loop.
  private catchUp() {
    const t = this.prevT;
    if (t < 0 || t >= WIPE_T || this.beds.has('music')) return;
    this.startBed('music', 'race-music', 0.42, 0.6, true, 0.3);
    if (t < 5.3) this.startBed('engines', 'grid-launch', 1, 1, false, 0.3, t);
    else if (t < 5.3 + 14) this.startBed('pack', 'pack-pass', 0.9, 1, false, 0.3, t - 5.3);
  }

  /** Volume 0..1. */
  setVolume(volume: number) {
    this.volume = Math.min(1, Math.max(0, volume));
    this.applyLevel();
  }

  /** Suspend while the film is paused (hero off screen or tab hidden). */
  pause(paused: boolean) {
    this.paused = paused;
    if (!this.on) return;
    void (paused ? this.ctx.suspend() : this.ctx.resume());
  }

  dispose() {
    void this.ctx.close();
  }

  /** Call every frame with the film clock and its speed (film seconds per real second). */
  update(t: number, timeScale: number) {
    const from = this.prevT;
    this.prevT = t;
    if (!this.on || this.paused || this.buffers.size < FILES.length) return;

    // Beds follow the slow motion like a tape and sink under water; the surge speeds them up.
    const now = this.ctx.currentTime;
    this.beds.forEach((bed) => {
      bed.src.playbackRate.setTargetAtTime(Math.max(0.25, 1 - bed.bend * (1 - timeScale)), now, 0.05);
    });
    const slow = Math.min(1, Math.max(0, 1 - timeScale));
    this.muffle.frequency.setTargetAtTime(20000 * Math.pow(1 - slow, 3) + 380, now, 0.08);

    if (from < 0) return;
    const wrapped = t < from;
    if (!wrapped && t - from > 1.5) return; // a seek or a long stall: do not fire a burst of cues
    if (wrapped) this.stopAllBeds();
    for (const cue of this.cues) {
      const fire = wrapped ? cue.at > from || cue.at <= t : cue.at > from && cue.at <= t;
      if (fire) cue.run();
    }
  }

  private applyLevel() {
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.on ? this.volume : 0, now, 0.12);
  }

  private play(name: Name, gain: number) {
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.bus);
    src.start();
  }

  private startBed(key: string, name: Name, gain: number, bend: number, loop = false, fadeIn = 0.05, offset = 0) {
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    this.stopBed(key, 0.05);
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = loop;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + fadeIn);
    src.connect(g).connect(this.bedBus);
    src.start(now, offset % buffer.duration);
    this.beds.set(key, { src, gain: g, bend });
    src.onended = () => {
      if (this.beds.get(key)?.src === src) this.beds.delete(key);
    };
  }

  private stopBed(key: string, fade: number) {
    const bed = this.beds.get(key);
    if (!bed) return;
    const now = this.ctx.currentTime;
    bed.gain.gain.cancelScheduledValues(now);
    bed.gain.gain.setTargetAtTime(0.0001, now, fade / 3);
    bed.src.stop(now + fade * 2);
    this.beds.delete(key);
  }

  private stopAllBeds() {
    [...this.beds.keys()].forEach((key) => this.stopBed(key, 0.1));
  }

  private duck() {
    const now = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(now);
    this.bus.gain.setTargetAtTime(0.0001, now, 0.3);
    this.bus.gain.setTargetAtTime(1, now + (LOOP - PHASE.fade) + 0.1, 0.05);
  }
}
