import * as THREE from 'three';
import {
  DEFAULT_TOWER,
  SEGMENTS_PER_RING,
  type RingBlueprint,
  type SegmentKind,
  type TowerConfig,
} from '../shared/tower';

export type PlatformHit =
  | { kind: 'safe' | 'danger'; ringIndex: number; mesh: THREE.Mesh }
  | { kind: 'none' };

const COLORS: Record<Exclude<SegmentKind, 'gap'>, number> = {
  safe: 0xd8c9a7,
  danger: 0xff2a1f,
};

function addDangerMarkings(
  mesh: THREE.Mesh,
  config: TowerConfig,
  angleStep: number,
  pad: number
): void {
  const topY = config.ringHeight / 2 + 0.06;
  const mid = angleStep / 2;
  const radius = (config.innerRadius + config.outerRadius) / 2;

  const stripeMat = new THREE.MeshStandardMaterial({
    color: 0x1a0504,
    emissive: 0xffc14d,
    emissiveIntensity: 0.95,
    metalness: 0.1,
    roughness: 0.4,
  });
  const stripeGeo = new THREE.BoxGeometry(0.22, 0.05, 1.55);
  for (let i = -2; i <= 2; i++) {
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    const a = mid + i * 0.11;
    const r = radius + i * 0.02;
    stripe.position.set(Math.cos(a) * r, topY, -Math.sin(a) * r);
    stripe.rotation.y = a;
    stripe.rotation.z = Math.PI / 5;
    mesh.add(stripe);
  }

  const rimGeo = createAnnularSector(
    config.innerRadius + 0.2,
    config.outerRadius - 0.12,
    0.04,
    pad + 0.03,
    angleStep - pad - 0.03
  );
  const rim = new THREE.Mesh(
    rimGeo,
    new THREE.MeshStandardMaterial({
      color: 0xff4d3d,
      emissive: 0xff1e0a,
      emissiveIntensity: 1.6,
      metalness: 0.05,
      roughness: 0.35,
      transparent: true,
      opacity: 0.92,
    })
  );
  rim.position.y = topY + 0.01;
  mesh.add(rim);

  const xMat = new THREE.MeshStandardMaterial({
    color: 0xfff1c9,
    emissive: 0xff4d3d,
    emissiveIntensity: 1.8,
    metalness: 0.1,
    roughness: 0.25,
  });
  const barGeo = new THREE.BoxGeometry(0.12, 0.08, 1.05);
  for (const rot of [Math.PI / 4, -Math.PI / 4]) {
    const bar = new THREE.Mesh(barGeo, xMat);
    bar.position.set(Math.cos(mid) * radius, topY + 0.05, -Math.sin(mid) * radius);
    bar.rotation.y = mid + rot;
    mesh.add(bar);
  }

  const glow = new THREE.Mesh(
    createAnnularSector(
      config.innerRadius + 0.08,
      config.outerRadius + 0.08,
      0.03,
      pad * 0.5,
      angleStep - pad * 0.5
    ),
    new THREE.MeshBasicMaterial({
      color: 0xff3b2e,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
  );
  glow.position.y = topY + 0.08;
  glow.visible = false;
  mesh.add(glow);

  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.12, 1.4, 8, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xff4d3d,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
  );
  beacon.position.set(Math.cos(mid) * radius, topY + 0.75, -Math.sin(mid) * radius);
  beacon.visible = false;
  mesh.add(beacon);

  mesh.userData.glow = glow;
  mesh.userData.beacon = beacon;
  mesh.userData.dangerPulse = true;
}

function createAnnularSector(
  innerR: number,
  outerR: number,
  height: number,
  startAngle: number,
  endAngle: number
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const steps = 16;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = startAngle + (endAngle - startAngle) * t;
    const x = Math.cos(a) * outerR;
    const y = Math.sin(a) * outerR;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }

  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const a = startAngle + (endAngle - startAngle) * t;
    shape.lineTo(Math.cos(a) * innerR, Math.sin(a) * innerR);
  }

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.035,
    bevelThickness: 0.035,
    curveSegments: 1,
  });
  // Shape is XY; extrude +Z → rotate so thickness is world Y (floor)
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -height / 2, 0);
  return geo;
}

export type BuiltTower = {
  group: THREE.Group;
  rings: RingBlueprint[];
  config: TowerConfig;
  ringYs: number[];
  segmentMeshes: Array<Array<THREE.Mesh | null>>;
  finishMesh: THREE.Mesh;
  finishY: number;
};

