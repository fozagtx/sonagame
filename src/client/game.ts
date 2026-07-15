import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  buildTower,
  shatterMesh,
  updateDebris,
  queryPlatformHit,
  segmentIndexAtBall,
  updateDangerPresentation,
  type BuiltTower,
} from './tower';
import {
  DEFAULT_TOWER,
  createRng,
  generateTowerRings,
  SEGMENTS_PER_RING,
  type RingBlueprint,
  type SegmentKind,
} from '../shared/tower';
import { levelForDepth, LEVELS } from '../shared/levels';
import type {
  InitResponse,
  SubmitScoreResponse,
  BlueprintListResponse,
} from '../shared/api';

type GameMode = 'daily' | 'endless';
type Phase = 'intro' | 'menu' | 'playing' | 'paused' | 'dead' | 'cleared' | 'forge';

const BALL_R = 0.38;
const GRAVITY = -70;
const BOUNCE = 5.5;
const ROTATE_SPEED = 3.4;
const FIXED_STEP = 1 / 120;
const RADIAL = (DEFAULT_TOWER.innerRadius + DEFAULT_TOWER.outerRadius) / 2;
const BASE_FOV = 46;
const SHAFT_RADIUS = 15.5;

const el = {
  depth: document.getElementById('hud-depth') as HTMLSpanElement,
  best: document.getElementById('hud-best') as HTMLSpanElement,
  streak: document.getElementById('hud-streak') as HTMLSpanElement,
  level: document.getElementById('hud-level') as HTMLSpanElement,
  levelHook: document.getElementById('hud-level-hook') as HTMLParagraphElement,
  overlay: document.getElementById('overlay') as HTMLDivElement,
  title: document.getElementById('overlay-title') as HTMLHeadingElement,
  sub: document.getElementById('overlay-sub') as HTMLParagraphElement,
  stats: document.getElementById('overlay-stats') as HTMLDivElement,
  board: document.getElementById('leaderboard') as HTMLUListElement,
  controls: document.getElementById('controls') as HTMLDivElement,
  toast: document.getElementById('toast') as HTMLDivElement,
  forge: document.getElementById('forge-panel') as HTMLDivElement,
  forgeGrid: document.getElementById('forge-grid') as HTMLDivElement,
  forgeName: document.getElementById('forge-name') as HTMLInputElement,
  community: document.getElementById('community-list') as HTMLUListElement,
  depthFill: document.getElementById('depth-fill') as HTMLSpanElement,
  depthTotal: document.getElementById('depth-total') as HTMLSpanElement,
  combo: document.getElementById('combo') as HTMLDivElement,
  pause: document.getElementById('pause-panel') as HTMLDivElement,
  soundButton: document.getElementById('btn-sound') as HTMLButtonElement,
  flash: document.getElementById('impact-flash') as HTMLDivElement,
  intro: document.getElementById('intro') as HTMLDivElement,
  introBeat: document.getElementById('intro-beat') as HTMLParagraphElement,
  hud: document.querySelector('.hud') as HTMLElement,
  aimMark: document.querySelector('.aim-mark') as HTMLElement,
  coach: document.getElementById('coach') as HTMLDivElement,
  dangerRim: document.getElementById('danger-rim') as HTMLDivElement,
  dangerCallout: document.getElementById('danger-callout') as HTMLDivElement,
  hazardKey: document.getElementById('hazard-key') as HTMLDivElement,
  badge: document.getElementById('overlay-badge') as HTMLSpanElement,
};

let initData: InitResponse | null = null;
let built: BuiltTower | null = null;
let debris: THREE.Mesh[] = [];
type ImpactEffect = {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  life: number;
  duration: number;
};
let impactEffects: ImpactEffect[] = [];
const broken = new Set<string>();

let phase: Phase = 'menu';
let mode: GameMode = 'daily';
let depth = 0;
let combo = 0;
let bestCombo = 0;
let lastHitRing = -1;
let scoreSubmitted = false;
let bounceLock = 0;

const vel = { y: 0 };
let prevY = 5;
let rotY = 0;
let rotVel = 0;
let holdDir = 0; // -1 left, +1 right from buttons/keys
let cameraTargetY = 10.5;
let audio: AudioContext | null = null;
let masterGain: GainNode | null = null;
let soundEvents = 0;
let muted = false;
let trauma = 0;
let shakeTime = 0;
let introT = 0;
let introDiveStarted = false;
let coachArmed = false;
let lastMilestone = 0;
let runStartBest = 0;
let taughtDanger = false;
let taughtLegend = false;
let dangerWarnSoundAt = 0;
let dangerCalloutUntil = 0;
let hitstop = 0;
let lastZone = 0;

function unlockAudio(): void {
  if (!audio) {
    audio = new AudioContext();
    masterGain = audio.createGain();
    masterGain.gain.value = muted ? 0 : 0.72;
    masterGain.connect(audio.destination);
  }
  if (audio.state === 'suspended') void audio.resume();
  document.body.dataset.audioState = audio.state;
}

function tone(
  startFrequency: number,
  endFrequency: number,
  duration: number,
  volume: number,
  type: OscillatorType = 'sine',
  delay = 0
): void {
  if (!audio || audio.state !== 'running') return;

  const start = audio.currentTime + delay;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(startFrequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(
    Math.max(1, endFrequency),
    start + duration
  );
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  oscillator.connect(gain);
  gain.connect(masterGain ?? audio.destination);
  oscillator.start(start);
  oscillator.stop(start + duration);
  soundEvents += 1;
  document.body.dataset.soundEvents = String(soundEvents);
}

function bounceSound(): void {
  tone(170, 330, 0.09, 0.12, 'sine');
  tone(420, 280, 0.05, 0.04, 'triangle', 0.02);
}

function diveSound(): void {
  tone(220, 90, 0.35, 0.1, 'sine');
  tone(480, 160, 0.28, 0.06, 'triangle', 0.04);
}

function dropSound(currentDepth: number): void {
  const pitch = 520 + (currentDepth % 5) * 55;
  tone(pitch, pitch * 0.72, 0.07, 0.055, 'triangle');
}

function dangerSound(): void {
  tone(150, 42, 0.42, 0.2, 'sawtooth');
  tone(90, 35, 0.48, 0.12, 'square', 0.03);
}

function clearSound(): void {
  tone(330, 440, 0.12, 0.1, 'triangle');
  tone(440, 660, 0.14, 0.1, 'triangle', 0.11);
  tone(660, 880, 0.2, 0.1, 'triangle', 0.23);
}

function milestoneSound(): void {
  tone(380, 520, 0.1, 0.08, 'triangle');
  tone(520, 740, 0.14, 0.07, 'sine', 0.08);
}

function spawnImpactRing(y: number, danger = false): void {
  const material = new THREE.MeshBasicMaterial({
    color: danger ? 0xff4d3d : 0x2cd9ff,
    transparent: true,
    opacity: danger ? 0.9 : 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 28), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, y + 0.04, RADIAL);
  scene.add(mesh);
  impactEffects.push({ mesh, life: 0, duration: danger ? 0.42 : 0.24 });
}

function updateImpactEffects(dt: number): void {
  impactEffects = impactEffects.filter((effect) => {
    effect.life += dt;
    const progress = Math.min(1, effect.life / effect.duration);
    effect.mesh.scale.setScalar(1 + progress * (effect.duration > 0.3 ? 7 : 4));
    effect.mesh.material.opacity = (1 - progress) * (effect.duration > 0.3 ? 0.9 : 0.55);
    if (progress < 1) return true;
    effect.mesh.parent?.remove(effect.mesh);
    effect.mesh.geometry.dispose();
    effect.mesh.material.dispose();
    return false;
  });
}

function impactFlash(danger = false): void {
  el.flash.style.background = danger ? '#ff6d5c' : '#fff3dd';
  el.flash.animate([{ opacity: danger ? 0.55 : 0.72 }, { opacity: 0 }], {
    duration: danger ? 220 : 130,
    easing: 'ease-out',
  });
}

const canvas = document.getElementById('bg') as HTMLCanvasElement;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070a10);
scene.fog = new THREE.FogExp2(0x070a10, 0.034);

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  120
);
camera.position.set(0, 6, 13.5);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.62;
pmrem.dispose();

