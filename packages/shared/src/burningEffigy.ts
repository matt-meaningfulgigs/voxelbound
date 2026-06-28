import type { VoxelEntry, VoxelModel } from './voxelModel';

/** Fill an inclusive voxel box with a palette index. */
function box(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  ci: number,
): VoxelEntry[] {
  const v: VoxelEntry[] = [];
  const [ax, bx] = x0 <= x1 ? [x0, x1] : [x1, x0];
  const [ay, by] = y0 <= y1 ? [y0, y1] : [y1, y0];
  const [az, bz] = z0 <= z1 ? [z0, z1] : [z1, z0];
  for (let x = ax; x <= bx; x++)
    for (let y = ay; y <= by; y++)
      for (let z = az; z <= bz; z++) v.push([x, y, z, ci]);
  return v;
}

/**
 * Huge wicker cult effigy — Midsommar / Burning Man centerpiece.
 *
 * Palette:
 *  0 straw/wicker  1 dark wood  2 bone  3 ritual blood
 *  4 moss rot      5 wilted bloom  6 ember (fire emitter)
 */
const W = 56;
const H = 84;
const D = 56;
const CX = 28;
const CZ = 28;

function set(map: Map<string, number>, x: number, y: number, z: number, ci: number): void {
  if (x < 0 || y < 0 || z < 0 || x >= W || y >= H || z >= D) return;
  map.set(`${x},${y},${z}`, ci);
}

function get(map: Map<string, number>, x: number, y: number, z: number): number | undefined {
  return map.get(`${x},${y},${z}`);
}

/** Thick line of voxels (ritual beams / wicker wraps). */
function beam(
  map: Map<string, number>,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  ci: number,
  thick = 1,
): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), 1);
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    const z = Math.round(z0 + (z1 - z0) * t);
    for (let dx = -thick; dx <= thick; dx++)
      for (let dy = -thick; dy <= thick; dy++)
        for (let dz = -thick; dz <= thick; dz++) {
          if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > thick + 1) continue;
          set(map, x + dx, y + dy, z + dz, ci);
        }
  }
}

/** Hollow ellipsoid shell — wicker body wrapping. */
function wickerShell(
  map: Map<string, number>,
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
  ci: number,
  hollow = 0.55,
): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        const nz = (z - cz) / rz;
        const d = nx * nx + ny * ny + nz * nz;
        if (d > 1.05 || d < hollow * hollow) continue;
        if (Math.abs(nx * 100 + ny * 37 + nz * 19) % 7 === 0) continue; // wicker gaps
        set(map, x, y, z, ci);
      }
    }
  }
}

