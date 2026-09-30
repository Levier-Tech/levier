'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface HowItWorksSceneProps {
  step: number;
  active: boolean;
  onFail: () => void;
}

interface SceneControls {
  setStep: (step: number) => void;
  setActive: (active: boolean) => void;
}

const LIME = 0xc2ff47;
const DANGER = 0xd6153c;
const PANEL = 0x111111;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeIn = (t: number) => t * t * t;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
// Progress of a segment that starts at `start` seconds and lasts `duration` seconds.
const seg = (t: number, start: number, duration: number) => clamp01((t - start) / duration);

// Layout (world units). Floor is y = 0. The vault is the origin of everything.
const DISC_Y = [0.19, 0.59, 0.99];
const DISC_TOP = 1.16;
const BLOCK_H = 0.6;
const BLOCK_BOTTOM = [DISC_TOP + 0.03, DISC_TOP + 0.03 + 0.65];
const PLATE = new THREE.Vector3(5.8, 0, 0.2);
const COIN_REST_Y = [0.19, 0.35, 0.51];
const GUARD_Y = 1.0;
const SLAB_PEAK = 0.86;
const SLAB_FLOOR = 0.03;

interface Part {
  mat: THREE.Material;
  base: number;
}
interface Entity {
  group: THREE.Group;
  parts: Part[];
}

// Wraps a group so its whole opacity can be driven with one number.
function entity(group: THREE.Group): Entity {
  const parts: Part[] = [];
  group.traverse((obj) => {
    const material = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!material) return;
    (Array.isArray(material) ? material : [material]).forEach((mat) => {
      mat.transparent = true;
      parts.push({ mat, base: mat.opacity });
    });
  });
  return { group, parts };
}

function alpha(e: Entity, a: number) {
  e.group.visible = a > 0.001;
  e.parts.forEach((p) => {
    p.mat.opacity = p.base * a;
  });
}

const edges = (geometry: THREE.BufferGeometry, color: number, opacity: number, angle = 30) =>
  new THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>(
    new THREE.EdgesGeometry(geometry, angle),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
  );

interface Tag {
  el: HTMLSpanElement;
  pos: THREE.Vector3;
  show: boolean;
  on: boolean;
  text: string;
}