scene.add(new THREE.HemisphereLight(0xb8d8ff, 0x120b08, 0.9));
const sun = new THREE.DirectionalLight(0xffe1b2, 1.65);
sun.position.set(5, 14, 8);
scene.add(sun);
// Soft fills ride behind the camera — never sit in the play frustum.
const cyanFill = new THREE.PointLight(0x2cd9ff, 0.85, 22, 2);
cyanFill.position.set(-2.2, 6, 16);
scene.add(cyanFill);
const amberFill = new THREE.PointLight(0xffa928, 0.55, 26, 2);
amberFill.position.set(3.4, 2, 15);
scene.add(amberFill);

const ball = new THREE.Group();
const ballCoreMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x78eaff,
  emissive: 0x12bde8,
  emissiveIntensity: 1.15,
  metalness: 0.08,
  roughness: 0.12,
  clearcoat: 1,
  clearcoatRoughness: 0.08,
});
const ballCore = new THREE.Mesh(
  new THREE.SphereGeometry(BALL_R * 0.88, 32, 24),
  ballCoreMaterial
);
ball.add(ballCore);
const ballBandMaterial = new THREE.MeshStandardMaterial({
  color: 0x182433,
  metalness: 0.9,
  roughness: 0.18,
});
const ballBandA = new THREE.Mesh(
  new THREE.TorusGeometry(BALL_R * 1.04, 0.03, 8, 28),
  ballBandMaterial
);
ball.add(ballBandA);
const ballBandB = ballBandA.clone();
ballBandB.rotation.x = Math.PI / 2;
ball.add(ballBandB);
const ballBandC = ballBandA.clone();
ballBandC.rotation.y = Math.PI / 2;
ball.add(ballBandC);
const finGeometry = new THREE.ConeGeometry(0.085, 0.25, 3);
for (let i = 0; i < 4; i++) {
  const finPivot = new THREE.Group();
  finPivot.rotation.y = (i / 4) * Math.PI * 2;
  const fin = new THREE.Mesh(finGeometry, ballBandMaterial);
  fin.position.x = BALL_R * 1.05;
  fin.rotation.z = -Math.PI / 2;
  finPivot.add(fin);
  ball.add(finPivot);
}
const capMaterial = new THREE.MeshStandardMaterial({
  color: 0x5a3513,
  emissive: 0xffa928,
  emissiveIntensity: 0.8,
  metalness: 0.72,
  roughness: 0.22,
});
for (const direction of [-1, 1]) {
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.09, 0.07, 8), capMaterial);
  cap.position.y = direction * BALL_R * 0.86;
  ball.add(cap);
}
const ballLens = new THREE.Mesh(
  new THREE.OctahedronGeometry(BALL_R * 0.22, 1),
  new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xbef7ff,
    emissiveIntensity: 2.1,
    metalness: 0.05,
    roughness: 0.08,
  })
);
ballLens.position.z = BALL_R * 0.78;
ball.add(ballLens);
ball.position.set(0, 5, RADIAL);
scene.add(ball);

const fallTrail = new THREE.Mesh(
  new THREE.CylinderGeometry(0.025, 0.08, 0.85, 8, 1, true),
  new THREE.MeshBasicMaterial({
    color: 0x2cd9ff,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
);
fallTrail.visible = false;
scene.add(fallTrail);
const contactShadow = new THREE.Mesh(
  new THREE.CircleGeometry(BALL_R * 1.18, 24),
  new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  })
);
contactShadow.rotation.x = -Math.PI / 2;
contactShadow.visible = false;
scene.add(contactShadow);

const towerRoot = new THREE.Group();
scene.add(towerRoot);

