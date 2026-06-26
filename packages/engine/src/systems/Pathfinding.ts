import { walkableAt, type TerrainField } from '@voxelbound/shared';

export interface NavPoint {
  x: number;
  z: number;
}

interface NavRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/**
 * Coarse navigation grid built from the terrain walkable mask plus static
 * obstacle rectangles (houses, props). A* over this grid powers NPC scripted
 * routes and wandering with smart obstacle avoidance.
 */
export class NavGrid {
  readonly cell: number;
  readonly gw: number;
  readonly gh: number;
  readonly blocked: Uint8Array;
  private w: number;
  private d: number;

  constructor(field: TerrainField, solids: NavRect[], cell = 4, pad = 3) {
    this.cell = cell;
    this.w = field.w;
    this.d = field.d;
    this.gw = Math.ceil(field.w / cell);
    this.gh = Math.ceil(field.d / cell);
    this.blocked = new Uint8Array(this.gw * this.gh);

    for (let gz = 0; gz < this.gh; gz++) {
      for (let gx = 0; gx < this.gw; gx++) {
        const wx = gx * cell + cell / 2;
        const wz = gz * cell + cell / 2;
        let block = !walkableAt(field, wx, wz);
        if (!block) {
          for (const s of solids) {
            if (wx > s.x0 - pad && wx < s.x1 + pad && wz > s.z0 - pad && wz < s.z1 + pad) {
              block = true;
              break;
            }
          }
        }
        this.blocked[gz * this.gw + gx] = block ? 1 : 0;
      }
    }
  }

  private idx(gx: number, gz: number): number {
    return gz * this.gw + gx;
  }

  isBlockedCell(gx: number, gz: number): boolean {
    if (gx < 0 || gz < 0 || gx >= this.gw || gz >= this.gh) return true;
    return this.blocked[this.idx(gx, gz)] === 1;
  }

  worldToCell(x: number, z: number): { gx: number; gz: number } {
    return { gx: Math.floor(x / this.cell), gz: Math.floor(z / this.cell) };
  }

  cellCenter(gx: number, gz: number): NavPoint {
    return { x: gx * this.cell + this.cell / 2, z: gz * this.cell + this.cell / 2 };
  }

  /** Nearest non-blocked cell to a world point (spiral search). */
  nearestOpen(x: number, z: number, maxR = 8): { gx: number; gz: number } | null {
    const { gx, gz } = this.worldToCell(x, z);
    if (!this.isBlockedCell(gx, gz)) return { gx, gz };
    for (let r = 1; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (!this.isBlockedCell(gx + dx, gz + dz)) return { gx: gx + dx, gz: gz + dz };
        }
      }
    }
    return null;
  }
}

const NB = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/**
 * A* from one world point to another. Returns a list of world-space waypoints
 * (cell centers) or null if unreachable. Diagonals are allowed but not through
 * blocked corners.
 */
export function findPath(grid: NavGrid, sx: number, sz: number, gx: number, gz: number, maxNodes = 4000): NavPoint[] | null {
  const start = grid.nearestOpen(sx, sz);
  const goal = grid.nearestOpen(gx, gz);
  if (!start || goal === null) return null;
  if (start.gx === goal.gx && start.gz === goal.gz) return [grid.cellCenter(goal.gx, goal.gz)];

  const gwid = grid.gw;
  const sIdx = start.gz * gwid + start.gx;
  const eIdx = goal.gz * gwid + goal.gx;

  const open = new MinHeap();
  const came = new Map<number, number>();
  const gScore = new Map<number, number>();
  gScore.set(sIdx, 0);
  open.push(sIdx, heuristic(start.gx, start.gz, goal.gx, goal.gz));

  let nodes = 0;
  while (open.size() > 0 && nodes < maxNodes) {
    nodes++;
    const cur = open.pop()!;
    if (cur === eIdx) return reconstruct(grid, came, cur);
    const cgx = cur % gwid;
    const cgz = (cur - cgx) / gwid;
    const cg = gScore.get(cur)!;

    for (const [dx, dz] of NB) {
      const ngx = cgx + dx;
      const ngz = cgz + dz;
      if (grid.isBlockedCell(ngx, ngz)) continue;
      if (dx !== 0 && dz !== 0) {
        // no cutting blocked corners
        if (grid.isBlockedCell(cgx + dx, cgz) || grid.isBlockedCell(cgx, cgz + dz)) continue;
      }
      const nIdx = ngz * gwid + ngx;
      const step = dx !== 0 && dz !== 0 ? 1.4142 : 1;
      const tentative = cg + step;
      if (tentative < (gScore.get(nIdx) ?? Infinity)) {
        came.set(nIdx, cur);
        gScore.set(nIdx, tentative);
        open.push(nIdx, tentative + heuristic(ngx, ngz, goal.gx, goal.gz));
      }
    }
  }
  return null;
}

function heuristic(ax: number, az: number, bx: number, bz: number): number {
  const dx = Math.abs(ax - bx);
  const dz = Math.abs(az - bz);
  return (dx + dz) + (1.4142 - 2) * Math.min(dx, dz);
}

function reconstruct(grid: NavGrid, came: Map<number, number>, end: number): NavPoint[] {
  const path: NavPoint[] = [];
  let cur: number | undefined = end;
  const gwid = grid.gw;
  while (cur !== undefined) {
    const gx = cur % gwid;
    const gz = (cur - gx) / gwid;
    path.push(grid.cellCenter(gx, gz));
    cur = came.get(cur);
  }
  path.reverse();
  return path;
}

/** Tiny binary min-heap keyed by priority. */
class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];

  size(): number {
    return this.items.length;
  }
  push(item: number, priority: number): void {
    this.items.push(item);
    this.prio.push(priority);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.prio[p]! <= this.prio[i]!) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number | undefined {
    const n = this.items.length;
    if (n === 0) return undefined;
    const top = this.items[0]!;
    const lastItem = this.items.pop()!;
    const lastPrio = this.prio.pop()!;
    if (n > 1) {
      this.items[0] = lastItem;
      this.prio[0] = lastPrio;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let s = i;
        if (l < this.items.length && this.prio[l]! < this.prio[s]!) s = l;
        if (r < this.items.length && this.prio[r]! < this.prio[s]!) s = r;
        if (s === i) break;
        this.swap(i, s);
        i = s;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!];
    [this.prio[a], this.prio[b]] = [this.prio[b]!, this.prio[a]!];
  }
}
