/** Connected-component grouping for supervoxel (one instance per cluster) rendering. */

export interface GridCell {
  gx: number;
  gy: number;
  gz: number;
}

export interface ClusterGroup<T extends GridCell> {
  cells: T[];
  /** Integer grid centroid for instance placement. */
  cx: number;
  cy: number;
  cz: number;
  cellCount: number;
}

function cellKey(gx: number, gy: number, gz: number): string {
  return `${gx},${gy},${gz}`;
}

/** 6-connected (face neighbors) BFS grouping. */
export function groupFaceClusters<T extends GridCell>(cells: Map<string, T>): ClusterGroup<T>[] {
  const visited = new Set<string>();
  const faceNeighbors: ReadonlyArray<[number, number, number]> = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ];
  const groups: ClusterGroup<T>[] = [];

  for (const startKey of cells.keys()) {
    if (visited.has(startKey)) continue;
    const cluster: T[] = [];
    const queue = [startKey];
    visited.add(startKey);

    while (queue.length) {
      const key = queue.pop()!;
      const c = cells.get(key)!;
      cluster.push(c);
      for (const [dx, dy, dz] of faceNeighbors) {
        const nk = cellKey(c.gx + dx, c.gy + dy, c.gz + dz);
        if (!cells.has(nk) || visited.has(nk)) continue;
        visited.add(nk);
        queue.push(nk);
      }
    }

    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const c of cluster) {
      sx += c.gx;
      sy += c.gy;
      sz += c.gz;
    }
    const n = cluster.length;
    groups.push({
      cells: cluster,
      cx: Math.round(sx / n),
      cy: Math.round(sy / n),
      cz: Math.round(sz / n),
      cellCount: n,
    });
  }
  return groups;
}

/** XZ-connected grouping (bulk water surface bodies). */
export function groupXzClusters<T extends GridCell>(cells: Map<string, T>): ClusterGroup<T>[] {
  const byXz = new Map<string, string[]>();
  for (const [key, c] of cells) {
    const xz = `${c.gx},${c.gz}`;
    const list = byXz.get(xz);
    if (list) list.push(key);
    else byXz.set(xz, [key]);
  }

  const visited = new Set<string>();
  const xzNeighbors: ReadonlyArray<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const groups: ClusterGroup<T>[] = [];

  for (const startKey of cells.keys()) {
    if (visited.has(startKey)) continue;
    const cluster: T[] = [];
    const queue = [startKey];
    visited.add(startKey);

    while (queue.length) {
      const key = queue.pop()!;
      const c = cells.get(key)!;
      cluster.push(c);
      for (const [dx, dz] of xzNeighbors) {
        const nkeys = byXz.get(`${c.gx + dx},${c.gz + dz}`);
        if (!nkeys) continue;
        for (const nk of nkeys) {
          if (visited.has(nk)) continue;
          visited.add(nk);
          queue.push(nk);
        }
      }
    }

    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const c of cluster) {
      sx += c.gx;
      sy += c.gy;
      sz += c.gz;
    }
    const n = cluster.length;
    groups.push({
      cells: cluster,
      cx: Math.round(sx / n),
      cy: Math.round(sy / n),
      cz: Math.round(sz / n),
      cellCount: n,
    });
  }
  return groups;
}

/** Scale factor for a merged supervoxel from occupied cell count. */
export function supervoxelScale(cellCount: number, densityBonus = 0): number {
  if (cellCount <= 1) return 1;
  return Math.cbrt(cellCount) * (1 + densityBonus * 0.1);
}
