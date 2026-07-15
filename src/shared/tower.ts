/** Shared tower generation — client & server use the same seed for daily cores. */

import { levelForRing, type LevelModifier } from './levels.js';

export type SegmentKind = 'safe' | 'danger' | 'gap';

export type RingBlueprint = {
  /** 8 segments around the ring */
  segments: SegmentKind[];
};

export type TowerConfig = {
  ringCount: number;
  ringSpacing: number;
  innerRadius: number;
  outerRadius: number;
  ringHeight: number;
  poleRadius: number;
};

export const DEFAULT_TOWER: TowerConfig = {
  ringCount: 40,
  ringSpacing: 2.2,
  innerRadius: 1.15,
  outerRadius: 3.4,
  ringHeight: 0.38,
  poleRadius: 0.95,
};

export const SEGMENTS_PER_RING = 8;

/** Mulberry32 — deterministic PRNG from a 32-bit seed */
export function createRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** UTC date key YYYY-MM-DD */
export function utcDateKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function dailySeed(dateKey: string): number {
  return hashString(`sona-daily-${dateKey}`);
}

function countKind(segments: SegmentKind[], kind: SegmentKind): number {
  return segments.reduce((n, s) => n + (s === kind ? 1 : 0), 0);
}

/**
 * Keep fracture plates readable and escapable:
 * - no adjacent reds
 * - no stacked reds in the same column
 * - no red under a gap drop corridor (prev ring gap ±2)
 * - no red beside a gap on the same ring (looks like a locked chute)
 * - hard cap on reds per ring
 */
export function fairifyBlueprint(
  segments: SegmentKind[],
  prev: SegmentKind[] | null = null,
  difficulty = 0.5
): SegmentKind[] {
  const out: SegmentKind[] = segments.map((s) => s);
  const maxDanger = difficulty < 0.4 ? 1 : difficulty < 0.75 ? 1 : 2;

  const clearDanger = (index: number): void => {
    if (out[index] === 'danger') out[index] = 'safe';
  };

  // Break red walls.
  for (let pass = 0; pass < SEGMENTS_PER_RING; pass++) {
    for (let i = 0; i < SEGMENTS_PER_RING; i++) {
      const next = (i + 1) % SEGMENTS_PER_RING;
      if (out[i] === 'danger' && out[next] === 'danger') clearDanger(next);
    }
  }

  if (prev) {
    for (let i = 0; i < SEGMENTS_PER_RING; i++) {
      if (out[i] === 'danger' && prev[i] === 'danger') clearDanger(i);

      // Drop corridor: falling through a gap must land on ivory/gap, with spin room.
      if (prev[i] === 'gap') {
        for (const offset of [-2, -1, 0, 1, 2]) {
          clearDanger((i + offset + SEGMENTS_PER_RING) % SEGMENTS_PER_RING);
        }
      }
    }
  }

  // Same-ring rule: reds may not sit beside a gap (the "locked chute" read).
  for (let i = 0; i < SEGMENTS_PER_RING; i++) {
    if (out[i] !== 'gap') continue;
    clearDanger((i + 1) % SEGMENTS_PER_RING);
    clearDanger((i + SEGMENTS_PER_RING - 1) % SEGMENTS_PER_RING);
  }

  // Un-sandwich: danger-safe-danger.
  for (let i = 0; i < SEGMENTS_PER_RING; i++) {
    const left = (i + SEGMENTS_PER_RING - 1) % SEGMENTS_PER_RING;
    const right = (i + 1) % SEGMENTS_PER_RING;
    if (out[i] === 'safe' && out[left] === 'danger' && out[right] === 'danger') {
      clearDanger(right);
    }
  }

  // Cap red density — climax still max 2, but only if both stay isolated from gaps.
  const dangerIndexes: number[] = [];
  for (let i = 0; i < SEGMENTS_PER_RING; i++) {
    if (out[i] === 'danger') dangerIndexes.push(i);
  }
  while (dangerIndexes.length > maxDanger) {
    clearDanger(dangerIndexes.pop()!);
  }

  // Always keep a landable ivory plate and a drop gap.
  if (!out.includes('gap')) {
    let gapAt = 0;
    for (let i = 0; i < SEGMENTS_PER_RING; i++) {
      const left = out[(i + SEGMENTS_PER_RING - 1) % SEGMENTS_PER_RING];
      const right = out[(i + 1) % SEGMENTS_PER_RING];
      if (out[i] !== 'danger' && left !== 'danger' && right !== 'danger') {
        gapAt = i;
        break;
      }
    }
    out[gapAt] = 'gap';
  }
  if (!out.includes('safe')) {
    const idx = out.findIndex((s) => s !== 'gap');
    if (idx >= 0) out[idx] = 'safe';
    else out[1 % SEGMENTS_PER_RING] = 'safe';
  }

  // At least three safes whenever a red exists — real escape arcs.
  if (countKind(out, 'danger') > 0) {
    while (countKind(out, 'safe') < 3 && countKind(out, 'danger') > 0) {
      const d = out.findIndex((s) => s === 'danger');
      if (d < 0) break;
      out[d] = 'safe';
    }
  }

  // Final safety sweeps after gap insertion / conversions.
  for (let i = 0; i < SEGMENTS_PER_RING; i++) {
    if (out[i] === 'gap') {
      clearDanger((i + 1) % SEGMENTS_PER_RING);
      clearDanger((i + SEGMENTS_PER_RING - 1) % SEGMENTS_PER_RING);
    }
  }
  if (prev) {
    for (let i = 0; i < SEGMENTS_PER_RING; i++) {
      if (prev[i] !== 'gap') continue;
      for (const offset of [-2, -1, 0, 1, 2]) {
        clearDanger((i + offset + SEGMENTS_PER_RING) % SEGMENTS_PER_RING);
      }
    }
  }

  // Re-break any walls created by earlier passes.
  for (let i = 0; i < SEGMENTS_PER_RING; i++) {
    const next = (i + 1) % SEGMENTS_PER_RING;
    if (out[i] === 'danger' && out[next] === 'danger') clearDanger(next);
  }

  return out;
}

