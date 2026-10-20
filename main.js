import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createBackground } from './background.js?v=73';

gsap.registerPlugin(ScrollTrigger);
gsap.ticker.lagSmoothing(false);    // the intro runs on real time even if a frame stalls

const S = 10;                     // the bottle is ~15 cm; scale it to ~1.5 scene units
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isNarrow = () => innerWidth < 760;

// ------------------------------------------------------------------ renderer / scene
const canvas = document.getElementById('scene');
// ?theme=light: warm light studio instead of black (the page background shows through the canvas)
const LIGHT = new URLSearchParams(location.search).get('theme') === 'light';
document.documentElement.dataset.theme = LIGHT ? 'light' : 'dark';
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: LIGHT });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const modelBox = new THREE.Box3();
const silhouette = [];
scene.background = LIGHT ? null : new THREE.Color(0x000000);   // dark: the unlit bottle disappears into black
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.01, 100);
camera.position.set(0, 0, 6);

const bg = createBackground(scene, renderer);
bg.setEnabled(false);                       // the desert video is the background now (storm/dust kept for later)

// ------------------------------------------------------------------ desert video background
// Kling clip (site/media), re-encoded as a seamless loop. Drawn as a full-screen layer behind the
// bottle; it fades in when the camera pulls back from the monogram. Edges are darkened for the text.
const deVideo = Object.assign(document.createElement('video'), {
  src: 'assets/desert.mp4?v=2', muted: true, loop: true, playsInline: true, autoplay: true, preload: 'auto',
});
deVideo.play().catch(() => addEventListener('pointerdown', () => deVideo.play(), { once: true }));
const deTex = new THREE.VideoTexture(deVideo);
deTex.colorSpace = THREE.NoColorSpace;      // sampled as-is and written as-is: no double conversion
// block 2: night sky with lightning (Kling, re-encoded as a seamless loop)
const ltVideo = Object.assign(document.createElement('video'), {
  src: 'assets/lightning.mp4?v=2', muted: true, loop: true, playsInline: true, autoplay: true, preload: 'auto',
});
ltVideo.play().catch(() => addEventListener('pointerdown', () => ltVideo.play(), { once: true }));
const ltTex = new THREE.VideoTexture(ltVideo);
ltTex.colorSpace = THREE.NoColorSpace;
// block 3: the sunset over a Texas road (Kling time-lapse). It plays by itself (not by the scroll) as
// soon as the block comes up out of the black; scrolling back into the storm rewinds it.
const ssVideo = Object.assign(document.createElement('video'), {
  src: 'assets/sunset.mp4?v=2', muted: true, playsInline: true, preload: 'auto',
});
ssVideo.pause();
const ssTex = new THREE.VideoTexture(ssVideo);
ssTex.colorSpace = THREE.NoColorSpace;
function runSunset(on) {
  if (on) {
    if (ssVideo.paused && !ssVideo.ended) ssVideo.play().catch(() => {});
  } else if (!ssVideo.paused || ssVideo.currentTime > 0) {
    ssVideo.pause();
    ssVideo.currentTime = 0;
  }
}
const deU = {
  uTex: { value: deTex }, uTex2: { value: ltTex }, uTex3: { value: ssTex }, uOpacity: { value: 0 }, uBlock2: { value: 0 }, uBlock3: { value: 0 }, uBlack: { value: 0 }, uExit: { value: 0 },
  uCover: { value: new THREE.Vector2(1, 1) },
};
const desertBg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: deU, depthTest: false, depthWrite: false,
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `uniform sampler2D uTex, uTex2, uTex3; uniform float uOpacity, uBlock2, uBlock3, uExit, uBlack; uniform vec2 uCover; varying vec2 vUv;
    void main(){
      if (uBlack > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }   // block 3: pure black
      // block 2 leaving upwards: everything moves up by uExit screens, the empty light block follows below
      vec2 sv = vec2(vUv.x, vUv.y - uExit);
      if (sv.y < 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }   // block 3 comes up from below: black
      vec2 uv = (sv - 0.5) * uCover + 0.5;                  // object-fit: cover
      // darker overall and towards the sides, where the white text sits
      float side = smoothstep(0.0, 0.42, abs(sv.x - 0.5));
      float vig = 1.0 - 0.55 * side - 0.25 * smoothstep(0.3, 0.75, length(sv - vec2(0.5, 0.45)));
      vec3 desert = texture2D(uTex, uv).rgb * 0.82 * vig * uOpacity;
      vec3 storm = texture2D(uTex2, uv).rgb * (1.0 - 0.35 * side);
      // block 1 -> block 2 through black: the desert darkens out, then the night sky comes up
      vec3 c = uBlock2 < 0.5 ? desert * (1.0 - uBlock2 * 2.0) : storm * (uBlock2 * 2.0 - 1.0);
      // block 2 -> block 3 the same way: the storm darkens out, then the sunset comes up
      if (uBlock3 > 0.0) {
        vec3 sunset = texture2D(uTex3, uv).rgb;
        c = uBlock3 < 0.5 ? c * (1.0 - uBlock3 * 2.0) : sunset * (uBlock3 * 2.0 - 1.0);
      }
      gl_FragColor = vec4(c, 1.0);                          // video pixels are already display (sRGB) colours
    }`,
}));
desertBg.frustumCulled = false;
desertBg.renderOrder = -2;                   // first: behind the bottle
scene.add(desertBg);
function fitDesert() {
  const va = 16 / 9, sa = innerWidth / innerHeight;
  deU.uCover.value.set(sa < va ? sa / va : 1, sa < va ? 1 : va / sa);
}
fitDesert();
addEventListener('resize', fitDesert);

// the lacquer and the gold reflect the desert instead of a grey studio once we see it
const studioEnvTex = scene.environment;
let desertEnvTex = null;
new THREE.TextureLoader().load('assets/desert_env.jpg', (t) => {
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  desertEnvTex = pmrem.fromEquirectangular(t).texture;
});
let scrollST = null, mainTL = null, looping = false;
// the site loops: at the very end (the opening frame again) the page jumps back to the top, the
// timeline jumps with it (no scrubbing back through the whole story)
function loopToTop() {
  looping = true;
  window.scrollTo(0, 0);
  ScrollTrigger.update();
  const tw = scrollST.getTween && scrollST.getTween();
  if (tw) tw.progress(1);
  mainTL.progress(0);
  requestAnimationFrame(() => { looping = false; });
}

