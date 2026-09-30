import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';

import { BIKE_MODEL_CONFIG, RiderSpec } from './config';
import { LogoAsset, logoMesh } from './logos';

export interface BikeRig {
  /** Position and yaw. Origin is on the ground under the bike, bike faces +X. */
  root: THREE.Group;
  /** Roll about the forward axis. */
  lean: THREE.Group;
  wheels: THREE.Object3D[];
  /** Point above the rider for the name tag (local to `root`). */
  tagAnchor: THREE.Object3D;
  /** Boost effect: 0 = off, 1 = full flame and light trail. `time` drives the flicker. */
  setBoost: (amount: number, time: number) => void;
}

let gradientTex: THREE.Texture | null = null;
// Soft white gradient along U (hot at u=0, gone at u=1) and across V, used by the flame and the trail.
function boostGradient() {
  if (gradientTex) return gradientTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  const along = ctx.createLinearGradient(0, 0, 128, 0);
  along.addColorStop(0, 'rgba(255,255,255,1)');
  along.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  along.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = along;
  ctx.fillRect(0, 0, 128, 32);
  ctx.globalCompositeOperation = 'destination-in';
  const across = ctx.createLinearGradient(0, 0, 0, 32);
  across.addColorStop(0, 'rgba(0,0,0,0)');
  across.addColorStop(0.5, 'rgba(0,0,0,1)');
  across.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = across;
  ctx.fillRect(0, 0, 128, 32);
  gradientTex = new THREE.CanvasTexture(c);
  return gradientTex;
}

// Exhaust flame plus a light trail from the tail light, both additive and brand-tinted.
function buildBoost(color: THREE.Color, exhaust: THREE.Vector3, tail: THREE.Vector3) {
  const group = new THREE.Group();
  const tex = boostGradient();
  const hot = color.clone().lerp(new THREE.Color(1, 1, 1), 0.35);
  const mat = (c: THREE.Color, opacity: number) =>
    new THREE.MeshBasicMaterial({
      map: tex,
      color: c,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
  // Flame: two crossed quads starting at the exhaust and pointing back (-X).
  const flameMats = [mat(new THREE.Color(0.55, 0.75, 1).multiplyScalar(3), 0), mat(hot.clone().multiplyScalar(4), 0)];
  const flame = new THREE.Group();
  flameMats.forEach((m, k) => {
    for (const rot of [0, Math.PI / 2]) {
      const q = new THREE.Mesh(new THREE.PlaneGeometry(1, k === 0 ? 0.22 : 0.1), m);
      q.geometry.translate(-0.5, 0, 0);
      q.rotation.x = rot;
      flame.add(q);
    }
  });
  flame.position.copy(exhaust);
  // Trail: long streak from the tail light.
  const trailMat = mat(color.clone().multiplyScalar(2.2), 0);
  const trail = new THREE.Group();
  for (const rot of [0, Math.PI / 2]) {
    const q = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.09), trailMat);
    q.geometry.translate(-0.5, 0, 0);
    q.rotation.x = rot;
    trail.add(q);
  }
  trail.position.copy(tail);
  group.add(flame, trail);
  group.visible = false;
  const set = (amount: number, time: number) => {
    group.visible = amount > 0.01;
    if (!group.visible) return;
    const flicker = 0.75 + 0.25 * Math.sin(time * 61) * Math.sin(time * 37 + 1.3);
    flame.scale.set((0.35 + 0.55 * amount) * flicker, 0.7 + 0.5 * amount * flicker, 0.7 + 0.5 * amount);
    flameMats[0].opacity = 0.8 * amount;
    flameMats[1].opacity = amount * flicker;
    trail.scale.set(0.5 + 4.5 * amount, 1, 1);
    trailMat.opacity = 0.75 * amount;
  };
  return { group, set };
}

const WHEEL_R = 0.32;
const HDR = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b);
const Y = new THREE.Vector3(0, 1, 0);

// Shared geometry: built once, reused by all five bikes.
let shared: {
  fairing: THREE.BufferGeometry;
  tire: THREE.BufferGeometry;
  rim: THREE.BufferGeometry;
  spoke: THREE.BufferGeometry;
  disc: THREE.BufferGeometry;
  shadow: THREE.Texture;
} | null = null;

