import * as THREE from 'three';

import { FINISH_X, GANTRY_X } from './timeline';

export const TRACK_HALF = 3.2; // half width of the asphalt in meters
const PERIOD = 120; // all repeating patterns divide this, so the strip can jump by PERIOD unseen
const LIME = 0xc2ff47;

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function asphaltTexture() {
  return canvasTexture(512, 512, (ctx) => {
    ctx.fillStyle = '#1b1c1d';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 9000; i++) {
      const g = 20 + Math.random() * 40;
      ctx.fillStyle = `rgba(${g},${g},${g},${0.25 + Math.random() * 0.3})`;
      ctx.fillRect(Math.random() * 512, Math.random() * 512, 1.5, 1.5);
    }
    // Rubbered-in racing line.
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.35)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);
  });
}

function stripeTexture(a: string, b: string) {
  return canvasTexture(64, 16, (ctx) => {
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, 32, 16);
    ctx.fillStyle = b;
    ctx.fillRect(32, 0, 32, 16);
  });
}

function checkerTexture() {
  return canvasTexture(128, 128, (ctx) => {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#f4f4f0' : '#0a0a0a';
        ctx.fillRect(x * 16, y * 16, 16, 16);
      }
    }
  });
}

export interface Track {
  /** Parts that repeat; call follow() every frame with the camera x. */
  strip: THREE.Group;
  follow: (x: number) => void;
  gantry: THREE.Group;
  lights: THREE.Mesh[];
  finish: THREE.Group;
  flag: THREE.Mesh;
  animateFlag: (t: number) => void;
  glow: THREE.Mesh;
}

