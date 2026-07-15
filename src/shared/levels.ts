/** Discrete descent levels — each has a named hook + generation modifier. */

export type LevelModifier =
  | 'wide-gaps'
  | 'first-red'
  | 'offset-gaps'
  | 'tight-spin'
  | 'double-threat';

export type LevelDef = {
  id: number;
  name: string;
  /** Inclusive ring index start (0-based). */
  fromRing: number;
  /** Exclusive ring index end. */
  toRing: number;
  /** Short player-facing hook attached to this level. */
  hook: string;
  enterToast: string;
  clearToast: string;
  modifier: LevelModifier;
  fogTint: number;
  accentHex: number;
};

/** Daily reactor = 4 levels × 10 rings. Endless reuses the cycle. */
export const LEVELS: LevelDef[] = [
  {
    id: 1,
    name: 'ALIGN',
    fromRing: 0,
    toRing: 10,
    hook: 'Wide gaps · learn the spin',
    enterToast: 'LEVEL 1 — ALIGN',
    clearToast: 'LEVEL 1 CLEAR — fracture plates incoming',
    modifier: 'wide-gaps',
    fogTint: 0x2cd9ff,
    accentHex: 0x2cd9ff,
  },
  {
    id: 2,
    name: 'FRACTURE',
    fromRing: 10,
    toRing: 20,
    hook: 'First red · one kill plate per ring',
    enterToast: 'LEVEL 2 — FRACTURE',
    clearToast: 'LEVEL 2 CLEAR — gaps start shifting',
    modifier: 'first-red',
    fogTint: 0x7ad7ff,
    accentHex: 0xffa928,
  },
  {
    id: 3,
    name: 'PRESSURE',
    fromRing: 20,
    toRing: 30,
    hook: 'Offset gaps · commit the turn',
    enterToast: 'LEVEL 3 — PRESSURE',
    clearToast: 'LEVEL 3 CLEAR — final descent',
    modifier: 'offset-gaps',
    fogTint: 0xff8a6a,
    accentHex: 0xff6a2a,
  },
  {
    id: 4,
    name: 'NADIR',
    fromRing: 30,
    toRing: 40,
    hook: 'Tight rings · survive the bottom',
    enterToast: 'LEVEL 4 — NADIR',
    clearToast: 'REACTOR CLEARED',
    modifier: 'tight-spin',
    fogTint: 0xff6a2a,
    accentHex: 0xff3d2e,
  },
];

export function levelForRing(ringIndex: number, ringCount = 40): LevelDef {
  const cycle = Math.max(40, ringCount);
  const idx = ((ringIndex % cycle) + cycle) % cycle;
  for (const level of LEVELS) {
    if (idx >= level.fromRing && idx < level.toRing) return level;
  }
  return LEVELS[LEVELS.length - 1]!;
}

export function levelForDepth(depth: number, ringCount = 40): LevelDef {
  // depth is 1-based rings cleared; map to ring index just cleared
  const ringIndex = Math.max(0, depth - 1);
  return levelForRing(ringIndex, ringCount);
}

export function levelProgressLabel(depth: number, ringCount: number): string {
  const level = levelForDepth(Math.max(1, depth), ringCount);
  const local = Math.max(0, depth - level.fromRing);
  const span = level.toRing - level.fromRing;
  return `L${level.id} ${level.name} · ${Math.min(local, span)}/${span}`;
}