function numberTexture(ticker: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f4f4f0';
  ctx.beginPath();
  ctx.arc(32, 32, 31, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0a0a0a';
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(10 + (ticker.charCodeAt(0) % 80)), 32, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function fairingGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0.98, 0.6);
  s.quadraticCurveTo(0.78, 0.98, 0.42, 1.02);
  s.lineTo(0.3, 0.9);
  s.quadraticCurveTo(0.0, 1.0, -0.3, 0.95);
  s.lineTo(-0.62, 0.9);
  s.quadraticCurveTo(-1.0, 0.98, -1.12, 0.86);
  s.lineTo(-1.02, 0.62);
  s.quadraticCurveTo(-0.5, 0.46, 0.05, 0.42);
  s.quadraticCurveTo(0.6, 0.4, 0.98, 0.6);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: 0.3,
    bevelEnabled: true,
    bevelThickness: 0.07,
    bevelSize: 0.07,
    bevelSegments: 4,
    curveSegments: 20,
  });
  g.translate(0, 0, -0.15);
  return g;
}

function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,0.75)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function getShared() {
  if (!shared) {
    shared = {
      fairing: fairingGeometry(),
      tire: new THREE.TorusGeometry(WHEEL_R - 0.05, 0.05, 12, 32),
      rim: new THREE.CylinderGeometry(WHEEL_R - 0.1, WHEEL_R - 0.1, 0.06, 24).rotateX(Math.PI / 2),
      spoke: new THREE.BoxGeometry(0.46, 0.05, 0.045),
      disc: new THREE.CylinderGeometry(0.17, 0.17, 0.012, 28).rotateX(Math.PI / 2),
      shadow: shadowTexture(),
    };
  }
  return shared;
}

// A capsule between two points.
function limb(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material) {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.001, len - radius * 2), 4, 10), material);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(Y, dir.normalize());
  return mesh;
}
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// Quantized (meshopt) attributes are normalized integers; baking a transform into them would clamp. Copy to floats first.
function toFloat(source: THREE.BufferGeometry) {
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(source.index ? source.index.clone() : null);
  for (const [name, attr] of Object.entries(source.attributes)) {
    const a = attr as THREE.BufferAttribute;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) {
      out[i * a.itemSize] = a.getX(i);
      if (a.itemSize > 1) out[i * a.itemSize + 1] = a.getY(i);
      if (a.itemSize > 2) out[i * a.itemSize + 2] = a.getZ(i);
      if (a.itemSize > 3) out[i * a.itemSize + 3] = a.getW(i);
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  source.groups.forEach((g) => geometry.addGroup(g.start, g.count, g.materialIndex));
  return geometry;
}

// Splits a geometry into one piece per axle (each triangle goes to the nearest axle along X), each piece
// re-centred on its axle.
function splitByAxle(geometry: THREE.BufferGeometry, axles: THREE.Vector3[]) {
  if (!axles.length) return [];
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const count = index ? index.count : pos.count;
  const lists: number[][] = axles.map(() => []);
  for (let i = 0; i < count; i += 3) {
    const a = index ? index.getX(i) : i;
    const b = index ? index.getX(i + 1) : i + 1;
    const c = index ? index.getX(i + 2) : i + 2;
    const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
    let best = 0;
    axles.forEach((axle, k) => {
      if (Math.abs(axle.x - cx) < Math.abs(axles[best].x - cx)) best = k;
    });
    lists[best].push(a, b, c);
  }
  return axles.map((axle, k) => {
    const part = geometry.clone();
    part.setIndex(lists[k]);
    part.translate(-axle.x, -axle.y, -axle.z);
    return { geometry: part, axle };
  });
}

export interface BikeModel {
  /** Static parts, flattened into bike space (meters, +X forward, ground at y = 0). */
  body: THREE.Group;
  /** Tyres, centered on their axles so they can spin. */
  wheels: THREE.Mesh[];
  /** The paint material; cloned per bike and tinted with the stock color. */
  paint: THREE.Material | null;
}

/** Loads the realistic glb. Resolves null on any problem so the procedural bike is used. */
export async function loadBikeModel(url: string): Promise<BikeModel | null> {
  if (!url) return null;
  try {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(url);
    const scene = gltf.scene;
    scene.rotation.y = BIKE_MODEL_CONFIG.rotationY;
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const scale = BIKE_MODEL_CONFIG.length / Math.max(size.x, size.z);
    const center = box.getCenter(new THREE.Vector3());
    // Bake every mesh into bike space once, so clones are cheap and tyres can pivot on their axles.
    const fit = new THREE.Matrix4()
      .makeScale(scale, scale, scale)
      .multiply(new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));
    const body = new THREE.Group();
    const wheels: THREE.Mesh[] = [];
    const rims: THREE.Mesh[] = [];
    let paint: THREE.Material | null = null;
    const meshes: THREE.Mesh[] = [];
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    for (const mesh of meshes) {
      const geometry = toFloat(mesh.geometry);
      geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(fit, mesh.matrixWorld));
      const material = mesh.material as THREE.MeshStandardMaterial;
      if (/glass/i.test(material.name) && !/edge/i.test(material.name)) {
        // Smoked race screen instead of the model's milky one.
        material.color.set(0x0c1116);
        material.transparent = true;
        material.opacity = 0.45;
        material.roughness = 0.05;
        material.metalness = 0.3;
        material.alphaTest = 0;
        material.depthWrite = false;
      }
      const flat = new THREE.Mesh(geometry, material);
      if (BIKE_MODEL_CONFIG.paintNames.test(material.name)) paint = material;
      if (BIKE_MODEL_CONFIG.rimNames.test(material.name)) {
        rims.push(flat);
      } else if (BIKE_MODEL_CONFIG.wheelNames.test(material.name)) {
        geometry.computeBoundingBox();
        const c = geometry.boundingBox!.getCenter(new THREE.Vector3());
        geometry.translate(-c.x, -c.y, -c.z);
        flat.position.copy(c);
        wheels.push(flat);
      } else {
        body.add(flat);
      }
    }
    // Both rims come as one mesh. Split it front/back by triangle and pivot each half on its tyre's axle,
    // so the spokes turn with the wheel.
    const axles = wheels.map((w) => w.position.clone());
    for (const rim of rims) {
      for (const part of splitByAxle(rim.geometry, axles)) {
        const mesh = new THREE.Mesh(part.geometry, rim.material);
        mesh.position.copy(part.axle);
        wheels.push(mesh);
      }
    }
    return { body, wheels, paint };
  } catch {
    return null;
  }
}