function addReactorShaft(): void {
  // All shaft kit lives outside the play radius (~6) and camera z (~13)
  // so rings, rails, and lights never cross the ball's drop corridor.
  const railGeometry = new THREE.BoxGeometry(0.18, 120, 0.36);
  const railMaterial = new THREE.MeshStandardMaterial({
    color: 0x0e141c,
    metalness: 0.68,
    roughness: 0.42,
  });
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const rail = new THREE.Mesh(railGeometry, railMaterial);
    rail.position.set(
      Math.cos(angle) * SHAFT_RADIUS,
      -42,
      Math.sin(angle) * SHAFT_RADIUS
    );
    rail.rotation.y = -angle;
    scene.add(rail);
  }

  const frameGeometry = new THREE.TorusGeometry(SHAFT_RADIUS - 0.35, 0.07, 5, 56);
  frameGeometry.rotateX(Math.PI / 2);
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0x241810,
    emissive: 0xff8a1f,
    emissiveIntensity: 0.09,
    metalness: 0.8,
    roughness: 0.32,
  });
  for (let y = 6; y > -100; y -= 18) {
    const frame = new THREE.Mesh(frameGeometry, frameMaterial);
    frame.position.y = y;
    scene.add(frame);
  }

  // Deeper shaft windows shift warmer — the world tells you how far you've fallen.
  const windowGeometry = new THREE.BoxGeometry(0.28, 2.1, 0.06);
  const windowMaterial = new THREE.MeshStandardMaterial({
    color: 0x0c1c22,
    emissive: 0x2cd9ff,
    emissiveIntensity: 0.35,
    metalness: 0.35,
    roughness: 0.34,
  });
  const windowMaterialDeep = new THREE.MeshStandardMaterial({
    color: 0x1a100c,
    emissive: 0xff6a2a,
    emissiveIntensity: 0.42,
    metalness: 0.35,
    roughness: 0.34,
  });
  const windows = new THREE.InstancedMesh(windowGeometry, windowMaterial, 20);
  const windowsDeep = new THREE.InstancedMesh(windowGeometry, windowMaterialDeep, 20);
  const transform = new THREE.Object3D();
  let upper = 0;
  let deeper = 0;
  for (let i = 0; i < 40; i++) {
    const column = i % 10;
    const level = Math.floor(i / 10);
    const angle = (column / 10) * Math.PI * 2 + 0.12;
    transform.position.set(
      Math.cos(angle) * (SHAFT_RADIUS - 0.55),
      2 - level * 28,
      Math.sin(angle) * (SHAFT_RADIUS - 0.55)
    );
    transform.rotation.set(0, -angle, 0);
    transform.scale.set(1, 0.7 + (column % 3) * 0.18, 1);
    transform.updateMatrix();
    if (level < 2) {
      windows.setMatrixAt(upper++, transform.matrix);
    } else {
      windowsDeep.setMatrixAt(deeper++, transform.matrix);
    }
  }
  windows.count = upper;
  windowsDeep.count = deeper;
  windows.instanceMatrix.needsUpdate = true;
  windowsDeep.instanceMatrix.needsUpdate = true;
  scene.add(windows);
  scene.add(windowsDeep);

  // Far-field dust only — never inside the drop column.
  const dustPositions = new Float32Array(160 * 3);
  const rng = createRng(0x51a7c0de);
  for (let i = 0; i < 160; i++) {
    const radius = SHAFT_RADIUS - 1.2 + rng() * 4.5;
    const angle = rng() * Math.PI * 2;
    dustPositions[i * 3] = Math.cos(angle) * radius;
    dustPositions[i * 3 + 1] = 8 - rng() * 110;
    dustPositions[i * 3 + 2] = Math.sin(angle) * radius;
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  scene.add(
    new THREE.Points(
      dustGeometry,
      new THREE.PointsMaterial({
        color: 0xffc66b,
        size: 0.04,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      })
    )
  );
}

addReactorShaft();

const diagnosticsWindow = window as typeof window & {
  __THREE_GAME_DIAGNOSTICS__?: unknown;
};
diagnosticsWindow.__THREE_GAME_DIAGNOSTICS__ = {
  get renderer() {
    const materials = new Set<THREE.Material>();
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Points)) return;
      const objectMaterial = object.material;
      if (Array.isArray(objectMaterial)) objectMaterial.forEach((material) => materials.add(material));
      else materials.add(objectMaterial);
    });
    return {
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      materials: materials.size,
      dpr: renderer.getPixelRatio(),
      postPasses: 0,
      shadowLights: 0,
    };
  },
  get state() {
    return {
      phase,
      depth,
      combo,
      ballY: Number(ball.position.y.toFixed(3)),
      velocityY: Number(vel.y.toFixed(3)),
    };
  },
  get landingThreat() {
    if (!built) return null;
    const bottom = ball.position.y - BALL_R;
    const warnSeg = segmentIndexAtBall(rotY);
    const reach = vel.y < 2.5 ? 3.35 : 0.9;
    let targetRing: number | null = null;
    let targetDist = Infinity;
    let dangerAhead = false;
    for (let i = 0; i < built.ringYs.length; i++) {
      const top = built.ringYs[i]! + built.config.ringHeight / 2;
      const dist = bottom - top;
      if (dist < -0.05 || dist >= reach) continue;
      const mesh = built.segmentMeshes[i]?.[warnSeg];
      if (built.rings[i]!.segments[warnSeg] === 'danger' && mesh?.visible) {
        dangerAhead = true;
        if (dist < targetDist) {
          targetDist = dist;
          targetRing = i;
        }
      }
    }
    return {
      warnSeg,
      targetRing,
      targetDist: targetRing === null ? null : Number(targetDist.toFixed(3)),
      dangerAhead,
      reach,
    };
  },
  get physics() {
    return {
      engine: 'custom one-way platform collision',
      timestep: FIXED_STEP,
      bodies: 1,
      colliders: built?.segmentMeshes.flat().filter(Boolean).length ?? 0,
      sensors: 0,
      ccdBodies: 0,
    };
  },
  /** True when collision index matches the mesh plate under the ball. */
  get visualSegmentUnderBall() {
    if (!built) return null;
    const angleStep = (Math.PI * 2) / SEGMENTS_PER_RING;
    const pad = 0.05;
    const collision = segmentIndexAtBall(rotY);
    const ballWorld = ball.getWorldPosition(new THREE.Vector3());
    let plateSeg: number | null = null;

    for (let ring = 0; ring < built.segmentMeshes.length && plateSeg === null; ring++) {
      for (let seg = 0; seg < SEGMENTS_PER_RING; seg++) {
        const mesh = built.segmentMeshes[ring]![seg];
        if (!mesh || !mesh.visible) continue;
        mesh.updateWorldMatrix(true, false);
        const local = mesh.worldToLocal(ballWorld.clone());
        // Shared sector is authored in XY then flipped: (cos a, 0, -sin a).
        const authored = Math.atan2(-local.z, local.x);
        const radius = Math.hypot(local.x, local.z);
        const onPlate =
          authored >= pad - 0.02 &&
          authored <= angleStep - pad + 0.02 &&
          radius >= built.config.innerRadius - 0.15 &&
          radius <= built.config.outerRadius + 0.15;
        if (onPlate) {
          plateSeg = seg;
          break;
        }
      }
    }

    return {
      plateSeg,
      collision,
      rotationY: rotY,
      // Over a solid plate: collision must name that plate.
      // Over a gap: no plate claims the ball.
      aligned: plateSeg === null || plateSeg === collision,
    };
  },
};

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --- INPUT: window-level so UI never steals the drag ---
let dragging = false;
let lastX = 0;

function onDown(e: PointerEvent): void {
  unlockAudio();
  if (phase === 'intro') {
    const t = e.target as HTMLElement | null;
    if (t?.closest('#btn-skip-intro, .intro')) {
      skipIntro();
      return;
    }
    skipIntro();
    return;
  }
  if (phase !== 'playing') return;
  const t = e.target as HTMLElement | null;
  if (t?.closest('button, input, a, .panel')) return;
  dragging = true;
  lastX = e.clientX;
  clearCoach();
}