const KEY_I = 60, RIM_I = 2.2;
const key = new THREE.SpotLight(0xffffff, KEY_I, 0, Math.PI / 6, 0.6);
key.position.set(-3, 4, 5);
scene.add(key);
const rim = new THREE.DirectionalLight(0xfff1d6, RIM_I);
rim.position.set(-4, 2, -3);                // the low sun is behind-left in the desert video
scene.add(rim);
// contour shot: two lights from behind the bottle, so only its rolled edges catch light
const CONTOUR_I = 7;
const backL = new THREE.DirectionalLight(0xfff4e6, 0), backR = new THREE.DirectionalLight(0xe8eeff, 0);
backL.position.set(-4, 1.5, -5);
backR.position.set(4, 0.5, -5);
scene.add(backL, backR);

// Apple-style section change: a light panel rises from the bottom edge of the screen and covers
// the black scene (the bottle sinks in the black and disappears under it); later it slides away upwards
const wipeU = { uWipe: { value: -1.001 }, uWipeOut: { value: -1.001 } };
const wipe = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: wipeU, depthTest: false, depthWrite: false,
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `uniform float uWipe, uWipeOut; varying vec2 vUv;
    void main(){
      float y = vUv.y * 2.0 - 1.0;
      if (y > uWipe || y < uWipeOut) discard;
      float v = 1.0 - 0.06 * length((vUv - vec2(0.5, 0.6)) * vec2(1.0, 1.3));   // faint vignette
      gl_FragColor = vec4(vec3(0.961, 0.961, 0.969) * v, 1.0);                    // #f5f5f7
    }`,
}));
wipe.frustumCulled = false;
wipe.renderOrder = -0.5;                     // behind the bottle, over the background (as in backup 2026-10-16_22-39)
scene.add(wipe);


// ------------------------------------------------------------------ materials
// every bottle material registers its base env intensity, so the bottle can be "lit up" (reveal)
const revealMats = [];
const reg = (m, env) => { m.userData.env = env; revealMats.push(m); return m; };

// contour shot: an edge glow (fresnel) — surfaces facing us stay black, the rolled edges light up
const contourU = { uContour: { value: 0 }, uSil: { value: 0 } };   // uSil: flat black silhouette
function withContour(sh) {
  sh.uniforms.uContour = contourU.uContour;
  sh.uniforms.uSil = contourU.uSil;
  sh.fragmentShader = 'uniform float uContour;\nuniform float uSil;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', `
  float fres = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 4.0);
  outgoingLight = mix(outgoingLight, outgoingLight * 0.15, uContour) + vec3(1.0, 0.94, 0.84) * fres * uContour * 1.6;
  #include <opaque_fragment>`).replace('#include <tonemapping_fragment>', `#include <tonemapping_fragment>
  gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0, 0.604, 0.0), uSil);   // flat lightning yellow #FFCC00, after tone mapping`);
}

const blackLacquer = () => {
  const m = reg(new THREE.MeshPhysicalMaterial({
    color: 0x060607, metalness: 0, roughness: 0.08,
    clearcoat: 1, clearcoatRoughness: 0.03,
  }), LIGHT ? 0.9 : 0.5);
  m.onBeforeCompile = withContour;
  return m;
};

// the monogram on the cap: starts white, flows into the gold foil
const WHITE = new THREE.Color(0xffffff);
// metallic gold reflectance (the photo sample #EBD9AF reads near-white once it reflects the studio)
const FOIL = new THREE.Color().setRGB(0.95, 0.66, 0.26, THREE.LinearSRGBColorSpace);
const logoMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff, metalness: 0, roughness: 0.3, emissive: 0xffffff, emissiveIntensity: 0.35,
  transparent: true, opacity: 0, envMapIntensity: 1.2,
});
// light sweep across the letters while they turn gold (only the monogram, the lacquer stays dark)
const sweepU = { uSweep: { value: -9 }, uSweepAmp: { value: 0 } };
logoMat.onBeforeCompile = (sh) => {
  Object.assign(sh.uniforms, sweepU);
  sh.uniforms.uSil = contourU.uSil;
  sh.fragmentShader = 'uniform float uSweep;\nuniform float uSweepAmp;\nuniform float uSil;\n' + sh.fragmentShader.replace(
    '#include <opaque_fragment>', `
  vec2 sp = vViewPosition.xy / max(vViewPosition.z, 1e-4);
  float band = exp(-pow((sp.x + 0.5 * sp.y - uSweep) / 0.035, 2.0));
  outgoingLight += vec3(1.0, 0.92, 0.74) * band * uSweepAmp * 2.6;
  #include <opaque_fragment>`).replace('#include <tonemapping_fragment>', `#include <tonemapping_fragment>
  gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0, 0.604, 0.0), uSil);`);
};

// glass body, as on the real bottle: a clear lacquer coat over metallic-flake gold paint, with
// glossy black sprayed over it from the top. The flakes tilt the base normal a little each, so the
// gold glitters; the smooth clear coat on top keeps one sharp gloss reflection over everything.
function gradientGlass() {
  const m = reg(new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.035,
  }), LIGHT ? 0.9 : 0.6);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uZ0 = { value: 0.060 };
    sh.uniforms.uZ1 = { value: 0.094 };
    sh.vertexShader = 'varying vec3 vBB;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\n  vBB = position;');
    sh.fragmentShader = `varying vec3 vBB;
uniform float uZ0;
uniform float uZ1;
vec3 hash3(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453);
}
float vnoise(vec3 p) {                          // smooth value noise for the uneven spray
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float n000 = hash3(i).x, n100 = hash3(i + vec3(1,0,0)).x, n010 = hash3(i + vec3(0,1,0)).x, n110 = hash3(i + vec3(1,1,0)).x;
  float n001 = hash3(i + vec3(0,0,1)).x, n101 = hash3(i + vec3(1,0,1)).x, n011 = hash3(i + vec3(0,1,1)).x, n111 = hash3(i + vec3(1,1,1)).x;
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
` + sh.fragmentShader
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
  vec3 flake = hash3(floor(vBB * 14000.0));                // ~0.07 mm metallic flakes
  vec3 drop = hash3(floor(vBB * 9000.0) + 17.0);           // ~0.1 mm spray droplets
  float spray = vnoise(vBB * 180.0) - 0.5;                 // a few-mm unevenness of the spray
  float edge = vBB.y + spray * 0.006 + (drop.x - 0.5) * 0.010;
  float t = smoothstep(uZ0, uZ1, edge);                    // 0 = gold, 1 = black
  t = mix(t, step(0.5, t), 0.3);                           // droplets: black is mostly there or not
  vec3 gold = vec3(0.96, 0.63, 0.09) * (0.86 + 0.28 * flake.y);   // saturated yellow gold, as in the photos
  diffuseColor.rgb = mix(gold, vec3(0.006, 0.006, 0.007), t);
  metalnessFactor = mix(1.0, 0.0, t);
  roughnessFactor = mix(0.3, 0.09, t);
  float flakeAmt = (1.0 - t) * 0.35;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  normal = normalize(normal + (flake - 0.5) * flakeAmt);    // each flake catches the light differently`);
    withContour(sh);
  };
  return m;
}

