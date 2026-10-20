import * as THREE from 'three';

// Perfume spray ("пшик"): a burst of fine droplets leaving the nozzle in a narrow cone, braking hard
// in the air, then drifting and sinking as a soft cloud. Everything is computed on the GPU from the
// time since the press, so the spray can be scrubbed forwards and backwards (e.g. by the scroll).
//
// Units: the bottle's pivot space (1 unit = 10 cm). origin = nozzle, dir = spray direction.
// Light: droplets glow when the light is behind them (forward scattering), like in perfume ads.

const DROPS = 20000, MIST = 1600;

function seeds(n) {
  const a = new Float32Array(n * 4);
  for (let i = 0; i < a.length; i++) a[i] = Math.random();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));   // unused, required
  g.setAttribute('seed', new THREE.BufferAttribute(a, 4));
  return g;
}

const vert = /* glsl */`
  attribute vec4 seed;
  uniform float uT, uPx, uProj, uMist;
  uniform vec3 uO, uD, uP1, uP2;
  varying float vA, vSeed;
  varying vec3 vWorld;

  // the same path for every droplet: launch, quadratic air drag, a little gravity, growing swirl
  vec3 pathAt(float age) {
    float ang = seed.y * 6.2831853;
    float rr = sqrt(-2.0 * log(max(seed.z, 1e-4))) * 0.45;             // gaussian spread in the cone
    float cone = mix(0.2, 0.34, uMist);                                  // ~11° half angle (mist wider)
    vec3 dir = normalize(uD + (uP1 * cos(ang) + uP2 * sin(ang)) * rr * cone);
    float v0 = mix(9.0, 5.5, uMist) * (0.12 + 0.88 * seed.w * seed.w);   // units/s (1 unit = 10 cm); many slow drops
    float k = mix(5.5, 4.0, uMist) + 3.0 * seed.w;                        // drag: small drops stop fast
    float s = v0 / k * (1.0 - exp(-k * age));
    vec3 p = uO + dir * s;
    p.y -= 0.06 * age * age;                                              // slowly sinking
    // the cloud keeps spreading sideways once the drops have lost their speed (diffusion)
    float a2 = fract(seed.x * 7.13 + seed.z * 3.7) * 6.2831853;
    p += (uP1 * cos(a2) + uP2 * sin(a2) + vec3(0.0, 0.4, 0.0) * sin(a2 * 1.7)) * sqrt(age) * (0.12 + 0.18 * uMist) * fract(seed.w * 13.1);
    float sw = (0.03 + 0.09 * uMist) * age;                               // turbulence grows with age
    p += vec3(sin(age * 2.9 + seed.y * 41.0), sin(age * 2.1 + seed.z * 37.0), cos(age * 2.5 + seed.w * 29.0)) * sw;
    return p;
  }

  void main() {
    vSeed = seed.x;
    float te = seed.x * 0.45;                                              // the jet lasts ~0.45 s
    float age = uT - te;
    if (age <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; return; }
    vec3 p = pathAt(age);
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vWorld = wp.xyz;
    vec4 mv = viewMatrix * wp;
    float depth = max(-mv.z, 1e-4);
    float life = mix(1.9, 2.8, uMist);
    vA = smoothstep(0.0, 0.03, age) * (1.0 - smoothstep(life * 0.55, life, age));
    if (uMist < 0.5) {
      // droplets: ~1-2 px sparks; very close ones grow (a real drop near the lens) but fade out
      float px = mix(1.0, 2.2, seed.w) * uPx * (1.0 + 0.004 * uProj / depth);
      gl_PointSize = min(px, 48.0);
      vA *= smoothstep(0.004, 0.03, depth);
    } else {
      // mist: big soft blobs that grow as the cloud spreads
      float size = (0.05 + 0.18 * age) * mix(0.6, 1.4, seed.w);
      gl_PointSize = min(size * uProj / depth, 900.0);
      vA *= 0.016 * smoothstep(0.05, 0.3, depth) / (1.0 + age);   // thins out as it spreads
    }
    gl_Position = projectionMatrix * mv;
  }`;

const frag = /* glsl */`
  uniform vec3 uLight, uCam, uTint;
  uniform float uMist, uBright;
  varying float vA, vSeed;
  varying vec3 vWorld;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    // forward scattering: much brighter when we look towards the light through the droplet
    vec3 v = normalize(vWorld - uCam);
    float back = pow(max(dot(v, normalize(uLight - vWorld)), 0.0), 6.0);
    float lum = (0.16 + 1.5 * back) * uBright;
    float a = uMist < 0.5 ? 0.4 * (1.0 - smoothstep(0.15, 0.5, r)) : exp(-r * r * 18.0);
    float twinkle = uMist < 0.5 ? 0.6 + 0.4 * fract(vSeed * 91.7) : 1.0;
    gl_FragColor = vec4(uTint * lum * twinkle, a * vA);
  }`;

export function createSpray({ origin, dir, light }) {
  const d = dir.clone().normalize();
  const p1 = new THREE.Vector3(0, 1, 0).cross(d).normalize();
  const p2 = d.clone().cross(p1).normalize();
  const common = {
    uT: { value: 0 }, uPx: { value: 1 }, uProj: { value: 800 },
    uO: { value: origin.clone() }, uD: { value: d }, uP1: { value: p1 }, uP2: { value: p2 },
    uLight: { value: light.clone() }, uCam: { value: new THREE.Vector3() },
    uTint: { value: new THREE.Color(1.0, 0.97, 0.92) }, uBright: { value: 1 },
  };
  const mk = (n, mist) => {
    const m = new THREE.ShaderMaterial({
      uniforms: { ...common, uMist: { value: mist } },
      vertexShader: vert, fragmentShader: frag,
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    });
    const pts = new THREE.Points(seeds(n), m);
    pts.frustumCulled = false;
    pts.renderOrder = mist ? 3 : 4;
    return pts;
  };
  const group = new THREE.Group();
  const drops = mk(DROPS, 0), mist = mk(MIST, 1);
  group.add(mist, drops);

  // the hero droplet for the macro shot: a real refracting water sphere, slightly flattened
  const dropPos = origin.clone().addScaledVector(d, 0.85).addScaledVector(p1, 0.035).addScaledVector(p2, 0.02);
  const droplet = new THREE.Mesh(
    new THREE.SphereGeometry(0.004, 96, 64),
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff, metalness: 0, roughness: 0, transmission: 1, ior: 1.33, thickness: 0.006,
      specularIntensity: 1, envMapIntensity: 1.2, transparent: true,
    }),
  );
  droplet.scale.set(1, 0.92, 1);
  droplet.position.copy(dropPos);
  group.add(droplet);

  const tmp = new THREE.Vector3();
  function update({ t, camera, renderer, height }) {
    common.uT.value = t;
    common.uPx.value = renderer.getPixelRatio();
    common.uProj.value = (height * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    common.uCam.value.copy(camera.getWorldPosition(tmp));
    // the hero drop appears once the cloud has reached it
    const s = THREE.MathUtils.clamp((t - 0.25) / 0.25, 0, 1);
    droplet.visible = s > 0;
    droplet.scale.set(s, 0.92 * s, s);
  }

  return { group, droplet, dropPos, update, uniforms: common };
}