export function buildTower(
  rings: RingBlueprint[],
  config: TowerConfig = DEFAULT_TOWER
): BuiltTower {
  const group = new THREE.Group();
  const totalHeight = Math.max(1, rings.length - 1) * config.ringSpacing;

  const poleGeo = new THREE.CylinderGeometry(
    config.poleRadius,
    config.poleRadius * 0.92,
    totalHeight + 10,
    28
  );
  const poleMat = new THREE.MeshStandardMaterial({
    color: 0x1e2530,
    metalness: 0.82,
    roughness: 0.24,
  });
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.y = -totalHeight / 2;
  group.add(pole);

  const coreGeo = new THREE.CylinderGeometry(
    config.poleRadius * 0.32,
    config.poleRadius * 0.2,
    totalHeight + 8,
    12
  );
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0x06141c,
    emissive: 0x2cd9ff,
    emissiveIntensity: 2.2,
    metalness: 0.2,
    roughness: 0.22,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.position.y = -totalHeight / 2;
  group.add(core);

  const ringYs: number[] = [];
  const segmentMeshes: Array<Array<THREE.Mesh | null>> = [];
  const angleStep = (Math.PI * 2) / SEGMENTS_PER_RING;
  const pad = 0.05;
  const sharedSectors = [
    createAnnularSector(
      config.innerRadius,
      config.outerRadius,
      config.ringHeight,
      pad,
      angleStep - pad
    ),
    createAnnularSector(
      config.innerRadius + 0.14,
      config.outerRadius - 0.2,
      config.ringHeight,
      pad,
      angleStep - pad
    ),
    createAnnularSector(
      config.innerRadius + 0.28,
      config.outerRadius,
      config.ringHeight,
      pad + 0.025,
      angleStep - pad - 0.025
    ),
  ];
  const insetGeometry = createAnnularSector(
    config.innerRadius + 0.36,
    config.outerRadius - 0.28,
    0.055,
    pad + 0.08,
    angleStep - pad - 0.08
  );
  const safeMaterial = new THREE.MeshStandardMaterial({
    color: COLORS.safe,
    metalness: 0.18,
    roughness: 0.46,
    emissive: 0x3a2b12,
    emissiveIntensity: 0.08,
  });
  const insetMaterial = new THREE.MeshStandardMaterial({
    color: 0x242a2d,
    emissive: 0x8a5417,
    emissiveIntensity: 0.12,
    metalness: 0.62,
    roughness: 0.32,
  });

  rings.forEach((ring, ringIndex) => {
    const y = -ringIndex * config.ringSpacing;
    ringYs.push(y);
    const meshes: Array<THREE.Mesh | null> = [];

    ring.segments.forEach((kind, segIndex) => {
      if (kind === 'gap') {
        meshes.push(null);
        return;
      }

      const material =
        kind === 'danger'
          ? new THREE.MeshStandardMaterial({
              color: COLORS.danger,
              metalness: 0.08,
              roughness: 0.28,
              emissive: 0xff1a0a,
              emissiveIntensity: 0.95,
            })
          : safeMaterial;

      const mesh = new THREE.Mesh(
        sharedSectors[ringIndex % sharedSectors.length]!,
        material
      );
      mesh.position.y = y;
      // Geometry authored in XY maps authored +angle to world -angle.
      mesh.rotation.y = -segIndex * angleStep;
      mesh.userData = { kind, ringIndex, segIndex };

      if (kind === 'danger') {
        addDangerMarkings(mesh, config, angleStep, pad);
      } else {
        const inset = new THREE.Mesh(insetGeometry, insetMaterial);
        inset.position.y = config.ringHeight / 2 + 0.05;
        mesh.add(inset);
      }

      group.add(mesh);
      meshes.push(mesh);
    });

    segmentMeshes.push(meshes);
  });

  const finishY = -rings.length * config.ringSpacing;
  const finishGeo = new THREE.CylinderGeometry(
    config.outerRadius,
    config.outerRadius,
    config.ringHeight,
    40
  );
  const finishMat = new THREE.MeshStandardMaterial({
    color: 0xf4d27a,
    emissive: 0xffa928,
    emissiveIntensity: 0.75,
    metalness: 0.48,
    roughness: 0.24,
  });
  const finishMesh = new THREE.Mesh(finishGeo, finishMat);
  finishMesh.position.y = finishY;
  finishMesh.userData = { kind: 'finish', ringIndex: rings.length };
  group.add(finishMesh);

  const collarGeometry = new THREE.TorusGeometry(config.poleRadius * 1.06, 0.07, 8, 28);
  collarGeometry.rotateX(Math.PI / 2);
  const collarMaterial = new THREE.MeshStandardMaterial({
    color: 0xd68b35,
    metalness: 0.85,
    roughness: 0.2,
    emissive: 0x5b2505,
    emissiveIntensity: 0.18,
  });
  const landmarkMaterial = new THREE.MeshStandardMaterial({
    color: 0xffd27a,
    metalness: 0.7,
    roughness: 0.18,
    emissive: 0xffa928,
    emissiveIntensity: 1.15,
  });
  for (let i = 0; i < rings.length; i++) {
    const isLandmark = i > 0 && i % 10 === 0;
    if (!isLandmark && i % 4 !== 0) continue;
    const collar = new THREE.Mesh(
      collarGeometry,
      isLandmark ? landmarkMaterial : collarMaterial
    );
    collar.position.y = ringYs[i]! - config.ringSpacing / 2;
    if (isLandmark) collar.scale.setScalar(1.18);
    group.add(collar);
  }

  // Landmark zone bands — readable depth anchors in the shaft world.
  const bandGeo = new THREE.TorusGeometry(config.outerRadius + 1.6, 0.05, 6, 48);
  bandGeo.rotateX(Math.PI / 2);
  for (const [ringIndex, color] of [
    [10, 0x2cd9ff],
    [20, 0xffa928],
    [30, 0xff4d3d],
  ] as const) {
    if (ringIndex >= rings.length) continue;
    const band = new THREE.Mesh(
      bandGeo,
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.85,
        metalness: 0.4,
        roughness: 0.35,
        transparent: true,
        opacity: 0.7,
      })
    );
    band.position.y = ringYs[ringIndex]!;
    group.add(band);
  }

  return { group, rings, config, ringYs, segmentMeshes, finishMesh, finishY };
}

