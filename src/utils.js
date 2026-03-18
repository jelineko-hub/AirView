import { PPM, GRID, OX, OY, DETECT_CELL, scene } from './state.js';

/** Convert meters to pixels */
export function mToP(m) { return m * PPM; }

/** Convert pixels to meters */
export function pToM(p) { return p / PPM; }

/** Snap value to grid (0.1m) */
export function snapGrid(v) { return Math.round(v / GRID) * GRID; }

/** Snap value to double grid (0.2m) — for furniture placement */
export function snapGrid2(v) { return Math.round(v / (GRID * 2)) * (GRID * 2); }

/** Get bounding box of all walls (in meters) */
export function allBoundingBox() {
  const { walls } = scene;
  if (!walls.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  walls.forEach(w => {
    x1 = Math.min(x1, w.x1, w.x2);
    y1 = Math.min(y1, w.y1, w.y2);
    x2 = Math.max(x2, w.x1, w.x2);
    y2 = Math.max(y2, w.y1, w.y2);
  });
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

// ── Room detection via flood fill ──

export function detectRooms() {
  const bb = allBoundingBox();
  if (!bb || bb.w < 0.1 || bb.h < 0.1) { scene.rooms = []; return; }

  const cs = DETECT_CELL;
  // Add 1-cell padding around bbox for flood fill from outside
  const pad = cs;
  const ox = bb.x - pad, oy = bb.y - pad;
  const gw = Math.ceil((bb.w + 2 * pad) / cs) + 1;
  const gh = Math.ceil((bb.h + 2 * pad) / cs) + 1;

  // 0 = unknown, 1 = wall, 2 = outside, 3+ = room index + 3
  const grid = new Uint16Array(gw * gh);

  // Mark wall cells
  scene.walls.forEach(w => {
    const isH = Math.abs(w.y1 - w.y2) < 0.001;
    if (isH) {
      const y = w.y1;
      const minX = Math.min(w.x1, w.x2), maxX = Math.max(w.x1, w.x2);
      const gy = Math.round((y - oy) / cs);
      const gx1 = Math.floor((minX - ox) / cs);
      const gx2 = Math.ceil((maxX - ox) / cs);
      for (let x = Math.max(0, gx1); x <= Math.min(gw - 1, gx2); x++) {
        if (gy >= 0 && gy < gh) grid[gy * gw + x] = 1;
      }
    } else {
      const x = w.x1;
      const minY = Math.min(w.y1, w.y2), maxY = Math.max(w.y1, w.y2);
      const gx = Math.round((x - ox) / cs);
      const gy1 = Math.floor((minY - oy) / cs);
      const gy2 = Math.ceil((maxY - oy) / cs);
      for (let y = Math.max(0, gy1); y <= Math.min(gh - 1, gy2); y++) {
        if (gx >= 0 && gx < gw) grid[y * gw + gx] = 1;
      }
    }
  });

  // Remove wall cells at door locations
  scene.doors.forEach(d => {
    const w = scene.walls[d.wi];
    if (!w) return;
    const isH = Math.abs(w.y1 - w.y2) < 0.001;
    const hw = 0.45; // half door width
    let dx, dy;
    if (isH) {
      dx = Math.min(w.x1, w.x2) + d.pos * Math.abs(w.x2 - w.x1);
      dy = w.y1;
    } else {
      dx = w.x1;
      dy = Math.min(w.y1, w.y2) + d.pos * Math.abs(w.y2 - w.y1);
    }
    const gx = Math.round((dx - ox) / cs);
    const gy = Math.round((dy - oy) / cs);
    // Clear wall cells in door area
    for (let ddx = -4; ddx <= 4; ddx++) {
      for (let ddy = -4; ddy <= 4; ddy++) {
        const cx = gx + ddx, cy = gy + ddy;
        if (cx < 0 || cx >= gw || cy < 0 || cy >= gh) continue;
        const px = ox + cx * cs, py = oy + cy * cs;
        if (isH && Math.abs(py - dy) < cs * 1.5 && Math.abs(px - dx) < hw) {
          grid[cy * gw + cx] = 0;
        } else if (!isH && Math.abs(px - dx) < cs * 1.5 && Math.abs(py - dy) < hw) {
          grid[cy * gw + cx] = 0;
        }
      }
    }
  });

  // Flood fill from outside (BFS from border cells)
  const queue = [];
  for (let x = 0; x < gw; x++) {
    if (!grid[x]) { grid[x] = 2; queue.push(x); }
    const bi = (gh - 1) * gw + x;
    if (!grid[bi]) { grid[bi] = 2; queue.push(bi); }
  }
  for (let y = 1; y < gh - 1; y++) {
    const li = y * gw;
    if (!grid[li]) { grid[li] = 2; queue.push(li); }
    const ri = y * gw + gw - 1;
    if (!grid[ri]) { grid[ri] = 2; queue.push(ri); }
  }

  let qi = 0;
  while (qi < queue.length) {
    const idx = queue[qi++];
    const x = idx % gw, y = (idx - x) / gw;
    const nb = [
      y > 0 ? idx - gw : -1,
      y < gh - 1 ? idx + gw : -1,
      x > 0 ? idx - 1 : -1,
      x < gw - 1 ? idx + 1 : -1,
    ];
    for (let i = 0; i < 4; i++) {
      const ni = nb[i];
      if (ni >= 0 && grid[ni] === 0) { grid[ni] = 2; queue.push(ni); }
    }
  }

  // Find connected components of interior cells (grid[i] === 0)
  const oldRooms = scene.rooms.slice();
  const newRooms = [];
  let roomId = 3;

  for (let i = 0; i < gw * gh; i++) {
    if (grid[i] !== 0) continue;
    // BFS to find connected component
    const cells = [];
    const q = [i];
    grid[i] = roomId;
    let qj = 0;
    while (qj < q.length) {
      const ci = q[qj++];
      cells.push(ci);
      const cx = ci % gw, cy = (ci - cx) / gw;
      const nb2 = [
        cy > 0 ? ci - gw : -1,
        cy < gh - 1 ? ci + gw : -1,
        cx > 0 ? ci - 1 : -1,
        cx < gw - 1 ? ci + 1 : -1,
      ];
      for (let j = 0; j < 4; j++) {
        const ni = nb2[j];
        if (ni >= 0 && grid[ni] === 0) { grid[ni] = roomId; q.push(ni); }
      }
    }

    // Compute centroid and area
    let sx = 0, sy = 0;
    cells.forEach(ci => {
      sx += (ci % gw) * cs + ox + cs / 2;
      sy += Math.floor(ci / gw) * cs + oy + cs / 2;
    });
    const cx = sx / cells.length;
    const cy = sy / cells.length;
    const area = cells.length * cs * cs;

    // Match with old room by centroid proximity
    let temp = 26;
    for (let j = 0; j < oldRooms.length; j++) {
      const or2 = oldRooms[j];
      if (Math.abs(cx - or2.cx) < 1 && Math.abs(cy - or2.cy) < 1) {
        temp = or2.temp || 26;
        break;
      }
    }

    // Store cell grid positions for simulation
    const cellPositions = cells.map(ci => ({
      x: (ci % gw) * cs + ox,
      y: Math.floor(ci / gw) * cs + oy,
    }));

    newRooms.push({ cells: cellPositions, cx, cy, area, temp });
    roomId++;
  }

  scene.rooms = newRooms;
}

// ── Wall utilities ──

/** Find nearest wall segment at pixel coords */
export function wallAtPixel(mx, my) {
  const THRESHOLD = 22;
  let best = null, bestD = THRESHOLD;

  for (let i = 0; i < scene.walls.length; i++) {
    const w = scene.walls[i];
    const wx1 = OX + mToP(w.x1), wy1 = OY + mToP(w.y1);
    const wx2 = OX + mToP(w.x2), wy2 = OY + mToP(w.y2);

    // Distance from point to line segment
    const dx = wx2 - wx1, dy = wy2 - wy1;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((mx - wx1) * dx + (my - wy1) * dy) / len2 : 0;
    t = Math.max(0.03, Math.min(0.97, t));
    const px = wx1 + t * dx, py = wy1 + t * dy;
    const d = Math.sqrt((mx - px) ** 2 + (my - py) ** 2);

    if (d < bestD) { bestD = d; best = { wi: i, pos: t }; }
  }
  return best;
}

/** Get pixel coordinates for a window/door on a wall */
export function getObjectPixels(type, obj) {
  const w = scene.walls[obj.wi];
  if (!w) return null;
  const wx1 = OX + mToP(w.x1), wy1 = OY + mToP(w.y1);
  const wx2 = OX + mToP(w.x2), wy2 = OY + mToP(w.y2);
  const halfWidth = mToP(type === 'win' ? 0.6 : 0.45);

  const cx = wx1 + obj.pos * (wx2 - wx1);
  const cy = wy1 + obj.pos * (wy2 - wy1);
  const isH = Math.abs(w.y1 - w.y2) < 0.001;

  if (isH) return { x1: cx - halfWidth, y1: cy, x2: cx + halfWidth, y2: cy };
  return { x1: cx, y1: cy - halfWidth, x2: cx, y2: cy + halfWidth };
}

/** Check if pixel coords are inside any detected room */
export function isInsideAnyRoom(mx, my) {
  const mxM = pToM(mx - OX), myM = pToM(my - OY);
  return scene.rooms.some(r =>
    r.cells.some(c => mxM >= c.x && mxM < c.x + DETECT_CELL && myM >= c.y && myM < c.y + DETECT_CELL)
  );
}

/** Find which detected room contains meter coords */
export function roomAtMeter(mx, my) {
  for (let i = 0; i < scene.rooms.length; i++) {
    const r = scene.rooms[i];
    if (r.cells.some(c => mx >= c.x && mx < c.x + DETECT_CELL && my >= c.y && my < c.y + DETECT_CELL)) {
      return i;
    }
  }
  return -1;
}

/** Get wall orientation: 'h' for horizontal, 'v' for vertical */
export function wallDir(w) {
  return Math.abs(w.y1 - w.y2) < 0.001 ? 'h' : 'v';
}

/** Get wall side relative to building bounding box */
export function wallSide(w) {
  const bb = allBoundingBox();
  if (!bb) return null;
  const isH = wallDir(w) === 'h';
  const cx = (w.x1 + w.x2) / 2, cy = (w.y1 + w.y2) / 2;
  if (isH) {
    return Math.abs(cy - bb.y) < 0.02 ? 'top' : Math.abs(cy - (bb.y + bb.h)) < 0.02 ? 'bottom' : null;
  }
  return Math.abs(cx - bb.x) < 0.02 ? 'left' : Math.abs(cx - (bb.x + bb.w)) < 0.02 ? 'right' : null;
}