function onMove(e: PointerEvent): void {
  if (!dragging || phase !== 'playing') return;
  const dx = e.clientX - lastX;
  lastX = e.clientX;
  rotY += dx * 0.012;
  rotVel = dx * 0.65;
  if (Math.abs(dx) > 2) clearCoach();
}

function onUp(): void {
  dragging = false;
}

window.addEventListener('pointerdown', onDown, { passive: true });
window.addEventListener('pointermove', onMove, { passive: true });
window.addEventListener('pointerup', onUp, { passive: true });
window.addEventListener('pointercancel', onUp, { passive: true });
window.addEventListener('blur', () => {
  dragging = false;
  holdDir = 0;
  if (phase === 'playing') setPaused(true);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && phase === 'playing') setPaused(true);
});

window.addEventListener('keydown', (e) => {
  unlockAudio();
  if (phase === 'intro' && (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape')) {
    e.preventDefault();
    skipIntro();
    return;
  }
  if (e.key === 'Escape') {
    if (phase === 'playing') setPaused(true);
    else if (phase === 'paused') setPaused(false);
    return;
  }
  if (phase !== 'playing') return;
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
    holdDir = 1;
    clearCoach();
  }
  if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
    holdDir = -1;
    clearCoach();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A' || e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
    holdDir = 0;
  }
});

document.getElementById('btn-left')!.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  holdDir = 1;
  clearCoach();
  (e.currentTarget as HTMLElement).classList.add('is-held');
});
document.getElementById('btn-right')!.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  holdDir = -1;
  clearCoach();
  (e.currentTarget as HTMLElement).classList.add('is-held');
});
const clearHold = (e?: Event) => {
  holdDir = 0;
  document.getElementById('btn-left')!.classList.remove('is-held');
  document.getElementById('btn-right')!.classList.remove('is-held');
  void e;
};
document.getElementById('btn-left')!.addEventListener('pointerup', clearHold);
document.getElementById('btn-right')!.addEventListener('pointerup', clearHold);
document.getElementById('btn-left')!.addEventListener('pointerleave', clearHold);
document.getElementById('btn-right')!.addEventListener('pointerleave', clearHold);
document.getElementById('btn-left')!.addEventListener('pointercancel', clearHold);
document.getElementById('btn-right')!.addEventListener('pointercancel', clearHold);

function toast(msg: string): void {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  setTimeout(() => el.toast.classList.remove('show'), 1800);
}

function clearCoach(): void {
  if (!coachArmed) return;
  coachArmed = false;
  el.coach.classList.remove('show');
  el.coach.setAttribute('aria-hidden', 'true');
  if (!taughtLegend) {
    taughtLegend = true;
    el.hazardKey.classList.add('is-hidden');
    el.hazardKey.setAttribute('aria-hidden', 'true');
  }
}

function warnTone(): void {
  tone(210, 160, 0.08, 0.05, 'sawtooth');
}

function setDangerCallout(active: boolean): void {
  const now = performance.now() * 0.001;
  if (active) dangerCalloutUntil = now + 0.55;
  const show = active || now < dangerCalloutUntil;
  el.dangerCallout.classList.toggle('show', show);
  el.dangerCallout.setAttribute('aria-hidden', String(!show));
}

function showCoach(): void {
  coachArmed = true;
  taughtLegend = false;
  el.coach.classList.add('show');
  el.coach.setAttribute('aria-hidden', 'false');
  el.hazardKey.classList.remove('is-hidden');
  el.hazardKey.setAttribute('aria-hidden', 'false');
  window.setTimeout(() => clearCoach(), 3800);
}

function punchDepth(): void {
  el.depth.classList.remove('punch');
  // Force reflow so the punch class can retrigger.
  void el.depth.offsetWidth;
  el.depth.classList.add('punch');
  window.setTimeout(() => el.depth.classList.remove('punch'), 220);
}

function noteDepthProgress(nextDepth: number): void {
  if (nextDepth <= depth) return;
  const skipped = nextDepth - depth;
  depth = nextDepth;
  punchDepth();
  dropSound(depth);

  // Clean multi-ring drops are the skill expression reward.
  if (skipped >= 2) {
    combo = Math.max(combo, skipped);
    bestCombo = Math.max(bestCombo, combo);
    trauma = Math.min(1, trauma + 0.08 * skipped);
    camera.fov = Math.min(58, camera.fov + 2 + skipped);
    camera.updateProjectionMatrix();
  }

  if (depth >= 10 && lastMilestone < 10) {
    lastMilestone = 10;
    milestoneSound();
    toast(LEVELS[0]!.clearToast);
    window.setTimeout(() => toast(LEVELS[1]!.enterToast), 900);
  } else if (depth >= 20 && lastMilestone < 20) {
    lastMilestone = 20;
    milestoneSound();
    toast(LEVELS[1]!.clearToast);
    window.setTimeout(() => toast(LEVELS[2]!.enterToast), 900);
  } else if (depth >= 30 && lastMilestone < 30) {
    lastMilestone = 30;
    milestoneSound();
    toast(LEVELS[2]!.clearToast);
    window.setTimeout(() => toast(LEVELS[3]!.enterToast), 900);
  }

  const zone = Math.floor(depth / 10);
  if (zone > lastZone && zone <= 3) {
    lastZone = zone;
  }

  setHud();
}

function setHud(): void {
  el.depth.textContent = String(depth).padStart(2, '0');
  el.streak.textContent = String(initData?.streak ?? 0);
  el.best.textContent = String(
    mode === 'daily' ? (initData?.dailyBest ?? 0) : (initData?.personalBest ?? 0)
  );
  document.body.dataset.phase = phase;
  document.body.dataset.depth = String(depth);
  document.body.dataset.ballY = ball.position.y.toFixed(3);
  document.body.dataset.velocityY = vel.y.toFixed(3);
  document.body.dataset.rotationY = rotY.toFixed(6);
  document.body.dataset.activeSegment = String(segmentIndexAtBall(rotY));
  const total = built?.rings.length ?? 40;
  el.depthTotal.textContent = `/${total}`;
  el.depthFill.style.transform = `scaleX(${Math.min(1, depth / total)})`;
  el.combo.textContent = combo > 1 ? `DROP ×${combo}` : '';
  el.combo.classList.toggle('active', combo > 1);
  const level = levelForDepth(Math.max(1, depth || 1), total);
  el.level.textContent = `LEVEL ${level.id} — ${level.name}`;
  el.levelHook.textContent = level.hook;
  document.body.dataset.level = String(level.id);
}

