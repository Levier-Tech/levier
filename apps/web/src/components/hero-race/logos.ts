import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';

/** Logo geometry normalized to height 1 and centered, facing +Z. Draw with a DoubleSide material. */
export interface LogoAsset {
  geoms: THREE.BufferGeometry[];
}

const EXTRUDE_DEPTH = 0.08; // relative to the tallest side of the logo box

export async function loadLogo(url: string): Promise<LogoAsset | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = new SVGLoader().parse(await res.text());
    const geoms: THREE.BufferGeometry[] = [];
    for (const path of data.paths) {
      const style = path.userData?.style as (Parameters<typeof SVGLoader.pointsToStroke>[1] & { fill?: string; stroke?: string }) | undefined;
      if (!style) continue;
      if (style.fill !== undefined && style.fill !== 'none') {
        for (const shape of path.toShapes()) {
          geoms.push(new THREE.ExtrudeGeometry(shape, { depth: 10, bevelEnabled: false, curveSegments: 12 }));
        }
      }
      if (style.stroke !== undefined && style.stroke !== 'none') {
        for (const sub of path.subPaths) {
          const g = SVGLoader.pointsToStroke(sub.getPoints(), style);
          if (g) geoms.push(g);
        }
      }
    }
    if (!geoms.length) return null;
    const box = new THREE.Box3();
    geoms.forEach((g) => {
      g.computeBoundingBox();
      if (g.boundingBox) box.union(g.boundingBox);
    });
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = 1 / Math.max(size.x, size.y);
    // SVG y points down; flip it and normalize.
    const m = new THREE.Matrix4().makeScale(s, -s, s * (EXTRUDE_DEPTH * Math.max(size.x, size.y)) / 10);
    m.multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, 0));
    geoms.forEach((g) => g.applyMatrix4(m));
    return { geoms };
  } catch {
    return null;
  }
}

/** The logo painted into a square canvas texture in one color, for decals that wrap the fairing. */
export async function loadLogoTexture(url: string, color: number): Promise<THREE.Texture | null> {
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    const scale = (size * 0.9) / Math.max(img.naturalWidth || size, img.naturalHeight || size);
    const w = (img.naturalWidth || size) * scale;
    const h = (img.naturalHeight || size) * scale;
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  } catch {
    return null;
  }
}

/** A decal mesh group. `size` is the logo's largest side in meters. */
export function logoMesh(asset: LogoAsset, material: THREE.Material, size: number) {
  const group = new THREE.Group();
  asset.geoms.forEach((g) => group.add(new THREE.Mesh(g, material)));
  group.scale.setScalar(size);
  return group;
}

// The Levier mark, traced from public/assets/levier-logo-new-trimmed.png (1922 x 839 px, y down).
const MARK_W = 1922;
const MARK_H = 839;
const GREY: [number, number][] = [[30, 780], [340, 570], [735, 570], [430, 780]];
const RED: [number, number][] = [[585, 815], [722, 632], [860, 815]];
const GREEN: [number, number][] = [[710, 628], [1560, 22], [1900, 22], [1035, 628]];

function markShape(points: [number, number][], scale: number) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => {
    const px = (x - MARK_W / 2) * scale;
    const py = (MARK_H / 2 - y) * scale;
    if (i === 0) shape.moveTo(px, py);
    else shape.lineTo(px, py);
  });
  shape.closePath();
  return shape;
}

// Paints a light-to-dark gradient across the piece so the solid mark keeps the flat logo's shading.
function gradient(geom: THREE.BufferGeometry, from: number, to: number) {
  geom.computeBoundingBox();
  const box = geom.boundingBox!;
  const pos = geom.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const a = new THREE.Color(from);
  const b = new THREE.Color(to);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getX(i) - box.min.x) / (box.max.x - box.min.x || 1);
    c.lerpColors(a, b, t);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/** Solid 3D Levier mark, `width` meters wide, facing +Z. */
export function buildLevierMark(width: number) {
  const scale = width / MARK_W;
  const group = new THREE.Group();
  const opts = {
    depth: 70 * scale * 2.2,
    bevelEnabled: true,
    bevelThickness: 14 * scale * 2.2,
    bevelSize: 10 * scale * 2.2,
    bevelSegments: 4,
    curveSegments: 4,
  };
  const pieces: [[number, number][], number, number, number][] = [
    [GREY, 0x8f9391, 0xe6e8e6, 0.35],
    [RED, 0xc0002a, 0xff4560, 0.3],
    [GREEN, 0x2fa800, 0xb0ff3a, 0.4],
  ];
  for (const [points, from, to, emissive] of pieces) {
    const geom = new THREE.ExtrudeGeometry(markShape(points, scale), opts);
    geom.translate(0, 0, -opts.depth / 2);
    gradient(geom, from, to);
    const material = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.28,
      metalness: 0.25,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
      emissive: new THREE.Color(to),
      emissiveIntensity: emissive * 0.25,
    });
    group.add(new THREE.Mesh(geom, material));
  }
  return group;
}
