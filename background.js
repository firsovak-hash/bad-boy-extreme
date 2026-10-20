import * as THREE from 'three';

// Background: a distant storm (dark clouds lit from inside by lightning) + drifting gold dust.
// ?bg=storm / ?bg=dust / ?bg=none to compare; default is both.
const params = new URLSearchParams(location.search);
const LIGHT = params.get('theme') === 'light';
const MODE = params.get('bg') || 'both';
const STORM = !LIGHT && (MODE === 'both' || MODE === 'storm');   // a storm needs a dark sky
const DUST = MODE === 'both' || MODE === 'dust';

// ------------------------------------------------------------------ storm dome
const stormU = {
  uTime: { value: 0 },
  uFlash: { value: 0 },                       // 0..~1.5, brightness of the current flash
  uFlashDir: { value: new THREE.Vector3(0.4, 0.5, -1).normalize() },
  uVis: { value: 0 },                         // 0 on the hero (pure black), 1 once the bottle is revealed
};

const stormMat = new THREE.ShaderMaterial({
  uniforms: stormU,
  side: THREE.BackSide,
  depthWrite: false,
  vertexShader: /* glsl */`
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform float uTime, uFlash, uVis;
    uniform vec3 uFlashDir;
    varying vec3 vDir;

    float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float noise(vec3 x) {
      vec3 i = floor(x), f = fract(x);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                 mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
    }
    float fbm(vec3 p) {
      float v = 0.0, a = 0.5;
      for (int k = 0; k < 5; k++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
      return v;
    }

    void main() {
      vec3 d = normalize(vDir);
      // slowly rolling cloud bank, denser towards the horizon
      vec3 p = d * 2.6 + vec3(uTime * 0.012, -uTime * 0.004, uTime * 0.008);
      float c = fbm(p + fbm(p * 1.7) * 0.8);
      c = smoothstep(0.35, 0.85, c);
      float horizon = smoothstep(-0.35, 0.25, d.y) * (1.0 - smoothstep(0.35, 0.9, d.y));

      // flash: lights the clouds from inside, strongest around its direction
      float near = pow(max(dot(d, uFlashDir), 0.0), 6.0);
      float glow = uFlash * (0.15 + 1.6 * near);
      vec3 base = vec3(0.010, 0.010, 0.012) * c * horizon;              // barely-there clouds at rest
      vec3 lit = vec3(0.55, 0.60, 0.75) * c * glow + vec3(1.0, 0.85, 0.6) * near * uFlash * 0.08;
      vec3 col = (base + lit) * uVis;
      gl_FragColor = vec4(col, 1.0);
    }`,
});

// ------------------------------------------------------------------ gold dust
const N = 1400;
const dustGeo = new THREE.BufferGeometry();
const pos = new Float32Array(N * 3), seed = new Float32Array(N);
for (let i = 0; i < N; i++) {
  pos[i * 3] = (Math.random() - 0.5) * 14;
  pos[i * 3 + 1] = (Math.random() - 0.5) * 9;
  pos[i * 3 + 2] = (Math.random() - 0.5) * 14;
  seed[i] = Math.random();
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
dustGeo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));