function isUnderPrevGap(prev: SegmentKind[] | null, idx: number): boolean {
  if (!prev) return false;
  for (const offset of [-2, -1, 0, 1, 2]) {
    const col = (idx + offset + SEGMENTS_PER_RING) % SEGMENTS_PER_RING;
    if (prev[col] === 'gap') return true;
  }
  return false;
}

function touchesGap(segments: SegmentKind[], idx: number): boolean {
  const left = segments[(idx + SEGMENTS_PER_RING - 1) % SEGMENTS_PER_RING];
  const right = segments[(idx + 1) % SEGMENTS_PER_RING];
  return left === 'gap' || right === 'gap';
}

function randomBlueprint(
  rng: () => number,
  difficulty: number,
  prev: SegmentKind[] | null,
  role: 'teach' | 'threat' | 'recovery' | 'pressure' | 'climax' = 'threat'
): RingBlueprint {
  const segments: SegmentKind[] = Array.from({ length: SEGMENTS_PER_RING }, () => 'safe');

  // Encounter rhythm: teach → threat → recovery → pressure → climax
  let gapLen: number;
  let maxDanger: number;
  let dangerChance: number;
  if (role === 'teach') {
    gapLen = 4;
    maxDanger = 0;
    dangerChance = 0;
  } else if (role === 'recovery') {
    gapLen = 3;
    maxDanger = 0;
    dangerChance = 0;
  } else if (role === 'threat') {
    gapLen = 3;
    maxDanger = 1;
    dangerChance = 0.55;
  } else if (role === 'pressure') {
    gapLen = 2;
    maxDanger = 1;
    dangerChance = 0.7;
  } else {
    gapLen = 2;
    maxDanger = 1;
    dangerChance = 0.75;
  }

  // Offset the gap from the previous ring so drops create a real align decision.
  let gapStart = Math.floor(rng() * SEGMENTS_PER_RING);
  if (prev) {
    const prevGap = prev.findIndex((s) => s === 'gap');
    if (prevGap >= 0) {
      const shift = 2 + Math.floor(rng() * 3); // 2-4 sectors — readable, not random chaos
      gapStart = (prevGap + shift) % SEGMENTS_PER_RING;
    }
  }

  for (let i = 0; i < gapLen; i++) {
    segments[(gapStart + i) % SEGMENTS_PER_RING] = 'gap';
  }

  const candidates: number[] = [];
  for (let i = 0; i < SEGMENTS_PER_RING; i++) {
    if (segments[i] !== 'gap' && !isUnderPrevGap(prev, i)) candidates.push(i);
  }
  let placed = 0;
  while (placed < maxDanger && candidates.length > 0) {
    const pick = Math.floor(rng() * candidates.length);
    const idx = candidates.splice(pick, 1)[0]!;
    if (rng() >= dangerChance && placed > 0) continue;
    const left = segments[(idx + SEGMENTS_PER_RING - 1) % SEGMENTS_PER_RING];
    const right = segments[(idx + 1) % SEGMENTS_PER_RING];
    if (left === 'danger' || right === 'danger') continue;
    if (prev && prev[idx] === 'danger') continue;
    if (isUnderPrevGap(prev, idx)) continue;
    if (touchesGap(segments, idx)) continue;
    segments[idx] = 'danger';
    placed += 1;
    for (const n of [
      (idx + SEGMENTS_PER_RING - 1) % SEGMENTS_PER_RING,
      (idx + 1) % SEGMENTS_PER_RING,
    ]) {
      const at = candidates.indexOf(n);
      if (at >= 0) candidates.splice(at, 1);
    }
  }

  return {
    segments: fairifyBlueprint(segments, prev, difficulty),
  };
}