export default function HowItWorksScene({ step, active, onFail }: HowItWorksSceneProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tagsRef = useRef<HTMLDivElement>(null);
  const controls = useRef<SceneControls | null>(null);
  const failRef = useRef(onFail);
  failRef.current = onFail;

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const tagLayer = tagsRef.current;
    if (!wrap || !canvas || !tagLayer) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      failRef.current();
      return;
    }
    const maxDpr = window.innerWidth <= 760 ? 1.5 : 2;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(PANEL, 16, 34);
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(4, 9, 7);
    scene.add(sun);

    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);
    const target = new THREE.Vector3(1.8, 2.0, 0);
    let aspect = 1;

    // Floor grid gives the scene depth without adding objects to read.
    const grid = new THREE.GridHelper(28, 28, 0x2a2d22, 0x1b1d16);
    (grid.material as THREE.Material).transparent = true;
    scene.add(grid);

    // Vault: open-top glass box.
    const vaultGeo = new THREE.BoxGeometry(4, 2, 4);
    const vaultGroup = new THREE.Group();
    const glass = new THREE.MeshStandardMaterial({ color: LIME, transparent: true, opacity: 0.07, depthWrite: false });
    const noTop = new THREE.MeshBasicMaterial({ visible: false });
    const vaultBody = new THREE.Mesh(vaultGeo, [glass, glass, noTop, glass, glass, glass]);
    vaultBody.position.y = 1;
    const vaultEdges = edges(vaultGeo, LIME, 1);
    vaultEdges.position.y = 1;
    vaultGroup.add(vaultBody, vaultEdges);
    scene.add(vaultGroup);
    const vault = entity(vaultGroup);

    // Share discs (collateral).
    const discGeo = new THREE.CylinderGeometry(1.25, 1.25, 0.34, 48);
    const discs = DISC_Y.map((y) => {
      const g = new THREE.Group();
      g.add(
        new THREE.Mesh(
          discGeo,
          new THREE.MeshStandardMaterial({ color: 0x1c2213, roughness: 0.55, metalness: 0.35, emissive: LIME, emissiveIntensity: 0.06 }),
        ),
        edges(discGeo, LIME, 0.95),
      );
      g.position.y = y;
      scene.add(g);
      return entity(g);
    });

    // Position blocks: the tower grows out of the vault as exposure rises.
    const blockGeo = new THREE.BoxGeometry(2.5, BLOCK_H, 2.5);
    const blocks = BLOCK_BOTTOM.map(() => {
      const g = new THREE.Group();
      g.add(
        new THREE.Mesh(
          blockGeo,
          new THREE.MeshStandardMaterial({ color: LIME, emissive: LIME, emissiveIntensity: 0.35, transparent: true, opacity: 0.34 }),
        ),
        edges(blockGeo, LIME, 1),
      );
      scene.add(g);
      return entity(g);
    });

    // Wallet plate and USDG coins.
    const plateGeo = new THREE.BoxGeometry(2.8, 0.12, 2.2);
    const plateGroup = new THREE.Group();
    plateGroup.add(
      new THREE.Mesh(plateGeo, new THREE.MeshStandardMaterial({ color: 0x14170f, roughness: 0.6 })),
      edges(plateGeo, LIME, 0.5),
    );
    plateGroup.position.set(PLATE.x, 0.06, PLATE.z);
    scene.add(plateGroup);
    const plate = entity(plateGroup);

    const coinGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.14, 36);
    const coins = COIN_REST_Y.map(() => {
      const g = new THREE.Group();
      g.add(
        new THREE.Mesh(
          coinGeo,
          new THREE.MeshStandardMaterial({ color: LIME, emissive: LIME, emissiveIntensity: 0.4, roughness: 0.4 }),
        ),
      );
      scene.add(g);
      return entity(g);
    });

    // Long / Short arrow.
    const arrowGroup = new THREE.Group();
    const arrowMat = new THREE.MeshBasicMaterial({ color: LIME });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.9, 16), arrowMat);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.55, 20), arrowMat);
    head.position.y = 0.72;
    arrowGroup.add(shaft, head);
    scene.add(arrowGroup);
    const arrow = entity(arrowGroup);

    // Liquidation slab and guard ring.
    const slabGeo = new THREE.BoxGeometry(6, 0.06, 6);
    const slabGroup = new THREE.Group();
    slabGroup.add(
      new THREE.Mesh(
        slabGeo,
        new THREE.MeshStandardMaterial({ color: DANGER, emissive: DANGER, emissiveIntensity: 0.7, transparent: true, opacity: 0.4, depthWrite: false }),
      ),
      edges(slabGeo, DANGER, 0.9),
    );
    scene.add(slabGroup);
    const slab = entity(slabGroup);

    const ringGroup = new THREE.Group();
    const ringMesh = new THREE.Mesh(
      new THREE.TorusGeometry(3.6, 0.03, 8, 120),
      new THREE.MeshBasicMaterial({ color: LIME }),
    );
    ringMesh.rotation.x = Math.PI / 2;
    ringGroup.add(ringMesh);
    ringGroup.position.y = GUARD_Y;
    scene.add(ringGroup);
    const ring = entity(ringGroup);

    // HTML tags follow world anchors so text stays crisp.
    const makeTag = (text: string, variant = ''): Tag => {
      const el = document.createElement('span');
      el.className = `hiw-tagpill ${variant}`.trim();
      el.textContent = text;
      tagLayer.appendChild(el);
      return { el, pos: new THREE.Vector3(), show: false, on: false, text };
    };
    const tagTsla = makeTag('TSLA');
    const tagUsdg = makeTag('USDG', 'is-lime');
    const tagMult = makeTag('1.25×', 'is-lime');
    const tagSide = makeTag('Long');
    const tagLiq = makeTag('Liquidation', 'is-danger');
    const tagGuard = makeTag('Guard', 'is-lime');
    const tags = [tagTsla, tagUsdg, tagMult, tagSide, tagLiq, tagGuard];
    tagTsla.pos.set(-2.7, 1.0, 0);
    tagUsdg.pos.set(PLATE.x, 1.3, PLATE.z);
    tagMult.pos.set(-1.9, 2.7, 0);
    tagSide.pos.set(1.15, 3.7, 0);
    tagGuard.pos.set(3.9, GUARD_Y, 0);

    const setTagText = (tag: Tag, text: string) => {
      if (tag.text === text) return;
      tag.text = text;
      tag.el.textContent = text;
    };

    // Poses ----------------------------------------------------------------
    const restDiscs = () =>
      discs.forEach((d, i) => {
        d.group.position.y = DISC_Y[i];
        alpha(d, 1);
      });
    const restBlocks = () =>
      blocks.forEach((b, k) => {
        b.group.position.set(0, BLOCK_BOTTOM[k] + BLOCK_H / 2, 0);
        b.group.scale.set(1, 1, 1);
        b.group.rotation.z = 0;
        alpha(b, 1);
      });
    const restCoins = () =>
      coins.forEach((c, j) => {
        c.group.position.set(PLATE.x + (j - 1) * 0.05, COIN_REST_Y[j] + 0.06, PLATE.z);
        c.group.rotation.set(0, 0, 0);
        alpha(c, 1);
      });

    const pose = (stepIndex: number, t: number) => {
      // Start from everything hidden, then reveal what this step needs.
      discs.forEach((d) => alpha(d, 0));
      blocks.forEach((b) => alpha(b, 0));
      coins.forEach((c) => alpha(c, 0));
      alpha(arrow, 0);
      alpha(slab, 0);
      alpha(ring, 0);
      alpha(plate, 0.6);
      tags.forEach((tag) => {
        tag.show = false;
      });
      arrowGroup.rotation.z = 0;
      ringGroup.scale.set(1, 1, 1);

      if (stepIndex === 0) {
        // Deposit: shares drop into the vault one by one.
        alpha(vault, 1);
        vaultEdges.material.opacity = lerp(0.35, 1, seg(t, 0.3, 0.6));
        discs.forEach((d, i) => {
          const p = seg(t, 0.35 + i * 0.55, 0.7);
          if (p <= 0) return;
          d.group.position.y = lerp(6.5, DISC_Y[i], easeOut(p));
          alpha(d, clamp01(p * 4));
        });
        tagTsla.show = t > 1.0;
        return;
      }

      alpha(vault, 1);
      vaultEdges.material.opacity = 1;
      restDiscs();
      tagTsla.show = true;

      if (stepIndex === 1) {
        // Borrow: USDG leaves the vault for the wallet. Trade: the tower grows, then Long and Short.
        coins.forEach((c, j) => {
          const p = seg(t, 0.3 + j * 0.4, 1.1);
          if (p <= 0) return;
          const e = easeInOut(p);
          const rest = COIN_REST_Y[j] + 0.06;
          c.group.position.set(
            lerp(0.3, PLATE.x, e),
            lerp(1.6, rest, e) + Math.sin(Math.PI * p) * 1.5,
            lerp(0.3, PLATE.z, e),
          );
          c.group.rotation.y = p * Math.PI * 2;
          alpha(c, clamp01(p * 6));
        });
        tagUsdg.show = t > 1.6;

        blocks.forEach((b, k) => {
          const p = seg(t, 2.0 + k * 0.5, 0.5);
          if (p <= 0) return;
          const e = easeOut(p);
          b.group.scale.y = Math.max(e, 0.001);
          b.group.position.y = BLOCK_BOTTOM[k] + (BLOCK_H * e) / 2;
          alpha(b, 1);
        });
        tagMult.show = t > 3.0;

        const arrowIn = seg(t, 3.0, 0.3);
        if (arrowIn > 0) {
          alpha(arrow, arrowIn);
          arrowGroup.position.set(0, 3.7 + Math.sin(t * 3) * 0.05, 0);
          arrowGroup.rotation.z = easeInOut(seg(t, 3.9, 0.5)) * Math.PI;
          tagSide.show = true;
          setTagText(tagSide, t < 4.15 ? 'Long' : 'Short');
        }
        return;
      }

      // Auto-Protect: the danger line rises, the guard fires, the top of the tower is trimmed.
      restCoins();
      tagUsdg.show = true;
      const flash = seg(t, 2.25, 0.15) - seg(t, 2.4, 0.5);
      const ringAlpha = seg(t, 0.3, 0.4) * (0.55 + 0.45 * clamp01(flash));
      alpha(ring, ringAlpha);
      ringGroup.scale.set(1 + 0.06 * clamp01(flash), 1, 1 + 0.06 * clamp01(flash));
      tagGuard.show = t > 0.5;

      const rise = t < 2.9 ? lerp(SLAB_FLOOR, SLAB_PEAK, easeInOut(seg(t, 0.5, 1.9))) : lerp(SLAB_PEAK, SLAB_FLOOR, easeInOut(seg(t, 2.9, 1.3)));
      slabGroup.position.y = rise;
      alpha(slab, seg(t, 0, 0.4) * (1 - seg(t, 4.4, 0.5)));
      tagLiq.pos.set(3.1, rise + 0.15, 3.0);
      tagLiq.show = t > 0.6 && t < 4.6;

      blocks.forEach((b, k) => {
        // Top block goes first.
        const q = seg(t, 2.5 + (1 - k) * 0.18, 0.7);
        const e = easeIn(q);
        b.group.position.set(-5 * e, BLOCK_BOTTOM[k] + BLOCK_H / 2 - 1.2 * e, 0);
        b.group.rotation.z = -1.2 * e;
        alpha(b, 1 - e);
      });
      tagMult.pos.set(-1.9, 2.7, 0);
      tagMult.show = t < 2.6;
    };

    // Camera fits the whole layout for any aspect ratio, with a slow drift.
    const updateCamera = (seconds: number) => {
      const narrow = aspect < 1;
      const halfH = 3.5;
      const halfW = narrow ? 5.4 : 6.2;
      target.x = narrow ? 2.3 : 1.8;
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const dist = Math.max(halfH / tanHalf, halfW / (tanHalf * aspect));
      const az = Math.sin(seconds * 0.3) * 0.09;
      const elev = 0.3;
      camera.position.set(
        target.x + dist * Math.sin(az) * Math.cos(elev),
        target.y + dist * Math.sin(elev),
        target.z + dist * Math.cos(az) * Math.cos(elev),
      );
      camera.lookAt(target);
    };

    const width = () => wrap.clientWidth;
    const height = () => wrap.clientHeight;
    const projected = new THREE.Vector3();
    const updateTags = () => {
      const w = width();
      const h = height();
      tags.forEach((tag) => {
        if (tag.show !== tag.on) {
          tag.on = tag.show;
          tag.el.classList.toggle('is-on', tag.show);
        }
        if (!tag.show) return;
        projected.copy(tag.pos).project(camera);
        const x = (projected.x * 0.5 + 0.5) * w;
        const y = (-projected.y * 0.5 + 0.5) * h;
        tag.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
      });
    };

    const resize = () => {
      const w = width();
      const h = height();
      if (!w || !h) return;
      aspect = w / h;
      renderer.setSize(w, h, false);
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    };

    // Loop --------------------------------------------------------------------
    let stepIndex = 0;
    let localT = 0;
    let last = 0;
    let raf = 0;
    let wantActive = false;

    const draw = (now: number) => {
      pose(stepIndex, localT);
      updateCamera(now / 1000);
      renderer.render(scene, camera);
      updateTags();
    };
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      localT += dt;
      draw(now);
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const start = () => {
      if (raf || !wantActive || document.hidden) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    controls.current = {
      setStep: (next) => {
        stepIndex = next;
        localT = 0;
        if (!raf) draw(performance.now());
      },
      setActive: (next) => {
        wantActive = next;
        if (next) start();
        else stop();
      },
    };

    const onVisibility = () => (document.hidden ? stop() : start());
    const onLost = (event: Event) => {
      event.preventDefault();
      stop();
      failRef.current();
    };
    document.addEventListener('visibilitychange', onVisibility);
    canvas.addEventListener('webglcontextlost', onLost);
    const observer = new ResizeObserver(() => {
      resize();
      if (!raf) draw(performance.now());
    });
    observer.observe(wrap);
    resize();

    return () => {
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
        if (material) (Array.isArray(material) ? material : [material]).forEach((m) => m.dispose());
      });
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
    controls.current?.setStep(step);
  }, [step]);

  useEffect(() => {
    controls.current?.setActive(active);
  }, [active]);

  return (
    <div className="hiw-canvas" ref={wrapRef}>
      <canvas ref={canvasRef} aria-hidden="true" />
      <div className="hiw-tags" ref={tagsRef} aria-hidden="true" />
    </div>
  );
}
