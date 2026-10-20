import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createSpray } from './spray.js';

// Standalone preview of the spray: the bottle, a press, the cloud, and a macro look at one droplet.
const S = 10;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const DARK = new THREE.Color(0x000000), SAND = new THREE.Color(0xe7d4b4);
scene.background = DARK.clone();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(renderer), 0.04).texture;

const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.01, 200);
camera.position.set(0.3, 0.35, 4.8);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(-0.9, 0.3, 0);

// light from behind and to the left: the spray is back-lit, the way it glows in perfume films
const LIGHT_POS = new THREE.Vector3(-3.5, 2.2, -4.5);
const back = new THREE.DirectionalLight(0xfff3e2, 3.2); back.position.copy(LIGHT_POS); scene.add(back);
const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(3, 3, 5); scene.add(key);

const lacquer = new THREE.MeshPhysicalMaterial({ color: 0x060607, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 0.5 });
const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.035, envMapIntensity: 0.6 });
glass.onBeforeCompile = (sh) => {       // black on top, metallic gold below (simplified version of the site shader)
  sh.vertexShader = 'varying vec3 vBB;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vBB = position;');
  sh.fragmentShader = 'varying vec3 vBB;\n' + sh.fragmentShader.replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
    float h = fract(sin(dot(floor(vBB * 9000.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float t = smoothstep(0.06, 0.094, vBB.y + (h - 0.5) * 0.01);
    diffuseColor.rgb = mix(vec3(0.96, 0.63, 0.09) * (0.86 + 0.28 * h), vec3(0.006), t);
    metalnessFactor = 1.0 - t; roughnessFactor = mix(0.3, 0.09, t);`);
};
const foil = new THREE.MeshPhysicalMaterial({ color: new THREE.Color().setRGB(0.95, 0.66, 0.26, THREE.LinearSRGBColorSpace), metalness: 1, roughness: 0.38 });

const bottle = new THREE.Group();
scene.add(bottle);
let spray = null, capKey = null, keyRest = 0, A = null;

async function load() {
  A = await fetch('assets/anchors.json', { cache: 'no-store' }).then((r) => r.json());
  const gltf = await new GLTFLoader().loadAsync(`assets/bottle.glb?v=${Date.now()}`);
  const model = gltf.scene;
  model.scale.setScalar(S);
  model.position.set(-A.center[0] * S, -A.center[1] * S, -A.center[2] * S);
  model.traverse((o) => {
    if (!o.isMesh) return;
    const n = o.name.replace(/_/g, ' ');
    o.material = n.startsWith('Bottle body') ? glass : n.startsWith('Logo') ? foil : lacquer;
    if (n === 'Cap key') { capKey = o; keyRest = o.rotation.z; }
  });
  bottle.add(model);
  // turn the bottle a little towards us, so the spray flies left and slightly at the camera
  bottle.rotation.y = 0.35;

  const local = (k) => new THREE.Vector3(...A[k]).sub(new THREE.Vector3(...A.center)).multiplyScalar(S);
  const n = new THREE.Vector3(A.logo_normal[0], 0, A.logo_normal[2]).normalize();   // horizontal nozzle axis
  const origin = local('window').addScaledVector(n, 0.03);
  spray = createSpray({ origin, dir: n, light: LIGHT_POS });
  bottle.add(spray.group);
  spray.uniforms.uLight.value.copy(LIGHT_POS);
}

// ------------------------------------------------------------------ ui
let t = 0, playing = false, macro = false;
const timeEl = document.getElementById('time');
document.getElementById('spray').onclick = () => { t = 0; playing = true; };
timeEl.oninput = () => { t = +timeEl.value; playing = false; };

const camFrom = new THREE.Vector3(), tgtFrom = new THREE.Vector3(), camTo = new THREE.Vector3(), tgtTo = new THREE.Vector3();
let fly = 1, flyDur = 2.4;
document.getElementById('macro').onclick = (e) => {
  macro = !macro;
  e.target.textContent = macro ? 'Общий план' : 'Макро капли';
  camFrom.copy(camera.position); tgtFrom.copy(controls.target);
  if (macro) {
    if (t < 0.7) { t = 0.75; playing = false; }                     // freeze the moment when the drop is in the air
    const drop = spray.droplet.getWorldPosition(new THREE.Vector3());
    tgtTo.copy(drop);
    // look at the drop with the light behind it, from ~2 cm away
    camTo.copy(drop).addScaledVector(drop.clone().sub(LIGHT_POS).normalize(), 0.02).add(new THREE.Vector3(0, 0.002, 0));
  } else {
    tgtTo.set(-0.9, 0.3, 0); camTo.set(0.3, 0.35, 4.8);
  }
  fly = 0;
};
document.getElementById('bg').onclick = (e) => {
  const light = scene.background.equals(DARK);
  scene.background = light ? SAND.clone() : DARK.clone();
  e.target.textContent = light ? 'Тёмный фон' : 'Светлый фон';
  if (spray) spray.uniforms.uBright.value = light ? 1.25 : 1;
};

// ------------------------------------------------------------------ loop
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (playing) { t += dt; if (t >= 2.8) { t = 2.8; playing = false; } }
  timeEl.value = t;
  if (capKey) capKey.rotation.z = keyRest - A.press_angle * THREE.MathUtils.clamp(t < 0.5 ? t / 0.12 : 1 - (t - 0.5) / 0.25, 0, 1);

  if (fly < 1) {
    fly = Math.min(1, fly + dt / flyDur);
    const e = fly < 0.5 ? 4 * fly ** 3 : 1 - (-2 * fly + 2) ** 3 / 2;
    camera.position.lerpVectors(camFrom, camTo, e);
    controls.target.lerpVectors(tgtFrom, tgtTo, e);
  }
  // near plane follows the distance so the macro shot works
  const d = camera.position.distanceTo(controls.target);
  const near = THREE.MathUtils.clamp(d * 0.02, 0.0002, 0.01);
  if (Math.abs(near - camera.near) > 1e-6) { camera.near = near; camera.updateProjectionMatrix(); }
  controls.minDistance = macro ? 0.006 : 0.3;
  controls.update();

  if (spray) spray.update({ t, camera, renderer, height: innerHeight });
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
});
load().then(() => { t = 0.75; frame(); });