/** Ring roles drive compression/release pacing (level-design contract). */
export function encounterRoleForRing(
  index: number,
  ringCount: number
): 'teach' | 'threat' | 'recovery' | 'pressure' | 'climax' {
  const level = levelForRing(index, ringCount);
  const local = index - level.fromRing;
  // First 2 rings of every level = soft teach/recovery.
  if (local < 2) return level.id === 1 ? 'teach' : 'recovery';
  if (level.modifier === 'wide-gaps') return 'teach';
  if (level.modifier === 'first-red') return 'threat';
  if (level.modifier === 'offset-gaps') return local % 5 === 4 ? 'recovery' : 'pressure';
  if (level.modifier === 'tight-spin') return 'climax';
  return 'pressure';
}

function roleForModifier(
  modifier: LevelModifier,
  fallback: 'teach' | 'threat' | 'recovery' | 'pressure' | 'climax'
): 'teach' | 'threat' | 'recovery' | 'pressure' | 'climax' {
  if (modifier === 'wide-gaps') return 'teach';
  if (modifier === 'first-red') return 'threat';
  if (modifier === 'offset-gaps') return 'pressure';
  if (modifier === 'tight-spin' || modifier === 'double-threat') return 'climax';
  return fallback;
}

export function generateTowerRings(
  seed: number,
  ringCount: number,
  communityBlueprints: RingBlueprint[] = []
): RingBlueprint[] {
  const rng = createRng(seed);
  const rings: RingBlueprint[] = [];

  for (let i = 0; i < ringCount; i++) {
    const level = levelForRing(i, ringCount);
    const difficulty = Math.min(1, (level.id - 1) / Math.max(1, 3) + (i - level.fromRing) / 40);
    const prev = rings.length ? rings[rings.length - 1]!.segments : null;
    const role = roleForModifier(level.modifier, encounterRoleForRing(i, ringCount));

    // Community modules only on pressure/climax beats — still fairified.
    if (
      communityBlueprints.length > 0 &&
      (role === 'pressure' || role === 'climax') &&
      i % 5 === 0 &&
      rng() < 0.45
    ) {
      const pick = communityBlueprints[Math.floor(rng() * communityBlueprints.length)];
      if (pick) {
        rings.push({
          segments: fairifyBlueprint([...pick.segments], prev, difficulty),
        });
        continue;
      }
    }

    rings.push(randomBlueprint(rng, difficulty, prev, role));
  }

  return rings;
}

export function isValidBlueprint(segments: unknown): segments is SegmentKind[] {
  if (!Array.isArray(segments) || segments.length !== SEGMENTS_PER_RING) return false;
  const allowed = new Set<SegmentKind>(['safe', 'danger', 'gap']);
  let hasGap = false;
  let hasSafe = false;
  let dangerCount = 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (typeof s !== 'string' || !allowed.has(s as SegmentKind)) return false;
    if (s === 'gap') hasGap = true;
    if (s === 'safe') hasSafe = true;
    if (s === 'danger') {
      dangerCount += 1;
      const next = segments[(i + 1) % SEGMENTS_PER_RING];
      if (next === 'danger') return false;
    }
  }
  return hasGap && hasSafe && dangerCount <= 2;
}

/** True when every gap has a safe drop corridor on the next ring. */
export function assertTowerFairness(rings: RingBlueprint[]): string[] {
  const errors: string[] = [];
  for (let i = 0; i < rings.length; i++) {
    const cur = rings[i]!.segments;
    for (let j = 0; j < SEGMENTS_PER_RING; j++) {
      if (cur[j] === 'danger' && cur[(j + 1) % SEGMENTS_PER_RING] === 'danger') {
        errors.push(`ring ${i}: adjacent danger`);
      }
      if (
        cur[j] === 'gap' &&
        (cur[(j + 1) % SEGMENTS_PER_RING] === 'danger' ||
          cur[(j + SEGMENTS_PER_RING - 1) % SEGMENTS_PER_RING] === 'danger')
      ) {
        errors.push(`ring ${i}: danger beside gap at ${j}`);
      }
    }
    if (i === 0) continue;
    const prev = rings[i - 1]!.segments;
    for (let j = 0; j < SEGMENTS_PER_RING; j++) {
      if (prev[j] !== 'gap') continue;
      for (const offset of [-2, -1, 0, 1, 2]) {
        const col = (j + offset + SEGMENTS_PER_RING) % SEGMENTS_PER_RING;
        if (cur[col] === 'danger') {
          errors.push(`ring ${i}: danger under gap corridor ${j}->${col}`);
        }
      }
    }
  }
  return errors;
}

export function depthFromRingIndex(ringIndex: number): number {
  return ringIndex + 1;
}