export function buildTrack(): Track {
  const strip = new THREE.Group();
  const len = 560;

  const asphalt = asphaltTexture();
  asphalt.repeat.set(len / 8, 1);
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(len, TRACK_HALF * 2),
    new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.3, metalness: 0.35, transparent: true, opacity: 0.8 }),
  );
  road.rotation.x = -Math.PI / 2;
  strip.add(road);

  const verge = new THREE.Mesh(new THREE.PlaneGeometry(len, 90), new THREE.MeshStandardMaterial({ color: 0x0b0d0a, roughness: 1 }));
  verge.rotation.x = -Math.PI / 2;
  verge.position.y = -0.02;
  strip.add(verge);

  // White edge lines and lime/black kerbs.
  const kerb = stripeTexture('#c2ff47', '#0d0f0a');
  kerb.repeat.set(len / 1.6, 1);
  for (const side of [1, -1]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.14), new THREE.MeshBasicMaterial({ color: 0xdddddd }));
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.012, (TRACK_HALF - 0.2) * side);
    strip.add(line);
    const k = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.7), new THREE.MeshStandardMaterial({ map: kerb, roughness: 0.6 }));
    k.rotation.x = -Math.PI / 2;
    k.position.set(0, 0.014, (TRACK_HALF + 0.4) * side);
    strip.add(k);
  }

  // Barrier with a lit lime strip on top: the main motion cue at night.
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x121413, roughness: 0.7 });
  const lit = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.5, 0.95, 0.16), toneMapped: false });
  for (const side of [1, -1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(len, 0.5, 0.25), wallMat);
    wall.position.set(0, 0.25, (TRACK_HALF + 4.6) * side);
    strip.add(wall);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.07), lit);
    bar.position.set(0, 0.1, (TRACK_HALF + 4.46) * side);
    strip.add(bar);
  }

  // Ad boards every 12 m, and floodlight towers every 60 m.
  const boardCount = Math.floor(len / 12);
  const boards = new THREE.InstancedMesh(
    new THREE.BoxGeometry(5, 0.7, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x1b1f17, emissive: new THREE.Color(LIME), emissiveIntensity: 0.14, roughness: 0.6 }),
    boardCount * 2,
  );
  const m = new THREE.Matrix4();
  for (let i = 0; i < boardCount; i++) {
    for (const [j, side] of [1, -1].entries()) {
      m.makeTranslation(-len / 2 + 6 + i * 12, 0.35, (TRACK_HALF + 4.42) * side);
      boards.setMatrixAt(i * 2 + j, m);
    }
  }
  strip.add(boards);

  const towerCount = Math.floor(len / 60);
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.18, 16, 8), new THREE.MeshStandardMaterial({ color: 0x1a1c1b }), towerCount * 2);
  const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.5, 3.2), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(4, 4, 3.6), toneMapped: false }), towerCount * 2);
  for (let i = 0; i < towerCount; i++) {
    for (const [j, side] of [1, -1].entries()) {
      const x = -len / 2 + 30 + i * 60;
      m.makeTranslation(x, 8, (TRACK_HALF + 8) * side);
      poles.setMatrixAt(i * 2 + j, m);
      m.makeTranslation(x, 16.2, (TRACK_HALF + 8) * side);
      lamps.setMatrixAt(i * 2 + j, m);
    }
  }
  strip.add(poles, lamps);

  // Volumetric-looking light shafts under each floodlight.
  const shafts = new THREE.InstancedMesh(
    new THREE.ConeGeometry(5, 16, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.8, 0.9, 1), transparent: true, opacity: 0.028, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
    towerCount * 2,
  );
  for (let i = 0; i < towerCount; i++) {
    for (const [j, side] of [1, -1].entries()) {
      m.makeTranslation(-len / 2 + 30 + i * 60, 8, (TRACK_HALF + 5) * side);
      shafts.setMatrixAt(i * 2 + j, m);
    }
  }
  strip.add(shafts);

  const follow = (x: number) => {
    strip.position.x = Math.round(x / PERIOD) * PERIOD;
  };

  // Start gantry: five red lights.
  const gantry = new THREE.Group();
  const truss = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5, metalness: 0.5 });
  for (const side of [1, -1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 6, 0.35), truss);
    post.position.set(0, 3, (TRACK_HALF + 1.2) * side);
    gantry.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, (TRACK_HALF + 1.2) * 2), truss);
  beam.position.y = 5.8;
  gantry.add(beam);
  const lights: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshBasicMaterial({ color: 0x2a0a0a, toneMapped: false }));
    l.position.set(-0.3, 5.8, (i - 2) * 1.1);
    gantry.add(l);
    lights.push(l);
  }
  gantry.position.x = GANTRY_X;

  // Finish arch: checkered beam, lime strip, checkered line on the road.
  const finish = new THREE.Group();
  const checker = checkerTexture();
  checker.repeat.set(1, 1);
  for (const side of [1, -1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7.5, 0.5), truss);
    post.position.set(0, 3.75, (TRACK_HALF + 1.6) * side);
    finish.add(post);
  }
  const cb = checkerTexture();
  cb.repeat.set(20, 2);
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.4, (TRACK_HALF + 1.6) * 2), new THREE.MeshStandardMaterial({ map: cb, roughness: 0.5 }));
  top.position.y = 7.5;
  finish.add(top);
  const strip2 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, (TRACK_HALF + 1.6) * 2), lit);
  strip2.position.y = 6.75;
  finish.add(strip2);
  const lineTex = checkerTexture();
  lineTex.repeat.set(1, 6);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(1.2, TRACK_HALF * 2), new THREE.MeshStandardMaterial({ map: lineTex, roughness: 0.6 }));
  line.rotation.x = -Math.PI / 2;
  line.position.y = 0.02;
  finish.add(line);
  finish.position.x = FINISH_X;

  // Waving checkered flag beside the arch.
  const flagTex = checkerTexture();
  flagTex.repeat.set(4, 3);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.2, 24, 8), new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: 0.8 }));
  flag.position.set(1.6, 5.6, TRACK_HALF + 3.8);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 6.4, 8), truss);
  pole.position.set(0, 3.2, TRACK_HALF + 3.8);
  finish.add(pole, flag);
  const base = flag.geometry.attributes.position.array.slice() as Float32Array;
  const animateFlag = (t: number) => {
    const pos = flag.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3] + 1.6; // 0 at the pole, 3.2 at the free edge
      pos.setZ(i, Math.sin(x * 2.2 - t * 6) * 0.12 * (x / 3.2));
    }
    pos.needsUpdate = true;
  };

  // A soft pool of light ahead of the pack (headlights).
  const glowTex = canvasTexture(128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
    g.addColorStop(0, 'rgba(255,255,235,0.55)');
    g.addColorStop(1, 'rgba(255,255,235,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(38, 9),
    new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.03;

  return { strip, follow, gantry, lights, finish, flag, animateFlag, glow };
}