function buildEffigyVoxels(): VoxelEntry[] {
  const map = new Map<string, number>();

  // Ritual stone-and-timber platform
  for (const [x, y, z, ci] of box(CX - 14, 0, CZ - 14, CX + 14, 1, CZ + 14, 1)) set(map, x, y, z, ci);
  for (const [x, y, z, ci] of box(CX - 12, 2, CZ - 12, CX + 12, 2, CZ + 12, 0)) set(map, x, y, z, ci);
  // Blood spiral on the dais
  for (let a = 0; a < 48; a++) {
    const ang = (a / 48) * Math.PI * 4;
    const r = 3 + a * 0.22;
    set(map, Math.round(CX + Math.cos(ang) * r), 2, Math.round(CZ + Math.sin(ang) * r), 3);
  }

  // Corner offering posts
  for (const [ox, oz] of [
    [CX - 11, CZ - 11],
    [CX + 11, CZ - 11],
    [CX - 11, CZ + 11],
    [CX + 11, CZ + 11],
  ] as const) {
    beam(map, ox, 3, oz, ox, 10, oz, 1, 0);
    set(map, ox, 11, oz, 5);
  }

  // Central stake — the man within the man
  beam(map, CX, 3, CZ, CX, 72, CZ, 1, 1);

  // Cross arms (outstretched, welcoming)
  beam(map, CX - 22, 46, CZ, CX + 22, 46, CZ, 0, 1);
  beam(map, CX, 46, CZ - 4, CX, 46, CZ + 4, 1, 1);
  // Wrist bindings
  for (const sx of [CX - 22, CX + 22]) {
    beam(map, sx, 44, CZ - 2, sx, 48, CZ + 2, 3, 0);
  }

  // Torso wicker cage
  wickerShell(map, CX, 32, CZ, 9, 16, 7, 0, 0.5);
  // Rib cage hints
  for (let y = 22; y <= 42; y += 4) {
    for (let x = CX - 8; x <= CX + 8; x++) {
      if (Math.abs(x - CX) > 6) set(map, x, y, CZ + (x < CX ? -6 : 6), 2);
      if (Math.abs(x - CX) > 6) set(map, x, y, CZ + (x < CX ? 6 : -6), 2);
    }
  }

  // Legs — bound together
  beam(map, CX - 3, 3, CZ - 2, CX - 3, 24, CZ - 2, 0, 0);
  beam(map, CX + 3, 3, CZ + 2, CX + 3, 24, CZ + 2, 0, 0);
  for (let y = 8; y <= 20; y += 3) beam(map, CX - 4, y, CZ - 3, CX + 4, y, CZ + 3, 3, 0);

  // Skull head — hollow eye sockets
  wickerShell(map, CX, 56, CZ, 6, 6, 6, 2, 0.35);
  for (const [ex, ez] of [
    [CX - 2, CZ - 2],
    [CX + 2, CZ - 2],
  ] as const) {
    map.delete(`${ex},56,${ez}`);
    map.delete(`${ex},55,${ez}`);
  }
  // Grinning jaw
  for (let x = CX - 3; x <= CX + 3; x++) set(map, x, 52, CZ + 4, 2);
  set(map, CX, 54, CZ + 5, 3);

  // Flower crown — wilted midsommar blooms
  for (let a = 0; a < 14; a++) {
    const ang = (a / 14) * Math.PI * 2;
    const r = 7 + (a % 3);
    const px = Math.round(CX + Math.cos(ang) * r);
    const pz = Math.round(CZ + Math.sin(ang) * r);
    beam(map, CX, 62, CZ, px, 66 + (a % 4), pz, 4, 0);
    set(map, px, 67 + (a % 3), pz, 5);
  }
  beam(map, CX - 5, 63, CZ, CX + 5, 63, CZ, 5, 0);

  // Hanging moss / rot
  for (let i = 0; i < 24; i++) {
    const x = CX - 10 + ((i * 17) % 21);
    const z = CZ - 8 + ((i * 13) % 17);
    const y0 = 18 + (i % 20);
    beam(map, x, y0, z, x + (i % 3) - 1, y0 - 4 - (i % 3), z, 4, 0);
  }

  // Mark outer surface voxels as fire emitters (ember palette slot)
  const FIRE = 6;
  const surfaceDirs: ReadonlyArray<[number, number, number]> = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ];
  const toFire: string[] = [];
  for (const [key, ci] of map) {
    if (ci === 3 || ci === 5) continue; // keep ritual marks / flowers
    const [xs, ys, zs] = key.split(',').map(Number);
    const x = xs!;
    const y = ys!;
    const z = zs!;
    if (y < 12) continue;
    let exposed = false;
    for (const [dx, dy, dz] of surfaceDirs) {
      if (!get(map, x + dx, y + dy, z + dz)) {
        exposed = true;
        break;
      }
    }
    if (!exposed) continue;
    const dist = Math.hypot(x - CX, z - CZ);
    // Fire from base through crown — denser toward the core for an engulfing blaze
    if (y >= 14 && y <= 78 && dist <= 26) {
      const core = dist <= 14 && y >= 18 ? 1 : 0;
      const hash = (x * 17 + y * 31 + z * 13) % (core ? 2 : 3);
      if (hash === 0) toFire.push(key);
    }
  }
  // Guaranteed fire ring at the waist and crown so the effigy always reads as burning
  for (let a = 0; a < 32; a++) {
    const ang = (a / 32) * Math.PI * 2;
    for (const r of [8, 11, 14]) {
      const px = Math.round(CX + Math.cos(ang) * r);
      const pz = Math.round(CZ + Math.sin(ang) * r);
      for (const y of [28, 44, 58, 66]) {
        if (get(map, px, y, pz) !== undefined) toFire.push(`${px},${y},${pz}`);
      }
    }
  }
  for (const key of new Set(toFire)) map.set(key, FIRE);

  const entries: VoxelEntry[] = [];
  for (const [key, ci] of map) {
    const [x, y, z] = key.split(',').map(Number);
    entries.push([x!, y!, z!, ci]);
  }
  return entries;
}

export const burningEffigyModel: VoxelModel = {
  id: 'burning_effigy',
  kind: 'prop',
  bounds: [W, H, D],
  palette: [
    '#8a6a3a', // 0 straw/wicker
    '#3a2418', // 1 dark timber
    '#d4c4a8', // 2 bone
    '#5a1018', // 3 dried blood
    '#3a4828', // 4 rot/moss
    '#8a7840', // 5 wilted bloom
    '#ff6a18', // 6 ember — fire emitter
  ],
  paletteEmitters: ['solid', 'solid', 'solid', 'solid', 'solid', 'solid', 'fire'],
  pivot: [CX, 0, CZ],
  animations: {},
  frames: { default: buildEffigyVoxels() },
};