function renderBoard(rows: InitResponse['leaderboard']): void {
  el.board.innerHTML = '';
  if (!rows.length) {
    el.board.innerHTML = '<li class="empty">Be the first dive today</li>';
    return;
  }
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const li = document.createElement('li');
    li.innerHTML = `<span>${i + 1}</span><span>${r.username}</span><span>${r.depth}</span>`;
    el.board.appendChild(li);
  }
}

function wipeTower(): void {
  while (towerRoot.children.length) {
    const c = towerRoot.children[0]!;
    towerRoot.remove(c);
    c.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
  }
  built = null;
  broken.clear();
  for (const d of debris) d.parent?.remove(d);
  debris = [];
  for (const effect of impactEffects) {
    effect.mesh.parent?.remove(effect.mesh);
    effect.mesh.geometry.dispose();
    effect.mesh.material.dispose();
  }
  impactEffects = [];
}

function syncChrome(): void {
  const inIntro = phase === 'intro';
  const inPlay = phase === 'playing';
  el.intro.classList.toggle('hidden', !inIntro);
  el.intro.classList.toggle('ready', inIntro && introT > 0.28);
  el.hud.classList.toggle('is-hidden', inIntro);
  el.aimMark.classList.toggle('is-hidden', !inPlay);
  const showLegend = inPlay && !taughtLegend;
  el.hazardKey.classList.toggle('is-hidden', !showLegend);
  el.hazardKey.setAttribute('aria-hidden', String(!showLegend));
  if (!inPlay) {
    el.dangerRim.classList.remove('hot');
    dangerCalloutUntil = 0;
    setDangerCallout(false);
    clearCoach();
  }
  if (inIntro || phase === 'menu' || phase === 'dead' || phase === 'cleared' || phase === 'forge' || phase === 'paused') {
    el.controls.classList.add('hidden');
    el.controls.classList.remove('wake');
  } else if (inPlay) {
    el.controls.classList.remove('hidden');
  }
}

function enterPlaying(): void {
  if (phase !== 'intro') return;
  phase = 'playing';
  el.overlay.classList.add('hidden');
  el.forge.classList.add('hidden');
  el.pause.classList.add('hidden');
  syncChrome();
  el.controls.classList.add('wake');
  window.setTimeout(() => el.controls.classList.remove('wake'), 780);
  showCoach();
  toast(LEVELS[0]!.enterToast);
  setHud();
}

function skipIntro(): void {
  if (phase !== 'intro' || !built) return;
  if (!introDiveStarted) {
    introDiveStarted = true;
    vel.y = -16;
    diveSound();
    cameraTargetY = ball.position.y + 2.8;
  } else if (vel.y > -8) {
    vel.y = -16;
  }
  enterPlaying();
}

function start(m: GameMode): void {
  if (!initData) return;
  mode = m;
  phase = 'intro';
  introT = 0;
  introDiveStarted = false;
  depth = 0;
  combo = 0;
  bestCombo = 0;
  lastHitRing = -1;
  scoreSubmitted = false;
  bounceLock = 0;
  rotVel = 0;
  holdDir = 0;
  trauma = 0;
  lastMilestone = 0;
  runStartBest = mode === 'daily' ? (initData.dailyBest ?? 0) : (initData.personalBest ?? 0);
  taughtDanger = false;
  dangerWarnSoundAt = 0;
  hitstop = 0;
  lastZone = 0;
  clearCoach();
  setDangerCallout(false);
  el.introBeat.textContent = 'HOLD';
  el.introBeat.classList.remove('is-drop');
  el.badge.classList.add('hidden');

  wipeTower();
  const count = m === 'daily' ? 40 : 70;
  const seed =
    m === 'daily'
      ? initData.dailySeed
      : (Date.now() ^ (Math.random() * 1e9)) >>> 0;
  const rings = generateTowerRings(seed, count, initData.communityBlueprints);
  built = buildTower(rings, DEFAULT_TOWER);
  towerRoot.add(built.group);

  // Aim a safe plate under the ball so the opening dive lands, then rolls.
  const angleStep = (Math.PI * 2) / SEGMENTS_PER_RING;
  const firstSafe = Math.max(
    0,
    built.rings[0]!.segments.findIndex((kind) => kind === 'safe')
  );
  rotY = (firstSafe - 0.5) * angleStep - Math.PI / 2;
  towerRoot.rotation.y = rotY;

  const firstTop = built.ringYs[0]! + built.config.ringHeight / 2;
  const introHeight = 11.5;
  ball.position.set(0, firstTop + introHeight, RADIAL);
  ball.scale.setScalar(1);
  ball.rotation.set(0.4, 0, 0.2);
  ball.visible = true;
  // Hold the core for the cinematic beat, then release the dive.
  vel.y = 0;
  prevY = ball.position.y;
  fallTrail.visible = false;
  contactShadow.visible = false;

  cameraTargetY = firstTop + 6.5;
  camera.position.set(0, cameraTargetY, 16.5);
  camera.lookAt(0, firstTop + 1.2, 0);
  camera.fov = 42;
  camera.updateProjectionMatrix();

  el.overlay.classList.add('hidden');
  el.forge.classList.add('hidden');
  el.pause.classList.add('hidden');
  syncChrome();
  setHud();

  // Automated QA / skipIntro query jumps straight into play.
  const params = new URLSearchParams(location.search);
  if (params.get('skipIntro') === '1' || params.get('qa') === '1') {
    vel.y = -16;
    camera.position.set(0, ball.position.y + 2.8, 13.2);
    camera.fov = BASE_FOV + 6;
    camera.updateProjectionMatrix();
    enterPlaying();
    clearCoach();
  }
}