export function shatterMesh(mesh: THREE.Mesh, scene: THREE.Scene): THREE.Mesh[] {
  const debris: THREE.Mesh[] = [];
  const color =
    mesh.material instanceof THREE.MeshStandardMaterial
      ? mesh.material.color.getHex()
      : 0x34d399;

  const worldPos = new THREE.Vector3();
  mesh.getWorldPosition(worldPos);

  for (let i = 0; i < 5; i++) {
    const geo = new THREE.BoxGeometry(
      0.2 + Math.random() * 0.3,
      0.1,
      0.25 + Math.random() * 0.35
    );
    const mat = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.3,
      roughness: 0.55,
      transparent: true,
    });
    const bit = new THREE.Mesh(geo, mat);
    bit.position.copy(worldPos);
    bit.position.x += (Math.random() - 0.5) * 1.1;
    bit.position.z += (Math.random() - 0.5) * 1.1;
    bit.userData = {
      vx: (Math.random() - 0.5) * 7,
      vy: 3 + Math.random() * 5,
      vz: (Math.random() - 0.5) * 7,
      spin: (Math.random() - 0.5) * 12,
      life: 1,
    };
    scene.add(bit);
    debris.push(bit);
  }

  return debris;
}

export function updateDebris(debris: THREE.Mesh[], dt: number): THREE.Mesh[] {
  const gravity = -22;
  const remaining: THREE.Mesh[] = [];

  for (const bit of debris) {
    const d = bit.userData as {
      vx: number;
      vy: number;
      vz: number;
      spin: number;
      life: number;
    };
    d.vy += gravity * dt;
    bit.position.x += d.vx * dt;
    bit.position.y += d.vy * dt;
    bit.position.z += d.vz * dt;
    bit.rotation.x += d.spin * dt;
    bit.rotation.z += d.spin * 0.7 * dt;
    d.life -= dt;

    if (d.life <= 0 || bit.position.y < -90) {
      bit.parent?.remove(bit);
      bit.geometry.dispose();
      if (Array.isArray(bit.material)) bit.material.forEach((m) => m.dispose());
      else bit.material.dispose();
    } else {
      if (bit.material instanceof THREE.MeshStandardMaterial) {
        bit.material.opacity = Math.max(0, d.life);
      }
      remaining.push(bit);
    }
  }

  return remaining;
}

