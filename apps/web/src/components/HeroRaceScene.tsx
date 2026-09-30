'use client';

import { MutableRefObject, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import type { HeroSound } from './hero-race/audio';
import { BIKE_MODEL_URL, RiderSpec } from './hero-race/config';
import { buildFilmPass } from './hero-race/film';
import { buildSmoke, buildSparks, buildStreaks } from './hero-race/fx';
import { buildLevierMark, loadLogo, loadLogoTexture } from './hero-race/logos';
import { buildBike, loadBikeModel, WHEEL_RADIUS } from './hero-race/rider';
import {
  CAPTION_AT,
  FINISH_X,
  LOGO_DISTANCE,
  REVEAL,
  LOOP,
  PHASE,
  RIDERS,
  bikeStates,
  boostAt,
  cameraAt,
  WIPE_OFFSET,
  WIPE_T,
  WIPE_X,
  fadeAt,
  impactAt,
  slowAt,
  laneCenter,
  leaderSpeed,
  newBikeStates,
  newCameraPose,
  orderAt,
  rivals,
  seg,
  startLightsOn,
  timeScale,
  wipeSide,
} from './hero-race/timeline';
import { buildTrack } from './hero-race/track';

interface HeroRaceSceneProps {
  riders: RiderSpec[];
  active: boolean;
  onReady: () => void;
  onFail: () => void;
  onOrder: (order: number[]) => void;
  /** True once the race is cut away and only the logo is on screen. */
  onLogo: (logo: boolean) => void;
  /** Race sound; null until the visitor turns sound on. */
  sound: MutableRefObject<HeroSound | null>;
}

interface Controls {
  setActive: (active: boolean) => void;
}

const BG = 0x080808;
const smooth = (t: number) => t * t * (3 - 2 * t);
const BAR = 0.1; // letterbox bar height, as a share of the frame

export default function HeroRaceScene({ riders, active, onReady, onFail, onOrder, onLogo, sound }: HeroRaceSceneProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tagsRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const barTopRef = useRef<HTMLDivElement>(null);
  const barBottomRef = useRef<HTMLDivElement>(null);
  const carbonRef = useRef<HTMLDivElement>(null);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const captionRef = useRef<HTMLParagraphElement>(null);
  const controls = useRef<Controls | null>(null);
  const callbacks = useRef({ onReady, onFail, onOrder, onLogo });
  callbacks.current = { onReady, onFail, onOrder, onLogo };
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const tagLayer = tagsRef.current;
    const flash = flashRef.current;
    const barTop = barTopRef.current;
    const barBottom = barBottomRef.current;
    const carbon = carbonRef.current;
    const caption = captionRef.current;
    if (!wrap || !canvas || !tagLayer || !flash || !barTop || !barBottom || !carbon || !caption) return;

    let disposed = false;
    let teardown = () => {};

    const init = async () => {
      let renderer: THREE.WebGLRenderer;
      try {
        // Alpha lets the carbon backdrop (HTML, behind the canvas) show through once the race is cut away.
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
      } catch {
        callbacks.current.onFail();
        return;
      }
      const mobile = window.innerWidth <= 760;
      let pixelRatio = Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.75);
      renderer.setPixelRatio(pixelRatio);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.setClearColor(BG, 1);

      // Assets first, so the first visible frame is complete.
      const [logos, logoTextures, model] = await Promise.all([
        Promise.all(riders.map((r) => loadLogo(r.image))),
        Promise.all(riders.map((r) => loadLogoTexture(r.image, r.logoColor))),
        loadBikeModel(BIKE_MODEL_URL),
      ]);
      if (disposed) {
        renderer.dispose();
        return;
      }

      const scene = new THREE.Scene();
      const raceBackground = new THREE.Color(BG);
      scene.background = raceBackground;
      scene.fog = new THREE.Fog(BG, 40, 260);
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environmentIntensity = 0.2;
      scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x080808, 0.35));
      const key = new THREE.DirectionalLight(0xcfe0ff, 1.0);
      key.position.set(20, 30, 25);
      const rim = new THREE.DirectionalLight(0xc2ff47, 1.2);
      rim.position.set(-20, 12, -25);
      scene.add(key, rim);

      const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 400);
      let aspect = 2;

      // World.
      const track = buildTrack();
      scene.add(track.strip, track.gantry, track.finish, track.glow);
      const rigs = riders.map((spec, i) => {
        const rig = buildBike(spec, logos[i], model, false, logoTextures[i]);
        scene.add(rig.root);
        return rig;
      });
      // Wet asphalt: an upside-down copy of each bike shows through the slightly transparent road.
      const mirrors = (model ? [] : riders).map((spec, i) => {
        const rig = buildBike(spec, logos[i], model, true);
        rig.root.scale.y = -1;
        scene.add(rig.root);
        return rig;
      });

      // The Levier mark: revealed alone on the page background once the winner wipes the lens.
      const mark = buildLevierMark(9);
      mark.visible = false;
      const markLight = new THREE.PointLight(0xdfffb0, 0, 30, 1.6);
      scene.add(mark, markLight);
      const markMats = mark.children.map((m) => (m as THREE.Mesh).material as THREE.MeshPhysicalMaterial);
      const markBase = markMats.map((m) => m.emissiveIntensity);
      const markBottom = new THREE.Vector3();
      const world = [track.strip, track.gantry, track.finish, track.glow];

      const streaks = buildStreaks();
      const sparks = buildSparks();
      const smoke = buildSmoke();
      scene.add(streaks.lines, sparks.points, smoke.points);

      // Name tags follow each bike.
      const tags = riders.map((r) => {
        const el = document.createElement('span');
        el.className = 'hero-race-tag';
        el.textContent = r.ticker;
        tagLayer.appendChild(el);
        return { el, on: false };
      });

      // Post-processing (desktop only): bloom, then the film look (motion blur, aberration, vignette, grain).
      let composer: EffectComposer | null = null;
      const film = buildFilmPass();
      if (!mobile) {
        const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(1, 1) });
        composer = new EffectComposer(renderer, target);
        composer.addPass(new RenderPass(scene, camera));
        composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 256), 0.4, 0.55, 1.0));
        composer.addPass(new OutputPass());
        composer.addPass(film.pass);
      }

      const resize = () => {
        const w = wrap.clientWidth;
        const h = wrap.clientHeight;
        if (!w || !h) return;
        aspect = w / h;
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(w, h, false);
        composer?.setPixelRatio(pixelRatio);
        composer?.setSize(w, h);
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
      };

      // Loop --------------------------------------------------------------
      const states = newBikeStates();
      const pose = newCameraPose();
      const order = Array.from({ length: RIDERS }, (_, i) => i);
      let orderKey = '';
      const anchor = new THREE.Vector3();
      const look = new THREE.Vector3();
      let t = 0;
      let loop = 0;
      let last = 0;
      let raf = 0;
      let sparkClock = 0;
      let frames = 0;
      let slow = 0;
      let mirrorsOn = true;
      let readyFired = false;
      let logoShown = false;
      let smokeClock = 0;

      const draw = (dt: number, now: number) => {
        // dt is film time: it slows down through the photo finish.
        bikeStates(t, loop, states);
        const speed = leaderSpeed(t);
        let cx = 0;
        let n = 0;
        for (let i = 0; i < RIDERS; i++) {
          const s = states[i];
          for (const rig of mirrors[i] ? [rigs[i], mirrors[i]] : [rigs[i]]) {
            rig.root.visible = s.visible && (rig === rigs[i] || mirrorsOn);
            rig.root.position.set(s.x, 0, s.z);
            rig.root.rotation.y = s.yaw;
            rig.lean.rotation.x = s.roll;
            rig.wheels.forEach((w) => {
              // Real wheel speed would strobe (or spin backwards) at screen frame rates, so the visible spin is
              // capped: fast enough to read as rolling, and it still winds down in slow motion.
              w.rotation.z -= Math.min(speed / WHEEL_RADIUS, 26) * dt;
            });
          }
          if (s.visible) {
            cx += s.x;
            n++;
          }
        }
        cx = n ? cx / n : FINISH_X;
        const seconds = now / 1000;
        const boosts = states.map((_, i) => boostAt(t, loop, i));
        boosts.forEach((v, i) => rigs[i].setBoost(v, seconds));

        // Camera: shot + shake + whip-pan + dutch tilt, with the field of view widened on narrow screens.
        const pair = rivals(loop);
        const a = states[pair.winner];
        const b = states[pair.rival];
        cameraAt(t, { ax: a.x, az: a.z, bx: b.x, bz: b.z, zc: laneCenter(loop) }, pose);
        if (process.env.NODE_ENV !== 'production') {
          // Dev only: pin the camera for inspection, e.g. window.__heroRaceCam = { px, py, pz, tx, ty, tz, fov }
          const cam = (window as unknown as { __heroRaceCam?: Partial<typeof pose> }).__heroRaceCam;
          if (cam) Object.assign(pose, cam, { shake: 0, dutch: 0, blur: 0 });
        }
        // Boost on the featured pair punches the lens wider and adds zoom blur.
        const pairBoost = Math.max(boosts[pair.winner], boosts[pair.rival]);
        pose.fov *= 1 + 0.12 * pairBoost;
        pose.blur = Math.max(pose.blur, 0.8 * pairBoost);
        if (pairBoost > 0.3) pose.blurMode = 1;
        // Deep slow motion tightens the lens a touch: the moment feels closer.
        const slow = logoShown ? 0 : slowAt(t);
        pose.fov *= 1 - 0.1 * slow;
        const sh = pose.shake * (1 - 0.6 * slow) + 0.1 * impactAt(t) + 0.02 * pairBoost;
        camera.position.set(
          pose.px + sh * (Math.sin(now * 0.021) + Math.sin(now * 0.037 + 1.3)),
          pose.py + sh * (Math.sin(now * 0.029 + 0.4) + Math.sin(now * 0.043)) * 0.6,
          pose.pz + sh * Math.sin(now * 0.017 + 2.1),
        );
        look.set(pose.tx - pose.px, pose.ty - pose.py, pose.tz - pose.pz);
        camera.lookAt(camera.position.x + look.x, camera.position.y + look.y, camera.position.z + look.z);
        if (pose.dutch) camera.rotateZ(pose.dutch);
        const half = Math.tan(THREE.MathUtils.degToRad(pose.fov) / 2) * Math.min(2.2, Math.max(1, 1.9 / aspect));
        const fov = THREE.MathUtils.radToDeg(Math.atan(half)) * 2;
        if (Math.abs(fov - camera.fov) > 0.01) {
          camera.fov = fov;
          camera.updateProjectionMatrix();
        }

        // After the wipe the world is gone: only the logo on the page background.
        const logo = t >= WIPE_T;
        world.forEach((o) => {
          o.visible = !logo;
        });
        const pairSide = wipeSide({ ax: a.x, az: a.z, bx: b.x, bz: b.z, zc: laneCenter(loop) });
        for (let i = 0; i < RIDERS; i++) {
          // Only the winner stays for a moment, clearing the lens to reveal the logo.
          if (logo && (i !== pair.winner || t > WIPE_T + 0.6)) rigs[i].root.visible = false;
        }
        if (logo !== logoShown) {
          logoShown = logo;
          callbacks.current.onLogo(logo);
          if (logo) smoke.clear();
          scene.background = logo ? null : raceBackground;
          renderer.setClearColor(BG, logo ? 0 : 1);
        }

        // World that follows the camera.
        track.follow(camera.position.x);
        const raceOn = logo ? 0 : smooth(seg(t, 3, 4)) * (1 - smooth(seg(t, 13, 13.8)));
        streaks.update(camera.position.x, speed, raceOn);
        track.glow.visible = !logo && raceOn > 0.01;
        track.glow.position.x = cx + 10;
        track.animateFlag(now / 1000);
        const lit = startLightsOn(t);
        track.lights.forEach((l, i) => {
          (l.material as THREE.MeshBasicMaterial).color.setRGB(i < lit ? 6 : 0.16, i < lit ? 0.2 : 0.04, i < lit ? 0.2 : 0.04);
        });

        // Sparks off the knee sliders of leaning bikes.
        sparkClock += dt;
        while (raceOn > 0.5 && sparkClock > 0.07) {
          sparkClock -= 0.07;
          const i = Math.floor(Math.random() * RIDERS);
          const s = states[i];
          if (Math.abs(s.roll) > 0.12) {
            sparks.emit(s.x + 0.1, 0.12, s.z + Math.sign(s.roll) * 0.42, speed);
          }
        }
        if (raceOn <= 0.5) sparkClock = 0;
        sparks.points.visible = !logo;
        sparks.update(dt);

        // Tyre smoke: heavy at the launch, puffs on every overtake.
        smokeClock += dt;
        const launch = seg(t, PHASE.grid - 0.1, PHASE.grid + 1.6);
        const burst = launch > 0 && launch < 1 ? 1 - launch : 0.35 * impactAt(t);
        while (!logo && burst > 0.02 && smokeClock > 0.02) {
          smokeClock -= 0.02;
          const i = Math.floor(Math.random() * RIDERS);
          const s = states[i];
          smoke.emit(s.x - 0.75, 0.2, s.z + (Math.random() - 0.5) * 0.2, burst);
        }
        if (burst <= 0.02) smokeClock = 0;
        smoke.points.visible = !logo;
        smoke.update(dt);

        // The logo stands square to the frozen lens on a carbon backdrop. Pieces light one by one, a light sweeps
        // across, then the caption fades up underneath.
        mark.visible = logo;
        const u = t - WIPE_T;
        carbon.style.opacity = logo ? smooth(seg(u, 0.15, 1.3)).toFixed(3) : '0';
        if (logo) {
          const lensZ = laneCenter(loop) + pairSide * (0.36 + WIPE_OFFSET);
          mark.position.set(WIPE_X, 0.85, lensZ - pairSide * LOGO_DISTANCE);
          mark.rotation.y = (pairSide > 0 ? 0 : Math.PI) + Math.sin(u * 0.5) * 0.05;
          const settle = 1 + 0.06 * (1 - smooth(seg(u, 0.4, 2.2)));
          mark.scale.setScalar(settle);
          markMats.forEach((m, idx) => {
            const on = smooth(seg(u, REVEAL[idx], REVEAL[idx] + 0.3));
            const kick = u > REVEAL[idx] ? Math.exp(-(u - REVEAL[idx]) * 3.5) : 0;
            m.color.setScalar(0.05 + 0.95 * on);
            m.emissiveIntensity = markBase[idx] * (0.2 + 2.2 * on + 9 * kick);
          });
          const sweep = seg(u, REVEAL[2] + 0.3, REVEAL[2] + 2.2);
          markLight.position.set(WIPE_X - 6 + sweep * 12, 2.8, mark.position.z + pairSide * 3);
          markLight.intensity = sweep > 0 && sweep < 1 ? 55 * Math.sin(sweep * Math.PI) : 0;
          // Caption sits under the logo wherever the logo lands on screen.
          markBottom.set(WIPE_X, mark.position.y - 2.6, mark.position.z).project(camera);
          const cy = (-markBottom.y * 0.5 + 0.5) * wrap.clientHeight;
          const show = smooth(seg(u, CAPTION_AT, CAPTION_AT + 0.9));
          caption.style.opacity = show.toFixed(3);
          caption.style.transform = `translate(-50%, ${(cy + (1 - show) * 10).toFixed(1)}px)`;
        } else {
          markLight.intensity = 0;
          caption.style.opacity = '0';
        }

        // Order and tags.
        orderAt(t, loop, order);
        const key = order.join('');
        if (key !== orderKey) {
          orderKey = key;
          callbacks.current.onOrder(order.slice());
          order.forEach((bike, place) => {
            tags[bike].el.textContent = `P${place + 1} ${riders[bike].ticker}`;
          });
        }
        const w = wrap.clientWidth;
        const h = wrap.clientHeight;
        const showTags = t > 0.8 && t < 13.2 && !logo;
        for (let i = 0; i < RIDERS; i++) {
          const tag = tags[i];
          let visible = false;
          if (showTags && states[i].visible) {
            rigs[i].tagAnchor.getWorldPosition(anchor);
            anchor.project(camera);
            const dist = camera.position.distanceTo(rigs[i].root.position);
            visible = anchor.z < 1 && dist > 3 && dist < 60 && Math.abs(anchor.x) < 1.05 && Math.abs(anchor.y) < 1.05;
            if (visible) {
              tag.el.style.transform = `translate(${((anchor.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-anchor.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%, -100%)`;
            }
          }
          if (visible !== tag.on) {
            tag.on = visible;
            tag.el.classList.toggle('is-on', visible);
          }
        }
        flash.style.opacity = String(fadeAt(t));
        // Letterbox bars slide in at lights out and away as the logo appears.
        const bars = smooth(seg(t, PHASE.grid - 0.3, PHASE.grid + 0.3)) * (1 - smooth(seg(t, WIPE_T + 0.4, WIPE_T + 1.4)));
        barTop.style.transform = `translateY(${((bars - 1) * 100).toFixed(2)}%)`;
        barBottom.style.transform = `translateY(${((1 - bars) * 100).toFixed(2)}%)`;

        // Sound cues follow the film clock; beds slow down with the slow motion.
        soundRef.current.current?.update(t, timeScale(t));

        if (composer) {
          // The render pass draws into renderTarget2; its depth drives the focus-aware blur.
          const focus = Math.hypot(pose.tx - camera.position.x, pose.ty - camera.position.y, pose.tz - camera.position.z);
          const clean = smooth(seg(t, WIPE_T + 0.1, WIPE_T + 0.7));
          film.set(now / 1000, pose.blur, pose.blurMode, w, h, focus, composer.renderTarget2.depthTexture, clean, slow);
          composer.render();
        } else {
          renderer.render(scene, camera);
        }

        if (!readyFired) {
          readyFired = true;
          callbacks.current.onReady();
        }
      };

      const frame = (now: number) => {
        const real = Math.min(0.05, (now - last) / 1000);
        last = now;
        const dt = real * timeScale(t);
        t += dt;
        if (t >= LOOP) {
          t -= LOOP;
          loop++;
        }
        if (process.env.NODE_ENV !== 'production') {
          // Dev only: pin the film to a time for screenshots, e.g. window.__heroRaceSeek = 14.5
          const seek = (window as unknown as { __heroRaceSeek?: number }).__heroRaceSeek;
          if (typeof seek === 'number') {
            t = seek % LOOP;
            loop = Math.floor(seek / LOOP);
          }
        }
        draw(dt, now);

        // Adaptive quality: if frames are slow for a while, drop reflections, bloom and pixel ratio.
        frames++;
        if (real > 0.03) slow++;
        if (frames === 90) {
          if (slow > 45 && (composer || pixelRatio > 1 || mirrorsOn)) {
            composer = null;
            pixelRatio = 1;
            mirrorsOn = false;
            resize();
          }
          frames = 0;
          slow = 0;
        }
        raf = requestAnimationFrame(frame);
      };
      const stop = () => {
        cancelAnimationFrame(raf);
        raf = 0;
      };
      const start = () => {
        if (raf || !activeRef.current || document.hidden) return;
        last = performance.now();
        raf = requestAnimationFrame(frame);
      };

      controls.current = {
        setActive: (next) => {
          if (next) start();
          else stop();
        },
      };

      const onVisibility = () => (document.hidden ? stop() : start());
      const onLost = (event: Event) => {
        event.preventDefault();
        stop();
        callbacks.current.onFail();
      };
      document.addEventListener('visibilitychange', onVisibility);
      canvas.addEventListener('webglcontextlost', onLost);
      const observer = new ResizeObserver(() => {
        resize();
        if (!raf) draw(0, performance.now());
      });
      observer.observe(wrap);
      resize();
      draw(0, performance.now());
      start();

      teardown = () => {
        stop();
        observer.disconnect();
        document.removeEventListener('visibilitychange', onVisibility);
        canvas.removeEventListener('webglcontextlost', onLost);
        controls.current = null;
        tags.forEach((tag) => tag.el.remove());
        scene.traverse((obj) => {
          const item = obj as THREE.Mesh;
          item.geometry?.dispose();
          const material = item.material as THREE.Material | THREE.Material[] | undefined;
          if (!material) return;
          (Array.isArray(material) ? material : [material]).forEach((m) => {
            Object.values(m).forEach((value) => {
              if (value && (value as THREE.Texture).isTexture) (value as THREE.Texture).dispose();
            });
            m.dispose();
          });
        });
        pmrem.dispose();
        composer?.dispose();
        renderer.dispose();
      };
    };

    void init();
    return () => {
      disposed = true;
      teardown();
    };
    // The scene is built once; riders never change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    controls.current?.setActive(active);
  }, [active]);

  return (
    <div className="hero-race-canvas" ref={wrapRef}>
      <div className="hero-race-carbon" ref={carbonRef} aria-hidden="true" />
      <canvas ref={canvasRef} aria-hidden="true" />
      <div className="hero-race-tags" ref={tagsRef} aria-hidden="true" />
      <div className="hero-race-bar is-top" ref={barTopRef} style={{ height: `${BAR * 100}%` }} aria-hidden="true" />
      <div className="hero-race-bar is-bottom" ref={barBottomRef} style={{ height: `${BAR * 100}%` }} aria-hidden="true" />
      <p className="hero-race-caption" ref={captionRef}>
        Leverage safely for tokenized assets on Robinhood Chain
      </p>
      <div className="hero-race-flash" ref={flashRef} aria-hidden="true" />
    </div>
  );
}