// the stand: satin black, a softer sheen than the glossy cap
const satinBlack = () => {
  const m = reg(new THREE.MeshPhysicalMaterial({
    color: 0x070708, metalness: 0, roughness: 0.38, clearcoat: 0.35, clearcoatRoughness: 0.25,
  }), LIGHT ? 0.9 : 0.5);
  m.onBeforeCompile = withContour;
  return m;
};

// ------------------------------------------------------------------ bottle
const bottle = new THREE.Group();          // pivot at the centre of the bottle
scene.add(bottle);
let A = null;
let standMat = null;
                              // anchors.json
let capKey = null, keyRestZ = 0;

async function buildBottle() {
  // no-store: the model is re-exported from Blender often, never serve a stale copy
  A = await fetch('assets/anchors.json', { cache: 'no-store' }).then((r) => r.json());
  const gltf = await new GLTFLoader().loadAsync(`assets/bottle.glb?v=${Date.now()}`);
  const model = gltf.scene;
  model.scale.setScalar(S);
  model.position.set(-A.center[0] * S, -A.center[1] * S, -A.center[2] * S);
  model.traverse((o) => {
    if (!o.isMesh) return;
    const n = o.name.replace(/_/g, ' ');
    if (n.startsWith('Bottle body')) o.material = gradientGlass();
    else if (n.startsWith('Logo')) { o.material = logoMat; o.renderOrder = 2; }
    else if (n.startsWith('Stand')) { o.material = satinBlack(); o.material.transparent = true; standMat = o.material; }
    else o.material = blackLacquer();
  });
  model.traverse((o) => {
    if (o.name.replace(/_/g, ' ') === 'Cap key') { capKey = o; keyRestZ = o.rotation.z; }
  });
  bottle.add(model);
  bottleModel = model;
  modelBox.setFromObject(model);             // pivot space (bottle has no rotation yet)
  model.updateMatrixWorld(true);
  model.traverse((o) => {                      // every ~3rd vertex in pivot space, for the text layout
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 3) silhouette.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
  });
}