async function submit(): Promise<void> {
  if (!initData || scoreSubmitted) return;
  scoreSubmitted = true;
  try {
    const res = await fetch('/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ depth, mode, dateKey: initData.dateKey }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as SubmitScoreResponse;
    initData.personalBest = data.personalBest;
    initData.dailyBest = data.dailyBest;
    initData.streak = data.streak;
    initData.leaderboard = data.leaderboard;
    renderBoard(data.leaderboard);
    setHud();
  } catch {
    /* local preview */
  }
}

function end(win: boolean): void {
  if (phase !== 'playing') return;
  phase = win ? 'cleared' : 'dead';
  holdDir = 0;
  clearCoach();
  el.dangerRim.classList.remove('hot');
  void submit();

  el.controls.classList.add('hidden');
  el.overlay.classList.remove('hidden');
  document.getElementById('menu-actions')!.classList.add('hidden');
  document.getElementById('end-actions')!.classList.remove('hidden');

  const isNewBest = depth > runStartBest;
  el.badge.classList.toggle('hidden', !isNewBest);

  if (win) {
    el.title.textContent = 'Core cleared';
    el.sub.textContent = isNewBest
      ? `Depth ${depth} — new best. Tomorrow’s core is a new seed.`
      : 'Clean run. Come back at UTC midnight for a fresh Daily Core.';
  } else if (depth >= 20) {
    el.title.textContent = 'Almost nadir';
    el.sub.textContent = isNewBest
      ? `New best at ${depth}. One earlier align and you break through.`
      : `Depth ${depth}. Spin the gap under you before the red catches the core.`;
  } else if (depth >= 8) {
    el.title.textContent = 'Fractured';
    el.sub.textContent = 'Red ends the dive. Keep ivory under the core — gaps only when you mean to drop.';
  } else {
    el.title.textContent = 'Fractured';
    el.sub.textContent = 'Drag or hold ◀ ▶. Land ivory. Fall gaps. Never red.';
  }

  el.stats.innerHTML = `
    <div><b>${depth}</b><i>depth</i></div>
    <div><b>${bestCombo}</b><i>combo</i></div>
    <div><b>${initData?.streak ?? 0}</b><i>streak</i></div>`;
  syncChrome();
  setHud();
}

function menu(): void {
  phase = 'menu';
  holdDir = 0;
  clearCoach();
  el.badge.classList.add('hidden');
  el.intro.classList.add('hidden');
  el.controls.classList.add('hidden');
  el.pause.classList.add('hidden');
  el.forge.classList.add('hidden');
  el.overlay.classList.remove('hidden');
  document.getElementById('menu-actions')!.classList.remove('hidden');
  document.getElementById('end-actions')!.classList.add('hidden');
  el.title.textContent = 'Sona';
  el.sub.textContent =
    'Today’s core is shared with everyone. Beat your depth. Keep the streak alive until UTC midnight.';
  el.stats.innerHTML = `
    <div><b>${initData?.dailyBest ?? 0}</b><i>today</i></div>
    <div><b>${initData?.personalBest ?? 0}</b><i>best</i></div>
    <div><b>${initData?.streak ?? 0}</b><i>streak</i></div>`;
  if (initData) renderBoard(initData.leaderboard);
  syncChrome();
  setHud();
}

function setPaused(paused: boolean): void {
  if (paused && phase === 'playing') {
    phase = 'paused';
    holdDir = 0;
    dragging = false;
    el.controls.classList.add('hidden');
    el.pause.classList.remove('hidden');
    setHud();
    return;
  }
  if (!paused && phase === 'paused') {
    phase = 'playing';
    el.pause.classList.add('hidden');
    el.controls.classList.remove('hidden');
    setHud();
  }
}

function toggleSound(): void {
  muted = !muted;
  unlockAudio();
  if (masterGain && audio) {
    masterGain.gain.setTargetAtTime(muted ? 0 : 0.72, audio.currentTime, 0.025);
  }
  el.soundButton.setAttribute('aria-pressed', String(muted));
  el.soundButton.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
}

const forgeSegs: SegmentKind[] = Array.from({ length: SEGMENTS_PER_RING }, (_, i) =>
  i < 2 ? 'gap' : 'safe'
);

function paintForge(): void {
  el.forgeGrid.innerHTML = '';
  forgeSegs.forEach((k, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `seg ${k}`;
    b.textContent = k === 'gap' ? 'GAP' : k === 'danger' ? 'RED' : 'OK';
    b.onclick = () => {
      forgeSegs[i] = k === 'safe' ? 'danger' : k === 'danger' ? 'gap' : 'safe';
      paintForge();
    };
    el.forgeGrid.appendChild(b);
  });
}

document.getElementById('btn-daily')!.onclick = () => start('daily');
document.getElementById('btn-endless')!.onclick = () => start('endless');
document.getElementById('btn-retry')!.onclick = () => start(mode);
document.getElementById('btn-menu')!.onclick = () => menu();
document.getElementById('btn-pause')!.onclick = () => setPaused(true);
document.getElementById('btn-sound')!.onclick = () => toggleSound();
document.getElementById('btn-skip-intro')!.onclick = (e) => {
  e.stopPropagation();
  skipIntro();
};
document.getElementById('btn-resume')!.onclick = () => setPaused(false);
document.getElementById('btn-pause-restart')!.onclick = () => start(mode);
document.getElementById('btn-pause-menu')!.onclick = () => menu();
document.getElementById('btn-forge')!.onclick = () => {
  phase = 'forge';
  el.overlay.classList.add('hidden');
  el.forge.classList.remove('hidden');
  paintForge();
  void loadCommunity();
};
document.getElementById('forge-close')!.onclick = () => menu();
document.getElementById('forge-submit')!.onclick = async () => {
  if (!forgeSegs.includes('gap') || !forgeSegs.includes('safe')) {
    toast('Need GAP + OK');
    return;
  }
  try {
    const res = await fetch('/api/blueprint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segments: forgeSegs, name: el.forgeName.value || undefined }),
    });
    if (!res.ok) {
      toast('Submit failed');
      return;
    }
    toast('Ring submitted');
    if (initData) {
      initData.communityBlueprints = [
        { segments: [...forgeSegs] } as RingBlueprint,
        ...initData.communityBlueprints,
      ].slice(0, 8);
    }
  } catch {
    toast('Offline — not saved');
  }
};

async function loadCommunity(): Promise<void> {
  try {
    const res = await fetch('/api/blueprints');
    if (!res.ok) return;
    const data = (await res.json()) as BlueprintListResponse;
    el.community.innerHTML = '';
    data.blueprints.slice(0, 6).forEach((b) => {
      const li = document.createElement('li');
      li.textContent = `${b.votes} · ${b.name} · ${b.username}`;
      el.community.appendChild(li);
    });
  } catch {
    /* ignore */
  }
}

const clock = new THREE.Clock();
let accumulator = 0;

