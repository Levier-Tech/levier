import * as THREE from 'three';

const STREAKS = 90;
const SPARKS = 160;

/** Thin light streaks that slide past the camera so speed reads even with a far-away subject. */
export function buildStreaks() {
  const positions = new Float32Array(STREAKS * 6);
  const seeds = Array.from({ length: STREAKS }, () => ({
    x: Math.random(),
    y: 0.2 + Math.random() * 3.2,
    z: (Math.random() - 0.5) * 16,
    len: 0.6 + Math.random() * 1.2,
  }));
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({ color: 0xdfffb0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const lines = new THREE.LineSegments(geom, material);
  lines.frustumCulled = false;
  const RANGE = 60;

  /** camX/speed in world units; strength 0..1 fades them in and out. */
  const update = (camX: number, speed: number, strength: number) => {
    material.opacity = 0.35 * strength;
    lines.visible = strength > 0.01;
    if (!lines.visible) return;
    const stretch = 0.03 * speed;
    for (let i = 0; i < STREAKS; i++) {
      const s = seeds[i];
      // Each streak is fixed in the world; wrap it around the camera so there are always some nearby.
      const wx = ((((s.x * RANGE * 2 - camX) % (RANGE * 2)) + RANGE * 2) % (RANGE * 2)) - RANGE + camX;
      const o = i * 6;
      positions[o] = wx;
      positions[o + 1] = s.y;
      positions[o + 2] = s.z;
      positions[o + 3] = wx - s.len * stretch;
      positions[o + 4] = s.y;
      positions[o + 5] = s.z;
    }
    geom.attributes.position.needsUpdate = true;
  };
  return { lines, update };
}

/** Sparks thrown off knee sliders. A small ring buffer of points. */
export function buildSparks() {
  const positions = new Float32Array(SPARKS * 3);
  const velocity = new Float32Array(SPARKS * 3);
  const life = new Float32Array(SPARKS);
  positions.fill(-9999);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(
    geom,
    new THREE.PointsMaterial({ color: 0xffc04a, size: 0.11, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  points.frustumCulled = false;
  let head = 0;

  const emit = (x: number, y: number, z: number, speed: number) => {
    const i = head;
    head = (head + 1) % SPARKS;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    velocity[i * 3] = speed * 0.7 - (2 + Math.random() * 9);
    velocity[i * 3 + 1] = 1 + Math.random() * 3;
    velocity[i * 3 + 2] = (Math.random() - 0.3) * 3;
    life[i] = 0.35 + Math.random() * 0.4;
  };

  const update = (dt: number) => {
    for (let i = 0; i < SPARKS; i++) {
      if (life[i] <= 0) {
        positions[i * 3 + 1] = -9999;
        continue;
      }
      life[i] -= dt;
      velocity[i * 3 + 1] -= 9.8 * dt;
      positions[i * 3] += velocity[i * 3] * dt;
      positions[i * 3 + 1] = Math.max(0.02, positions[i * 3 + 1] + velocity[i * 3 + 1] * dt);
      positions[i * 3 + 2] += velocity[i * 3 + 2] * dt;
    }
    geom.attributes.position.needsUpdate = true;
  };
  return { points, emit, update };
}

const SMOKE = 260;

/**
 * Tyre smoke: soft puffs dropped at the rear wheels. They stay where they were dropped, so at speed they stream
 * back as trails, grow and fade. Uses a tiny shader so every puff has its own size and opacity.
 */
export function buildSmoke() {
  const positions = new Float32Array(SMOKE * 3).fill(-999);
  const life = new Float32Array(SMOKE); // seconds left
  const size = new Float32Array(SMOKE);
  const alpha = new Float32Array(SMOKE);
  const drift = new Float32Array(SMOKE * 3);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('size', new THREE.BufferAttribute(size, 1));
  geom.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { scale: { value: 600 } },
    vertexShader: /* glsl */ `
      attribute float size;
      attribute float alpha;
      uniform float scale;
      varying float vAlpha;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * scale / -mv.z;
        gl_Position = projectionMatrix * mv;
        vAlpha = alpha;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, d) * vAlpha;
        gl_FragColor = vec4(vec3(0.62, 0.64, 0.66) * (0.7 + 0.3 * (1.0 - d)), a);
      }
    `,
  });
  const points = new THREE.Points(geom, material);
  points.frustumCulled = false;
  let head = 0;
  const maxLife = new Float32Array(SMOKE);

  const emit = (x: number, y: number, z: number, strength: number) => {
    const i = head;
    head = (head + 1) % SMOKE;
    positions.set([x, y, z], i * 3);
    drift.set([(Math.random() - 0.5) * 1.5, 0.4 + Math.random() * 0.8, (Math.random() - 0.5) * 1.8], i * 3);
    maxLife[i] = life[i] = 1.2 + Math.random() * 1.2;
    alpha[i] = 0.5 * strength;
  };

  const update = (dt: number) => {
    for (let i = 0; i < SMOKE; i++) {
      if (life[i] <= 0) {
        alpha[i] = 0;
        continue;
      }
      life[i] -= dt;
      const age = 1 - life[i] / maxLife[i];
      positions[i * 3] += drift[i * 3] * dt;
      positions[i * 3 + 1] += drift[i * 3 + 1] * dt;
      positions[i * 3 + 2] += drift[i * 3 + 2] * dt;
      size[i] = 0.5 + age * 2.6;
      alpha[i] *= 1 - dt * 0.9;
    }
    geom.attributes.position.needsUpdate = true;
    geom.attributes.size.needsUpdate = true;
    geom.attributes.alpha.needsUpdate = true;
  };
  const clear = () => {
    life.fill(0);
    alpha.fill(0);
  };
  return { points, emit, update, clear };
}