// ------------------------------------------------------------------ hand (blender/build_hand_rig.py)
// a live skinned hand (the user's rigged arm), fitted to the bottle in Blender (build_hand_grip.py):
// solved in blender/build_hand_ik.py: it comes up from below and holds the base with three finger
// pads (index + middle on the bottom tip of the glass, the thumb on the end of the stand), checked
// against the bottle meshes. It lives in the bottle model's own space, so the two never drift apart.
// Clip "grip": first key = relaxed open hand, last key = the pinch. As in the reference the fingers
// never twitch on their own: they follow the scroll only and close in a cascade (outer fingers
// first, the thumb last); the life comes from the whole hand turning as it rises.
const hand = new THREE.Group();          // child of the bottle model (metres, the Blender bottle space)
hand.visible = false;
let bottleModel = null;
let handMesh = null, HR = null;
const fingerPose = [];                    // [bone, open quaternion, pinch quaternion, delay]
const handBones = {}, handRest = {};
const skinMat = reg(new THREE.MeshPhysicalMaterial({
  // skin is nearly matte: one soft, wide highlight, no lacquer coat (it read as oil)
  color: 0x7a4b36, roughness: 0.68, specularIntensity: 0.45,
  sheen: 0.18, sheenRoughness: 0.7, sheenColor: 0xb7805c,
}), 0.22);
// the user's own skin (arm/skin, from the 4K-upscaled photos of their hand): colour-variation and
// fine-relief maps for the back of the hand (6.4 cm tile) and for the palm (3 cm tile, the clean
// pad at the thumb base: no big palm lines repeating over the fingers); only fine detail is kept, put on with a triplanar projection in the hand's bind pose, so the pattern stays on the
// skin while the fingers move; mirrored tiles never show a seam. Palm vs back: the surface normal
// against the palm direction of the rest pose (PALM_N, from the rig's middle-finger base bone).
{
  const tl = new THREE.TextureLoader();
  const sDetail = tl.load('assets/skin_detail.jpg'), sNormal = tl.load('assets/skin_normal.jpg');
  const pDetail = tl.load('assets/skin_palm_detail.jpg'), pNormal = tl.load('assets/skin_palm_normal.jpg');
  for (const t of [sDetail, sNormal, pDetail, pNormal]) { t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping; t.anisotropy = 8; }
  // nails and knuckles (blender/hand_details.py marks them per vertex: _nail/_nailuv, _joint/_jointuv, _crease)
  const nailTex = tl.load('assets/skin_nail.jpg'), knTex = tl.load('assets/skin_knuckle.jpg');
  nailTex.colorSpace = THREE.SRGBColorSpace;
  for (const t of [nailTex, knTex]) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 8; }
  skinMat.onBeforeCompile = (sh) => {
    sh.uniforms.uSkinD = { value: sDetail };
    sh.uniforms.uSkinN = { value: sNormal };
    sh.uniforms.uPalmD = { value: pDetail };
    sh.uniforms.uPalmN = { value: pNormal };
    sh.uniforms.uNail = { value: nailTex };
    sh.uniforms.uKnuckle = { value: knTex };
    sh.vertexShader = `varying vec3 vBindPos;
varying vec3 vBindNrm;
varying mat3 vSkinBasis;
attribute float _nail; attribute vec2 _nailuv; attribute float _tip; attribute float _joint; attribute vec2 _jointuv; attribute float _crease;
varying float vNail; varying vec2 vNailUv; varying float vTip; varying float vJoint; varying vec2 vJointUv; varying float vCrease;
` + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  vBindPos = position; vBindNrm = normal;
  vSkinBasis = normalMatrix;
  vNail = _nail; vNailUv = _nailuv; vTip = _tip; vJoint = _joint; vJointUv = _jointuv; vCrease = _crease;`);
    sh.fragmentShader = `uniform sampler2D uSkinD;
uniform sampler2D uSkinN;
uniform sampler2D uPalmD;
uniform sampler2D uPalmN;
uniform sampler2D uNail;
uniform sampler2D uKnuckle;
varying float vNail; varying vec2 vNailUv; varying float vTip; varying float vJoint; varying vec2 vJointUv; varying float vCrease;
const vec3 PALM_N = vec3(-0.379, -0.103, 0.92);
const float PALM_TILE = 0.030;
varying vec3 vBindPos;
varying vec3 vBindNrm;
varying mat3 vSkinBasis;
const float SKIN_TILE = 0.064;
vec3 triW() { vec3 w = pow(abs(normalize(vBindNrm)), vec3(4.0)); return w / (w.x + w.y + w.z); }
vec3 tri(sampler2D t, vec3 p, vec3 w) { return texture2D(t, p.yz).rgb * w.x + texture2D(t, p.xz).rgb * w.y + texture2D(t, p.xy).rgb * w.z; }
vec3 triN(sampler2D t, vec3 p, vec3 w) {
  vec2 nx = texture2D(t, p.yz).xy * 2.0 - 1.0, ny = texture2D(t, p.xz).xy * 2.0 - 1.0, nz = texture2D(t, p.xy).xy * 2.0 - 1.0;
  return vec3(0.0, nx.x, nx.y) * w.x + vec3(ny.x, 0.0, ny.y) * w.y + vec3(nz.x, nz.y, 0.0) * w.z;
}
` + sh.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
  vec3 tw = triW();
  vec3 sp = vBindPos / SKIN_TILE, pp = vBindPos / PALM_TILE;
  float palm = smoothstep(0.15, 0.55, dot(normalize(vBindNrm), PALM_N));
  vec3 dC = mix(tri(uSkinD, sp, tw), tri(uPalmD, pp, tw), palm);
  dC = mix(vec3(dot(dC, vec3(0.333))), dC, 0.35);                  // the pattern, not the light skin's pink
  diffuseColor.rgb *= mix(vec3(1.0), dC * 2.0, 0.6);
  // dark brown skin: the palm, the finger pads and the fingertips are lighter and warmer
  float light = max(palm * 0.85, clamp(vTip, 0.0, 1.0) * 0.55);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.9, 1.85, 1.95), light);   // pads and tips: pinkish beige
  // knuckles: the wrinkles and the redness of the user's own knuckle
  vec3 kn = texture2D(uKnuckle, vJointUv).rgb * 2.0;
  vec3 knd = pow(mix(vec3(dot(kn, vec3(0.333))), kn, 0.3), vec3(1.6));          // deeper wrinkles
  diffuseColor.rgb *= mix(vec3(1.0), knd * vec3(0.66, 0.62, 0.62), clamp(vJoint, 0.0, 1.0));   // knuckles clearly darker
  // flexion creases on the palm side: thin, slightly darker and pinker lines
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.62, 0.55, 0.52), clamp(vCrease, 0.0, 1.0));
  // nails: the user's own nail (lunula at the cuticle, the free edge at the tip)
  float nailM = clamp(vNail, 0.0, 1.0);
  vec3 nc = texture2D(uNail, vNailUv).rgb;
  float nl = dot(nc, vec3(0.333));
  nc = mix(vec3(nl), nc, 1.15) * vec3(0.93, 0.84, 0.82);        // the photo's glare out of the lunula
  nc = min(nc, vec3(0.78, 0.62, 0.58)) * vec3(0.66, 0.46, 0.4);   // pinkish beige, lighter than the skin   // nails on dark skin: a warm light tan
  diffuseColor.rgb = mix(diffuseColor.rgb, nc, nailM);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = mix(roughnessFactor, 0.38, clamp(vNail, 0.0, 1.0));   // nails: a little glossier than skin`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    vec3 pert = mix(triN(uSkinN, sp, tw), triN(uPalmN, pp, tw) * 0.55, palm) * (1.0 - clamp(vNail, 0.0, 1.0) * 0.9);
    normal = normalize(normal + vSkinBasis * pert * 0.9);
  }`);
  };
}
async function buildHand() {
  HR = await fetch('assets/hand_rig.json', { cache: 'no-store' }).then((r) => r.json());
  const gltf = await new GLTFLoader().loadAsync(`assets/hand_rig.glb?v=${Date.now()}`);
  gltf.scene.traverse((o) => {
    if (o.isSkinnedMesh) { o.material = skinMat; o.frustumCulled = false; handMesh = o; }
    if (o.isBone) { handBones[o.name] = o; handRest[o.name] = o.quaternion.clone(); }
  });
  hand.add(gltf.scene);
  // the two key poses straight from the clip's tracks
  const DELAY = { PI: 0, R: 0.07, M: 0.14, P: 0.2, T: 0.3 };
  const clip = gltf.animations.find((c) => c.name === 'grip') || gltf.animations[0];
  for (const tr of clip.tracks) {
    const [name, prop] = tr.name.split('.');
    if (prop !== 'quaternion' || !handBones[name] || !name.startsWith('F_')) continue;
    const v = tr.values, n = v.length;
    fingerPose.push([handBones[name], new THREE.Quaternion().fromArray(v, 0),
      new THREE.Quaternion().fromArray(v, n - 4), DELAY[name.split('_')[1]] || 0]);
  }
}
// the bottle turns in the hand around the middle of the grip (between the glass tip and the stand end)
const GRIP_POINT = [0.025, 0.002, 0];
const gripLocal = new THREE.Vector3(), gripW = new THREE.Vector3(), spunW = new THREE.Vector3();
const smooth = (x) => { x = Math.min(Math.max(x, 0), 1); return x * x * (3 - 2 * x); };

function poseHand() {
  // each finger closes over its own part of the grip: pinky first ... thumb last
  for (const [bone, qo, qp, d] of fingerPose) bone.quaternion.slerpQuaternions(qo, qp, smooth((state.grip - d) / 0.7));
}

// anchor (model space) -> pivot space
const anchorLocal = (name) => new THREE.Vector3(
  (A[name][0] - A.center[0]) * S, (A[name][1] - A.center[1]) * S, (A[name][2] - A.center[2]) * S);
const Y = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------------ choreography
// hero: the camera sits right in front of the monogram on the cap, square to the cap face.
// Scrolling pulls it back: the monogram turns out to be on the bottle.
// Each stop: bottle rotation, the point the camera looks at, distance, elevation, sideways shift.
let HERO_ROT = Math.PI / 2;                // set from the monogram's normal once anchors load
// shift > 0 moves the bottle to the right half of the frame (text sits on the left)
// 'glance' is passed through without stopping (no label, no hold).
const PROFILE_ROT = -0.42 + Math.PI / 3;   // turned 60° from the previous angle
const SPIN_LAST = 1.6;                     // how far the hand itself turns the bottle, to face us (rad)
const STOPS = () => [
  { id: 'glance', pass: true, rotY: HERO_ROT - 0.55, focus: 'center', dist: 3.4, elev: 0.1, shift: 0 },
  // close and big (cap + upper body fill the frame), turned 60° clockwise (seen from above)
  { id: 'profile', rotY: PROFILE_ROT, focus: 'center', dist: 1.9, elev: 0.08, shift: 0, lift: 0.22, textLead: 0.6 },
  // the light panel rises from the bottom OVER the bottle and covers the whole screen (only text on it).
  // Meanwhile the bottle sinks in the black and moves back a little: its cap is the last thing to go
  { id: 'white', rotY: PROFILE_ROT, focus: 'cap', dist: 2.6, elev: 0.08, shift: 0, white: 1, lift: 0.56 },
  // from there the bottle rises and turns side-on to us: the whole lightning profile on the light panel
  { id: 'side', rotY: 0, focus: 'center', dist: 3.6, elev: 0, shift: 0, sil: 1 },   // rises side-on and becomes a yellow lightning bolt
  // bigger, sliding towards the lower right; the key is pressed, the caption rises on the left
  { id: 'key', rotY: -0.4, focus: 'cap', dist: 1.6, elev: 0.2, shift: 1.0, lift: 0.14, press: 1 },
  // back to the centre, facing us (the monogram side)
  { id: 'front', rotY: HERO_ROT, focus: 'center', dist: 4.0, elev: 0.04, shift: 0 },
  // block 2 -> 3 as 1 -> 2, through black (b3 0 -> 0.5); the bottle stays and keeps spinning
  // block 3: a pure black section right under block 2 — block 2 scrolls away upwards, the black one
  // comes up from below; the bottle stays in the centre and closes in, facing us. The lower half of
  // the black block fades over the bottle (#fade, moves with the block), a centred caption sits there
  { id: 'black', rotY: PROFILE_ROT, focus: 'center', dist: 2.5, elev: 0.04, shift: 0, lift: 0.2, exit: 1, dur: 3.2 },   // the bottle settles a little lower
  // --- the sunset + hand version, switched off for now ---
  // { id: 'dive', pass: true, rotY: HERO_ROT + Math.PI, focus: 'center', dist: 4.0, elev: 0.04, shift: 0, b3: 0.5, dur: 3.0 },
  // the sunset comes up (b3 0.5 -> 1), the spin slows down, a hand comes up from below and takes it;
  // then the hand turns it the last bit, to face us (spin = SPIN_LAST)
  // { id: 'hand', rotY: HERO_ROT + Math.PI * 2 - SPIN_LAST, focus: 'center', dist: 5.2, elev: 0.26, shift: 0, lift: -0.3, b3: 1, dur: 5.5, hand: 1 },
  // --- the stops below the light block are switched off for now ---
  // { id: 'press', rotY: -0.95, focus: 'cap', dist: 1.5, elev: 0.32, shift: 0.45, press: 1 },
  // { id: 'gradient', rotY: 0.18, focus: 'gradient', dist: 2.1, elev: 0.04, shift: 0.45 },
  // { id: 'stand', rotY: 0.75, focus: 'foot', dist: 1.7, elev: 0.3, shift: 0.45 },
  // { id: 'finale', rotY: Math.PI * 2 + HERO_ROT - 0.5, focus: 'center', dist: 4.6, elev: 0.08, shift: 0.55 },
];

// ------------------------------------------------------------------ text (masked line reveals)
// Each line is clipped by its own mask and slides up into place; the paragraph follows.
// A {a|b|c} group in a line becomes a word carousel (the word slides out up, the next slides in).
const TEXT = {
  // big angled bottle: brand top-left, name bottom-right, both rise out of their masks
  profile: { cls: 'split', h: ['CAROLINA HERRERA', 'Bad Boy Extreme'], p: '' },
  side: { cls: 'narrow', h: ['my thunder.'], p: '' },
  key: { h: ['my fashion.'], p: '' },
  white: { cls: 'title', h: ['Bad Boy {Extreme|Electric|Intense}'], p: 'Eau de Parfum Extreme · 50 мл' },
  firsov: { cls: 'sign', h: ['FIRSOV'], p: '' },
  black: { cls: 'center', h: ['spice up front. cocoa underneath.'], p: 'ginger, wormwood, bergamot. sandy vetiver, cocoa, patchouli. warm, dark, a little dangerous.' },
  press: { h: ['Нажми —', 'и молния', 'оживает'], p: 'Клавиша-крышка уходит вниз и ложится на скос, закрывая заднюю грань.' },
  gradient: { h: ['Из чёрного', 'в золото'], p: 'Глянцевый лак растворяется в сатиновом золоте с напылением.' },
  stand: { h: ['Держит', 'наклон'], p: 'Чёрная пластина повторяет хвост молнии и держит флакон под углом.' },
  finale: { h: ['Bad Boy', 'Extreme'], p: 'Carolina Herrera New York' },
};

const textRoot = document.getElementById('text');
let blackText = null;
const blocks = {};
for (const [id, t] of Object.entries(TEXT)) {
  const el = document.createElement('section');
  el.className = 'tblock' + (t.cls ? ' ' + t.cls : '');
  const lines = t.h.map((line) => {
    const m = line.match(/\{(.+)\}/);
    if (!m) return `<span class="mask"><span class="ln">${line}</span></span>`;
    const words = m[1].split('|').map((w) => `<span class="w">${w}</span>`).join('');
    return `<span class="mask"><span class="ln">${line.slice(0, m.index)}<span class="rot">${words}</span></span></span>`;
  }).join('');
  el.innerHTML = `<h2>${lines}</h2>` + (t.p ? `<p><span class="mask"><span class="ln">${t.p}</span></span></p>` : '');
  textRoot.appendChild(el);
  gsap.set(el.querySelectorAll('.ln'), { yPercent: id === 'black' ? 0 : 110 });   // hidden below their masks
  if (id === 'black') { blackText = el; continue; }            // rides with the black block (frame())
  blocks[id] = el;
}

let shown = null;
const visible = new Set();
function showText(id) {
  if (!blocks[id]) id = null;
  if (id === shown) return;
  shown = id;
  for (const [bid, el] of Object.entries(blocks)) {
    const lns = el.querySelectorAll('.ln');
    gsap.killTweensOf(lns);
    if (bid === id) continue;
    if (visible.has(bid)) {                                  // visible lines leave upwards
      visible.delete(bid);
      gsap.to(lns, { yPercent: -110, opacity: 1, duration: 0.5, ease: 'power3.in', stagger: 0.04,
        onComplete: () => gsap.set(lns, { yPercent: 110 }) });
    } else {
      gsap.set(lns, { yPercent: 110 });
    }
  }
  if (!id) return;
  const el = blocks[id];
  visible.add(id);
  gsap.fromTo(el.querySelectorAll('h2 .ln'), { yPercent: 110 },
    { yPercent: 0, duration: 1.1, ease: 'expo.out', stagger: 0.09, delay: 0.05 });
  gsap.fromTo(el.querySelectorAll('p .ln'), { yPercent: 110, opacity: 0 },
    { yPercent: 0, opacity: 1, duration: 1, ease: 'expo.out', delay: 0.55 });
}

// word carousel: every 2.4 s the visible word slides up and out, the next one rises in
document.querySelectorAll('.rot').forEach((rot) => {
  const ws = [...rot.querySelectorAll('.w')];
  gsap.set(ws, { yPercent: 110 });
  gsap.set(ws[0], { yPercent: 0 });
  let i = 0;
  setInterval(() => {
    if (REDUCED) return;
    const a = ws[i], b = ws[(i = (i + 1) % ws.length)];
    gsap.to(a, { yPercent: -110, duration: 0.7, ease: 'power3.inOut' });
    gsap.fromTo(b, { yPercent: 110 }, { yPercent: 0, duration: 0.9, ease: 'expo.out', delay: 0.15 });
  }, 2400);
});

const state = {
  hero: 1, reveal: 0, logoIn: 0, gold: 0, sweep: -1, zoom: 1.35,
  rotY: Math.PI / 2, tx: 0, ty: 0, tz: 0, dist: 4.3, elev: 0.1, shift: 0, press: 0,
  contour: 0, white: 0, whiteOut: 0, sil: 0, exit: 0, b3: 0, black: 0, handIn: 0, grip: 1, spin: 0,
};

function targetFor(stop) {
  const p = stop.focus === 'center' ? new THREE.Vector3() : anchorLocal(stop.focus);
  return p.applyAxisAngle(Y, stop.rotY);
}

// ------------------------------------------------------------------ timeline (scroll)
const HOLD = 1.0;
let holding = false, lastStop = null;

function buildTimeline() {
  const tl = gsap.timeline({ defaults: { ease: 'power2.inOut' } });
  tl.addLabel('hero', 0);
  // first scroll: the white monogram flows into gold while the light sweeps across it
  tl.to(state, { gold: 1, duration: 1.0, ease: 'power1.inOut' });
  tl.fromTo(state, { sweep: -1 }, { sweep: 1, duration: 0.9, ease: 'none', immediateRender: false }, 0.45);
  tl.addLabel('gold');
  tl.to({}, { duration: 0.4 });
  const holds = [];
  const stops = STOPS();
  const holdIds = [];
  const textWin = [];
  const whiteAt = stops.findIndex((s) => s.white);
  stops.forEach((s, k) => {
    const first = k === 0;
    const prevPass = k > 0 && stops[k - 1].pass;
    const t = targetFor(s);
    const dur = s.dur || (s.white ? 2.4 : first ? 2.6 : prevPass ? 2.4 : 1.6);
    tl.to(state, {
      ...(s.turnBy ? {} : { rotY: s.rotY }), tx: t.x, ty: t.y + (s.lift || 0), tz: t.z, dist: s.dist, elev: s.elev, shift: s.shift, press: 0,
      contour: s.contour || 0, sil: 0, exit: s.exit || 0, b3: s.b3 || 0,     // sil only changes while standing (see hold)
      white: k >= whiteAt ? 1 : 0,                                     // once light, stays light
      whiteOut: s.leaveWhite ? 1 : 0,                                  // the panel leaves only where a stop says so
      ...(first ? { hero: 0, reveal: 1 } : {}),
      // longer = more scrolling for the move = slower on screen
      duration: dur,
      // a pass-through stop accelerates in and the next one decelerates out: one continuous move
      ease: s.hand ? 'power4.out' : s.pass ? 'power2.in' : prevPass ? 'power2.out' : 'power2.inOut',
    });
    // turnBy: the rotation finishes earlier than the rest of the move (fraction of the move)
    if (s.turnBy) tl.to(state, { rotY: s.rotY, duration: dur * s.turnBy, ease: 'power2.inOut' }, '<');
    // the hand comes up from below in the second half of the descent and meets the bottle
    if (s.hand) {
      tl.fromTo(state, { handIn: 0 }, { handIn: 1, duration: dur * 0.5, ease: 'power2.out', immediateRender: false }, '<');
    }
    if (s.pass) return;
    tl.addLabel(s.id);
    const start = tl.duration();
    if (s.sil) {
      // standing still in profile: turn into the bolt, stay, turn back, and only then move on
      tl.to(state, { sil: 1, duration: 0.6, ease: 'power1.inOut' });
      tl.to({}, { duration: 0.9 });
      tl.to(state, { sil: 0, duration: 0.6, ease: 'power1.inOut' });
    } else if (s.hand) {
      tl.to(state, { spin: 1, duration: 3.2, ease: 'power2.inOut' });   // the hand turns it to face us
      tl.to({}, { duration: HOLD * 0.6 });
    } else if (s.press) {
      tl.to(state, { press: 1, duration: HOLD * 0.6, ease: 'power1.inOut' });
      tl.to({}, { duration: HOLD * 0.4 });
    } else {
      tl.to({}, { duration: s.id === 'finale' ? 0.4 : HOLD });
    }
    holds.push([start, tl.duration()]);
    textWin.push([start - (s.textLead || 0), tl.duration()]);
    holdIds.push(s.id);
  });
  // finale: the bottle turns to face us and the camera flies back into the monogram (the opening
  // frame); the monogram fades into the black and the signature comes up
  tl.to(state, { rotY: HERO_ROT, hero: 1, reveal: 0, duration: 3.4, ease: 'power2.inOut' });   // still gold
  // close up on the monogram: the gold flows back to white with the light sweeping back across it
  tl.to(state, { gold: 0, duration: 1.2, ease: 'power1.inOut' });
  tl.fromTo(state, { sweep: 1 }, { sweep: -1, duration: 1.1, ease: 'none', immediateRender: false }, '<0.05');
  tl.to(state, { logoIn: 0, duration: 1.0, ease: 'power1.inOut' });
  const signAt = tl.duration();
  tl.to({}, { duration: 1.8 });
  holds.push([signAt, tl.duration()]);
  textWin.push([signAt, tl.duration() + 1]);
  holdIds.push('firsov');
  mainTL = tl;

  document.getElementById('track').style.height = `${100 + tl.duration() * 105}vh`;   // scroll per unit of the story (was 131.6: ~20% faster now)
  scrollST = ScrollTrigger.create({
    trigger: '#track', start: 'top top', end: 'bottom bottom', scrub: 2.6, animation: tl,
    snap: false,   // no settling onto stops: the scene follows the scroll exactly
    // snap: { snapTo: 'labels', inertia: false, duration: { min: 1.0, max: 2.2 }, delay: 0.35, ease: 'sine.inOut' },
  });
  // the timeline itself (not the scroll) decides: with scrub it keeps moving after the scroll stops
  tl.eventCallback('onUpdate', () => {
    const t = tl.time();
    const k = holds.findIndex(([a, b]) => t >= a - 0.06 && t <= b + 0.06);
    holding = k >= 0;
    const kt = textWin.findIndex(([a, b]) => t >= a && t <= b + 0.06);   // text may start before the stop
    const id = kt >= 0 ? holdIds[kt] : null;
    if (id && id !== lastStop && id !== 'white') bg.strike(1);   // a flash greets every dark stop
    lastStop = id;
    showText(id);
  });
}

// ------------------------------------------------------------------ intro (time based)
function intro() {
  const d = REDUCED ? 0.01 : 1;
  gsap.timeline()
    .to(state, { logoIn: 1, duration: 2.0 * d, ease: 'power2.out' }, 0.4 * d)
    .to(state, { zoom: 1, duration: 3.2 * d, ease: 'expo.out' }, 0.4 * d);
}

// ------------------------------------------------------------------ split text never covers the bottle
const corner = new THREE.Vector3();
const splitMasks = () => blocks.profile.querySelectorAll('h2 .mask');
const probeCam = new THREE.PerspectiveCamera();
const probeRot = new THREE.Matrix4();
function layoutSplitText() {
  // where the bottle will be on screen once the camera has arrived at the 'profile' stop
  const st = STOPS().find((x) => x.id === 'profile');
  const tgt = targetFor(st); tgt.y += st.lift || 0;
  probeCam.copy(camera);
  probeCam.position.set(tgt.x, tgt.y + Math.sin(st.elev) * st.dist, tgt.z + Math.cos(st.elev) * st.dist);
  probeCam.lookAt(tgt);
  probeCam.updateMatrixWorld();
  probeRot.makeRotationY(st.rotY);
  let minX = Infinity, maxX = -Infinity;
  for (const v of silhouette) {
    corner.copy(v).applyMatrix4(probeRot).project(probeCam);
    if (corner.y < -1 || corner.y > 1) continue;            // parts below/above the screen don't matter
    const x = (corner.x * 0.5 + 0.5) * innerWidth;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
  }
  // the font size stays fixed; a line that does not fit into the free space wraps onto a second line
  const edge = innerWidth * 0.06, gap = 56;
  const [brand, name] = splitMasks();
  brand.style.maxWidth = `${Math.max(minX - edge - gap, 0)}px`;     // words never break, so a line is at
  name.style.maxWidth = `${Math.max(innerWidth - maxX - edge - gap, 0)}px`;   // least one word wide
}
addEventListener('resize', () => requestAnimationFrame(layoutSplitText));

// ------------------------------------------------------------------ frame loop
const mouse = new THREE.Vector2();
addEventListener('pointermove', (e) => mouse.set(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5));

const clock = new THREE.Clock();
const camStop = new THREE.Vector3(), tgtStop = new THREE.Vector3();
const camHero = new THREE.Vector3(), tgtHero = new THREE.Vector3();
const nrm = new THREE.Vector3(), right = new THREE.Vector3(), tmp = new THREE.Vector3();

function heroDistance() {
  // monogram ~8.5 x 6.2 mm on the bottle: fill ~40% of the height / ~60% of the width
  const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const h = 0.0062 * S * 0.5 / 0.4 / tanH;
  const w = 0.0085 * S * 0.5 / 0.6 / (tanH * camera.aspect);
  return Math.max(h, w);
}

let lastT = 0;
const collageEl = document.getElementById('collage');
const fadeEl = document.getElementById('fade');
function frame() {
  const t = clock.getElapsedTime();
  const h = state.hero;

  // bottle pose
  const idle = holding && h < 0.01 ? Math.sin(t * 0.8) * 0.025 : 0;
  const baseRot = state.rotY + idle + mouse.x * 0.08 * (1 - h);
  const spin = state.spin * SPIN_LAST;             // the hand turns it round, to face us
  bottle.rotation.y = baseRot + spin;
  bottle.position.set(0, 0, 0);
  if (A && spin) {
    // turning in the hand: around the vertical axis through the point where the fingers hold it
    gripW.copy(gripLocal).applyAxisAngle(Y, baseRot);
    spunW.copy(gripW).applyAxisAngle(Y, spin);
    bottle.position.set(gripW.x - spunW.x, 0, gripW.z - spunW.z);
  }
  bottle.updateMatrixWorld();
  if (capKey) capKey.rotation.z = keyRestZ - state.press * A.press_angle;

  // the bottle is unlit (black on black) until we pull back from the monogram
  const r = state.reveal, c = state.contour, w = state.white;
  deU.uOpacity.value = r;
  // warm desert reflections, also over the sunset block
  if (desertEnvTex) scene.environment = r > 0.5 ? desertEnvTex : studioEnvTex;
  const covered = w * (1 - state.whiteOut);                    // how much of the screen the light panel covers
  const envK = r * (1 - 0.92 * c);                            // contour: almost no reflections
  revealMats.forEach((m) => { m.envMapIntensity = m.userData.env * envK; });
  // sunset block: the low sun sits right behind the bottle -> a strong warm back light, a dim warm front
  const sun = Math.max(0, state.b3 * 2 - 1);
  key.intensity = KEY_I * r * (1 - c) * (1 - 0.55 * sun);
  key.color.setRGB(1, 1 - 0.18 * sun, 1 - 0.35 * sun);
  rim.intensity = RIM_I * r * (1 - c) * (1 + 1.6 * sun);
  rim.color.setRGB(1, 0.945 - 0.38 * sun, 0.84 - 0.6 * sun);
  rim.position.set(-4 + 4 * sun, 2 - 1.4 * sun, -3 - 2 * sun);     // from the horizon, behind
  backL.intensity = backR.intensity = CONTOUR_I * c;
  contourU.uContour.value = c;
  contourU.uSil.value = state.sil;
  // at the same time: the stand is painted yellow with the bottle while it fades away
  // (squared so the fade lags a little and the yellow is visible on it)
  if (standMat) {
    const fade = state.sil * state.sil;
    standMat.opacity = 1 - fade;
    standMat.depthWrite = fade < 0.5;
  }
  // block 2 is the lightning video now (the light panel is switched off, text stays white)
  wipeU.uWipe.value = -1.001;
  deU.uBlock2.value = w;
  deU.uExit.value = state.exit;
  deU.uBlock3.value = state.b3;
  deU.uBlack.value = state.black;
  // the black block's caption is on the block: it comes up with it and goes as we fly into the monogram
  if (blackText) {
    blackText.style.transform = `translate3d(0, ${(1 - state.exit) * 100}vh, 0)`;
    blackText.style.opacity = state.exit > 0.001 ? 1 - Math.min(1, state.hero * 12) : 0;   // gone as soon as the turn to the monogram starts
  }
  // the black block's fade rides up with it
  fadeEl.style.opacity = state.exit > 0.001 ? 1 - state.hero : 0;   // gone again as we fly into the monogram
  fadeEl.style.transform = `translate3d(0, ${(1 - state.exit) * 100}vh, 0)`;
  runSunset(state.b3 > 0.5);                       // the sunset plays by itself once block 3 is up
  // the photo collage sits on the dark grey block and comes up with it
  // (the collage is switched off: the light block holds the hand scene now)
  collageEl.style.visibility = 'hidden';

  // hand: comes up from below and takes the spinning bottle (bottle model space). The approach is the
  // path checked in Blender (blender/check_hand_approach.py, same formula): nothing goes into the glass.
  hand.visible = !!handMesh && state.handIn > 0.001;
  if (hand.visible) {
    const k = 1 - state.handIn, kk = k * k;
    hand.position.set(-0.07 * k, -0.07 * k - 0.25 * kk, 0);
    hand.rotation.set(0, 0, 0);
    state.grip = smooth((state.handIn - 0.55) / 0.45);
    poseHand();
  }

  // monogram: fade in white, flow into gold foil
  logoMat.opacity = state.logoIn;
  logoMat.color.copy(WHITE).lerp(FOIL, state.gold);
  logoMat.metalness = state.gold;
  logoMat.roughness = 0.3 + 0.08 * state.gold;
  logoMat.emissiveIntensity = 0.35 * (1 - state.gold);
  logoMat.envMapIntensity = 1.2 - 0.85 * state.gold;     // bright studio reflections would bleach the gold

  // camera at the stop
  const shift = isNarrow() ? 0 : state.shift;
  tgtStop.set(state.tx - shift * state.dist * 0.18, state.ty, state.tz);
  camStop.set(tgtStop.x, tgtStop.y + Math.sin(state.elev) * state.dist, tgtStop.z + Math.cos(state.elev) * state.dist);

  // camera square in front of the monogram (follows the bottle's current rotation)
  tgtHero.copy(anchorLocal('logo'));
  bottle.localToWorld(tgtHero);
  nrm.set(...A.logo_normal).applyAxisAngle(Y, bottle.rotation.y).normalize();
  right.crossVectors(Y, nrm).normalize();
  camHero.copy(tgtHero).addScaledVector(nrm, heroDistance() * state.zoom)
    .addScaledVector(right, mouse.x * -0.02).addScaledVector(Y, mouse.y * 0.015);

  // blend the two (eased so the pull-back starts and lands softly)
  const k = h * h * (3 - 2 * h);
  camera.position.lerpVectors(camStop, camHero, k);
  camera.lookAt(tmp.lerpVectors(tgtStop, tgtHero, k));

  // light sweep across the monogram while it turns gold
  sweepU.uSweep.value = state.sweep * 0.45;
  sweepU.uSweepAmp.value = Math.sin(Math.PI * THREE.MathUtils.clamp((state.sweep + 1) / 2, 0, 1));


  const now = clock.getElapsedTime();
  bg.update(Math.min(now - lastT, 0.1), { vis: state.reveal * (1 - covered), scrollVel: scrollST ? scrollST.getVelocity() : 0 });
  lastT = now;


  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// ------------------------------------------------------------------ boot
Promise.all([buildBottle(), buildHand()]).then(() => {
  bottleModel.add(hand);                     // the hand lives in the bottle's space
  // turn the bottle so the monogram's face looks straight at the camera (+Z)
  HERO_ROT = Math.atan2(-A.logo_normal[0], A.logo_normal[2]);
  gripLocal.set((GRIP_POINT[0] - A.center[0]) * S, (GRIP_POINT[1] - A.center[1]) * S, (GRIP_POINT[2] - A.center[2]) * S);
  state.rotY = HERO_ROT;
  buildTimeline();
  ScrollTrigger.refresh();                   // measure the scroll track now, not on the first scroll
  layoutSplitText();
  renderer.compile(scene, camera);           // compile shaders before the intro, not during it
  scrollTo(0, 0);
  intro();
  frame();
});