function updateGame(dt: number): void {
  if (hitstop > 0) {
    hitstop = Math.max(0, hitstop - dt);
    // Keep chrome readable during freeze; skip physics integration.
    if (phase === 'playing' || phase === 'intro') {
      cyanFill.position.set(-2.4, camera.position.y + 1.2, camera.position.z + 2.8);
      amberFill.position.set(3.1, camera.position.y - 1.6, camera.position.z + 2.2);
    }
    return;
  }

  if (phase === 'playing') {
    if (holdDir !== 0) {
      rotY += holdDir * ROTATE_SPEED * dt;
    }
    rotY += rotVel * dt;
    rotVel *= Math.exp(-8 * dt);
  } else {
    rotVel = 0;
  }

  if ((phase === 'playing' || phase === 'intro') && built) {
    const inIntro = phase === 'intro';
    const firstTop = built.ringYs[0]! + built.config.ringHeight / 2;

    if (inIntro) {
      introT += dt;
      el.intro.classList.toggle('ready', introT > 0.28);
      // Showcase orbit, then release the dive — gameplay unlocks on first bounce or skip.
      if (!introDiveStarted) {
        towerRoot.rotation.y = rotY + Math.sin(introT * 0.55) * 0.1;
        const u = Math.min(1, introT / 2.35);
        const ease = 1 - Math.pow(1 - u, 3);
        const ang = Math.PI * 0.52 * (1 - ease);
        camera.position.set(
          Math.sin(ang) * 16.2,
          firstTop + 7.2 - ease * 3.4,
          Math.cos(ang) * 16.2
        );
        camera.lookAt(0, firstTop + 1.1, RADIAL * 0.35);
        camera.fov = THREE.MathUtils.lerp(36, BASE_FOV + 2, ease);
        camera.updateProjectionMatrix();
        ball.rotation.y += dt * 1.15;
        if (introT >= 1.35 && el.introBeat.textContent === 'HOLD') {
          el.introBeat.textContent = 'DROP';
          el.introBeat.classList.add('is-drop');
        }
        if (introT >= 2.45) {
          introDiveStarted = true;
          vel.y = -16;
          diveSound();
          cameraTargetY = ball.position.y + 2.8;
        }
      } else if (el.introBeat.textContent !== 'ALIGN') {
        el.introBeat.textContent = 'ALIGN';
        el.introBeat.classList.remove('is-drop');
      }
      // Full cinematic beat (~5s) before forcing play if they haven't bounced yet.
      if (introT > 5.0 && introDiveStarted) enterPlaying();
    } else {
      towerRoot.rotation.y = rotY;
    }

    if (!inIntro || introDiveStarted) {
      bounceLock = Math.max(0, bounceLock - dt);
      prevY = ball.position.y;
      vel.y += GRAVITY * dt;
      vel.y = Math.max(vel.y, -32);
      ball.position.y += vel.y * dt;
      const spin = 5 + Math.min(14, Math.abs(vel.y) * 0.45);
      ball.rotation.x += dt * spin;
      ball.rotation.z += dt * (spin * 0.35);
      ball.scale.x = THREE.MathUtils.damp(ball.scale.x, 1, 12, dt);
      ball.scale.y = THREE.MathUtils.damp(ball.scale.y, 1, 12, dt);
      ball.scale.z = THREE.MathUtils.damp(ball.scale.z, 1, 12, dt);
      const targetFov = vel.y < -12 ? BASE_FOV + 8 : BASE_FOV + 2;
      if (Math.abs(camera.fov - targetFov) > 0.05) {
        camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 4, dt);
        camera.updateProjectionMatrix();
      }
      fallTrail.visible = vel.y < -7;
      fallTrail.position.set(0, ball.position.y + 0.56, RADIAL);
      fallTrail.scale.y = Math.min(1.45, Math.abs(vel.y) / 20);

      const shadowRingIndex = Math.round(-ball.position.y / built.config.ringSpacing);
      if (shadowRingIndex >= 0 && shadowRingIndex < built.rings.length) {
        const shadowTop =
          built.ringYs[shadowRingIndex]! + built.config.ringHeight / 2 + 0.012;
        const shadowHeight = ball.position.y - BALL_R - shadowTop;
        const shadowSegment = segmentIndexAtBall(rotY);
        const hasSurface =
          built.rings[shadowRingIndex]!.segments[shadowSegment] !== 'gap' &&
          (built.segmentMeshes[shadowRingIndex]?.[shadowSegment]?.visible ?? false);
        contactShadow.visible = hasSurface && shadowHeight >= 0 && shadowHeight < 1.5;
        if (contactShadow.visible) {
          contactShadow.position.set(0, shadowTop, RADIAL);
          const shadowScale = 1 + shadowHeight * 0.32;
          contactShadow.scale.setScalar(shadowScale);
          (contactShadow.material as THREE.MeshBasicMaterial).opacity =
            0.3 * (1 - shadowHeight / 1.5);
        }
      } else {
        contactShadow.visible = false;
      }

      if (!inIntro && ball.position.y < 0) {
        const passedDepth = Math.min(
          built.rings.length,
          Math.floor(-ball.position.y / built.config.ringSpacing) + 1
        );
        noteDepthProgress(passedDepth);
      }

      // Soft red rim + targeted fracture plate when under the core.
      if (!inIntro) {
        const bottom = ball.position.y - BALL_R;
        const warnSeg = segmentIndexAtBall(rotY);
        // While falling, look farther ahead so the player can spin off a fracture.
        const reach = vel.y < 2.5 ? 3.35 : 0.9;
        let targetRing: number | null = null;
        let targetDist = Infinity;
        let dangerAhead = false;

        for (let i = 0; i < built.ringYs.length; i++) {
          const top = built.ringYs[i]! + built.config.ringHeight / 2;
          const dist = bottom - top;
          if (dist < -0.05 || dist >= reach) continue;
          const mesh = built.segmentMeshes[i]?.[warnSeg];
          if (built.rings[i]!.segments[warnSeg] === 'danger' && mesh?.visible) {
            dangerAhead = true;
            if (dist < targetDist) {
              targetDist = dist;
              targetRing = i;
            }
          }
        }

        el.dangerRim.classList.toggle('hot', dangerAhead);
        setDangerCallout(dangerAhead);
        if (dangerAhead) clearCoach();
        updateDangerPresentation(
          built,
          clock.elapsedTime,
          targetRing,
          dangerAhead ? warnSeg : null
        );

        if (dangerAhead && clock.elapsedTime - dangerWarnSoundAt > 0.45) {
          dangerWarnSoundAt = clock.elapsedTime;
          warnTone();
        }

        if (contactShadow.visible) {
          (contactShadow.material as THREE.MeshBasicMaterial).color.setHex(
            dangerAhead ? 0xff2a1f : 0x000000
          );
        }

        // Teach the rule the first time a fracture plate is nearby.
        if (!taughtDanger) {
          const probe = Math.max(
            0,
            Math.round(-ball.position.y / built.config.ringSpacing)
          );
          for (let look = probe; look < Math.min(built.rings.length, probe + 4); look++) {
            if (built.rings[look]!.segments.includes('danger')) {
              taughtDanger = true;
              toast('RED + ✕ = FRACTURE — DO NOT LAND');
              break;
            }
          }
        }
      } else {
        updateDangerPresentation(built, clock.elapsedTime, null, null);
      }

      if (bounceLock <= 0) {
        const hit = queryPlatformHit(
          prevY,
          ball.position.y,
          BALL_R,
          vel.y,
          rotY,
          built,
          broken
        );

        if (hit.kind === 'danger') {
          if (inIntro) enterPlaying();
          dangerSound();
          spawnImpactRing(
            built.ringYs[hit.ringIndex]! + built.config.ringHeight / 2,
            true
          );
          impactFlash(true);
          setDangerCallout(false);
          trauma = Math.min(1, trauma + 0.78);
          hitstop = 0.12;
          debris.push(...shatterMesh(hit.mesh, scene));
          hit.mesh.visible = false;
          vel.y = 2;
          end(false);
        } else if (hit.kind === 'safe') {
          bounceSound();
          const top =
            hit.ringIndex < built.rings.length
              ? built.ringYs[hit.ringIndex]! + built.config.ringHeight / 2
              : built.finishY + built.config.ringHeight / 2;
          spawnImpactRing(top);
          const diveLanding = lastHitRing < 0 && hit.ringIndex === 0;
          const skipCombo =
            lastHitRing >= 0 ? Math.max(1, hit.ringIndex - lastHitRing) : 1;
          ball.position.y = top + BALL_R + 0.01;
          // Clean gap streaks get a livelier bounce — skill expression reward.
          const streakBoost = skipCombo >= 2 ? Math.min(2.4, 0.55 * skipCombo) : 0;
          vel.y = (diveLanding ? BOUNCE + 1.8 : BOUNCE) + streakBoost;
          bounceLock = 0.1;
          hitstop = diveLanding || skipCombo >= 2 ? 0.05 : 0.028;
          ball.scale.set(
            diveLanding || skipCombo >= 2 ? 1.28 : 1.16,
            diveLanding || skipCombo >= 2 ? 0.62 : 0.72,
            diveLanding || skipCombo >= 2 ? 1.28 : 1.16
          );
          trauma = Math.min(1, trauma + (diveLanding ? 0.28 : 0.1 + streakBoost * 0.04));
          if (diveLanding || skipCombo >= 2) impactFlash();

          if (inIntro) {
            enterPlaying();
          }

          if (hit.ringIndex < built.rings.length) {
            if (hit.ringIndex > lastHitRing) {
              noteDepthProgress(Math.max(depth, hit.ringIndex + 1));
              combo = Math.max(1, skipCombo);
              bestCombo = Math.max(bestCombo, combo);
              lastHitRing = hit.ringIndex;
              setHud();
            }
          } else {
            noteDepthProgress(built.rings.length);
            clearSound();
            end(true);
          }
        }
      }

      if (ball.position.y < built.finishY - 10) {
        clearSound();
        end(true);
      }

      // Camera follows with a one-way, damped dead zone once the dive is live.
      if (!inIntro || introDiveStarted) {
        cameraTargetY = Math.min(cameraTargetY, ball.position.y + 4.2);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, cameraTargetY, 5, dt);
        camera.position.x = THREE.MathUtils.damp(camera.position.x, 0, 6, dt);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, 13.2, 5, dt);
        camera.lookAt(0, camera.position.y - 4.5, 0);
        camera.rotation.z = 0;
      }
    }

    cyanFill.position.set(-2.4, camera.position.y + 1.2, camera.position.z + 2.8);
    amberFill.position.set(3.1, camera.position.y - 1.6, camera.position.z + 2.2);

    // World mood shifts by level — each band has its own light identity.
    if (!inIntro && built) {
      const level = levelForDepth(Math.max(1, depth || 1), built.rings.length);
      const progress = Math.min(1, depth / Math.max(1, built.rings.length));
      const fogDensity = 0.028 + progress * 0.012;
      if (scene.fog instanceof THREE.FogExp2) scene.fog.density = fogDensity;
      cyanFill.intensity = 0.85 - progress * 0.25;
      amberFill.intensity = 0.55 + progress * 0.55;
      cyanFill.color.setHex(level.fogTint);
      amberFill.color.setHex(level.accentHex);
    }

    document.body.dataset.ballY = ball.position.y.toFixed(3);
    document.body.dataset.velocityY = vel.y.toFixed(3);
    document.body.dataset.rotationY = rotY.toFixed(6);
    document.body.dataset.activeSegment = String(segmentIndexAtBall(rotY));
  } else if (phase !== 'paused' && phase !== 'intro') {
    fallTrail.visible = false;
    contactShadow.visible = false;
    towerRoot.rotation.y += dt * 0.4;
    ball.position.y = 4.5 + Math.sin(clock.elapsedTime) * 0.25;
    camera.position.set(0, 5, 13.5);
    camera.lookAt(0, 1, 0);
    camera.rotation.z = 0;
    cyanFill.position.set(-2.2, 6, 16);
    amberFill.position.set(3.4, 2, 15);
  }
}

