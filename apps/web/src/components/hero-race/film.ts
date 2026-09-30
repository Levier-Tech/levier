import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

// The "movie" look: depth-aware motion blur, anamorphic light streaks, teal/orange grade, chromatic aberration,
// vignette and grain. `clean` fades all of it out and paints empty sky with the exact page background.
const shader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    focus: { value: 5 },
    near: { value: 0.1 },
    far: { value: 400 },
    time: { value: 0 },
    blur: { value: 0 },
    mode: { value: 0 },
    clean: { value: 0 },
    slow: { value: 0 },
    // Written straight to the screen, so this is the sRGB value of the page background #080808.
    background: { value: new THREE.Vector3(8 / 255, 8 / 255, 8 / 255) },
    resolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform float time, blur, mode, clean, slow, focus, near, far;
    uniform vec3 background;
    uniform vec2 resolution;
    varying vec2 vUv;

    float linearDepth(vec2 uv) {
      float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
      return 2.0 * near * far / (far + near - z * (far - near));
    }
    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

    void main() {
      vec2 c = vUv - 0.5;
      float r = length(c);
      float fx = 1.0 - clean;

      // Motion blur: only what is away from the focus distance streaks, so the subject stays sharp.
      float d = linearDepth(vUv);
      float away = smoothstep(0.15, 0.9, abs(d - focus) / focus);
      vec2 dir = mix(vec2(1.0, 0.0), -c * 2.0, mode);
      // Slow motion reads like a high-speed camera: crisp, so the blur fades out.
      float edge = away * (0.6 + 0.6 * smoothstep(0.05, 0.75, r)) * fx * (1.0 - 0.75 * slow);
      vec3 col = vec3(0.0);
      float wsum = 0.0;
      for (int i = -6; i <= 6; i++) {
        float f = float(i) / 6.0;
        float w = 1.0 - abs(f) * 0.7;
        col += texture2D(tDiffuse, vUv + dir * f * blur * edge * 0.035).rgb * w;
        wsum += w;
      }
      col /= wsum;

      // Anamorphic streaks: bright lights smear into long horizontal blue lines, like a wide-screen lens.
      vec3 streak = vec3(0.0);
      for (int i = 1; i <= 12; i++) {
        float o = float(i) / 12.0;
        float w = pow(1.0 - o, 2.0);
        vec3 a = texture2D(tDiffuse, vUv + vec2(o * 0.22, 0.0)).rgb;
        vec3 b = texture2D(tDiffuse, vUv - vec2(o * 0.22, 0.0)).rgb;
        streak += (max(luma(a) - 0.85, 0.0) + max(luma(b) - 0.85, 0.0)) * w;
      }
      col += streak * vec3(0.35, 0.55, 1.0) * 0.16;

      // Chromatic aberration toward the edges.
      vec2 ca = c * 0.0018 * (1.0 + r * 3.0) * fx * (1.0 + 2.5 * slow);
      col.r = mix(col.r, texture2D(tDiffuse, vUv + ca).r, 0.6);
      col.b = mix(col.b, texture2D(tDiffuse, vUv - ca).b, 0.6);

      // Grade: teal shadows, warm highlights, a filmic S-curve with crushed blacks.
      float l = luma(col);
      vec3 graded = col * mix(vec3(0.86, 1.0, 1.1), vec3(1.12, 1.0, 0.86), smoothstep(0.05, 0.7, l));
      graded = max(graded - 0.012, 0.0) * 1.03;
      graded = mix(graded, graded * graded * (3.0 - 2.0 * graded), 0.35);
      col = mix(col, graded, fx);
      // Slow motion: drained color, harder contrast, lifted highlights.
      float sl = luma(col);
      vec3 drained = mix(col, vec3(sl), 0.45);
      drained = (drained - 0.5) * 1.18 + 0.5;
      col = mix(col, max(drained, 0.0), slow * fx);

      // Vignette and grain.
      col *= 1.0 - (0.55 + 0.35 * slow) * fx * smoothstep(0.3 - 0.1 * slow, 0.95, r * 1.35);
      float g = fract(sin(dot(vUv * resolution + time, vec2(12.9898, 78.233))) * 43758.5453);
      col += (g - 0.5) * 0.045 * fx;

      // Clean frame: empty space turns transparent so the carbon backdrop behind the canvas shows through.
      // Glow keeps its color with zero alpha, which the page composites as added light.
      float alpha = mix(1.0, texture2D(tDiffuse, vUv).a, clean);
      gl_FragColor = vec4(col, alpha);
    }
  `,
};

export function buildFilmPass() {
  const pass = new ShaderPass(shader);
  const u = pass.uniforms as typeof shader.uniforms;
  return {
    pass,
    set: (
      time: number,
      blur: number,
      mode: number,
      w: number,
      h: number,
      focus: number,
      depth: THREE.Texture | null,
      clean: number,
      slow = 0,
    ) => {
      u.time.value = time % 100;
      u.blur.value = blur;
      u.mode.value = mode;
      u.resolution.value.set(w, h);
      u.focus.value = Math.max(0.5, focus);
      u.tDepth.value = depth;
      u.clean.value = clean;
      u.slow.value = slow;
    },
  };
}