/**
 * Returns the rendered segment directly below the ball.
 *
 * Sectors use one shared geometry authored on [0, τ/N], then each mesh is
 * rotated by `rotation.y = -index * (τ/N)`. After the XY→XZ extrude flip
 * (authored angle `a` → world angle `-a`), segment `i` occupies tower-local
 * world angles `((i-1)·step), i·step]`.
 *
 * The ball is fixed at +Z. In tower-local space that direction is
 * `π/2 + towerRotationY`, so the matching segment is:
 * `ceil((π/2 + towerRotationY) / step) mod N`.
 */
export function segmentIndexAtBall(towerRotationY: number): number {
  const angleStep = (Math.PI * 2) / SEGMENTS_PER_RING;
  const alpha =
    (((Math.PI / 2 + towerRotationY) % (Math.PI * 2)) + Math.PI * 2) %
    (Math.PI * 2);
  // Tiny epsilon keeps exact step boundaries on the lower segment.
  return Math.ceil(alpha / angleStep - 1e-9) % SEGMENTS_PER_RING;
}

/**
 * One-way floor: only hits when the ball crosses the platform top while falling.
 */
export function queryPlatformHit(
  prevY: number,
  ballY: number,
  ballRadius: number,
  vy: number,
  towerRotationY: number,
  built: BuiltTower,
  broken: Set<string>
): PlatformHit {
  if (vy > 0) return { kind: 'none' };

  const { config, rings, ringYs, segmentMeshes } = built;
  const prevBottom = prevY - ballRadius;
  const bottom = ballY - ballRadius;

  for (let i = 0; i < ringYs.length; i++) {
    const platformTop = ringYs[i]! + config.ringHeight / 2;

    // Crossed the top face this frame (or nested just below it)
    const crossed =
      prevBottom >= platformTop - 0.02 && bottom <= platformTop + 0.08;
    const resting =
      bottom <= platformTop + 0.05 &&
      bottom >= platformTop - config.ringHeight &&
      ballY >= ringYs[i]!;

    if (!crossed && !resting) continue;

    const seg = segmentIndexAtBall(towerRotationY);
    const kind = rings[i]!.segments[seg]!;
    if (kind === 'gap') continue;

    const key = `${i}:${seg}`;
    if (broken.has(key)) continue;

    const mesh = segmentMeshes[i]![seg];
    if (!mesh || !mesh.visible) continue;

    return { kind, ringIndex: i, mesh };
  }

  const finishTop = built.finishY + config.ringHeight / 2;
  if (
    (prevBottom >= finishTop - 0.02 && bottom <= finishTop + 0.08) ||
    (bottom <= finishTop + 0.05 && ballY >= built.finishY)
  ) {
    return { kind: 'safe', ringIndex: rings.length, mesh: built.finishMesh };
  }

  return { kind: 'none' };
}

/** Pulse fracture plates and light up the one currently under the core. */
export function updateDangerPresentation(
  built: BuiltTower,
  elapsed: number,
  targetRing: number | null,
  targetSeg: number | null
): void {
  const pulse = 0.75 + Math.sin(elapsed * 6.2) * 0.35;

  for (let ring = 0; ring < built.segmentMeshes.length; ring++) {
    for (let seg = 0; seg < SEGMENTS_PER_RING; seg++) {
      const mesh = built.segmentMeshes[ring]![seg];
      if (!mesh || !mesh.visible || mesh.userData.kind !== 'danger') continue;

      const mat = mesh.material;
      if (mat instanceof THREE.MeshStandardMaterial) {
        const targeted = ring === targetRing && seg === targetSeg;
        mat.emissiveIntensity = targeted ? 1.55 + pulse * 0.55 : 0.7 + pulse * 0.28;
      }

      const glow = mesh.userData.glow as THREE.Mesh | undefined;
      const beacon = mesh.userData.beacon as THREE.Mesh | undefined;
      const targeted = ring === targetRing && seg === targetSeg;

      if (glow) {
        glow.visible = targeted;
        const glowMat = glow.material as THREE.MeshBasicMaterial;
        glowMat.opacity = targeted ? 0.35 + pulse * 0.25 : 0;
      }
      if (beacon) {
        beacon.visible = targeted;
        const beaconMat = beacon.material as THREE.MeshBasicMaterial;
        beaconMat.opacity = targeted ? 0.45 + pulse * 0.3 : 0;
        beacon.scale.y = targeted ? 0.85 + pulse * 0.35 : 1;
      }
    }
  }
}