const dustU = {
  uTime: { value: 0 },
  uRise: { value: 0 },                        // accumulated drift (speeds up with the scroll)
  uOpacity: { value: 0 },
  uFlash: stormU.uFlash,
  uPx: { value: 1 },
};
const dustMat = new THREE.ShaderMaterial({
  uniforms: dustU,
  defines: LIGHT ? { LIGHT_BG: 1 } : {},
  transparent: true,
  depthWrite: false,
  blending: LIGHT ? THREE.NormalBlending : THREE.AdditiveBlending,
  vertexShader: /* glsl */`
    uniform float uTime, uRise, uPx;
    attribute float seed;
    varying float vSeed, vDepth;
    void main() {
      vec3 p = position;
      // slow upward drift with a little sway; wrap inside a 9-unit tall column
      p.y = mod(p.y + 4.5 + uRise * (0.6 + seed * 0.8), 9.0) - 4.5;
      p.x += sin(uTime * 0.3 + seed * 40.0) * 0.12;
      p.z += cos(uTime * 0.25 + seed * 30.0) * 0.12;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vDepth = -mv.z;
      vSeed = seed;
      // near particles are big and soft (out of focus), far ones are tiny sparks
      float size = mix(1.4, 3.2, seed) * uPx * (1.0 + 7.0 / max(vDepth * vDepth, 0.4));
      gl_PointSize = size * 6.0 / max(vDepth, 0.3);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
    uniform float uTime, uOpacity, uFlash;
    varying float vSeed, vDepth;
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float r = length(c);
      float blur = clamp(1.6 / max(vDepth, 0.2), 0.0, 1.0);               // closer = softer
      float a = smoothstep(0.5, mix(0.05, 0.45, blur), r);
      float twinkle = 0.55 + 0.45 * sin(uTime * (1.5 + vSeed * 3.0) + vSeed * 50.0);
      float fade = smoothstep(0.4, 1.2, vDepth) * (1.0 - smoothstep(9.0, 14.0, vDepth));
      vec3 gold = mix(vec3(1.0, 0.72, 0.32), vec3(1.0, 0.9, 0.7), vSeed);
      #ifdef LIGHT_BG
      gold = mix(vec3(0.62, 0.45, 0.18), vec3(0.78, 0.6, 0.3), vSeed);   // darker gold reads on a light page
      #endif
      float alpha = a * twinkle * fade * uOpacity * (1.0 - 0.6 * blur) * (1.0 + uFlash * 1.5);
      #ifdef LIGHT_BG
      gl_FragColor = vec4(gold, alpha * 0.8);
      #else
      gl_FragColor = vec4(gold * alpha, alpha);
      #endif
    }`,
});

// ------------------------------------------------------------------ public api
export function createBackground(scene, renderer) {   // theme comes from ?theme=, see LIGHT above
  const dome = new THREE.Mesh(new THREE.SphereGeometry(40, 48, 24), stormMat);
  dome.renderOrder = -1;
  dome.visible = STORM;
  scene.add(dome);

  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  dust.visible = DUST;
  scene.add(dust);

  // the flash also lights the bottle: a cold light from the flash direction
  const flashLight = new THREE.DirectionalLight(0xc9d6ff, 0);
  scene.add(flashLight);

  let flash = 0, nextAuto = 4 + Math.random() * 5, queue = [];

  // a real lightning flash is 2-3 quick flickers, then a short afterglow
  function strike(power = 1) {
    if (!STORM) return;
    const az = (Math.random() - 0.5) * 2.4, el = 0.25 + Math.random() * 0.4;
    stormU.uFlashDir.value.set(Math.sin(az), el, -Math.cos(az)).normalize();
    const n = 2 + (Math.random() < 0.5 ? 1 : 0);
    let t = 0;
    for (let k = 0; k < n; k++) {
      queue.push({ at: t, v: power * (k === 0 ? 1 : 0.6 + Math.random() * 0.5) });
      t += 0.07 + Math.random() * 0.12;
    }
  }

  let clockT = 0;
  function update(dt, { vis, scrollVel }) {
    clockT += dt;
    stormU.uTime.value = clockT;
    stormU.uVis.value = vis;
    dustU.uTime.value = clockT;
    dustU.uOpacity.value = 0.25 + 0.75 * vis;
    dustU.uPx.value = renderer.getPixelRatio();
    // drift: slow by itself, quicker while scrolling (both directions push the dust up)
    dustU.uRise.value += dt * (0.05 + Math.min(Math.abs(scrollVel) / 2500, 1.5));

    // automatic distant strikes every 6-13 s once the bottle is visible
    if (vis > 0.5 && !REDUCED()) {
      nextAuto -= dt;
      if (nextAuto <= 0) { strike(0.55 + Math.random() * 0.4); nextAuto = 6 + Math.random() * 7; }
    }
    // play the queued flickers
    queue = queue.filter((q) => {
      q.at -= dt;
      if (q.at <= 0) { flash = Math.max(flash, q.v); return false; }
      return true;
    });
    flash *= Math.pow(0.0009, dt);          // fast decay (~0.15 s)
    stormU.uFlash.value = flash * vis;
    flashLight.position.copy(stormU.uFlashDir.value).multiplyScalar(10);
    flashLight.intensity = flash * vis * 3.5;
  }

  // the desert video replaces the storm and the dust as the first background
  function setEnabled(on) { dome.visible = STORM && on; dust.visible = DUST && on; }

  return { update, strike, setEnabled };
}

const REDUCED = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
