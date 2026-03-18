import { PPM, GRID, OX, OY, scene } from './state.js';

/** Convert meters to pixels */
export function mToP(m) { return m * PPM; }

/** Convert pixels to meters */
export function pToM(p) { return p / PPM; }

/** Snap value to grid (0.1m) */
export function snapGrid(v) { return Math.round(v / GRID) * GRID; }

/** Snap value to double grid (0.2m) — for furniture placement */
export function snapGrid2(v) { return Math.round(v / (GRID * 2)) * (GRID * 2); }

/** Get bounding box of all rooms (in meters) */
export function allBoundingBox() {
  const { rooms } = scene;
  if (!rooms.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  rooms.forEach(r => {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w);
    y2 = Math.max(y2, r.y + r.h);
  });
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Check if pixel coords are inside any room */
export function isInsideAnyRoom(mx, my) {
  return scene.rooms.some(r => {
    const rx = OX + mToP(r.x), ry = OY + mToP(r.y);
    return mx > rx && mx < rx + mToP(r.w) && my > ry && my < ry + mToP(r.h);
  });
}

/** Find nearest wall to pixel coords */
export function wallAt(mx, my) {
  const MARGIN = 6, THRESHOLD = 28;
  const candidates = [];

  for (let i = 0; i < scene.rooms.length; i++) {
    const r = scene.rooms[i];
    const rx = OX + mToP(r.x), ry = OY + mToP(r.y);
    const rw = mToP(r.w), rh = mToP(r.h);
    const inside = mx >= rx && mx <= rx + rw && my >= ry && my <= ry + rh;

    if (mx >= rx - MARGIN && mx <= rx + rw + MARGIN) {
      const dT = Math.abs(my - ry);
      if (dT < THRESHOLD) candidates.push({ ri: i, wall: 'top', pos: Math.max(.03, Math.min(.97, (mx - rx) / rw)), d: dT, inside });
      const dB = Math.abs(my - (ry + rh));
      if (dB < THRESHOLD) candidates.push({ ri: i, wall: 'bottom', pos: Math.max(.03, Math.min(.97, (mx - rx) / rw)), d: dB, inside });
    }
    if (my >= ry - MARGIN && my <= ry + rh + MARGIN) {
      const dL = Math.abs(mx - rx);
      if (dL < THRESHOLD) candidates.push({ ri: i, wall: 'left', pos: Math.max(.03, Math.min(.97, (my - ry) / rh)), d: dL, inside });
      const dR = Math.abs(mx - (rx + rw));
      if (dR < THRESHOLD) candidates.push({ ri: i, wall: 'right', pos: Math.max(.03, Math.min(.97, (my - ry) / rh)), d: dR, inside });
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    if (Math.abs(a.d - b.d) < 4) {
      if (a.inside !== b.inside) return a.inside ? -1 : 1;
    }
    return a.d - b.d;
  });
  return { ri: candidates[0].ri, wall: candidates[0].wall, pos: candidates[0].pos };
}

/** Check if wall is shared between two rooms */
export function isSharedWall(ri, wall) {
  const r = scene.rooms[ri];
  let edgeVal, axis;
  if (wall === 'top') { edgeVal = r.y; axis = 'h'; }
  else if (wall === 'bottom') { edgeVal = r.y + r.h; axis = 'h'; }
  else if (wall === 'left') { edgeVal = r.x; axis = 'v'; }
  else { edgeVal = r.x + r.w; axis = 'v'; }

  for (let j = 0; j < scene.rooms.length; j++) {
    if (j === ri) continue;
    const o = scene.rooms[j];
    if (axis === 'h') {
      if (Math.abs(o.y - edgeVal) < .02 || Math.abs(o.y + o.h - edgeVal) < .02) {
        const s = Math.max(r.x, o.x), e = Math.min(r.x + r.w, o.x + o.w);
        if (e > s + .05) return true;
      }
    } else {
      if (Math.abs(o.x - edgeVal) < .02 || Math.abs(o.x + o.w - edgeVal) < .02) {
        const s = Math.max(r.y, o.y), e = Math.min(r.y + r.h, o.y + o.h);
        if (e > s + .05) return true;
      }
    }
  }
  return false;
}

/** Get pixel coordinates for a window or door on a wall */
export function getObjectPixels(type, obj) {
  const r = scene.rooms[obj.ri];
  if (!r) return null;
  const rx = OX + mToP(r.x), ry = OY + mToP(r.y);
  const rw = mToP(r.w), rh = mToP(r.h);
  const halfWidth = mToP(type === 'win' ? .6 : .45);

  if (obj.wall === 'top')    return { x1: rx + obj.pos * rw - halfWidth, y1: ry,      x2: rx + obj.pos * rw + halfWidth, y2: ry };
  if (obj.wall === 'bottom') return { x1: rx + obj.pos * rw - halfWidth, y1: ry + rh, x2: rx + obj.pos * rw + halfWidth, y2: ry + rh };
  if (obj.wall === 'left')   return { x1: rx,      y1: ry + obj.pos * rh - halfWidth, x2: rx,      y2: ry + obj.pos * rh + halfWidth };
  return                       { x1: rx + rw, y1: ry + obj.pos * rh - halfWidth, x2: rx + rw, y2: ry + obj.pos * rh + halfWidth };
}