function tick(): void {
  requestAnimationFrame(tick);
  const frameDt = Math.min(clock.getDelta(), 0.1);
  accumulator = Math.min(accumulator + frameDt, FIXED_STEP * 8);

  while (accumulator >= FIXED_STEP) {
    updateGame(FIXED_STEP);
    accumulator -= FIXED_STEP;
  }

  debris = updateDebris(debris, frameDt);
  updateImpactEffects(frameDt);
  if (trauma > 0.001 && phase !== 'paused') {
    shakeTime += frameDt;
    trauma = Math.max(0, trauma - frameDt * 1.7);
    const shake = trauma * trauma;
    camera.position.x += Math.sin(shakeTime * 41) * 0.18 * shake;
    camera.position.y += Math.sin(shakeTime * 53 + 1.2) * 0.12 * shake;
    camera.rotation.z += Math.sin(shakeTime * 47 + 2.5) * 0.035 * shake;
  }
  renderer.render(scene, camera);
}

async function boot(): Promise<void> {
  const fallback: InitResponse = {
    type: 'init',
    postId: 'local',
    username: 'diver',
    dateKey: new Date().toISOString().slice(0, 10),
    dailySeed: 42,
    personalBest: 0,
    dailyBest: 0,
    streak: 0,
    todayPlayed: false,
    leaderboard: [],
    communityBlueprints: [],
    playersToday: 0,
  };

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch('/api/init', { signal: ctrl.signal });
    clearTimeout(t);
    initData = res.ok ? ((await res.json()) as InitResponse) : fallback;
  } catch {
    initData = fallback;
  }

  wipeTower();
  built = buildTower(
    generateTowerRings(initData.dailySeed, 22, initData.communityBlueprints),
    DEFAULT_TOWER
  );
  towerRoot.add(built.group);

  menu();
  tick();
  // Auto-start so you see the ball fall immediately — no menu wall
  start('daily');
}

void boot();