// Decal geometry per side is the same for every bike (only the texture differs), so project once and share it.
const decalCache = new Map<number, THREE.BufferGeometry[]>();
const DECAL_SPOT = new THREE.Vector3(0.25, 0.62, 0); // side fairing panel, below the tank

function fairingDecals(model: BikeModel, side: number) {
  const hit = decalCache.get(side);
  if (hit) return hit;
  const paintMeshes: THREE.Mesh[] = [];
  model.body.children.forEach((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.material === model.paint) paintMeshes.push(mesh);
  });
  model.body.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(DECAL_SPOT.x, DECAL_SPOT.y, side), new THREE.Vector3(0, 0, -side));
  const found = ray.intersectObjects(paintMeshes, false)[0];
  const out: THREE.BufferGeometry[] = [];
  if (found) {
    const orientation = new THREE.Euler(0, side > 0 ? 0 : Math.PI, 0);
    out.push(new DecalGeometry(found.object as THREE.Mesh, found.point, orientation, new THREE.Vector3(0.26, 0.26, 0.3)));
  }
  decalCache.set(side, out);
  return out;
}

/** Builds one bike and rider with the stock's livery and logo decals. */
export function buildBike(
  spec: RiderSpec,
  logo: LogoAsset | null,
  model: BikeModel | null,
  mirror = false,
  logoTexture: THREE.Texture | null = null,
): BikeRig {
  const { fairing, tire, rim, spoke, disc, shadow } = getShared();
  const root = new THREE.Group();
  const lean = new THREE.Group();
  root.add(lean);

  const color = new THREE.Color(spec.color);
  const livery = new THREE.MeshPhysicalMaterial({ color, roughness: 0.4, metalness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.22 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.5, metalness: 0.6 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x060606, roughness: 0.9 });
  const suit = new THREE.MeshPhysicalMaterial({ color: 0x17181a, roughness: 0.5, clearcoat: 0.6, clearcoatRoughness: 0.35 });
  const sleeve = new THREE.MeshPhysicalMaterial({ color, roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.3 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x0d0d0f, roughness: 0.6 });
  const helmet = new THREE.MeshPhysicalMaterial({ color: spec.helmet, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 });
  const visor = new THREE.MeshPhysicalMaterial({ color: 0x080c10, roughness: 0.04, metalness: 0.9 });
  const decal = new THREE.MeshStandardMaterial({ color: spec.logoColor, roughness: 0.4, side: THREE.DoubleSide });
  const alloy = new THREE.MeshStandardMaterial({ color: 0xb08d3a, roughness: 0.3, metalness: 0.9 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.95 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0b1118, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.55 });
  const tail = new THREE.MeshBasicMaterial({ color: HDR(4, 0.15, 0.15), toneMapped: false });
  const head = new THREE.MeshBasicMaterial({ color: HDR(3, 3, 2.6), toneMapped: false });

  const wheels: THREE.Object3D[] = [];

  // Contact shadow: a soft blob on the ground that does not lean.
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 1.2),
    new THREE.MeshBasicMaterial({ map: shadow, transparent: true, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.01;
  if (!mirror) root.add(blob);

  if (model) {
    const body = model.body.clone();
    if (model.paint) {
      const paint = model.paint.clone() as THREE.MeshPhysicalMaterial;
      paint.color.set(spec.color);
      body.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && mesh.material === model.paint) mesh.material = paint;
      });
    }
    lean.add(body);
    for (const w of model.wheels) {
      const wheel = w.clone();
      lean.add(wheel);
      wheels.push(wheel);
    }
    // Stock logo projected onto both sides of the fairing, so it follows the curve of the bodywork.
    if (logoTexture) {
      const decalMat = new THREE.MeshStandardMaterial({
        map: logoTexture,
        transparent: true,
        roughness: 0.3,
        metalness: 0.1,
        polygonOffset: true,
        polygonOffsetFactor: -4,
      });
      for (const side of [1, -1]) {
        for (const geom of fairingDecals(model, side)) lean.add(new THREE.Mesh(geom, decalMat));
      }
    }
  } else {
    for (const x of [0.72, -0.72]) {
      const wheel = new THREE.Group();
      wheel.add(new THREE.Mesh(tire, rubber), new THREE.Mesh(rim, dark));
      for (let k = 0; k < 3; k++) {
        const arm = new THREE.Mesh(spoke, alloy);
        arm.rotation.z = (k * Math.PI) / 3;
        wheel.add(arm);
      }
      const brakeDisc = new THREE.Mesh(disc, steel);
      brakeDisc.position.z = 0.055;
      wheel.add(brakeDisc);
      wheel.position.set(x, WHEEL_R, 0);
      lean.add(wheel);
      wheels.push(wheel);
    }
    lean.add(new THREE.Mesh(fairing, livery));

    // Front fork, bars, swingarm, exhaust, seat.
    lean.add(limb(v(0.72, WHEEL_R, 0.09), v(0.5, 0.95, 0.09), 0.025, dark));
    lean.add(limb(v(0.72, WHEEL_R, -0.09), v(0.5, 0.95, -0.09), 0.025, dark));
    lean.add(limb(v(0.5, 0.97, -0.3), v(0.5, 0.97, 0.3), 0.022, dark));
    lean.add(limb(v(-0.72, WHEEL_R, 0.1), v(-0.1, 0.55, 0.1), 0.03, dark));
    lean.add(limb(v(-0.72, WHEEL_R, -0.1), v(-0.1, 0.55, -0.1), 0.03, dark));
    lean.add(limb(v(-0.25, 0.5, 0.24), v(-1.15, 0.72, 0.2), 0.05, new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.3, metalness: 0.9 })));
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.07, 0.24), leather);
    seat.position.set(-0.35, 0.94, 0);
    lean.add(seat);
    const brake = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.2), tail);
    brake.position.set(-1.13, 0.84, 0);
    lean.add(brake);
    for (const side of [1, -1]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.11), head);
      lamp.position.set(0.94, 0.68, 0.085 * side);
      lean.add(lamp);
    }
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.24, 0.3), glass);
    screen.position.set(0.56, 1.02, 0);
    screen.rotation.z = -0.8;
    lean.add(screen);
    for (const side of [1, -1]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.045, 0.006), decal);
      stripe.position.set(-0.05, 0.64, 0.226 * side);
      stripe.rotation.z = 0.05;
      lean.add(stripe);
    }
    const plate = new THREE.Mesh(new THREE.CircleGeometry(0.085, 24), new THREE.MeshBasicMaterial({ map: numberTexture(spec.ticker) }));
    plate.position.set(1.005, 0.78, 0);
    plate.rotation.y = Math.PI / 2;
    lean.add(plate);
    if (!mirror) {
      const beam = new THREE.Mesh(
        new THREE.ConeGeometry(1.0, 10, 24, 1, true),
        new THREE.MeshBasicMaterial({ color: HDR(0.9, 0.95, 1), transparent: true, opacity: 0.014, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      beam.rotation.z = Math.PI / 2;
      beam.position.set(6, 0.68, 0);
      lean.add(beam);
    }
    const fender = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R + 0.03, 0.03, 8, 20, Math.PI * 0.75), livery);
    fender.position.set(0.72, WHEEL_R, 0);
    fender.rotation.z = Math.PI * 0.12;
    lean.add(fender);
  }

  // Rider in a tuck: dark leathers with livery-colored hump and sleeves. Sized down to sit into the real bike.
  const rider = new THREE.Group();
  if (model) {
    rider.scale.setScalar(0.88);
    rider.position.set(-0.02, 0.0, 0);
  }
  lean.add(rider);
  const hips = v(-0.28, 0.98, 0);
  const shoulders = v(0.22, 1.16, 0);
  rider.add(limb(hips, shoulders, 0.15, suit));
  const hump = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 14), livery);
  hump.scale.set(1.25, 0.8, 1);
  hump.position.set(-0.16, 1.24, 0);
  rider.add(hump);
  for (const side of [1, -1]) {
    const shoulder = v(0.22, 1.13, 0.17 * side);
    const elbow = v(0.4, 1.02, 0.31 * side);
    const hand = v(0.5, 0.98, 0.3 * side);
    rider.add(limb(shoulder, elbow, 0.055, sleeve));
    rider.add(limb(elbow, hand, 0.048, sleeve));
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), leather);
    glove.position.copy(hand);
    rider.add(glove);
    const hip = v(-0.28, 0.94, 0.15 * side);
    const knee = v(0.1, 0.78, 0.27 * side);
    const foot = v(-0.18, 0.46, 0.24 * side);
    rider.add(limb(hip, knee, 0.085, suit));
    rider.add(limb(knee, foot, 0.06, suit));
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.09), leather);
    boot.position.set(foot.x + 0.04, foot.y - 0.03, foot.z);
    rider.add(boot);
    const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.025, 10).rotateX(Math.PI / 2), dark);
    puck.position.set(knee.x + 0.02, knee.y - 0.02, knee.z + 0.075 * side);
    rider.add(puck);
  }
  const head3 = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 16), helmet);
  head3.scale.set(1.18, 1, 1);
  head3.position.set(0.42, 1.24, 0);
  rider.add(head3);
  const visorMesh = new THREE.Mesh(new THREE.SphereGeometry(0.152, 20, 12, -Math.PI * 0.32, Math.PI * 0.64, Math.PI * 0.32, Math.PI * 0.28), visor);
  visorMesh.scale.set(1.18, 1, 1);
  visorMesh.position.copy(head3.position);
  visorMesh.rotation.y = Math.PI / 2;
  rider.add(visorMesh);

  // Logo decals: fairing sides, rider back, helmet sides.
  if (logo) {
    for (const side of [1, -1]) {
      if (!model) {
        const l = logoMesh(logo, decal, 0.3);
        l.position.set(0.22, 0.7, 0.225 * side);
        if (side < 0) l.rotation.y = Math.PI;
        lean.add(l);
      }
      const h = logoMesh(logo, decal, 0.11);
      h.position.set(0.4, 1.26, 0.155 * side);
      if (side < 0) h.rotation.y = Math.PI;
      rider.add(h);
    }
    const back = logoMesh(logo, decal, 0.24);
    back.position.set(-0.16, 1.375, 0);
    back.rotation.x = -Math.PI / 2;
    back.rotation.z = -Math.PI / 2;
    rider.add(back);
  }

  const tagAnchor = new THREE.Object3D();
  tagAnchor.position.set(0, 2.0, 0);
  root.add(tagAnchor);
  const boost = buildBoost(
    new THREE.Color(spec.color),
    model ? new THREE.Vector3(-0.42, 0.24, 0.12) : new THREE.Vector3(-1.18, 0.72, 0.2),
    model ? new THREE.Vector3(-1.07, 0.8, 0) : new THREE.Vector3(-1.15, 0.84, 0),
  );
  if (!mirror) lean.add(boost.group);
  return { root, lean, wheels, tagAnchor, setBoost: boost.set };
}

export const WHEEL_RADIUS = WHEEL_R;
