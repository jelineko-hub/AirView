import {
  PPM, OX, OY, AC_MODELS, MAX_PARTICLES,
  scene, sim, dom, particles, getAndAdvanceParticleHead,
} from './state.js';
import { mToP, allBoundingBox, getObjectPixels, wallDir } from './utils.js';
import { buildUnitCards } from './ui.js';

// ── Tuning parameter getters (cached DOM) ──

function getEdgeSoftness() { return +dom.edgeSoft.value / 10; }
function getDiffusionFactor() { return +dom.diffusion.value / 100; }
function getSunGain() { return +dom.sunGain.value / 100; }
function getTargetMult() { return +dom.targetMult.value / 100; }

// ── Build wall maps from scene.walls ──

function cellInDoor(px, py) {
  return scene.doors.some(d => {
    const w = scene.walls[d.wi];
    if (!w) return false;
    const isH = wallDir(w) === 'h';
    const hw = .45;
    let dx, dy;
    if (isH) {
      dx = Math.min(w.x1, w.x2) + d.pos * Math.abs(w.x2 - w.x1);
      dy = w.y1;
    } else {
      dx = w.x1;
      dy = Math.min(w.y1, w.y2) + d.pos * Math.abs(w.y2 - w.y1);
    }
    if (isH) return Math.abs(py - dy) < sim.cellSize * 2 && Math.abs(px - dx) < hw;
    return Math.abs(px - dx) < sim.cellSize * 2 && Math.abs(py - dy) < hw;
  });
}

function buildWallMaps() {
  const { gridW, gridH, cellSize, bboxX, bboxY } = sim;
  sim.wallH = new Uint8Array(gridW * gridH);
  sim.wallV = new Uint8Array(gridW * gridH);

  // wallH[y*gridW+x] = 1 means vertical barrier between cell (x-1,y) and (x,y)
  // wallV[y*gridW+x] = 1 means horizontal barrier between cell (x,y-1) and (x,y)
  // A wall segment maps to the grid edge closest to its position
  scene.walls.forEach(w => {
    const isH = wallDir(w) === 'h';
    if (isH) {
      // Horizontal wall → creates horizontal barriers (wallV entries)
      const wy = w.y1;
      const minX = Math.min(w.x1, w.x2), maxX = Math.max(w.x1, w.x2);
      // Find the grid row boundary closest to wy
      const gy = Math.round((wy - bboxY) / cellSize);
      if (gy < 1 || gy >= gridH) return;
      const gx1 = Math.max(0, Math.floor((minX - bboxX) / cellSize));
      const gx2 = Math.min(gridW - 1, Math.ceil((maxX - bboxX) / cellSize) - 1);
      for (let x = gx1; x <= gx2; x++) {
        const px = bboxX + (x + .5) * cellSize;
        if (!cellInDoor(px, wy)) {
          sim.wallV[gy * gridW + x] = 1;
        }
      }
    } else {
      // Vertical wall → creates vertical barriers (wallH entries)
      const wx = w.x1;
      const minY = Math.min(w.y1, w.y2), maxY = Math.max(w.y1, w.y2);
      const gx = Math.round((wx - bboxX) / cellSize);
      if (gx < 1 || gx >= gridW) return;
      const gy1 = Math.max(0, Math.floor((minY - bboxY) / cellSize));
      const gy2 = Math.min(gridH - 1, Math.ceil((maxY - bboxY) / cellSize) - 1);
      for (let y = gy1; y <= gy2; y++) {
        const py = bboxY + (y + .5) * cellSize;
        if (!cellInDoor(wx, py)) {
          sim.wallH[y * gridW + gx] = 1;
        }
      }
    }
  });
}

// ── Build simulation maps from detected rooms ──

function buildSimMaps() {
  const bb = allBoundingBox();
  if (!bb) return;
  // Add small padding so boundary walls fall inside the grid
  const pad = sim.cellSize;
  sim.bboxX = bb.x - pad;
  sim.bboxY = bb.y - pad;
  sim.gridW = Math.ceil((bb.w + 2 * pad) / sim.cellSize) + 1;
  sim.gridH = Math.ceil((bb.h + 2 * pad) / sim.cellSize) + 1;

  const { gridW, gridH, cellSize, bboxX, bboxY } = sim;

  sim.airMap = new Uint8Array(gridW * gridH);
  sim.furnitureSolid = new Uint8Array(gridW * gridH);
  sim.furnitureEdge = new Float32Array(gridW * gridH);
  sim.externalTemp = new Float32Array(gridW * gridH);
  sim.externalCoeff = new Float32Array(gridW * gridH);
  sim.cellRoomMap = new Int16Array(gridW * gridH);
  sim.cellRoomMap.fill(-1);

  // Build wall barriers first
  buildWallMaps();

  // Build airMap via flood fill (independent of detectRooms)
  // 1. Mark wall cells on grid
  const wallCell = new Uint8Array(gridW * gridH);
  scene.walls.forEach(w => {
    const isH = wallDir(w) === 'h';
    if (isH) {
      const gy = Math.round((w.y1 - bboxY) / cellSize);
      const gx1 = Math.floor((Math.min(w.x1, w.x2) - bboxX) / cellSize);
      const gx2 = Math.ceil((Math.max(w.x1, w.x2) - bboxX) / cellSize);
      for (let x = Math.max(0, gx1); x <= Math.min(gridW - 1, gx2); x++) {
        if (gy >= 0 && gy < gridH) wallCell[gy * gridW + x] = 1;
      }
    } else {
      const gx = Math.round((w.x1 - bboxX) / cellSize);
      const gy1 = Math.floor((Math.min(w.y1, w.y2) - bboxY) / cellSize);
      const gy2 = Math.ceil((Math.max(w.y1, w.y2) - bboxY) / cellSize);
      for (let y = Math.max(0, gy1); y <= Math.min(gridH - 1, gy2); y++) {
        if (gx >= 0 && gx < gridW) wallCell[y * gridW + gx] = 1;
      }
    }
  });

  // 2. Flood fill from borders to mark outside cells
  const outside = new Uint8Array(gridW * gridH);
  const queue = [];
  for (let x = 0; x < gridW; x++) {
    if (!wallCell[x]) { outside[x] = 1; queue.push(x); }
    const bi = (gridH - 1) * gridW + x;
    if (!wallCell[bi]) { outside[bi] = 1; queue.push(bi); }
  }
  for (let y = 1; y < gridH - 1; y++) {
    if (!wallCell[y * gridW]) { outside[y * gridW] = 1; queue.push(y * gridW); }
    const ri = y * gridW + gridW - 1;
    if (!wallCell[ri]) { outside[ri] = 1; queue.push(ri); }
  }
  let qi = 0;
  while (qi < queue.length) {
    const idx = queue[qi++];
    const x = idx % gridW, y = (idx - x) / gridW;
    const nb = [y > 0 ? idx - gridW : -1, y < gridH - 1 ? idx + gridW : -1,
                x > 0 ? idx - 1 : -1, x < gridW - 1 ? idx + 1 : -1];
    for (let i = 0; i < 4; i++) {
      const ni = nb[i];
      if (ni >= 0 && !wallCell[ni] && !outside[ni]) { outside[ni] = 1; queue.push(ni); }
    }
  }

  // 3. Everything not outside and not wall = air
  for (let i = 0; i < gridW * gridH; i++) {
    sim.airMap[i] = (!wallCell[i] && !outside[i]) ? 1 : 0;
  }

  // 4. Map air cells to detected rooms (for temperature)
  const roomCellCount = [];
  for (let i = 0; i < scene.rooms.length; i++) roomCellCount.push(0);

  for (let x = 0; x < gridW; x++) {
    for (let y = 0; y < gridH; y++) {
      const idx = y * gridW + x;
      if (!sim.airMap[idx]) continue;
      const px = bboxX + (x + .5) * cellSize;
      const py = bboxY + (y + .5) * cellSize;
      // Find which detected room this cell belongs to
      for (let ri = 0; ri < scene.rooms.length; ri++) {
        const r = scene.rooms[ri];
        if (Math.abs(px - r.cx) < r.area && Math.abs(py - r.cy) < r.area) {
          // Check if point is inside this room's cells
          if (r.cells.some(c => px >= c.x && px < c.x + 0.1 && py >= c.y && py < c.y + 0.1)) {
            sim.cellRoomMap[idx] = ri;
            roomCellCount[ri]++;
            break;
          }
        }
      }
    }
  }
  sim.roomCellCount = roomCellCount;

  buildWallMaps();

  // Furniture maps
  scene.furniture.forEach(f => {
    const gx1 = Math.floor((f.x - bboxX) / cellSize);
    const gy1 = Math.floor((f.y - bboxY) / cellSize);
    const gx2 = Math.ceil((f.x + f.w - bboxX) / cellSize);
    const gy2 = Math.ceil((f.y + f.h - bboxY) / cellSize);

    for (let x = Math.max(0, gx1); x < Math.min(gridW, gx2); x++) {
      for (let y = Math.max(0, gy1); y < Math.min(gridH, gy2); y++) {
        if (!sim.airMap[y * gridW + x]) continue;
        if (f.sol) sim.furnitureSolid[y * gridW + x] = 1;
        const px = (x + .5) * cellSize + bboxX;
        const py = (y + .5) * cellSize + bboxY;
        const minD = Math.min(px - f.x, f.x + f.w - px, py - f.y, f.y + f.h - py);
        const reach = f.sol ? cellSize * 3 : cellSize * 2;
        if (minD >= 0 && minD < reach) {
          sim.furnitureEdge[y * gridW + x] = Math.max(
            sim.furnitureEdge[y * gridW + x],
            (1 - minD / reach) * (f.sol ? 3 : .6)
          );
        }
      }
    }
  });

  // Recount room cells excluding solid furniture
  for (let i = 0; i < scene.rooms.length; i++) sim.roomCellCount[i] = 0;
  for (let i = 0, len = gridW * gridH; i < len; i++) {
    const ri = sim.cellRoomMap[i];
    if (ri >= 0 && !sim.furnitureSolid[i]) sim.roomCellCount[ri]++;
  }

  // External heat sources
  function getInsulation() {
    const v = +dom.insulation.value;
    return [0, .0009, .0004, .0001, 0][v] || 0;
  }

  function addHeatSide(side, extTemp, intensity) {
    if (!side) return;
    const wallK = getInsulation() * intensity;
    const winK = .00125 * intensity;

    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        if (!sim.airMap[y * gridW + x]) continue;
        const px = (x + .5) * cellSize, py = (y + .5) * cellSize;
        let dist;
        if (side === 'right') dist = bb.w - px;
        else if (side === 'left') dist = px;
        else if (side === 'bottom') dist = bb.h - py;
        else dist = py;

        if (dist > 3) continue;
        const decay = Math.pow(Math.max(0, 1 - dist / 3), 1.5);
        const k = wallK * decay;
        const i = y * gridW + x;
        if (k > sim.externalCoeff[i]) { sim.externalCoeff[i] = k; sim.externalTemp[i] = extTemp; }
        else if (k > 0 && sim.externalCoeff[i] > 0) {
          const w2 = k / (sim.externalCoeff[i] + k);
          sim.externalTemp[i] = sim.externalTemp[i] * (1 - w2) + extTemp * w2;
          sim.externalCoeff[i] = Math.max(sim.externalCoeff[i], k);
        }
      }
    }

    // Window heat
    scene.windows.forEach(win => {
      const wall = scene.walls[win.wi];
      if (!wall) return;
      const wSide = getWallSide(wall);
      if (wSide !== side) return;

      // Get window world position
      const isH = wallDir(wall) === 'h';
      const wx = Math.min(wall.x1, wall.x2) + win.pos * Math.abs(wall.x2 - wall.x1);
      const wy = Math.min(wall.y1, wall.y2) + win.pos * Math.abs(wall.y2 - wall.y1);

      for (let y = 0; y < gridH; y++) {
        for (let x = 0; x < gridW; x++) {
          if (!sim.airMap[y * gridW + x]) continue;
          const px = (x + .5) * cellSize + bboxX;
          const py = (y + .5) * cellSize + bboxY;
          let dist;
          if (isH) dist = Math.abs(py - wy);
          else dist = Math.abs(px - wx);

          if (dist > 4) continue;
          const along = isH ? (px - wx) : (py - wy);
          const band = Math.exp(-Math.pow(along / (.15 * Math.max(bb.w, bb.h)), 2));
          const decay2 = Math.pow(Math.max(0, 1 - dist / 4), 1.3) * band;
          const k = winK * decay2;
          const i = y * gridW + x;
          if (k > sim.externalCoeff[i]) { sim.externalCoeff[i] = k; sim.externalTemp[i] = extTemp; }
          else if (k > 0) {
            const w2 = k / (sim.externalCoeff[i] + k);
            sim.externalTemp[i] = sim.externalTemp[i] * (1 - w2) + extTemp * w2;
            sim.externalCoeff[i] = Math.max(sim.externalCoeff[i], k);
          }
        }
      }
    });
  }

  addHeatSide(scene.southSide, +dom.extSouth.value, 1.0);
  addHeatSide(scene.westSide, +dom.extWest.value, 0.65);
}

function getWallSide(w) {
  const bb = allBoundingBox();
  if (!bb) return null;
  const isH = wallDir(w) === 'h';
  if (isH) {
    if (Math.abs(w.y1 - bb.y) < 0.02) return 'top';
    if (Math.abs(w.y1 - (bb.y + bb.h)) < 0.02) return 'bottom';
  } else {
    if (Math.abs(w.x1 - bb.x) < 0.02) return 'left';
    if (Math.abs(w.x1 - (bb.x + bb.w)) < 0.02) return 'right';
  }
  return null;
}

// ── Initialize simulation ──

export function initSim() {
  if (!scene.rooms.length || !scene.acUnits.length) return;
  buildSimMaps();

  const { gridW, gridH } = sim;
  sim.tempGrid = new Float32Array(gridW * gridH);
  sim.tempBuffer = new Float32Array(gridW * gridH);
  const sg = getSunGain();

  for (let x = 0; x < gridW; x++) {
    for (let y = 0; y < gridH; y++) {
      const i = y * gridW + x;
      if (!sim.airMap[i]) { sim.tempGrid[i] = 20; continue; }
      const ri = sim.cellRoomMap[i];
      const baseTemp = ri >= 0 && scene.rooms[ri].temp ? scene.rooms[ri].temp : 26;
      const extPull = sim.externalCoeff[i] > 0
        ? Math.max(0, (sim.externalTemp[i] - baseTemp) * sg * 8 * sim.externalCoeff[i])
        : 0;
      sim.tempGrid[i] = baseTemp + extPull;
    }
  }

  // Initial smoothing
  const bl = new Float32Array(gridW * gridH);
  for (let p = 0; p < 6; p++) {
    bl.set(sim.tempGrid);
    for (let x = 0; x < gridW; x++) {
      for (let y = 0; y < gridH; y++) {
        if (!sim.airMap[y * gridW + x]) continue;
        let s = bl[y * gridW + x] * 3, c = 3;
        [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].forEach(([nx, ny]) => {
          if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH || !sim.airMap[ny * gridW + nx]) return;
          if (Math.abs(nx - x) > 0 && sim.wallH[y * gridW + Math.max(x, nx)]) return;
          if (Math.abs(ny - y) > 0 && sim.wallV[Math.max(y, ny) * gridW + x]) return;
          s += bl[ny * gridW + nx]; c++;
        });
        sim.tempGrid[y * gridW + x] = s / c;
      }
    }
  }

  sim.renderX = OX + mToP(sim.bboxX);
  sim.renderY = OY + mToP(sim.bboxY);
  sim.renderW = mToP(sim.gridW * sim.cellSize);
  sim.renderH = mToP(sim.gridH * sim.cellSize);

  sim.unitPower = scene.acUnits.map(() => 1);
  sim.unitRoomTemp = scene.acUnits.map(() => 26);
  sim.unitOutTemp = scene.acUnits.map(() => 15);

  for (let i = 0; i < MAX_PARTICLES; i++) particles[i].on = false;
  sim.elapsed = 0;
  sim.done = false;
  sim.running = false;

  dom.clock.textContent = '00:00';
  dom.startBtn.textContent = 'Štart';
  buildUnitCards();
}

// ── AC unit helpers ──

function getUnitPixelPos(u) {
  const w = scene.walls[u.wi];
  if (!w) return [0, 0];
  const wx1 = OX + mToP(w.x1), wy1 = OY + mToP(w.y1);
  const wx2 = OX + mToP(w.x2), wy2 = OY + mToP(w.y2);
  return [wx1 + u.pos * (wx2 - wx1), wy1 + u.pos * (wy2 - wy1)];
}

function getUnitBaseAngle(u) {
  const w = scene.walls[u.wi];
  if (!w) return 0;
  const isH = wallDir(w) === 'h';
  const bb = allBoundingBox();
  if (isH) return bb && w.y1 < bb.y + bb.h / 2 ? Math.PI / 2 : -Math.PI / 2;
  return bb && w.x1 < bb.x + bb.w / 2 ? 0 : Math.PI;
}

function getRoomAvgTemp(u) {
  // Find which room the AC unit faces
  const [ax, ay] = getUnitPixelPos(u);
  const w = scene.walls[u.wi];
  if (!w) return 25;
  const ba = getUnitBaseAngle(u);
  // Check the cell slightly inward from the wall
  const checkX = ax + Math.cos(ba) * 20;
  const checkY = ay + Math.sin(ba) * 20;
  const gx = Math.floor((checkX - sim.renderX) / (sim.cellSize * PPM));
  const gy = Math.floor((checkY - sim.renderY) / (sim.cellSize * PPM));
  if (gx < 0 || gx >= sim.gridW || gy < 0 || gy >= sim.gridH) return 25;
  const ri = sim.cellRoomMap[gy * sim.gridW + gx];
  if (ri < 0) return 25;
  const cnt = sim.roomCellCount[ri];
  if (!cnt) return 25;
  const { gridW, gridH, cellRoomMap, furnitureSolid, tempGrid } = sim;
  let s = 0;
  for (let i = 0, len = gridW * gridH; i < len; i++) {
    if (cellRoomMap[i] === ri && !furnitureSolid[i]) s += tempGrid[i];
  }
  return s / cnt;
}

function calcUnitOutput(u, ui) {
  const mo = u.mode;
  const tgt = +dom.targetTemp.value;
  const diff = Math.max(0, sim.unitRoomTemp[ui] - tgt);
  if (mo === 2) return { pow: 1.35, outT: Math.max(tgt - 8, tgt - diff * 1.5) };
  const maxPow = mo === 0 ? .6 : 1, minPow = mo === 0 ? .1 : .15;
  let fp, ot;
  if (diff > 4) { fp = maxPow; ot = tgt - Math.min(diff * 1.5, 8); }
  else if (diff > 1) { fp = minPow + (maxPow - minPow) * (diff - 1) / 3; ot = tgt - diff * 1.5; }
  else if (diff > 0) { fp = minPow; ot = tgt - Math.max(diff * 1.2, .5); }
  else { fp = minPow; ot = tgt - .5; }
  return { pow: fp, outT: Math.max(ot, tgt - 8) };
}

// ── Particle creation ──

function createParticle(u, ui) {
  const m = AC_MODELS[u.model];
  const tm = getTargetMult();
  const [ax, ay] = getUnitPixelPos(u);
  const ba = getUnitBaseAngle(u);
  const pw = Math.max(sim.unitPower[ui], .2);
  const uw = m.width * (PPM / 100);
  const off = (Math.random() - .5) * uw;
  const w = scene.walls[u.wi];
  const isH = w && wallDir(w) === 'h';

  let px, py;
  if (isH) { px = ax + off; py = ay + (ba > 0 ? 10 : -10); }
  else { px = ax + (ba === 0 ? 10 : -10); py = ay + off; }

  const dr = +dom.direction.value * Math.PI / 180;
  const ha = (+dom.spreadWidth.value / 2) * Math.PI / 180;
  const ea = ba + dr;
  const a = ea + (Math.random() - .5) * 2 * ha;
  const tpx = m.thrust * PPM * pw * tm;
  const spd = tpx / 130 * (.8 + Math.random() * .4);

  return {
    x: px, y: py, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
    age: 0, maxAge: 140 + Math.round(tm * 60) + Math.floor(Math.random() * 120),
    on: true, unitIndex: ui,
  };
}

// ── Particle emission ──

export function emitParticles() {
  if (!sim.running) return;
  scene.acUnits.forEach((u, ui) => {
    if (!u.on) return;
    sim.unitRoomTemp[ui] += (getRoomAvgTemp(u) - sim.unitRoomTemp[ui]) * .006;
    const inv = calcUnitOutput(u, ui);
    sim.unitPower[ui] += (inv.pow - sim.unitPower[ui]) * .008;
    sim.unitOutTemp[ui] += (inv.outT - sim.unitOutTemp[ui]) * .01;

    const emitRate = Math.max(2, Math.floor(2 + sim.unitPower[ui] * 4));
    for (let i = 0; i < emitRate; i++) {
      const idx = getAndAdvanceParticleHead();
      Object.assign(particles[idx], createParticle(u, ui));
    }

    const maxMult = u.mode === 2 ? 1.35 : u.mode === 0 ? .6 : 1;
    const te = dom.unitTemp[ui];
    if (te) te.textContent = getRoomAvgTemp(u).toFixed(1) + '°C';
    const ie = dom.unitInfo[ui];
    if (ie) ie.textContent = Math.round(sim.unitPower[ui] / maxMult * 100) + '%  ' + sim.unitOutTemp[ui].toFixed(0) + '°C';
  });
}

// ── Particle collision ──

function isParticleInDoor(px, py) {
  return scene.doors.some(d => {
    const w = scene.walls[d.wi];
    if (!w) return false;
    const isH = wallDir(w) === 'h';
    const hw = .45 * PPM;
    const wx1 = OX + mToP(w.x1), wy1 = OY + mToP(w.y1);
    const wx2 = OX + mToP(w.x2), wy2 = OY + mToP(w.y2);
    const dx = wx1 + d.pos * (wx2 - wx1);
    const dy = wy1 + d.pos * (wy2 - wy1);
    if (isH) return Math.abs(py - dy) < 8 && Math.abs(px - dx) < hw;
    return Math.abs(px - dx) < 8 && Math.abs(py - dy) < hw;
  });
}

function isParticleCellOk(px, py) {
  const gx = Math.floor((px - sim.renderX) / (sim.cellSize * PPM));
  const gy = Math.floor((py - sim.renderY) / (sim.cellSize * PPM));
  if (gx < 0 || gx >= sim.gridW || gy < 0 || gy >= sim.gridH) return false;
  return sim.airMap[gy * sim.gridW + gx] === 1;
}

function wallBetween(ox, oy, nx, ny) {
  const cpx = sim.cellSize * PPM;
  const ogx = Math.floor((ox - sim.renderX) / cpx), ogy = Math.floor((oy - sim.renderY) / cpx);
  const ngx = Math.floor((nx - sim.renderX) / cpx), ngy = Math.floor((ny - sim.renderY) / cpx);
  if (ogx === ngx && ogy === ngy) return 0;
  if (ogx !== ngx && ogy === ngy) {
    const wx = Math.max(ogx, ngx);
    if (wx >= 0 && wx < sim.gridW && ogy >= 0 && ogy < sim.gridH && sim.wallH[ogy * sim.gridW + wx]) return 1;
  }
  if (ogy !== ngy && ogx === ngx) {
    const wy = Math.max(ogy, ngy);
    if (ogx >= 0 && ogx < sim.gridW && wy >= 0 && wy < sim.gridH && sim.wallV[wy * sim.gridW + ogx]) return 2;
  }
  if (ogx !== ngx && ogy !== ngy) {
    const wx = Math.max(ogx, ngx), wy = Math.max(ogy, ngy);
    if (wx < sim.gridW && ogy < sim.gridH && sim.wallH[ogy * sim.gridW + wx]) return 1;
    if (ogx < sim.gridW && wy < sim.gridH && sim.wallV[wy * sim.gridW + ogx]) return 2;
  }
  return 0;
}

function collideParticleFurniture(p) {
  for (const f of scene.furniture) {
    const fx = OX + mToP(f.x), fy = OY + mToP(f.y), fw = mToP(f.w), fh = mToP(f.h);
    if (p.x > fx && p.x < fx + fw && p.y > fy && p.y < fy + fh) {
      if (f.sol) {
        const dl = p.x - fx, dr = fx + fw - p.x, dt = p.y - fy, db = fy + fh - p.y;
        const mn = Math.min(dl, dr, dt, db);
        if (mn === dl || mn === dr) p.vx *= -.35; else p.vy *= -.35;
      } else { p.vx *= .993; p.vy *= .993; }
    }
  }
}

function collideParticleWalls(p, ox, oy) {
  if (!isParticleCellOk(p.x, p.y)) {
    p.x = ox; p.y = oy;
    p.vx *= -.6; p.vy *= -.6;
    p.vx += (Math.random() - .5) * .3; p.vy += (Math.random() - .5) * .3;
    return;
  }
  const wt = wallBetween(ox, oy, p.x, p.y);
  if (wt > 0) {
    if (isParticleInDoor(p.x, p.y)) {
      if (Math.random() < .22) {
        p.x = ox; p.y = oy;
        if (wt === 1) p.vx *= -.4; else p.vy *= -.4;
        p.vx += (Math.random() - .5) * .2; p.vy += (Math.random() - .5) * .2;
      }
    } else {
      p.x = ox; p.y = oy;
      if (wt === 1) { p.vx *= -.6; p.vx += (Math.random() - .5) * .2; }
      else { p.vy *= -.6; p.vy += (Math.random() - .5) * .2; }
    }
  }
}

function applyParticleHeat(p, cpx, oT, cp, es) {
  const { gridW } = sim;
  const gx = Math.floor((p.x - sim.renderX) / cpx);
  const gy = Math.floor((p.y - sim.renderY) / cpx);
  if (gx >= 0 && gx < sim.gridW && gy >= 0 && gy < sim.gridH &&
      sim.airMap[gy * gridW + gx] && !sim.furnitureSolid[gy * gridW + gx]) {
    const ii = gy * gridW + gx;
    const ct = sim.tempGrid[ii];
    if (ct > oT) {
      const youth = 1 - p.age / p.maxAge;
      const str = cp * youth * youth;
      const eb = sim.furnitureEdge[ii];
      sim.tempGrid[ii] = ct - (ct - oT) * str * (1 + eb * es);
    }
  }
}

export function updateParticles() {
  const cpx = sim.cellSize * PPM;
  const es = getEdgeSoftness();

  for (let i = 0; i < MAX_PARTICLES; i++) {
    const p = particles[i];
    if (!p.on) continue;
    const u = scene.acUnits[p.unitIndex];
    if (!u || !u.on) { p.on = false; continue; }

    const m = AC_MODELS[u.model];
    const oT = sim.unitOutTemp[p.unitIndex];
    const cp = m.cool * sim.unitPower[p.unitIndex];

    const ox = p.x, oy = p.y;
    p.x += p.vx; p.y += p.vy;
    p.vx *= .992; p.vy *= .992;
    p.vx += (Math.random() - .5) * .05; p.vy += (Math.random() - .5) * .05;

    const [ax, ay] = getUnitPixelPos(u);
    const dx = ax - p.x, dy = ay - p.y, d = Math.sqrt(dx * dx + dy * dy);
    if (d > 60 && p.age > 25) { p.vx += dx / d * .008; p.vy += dy / d * .006; }

    collideParticleFurniture(p);
    collideParticleWalls(p, ox, oy);

    p.age++;
    if (p.age > p.maxAge) { p.on = false; continue; }

    applyParticleHeat(p, cpx, oT, cp, es);
  }
}

// ── Update grid diffusion ──

export function updateGrid() {
  if (!sim.running) return;
  const { gridW, gridH } = sim;
  const totalSeconds = (+dom.simLength.value) * 60;
  const progress = Math.min(sim.elapsed / totalSeconds, 1);
  const dfM = getDiffusionFactor();
  const sg = getSunGain();
  const es = getEdgeSoftness();

  const df = (.03 + progress * .04) * dfM;
  const passes = Math.max(1, Math.round((2 + Math.floor(progress * 2)) * dfM));

  const NB_DX = [-1, 1, 0, 0, -1, 1, -1, 1];
  const NB_DY = [0, 0, -1, 1, -1, -1, 1, 1];
  const NB_W  = [1, 1, 1, 1, .7, .7, .7, .7];

  for (let pass = 0; pass < passes; pass++) {
    sim.tempBuffer.set(sim.tempGrid);
    for (let x = 0; x < gridW; x++) {
      for (let y = 0; y < gridH; y++) {
        const i = y * gridW + x;
        if (!sim.airMap[i] || sim.furnitureSolid[i]) continue;
        let s = 0, c = 0;
        for (let n = 0; n < 8; n++) {
          const nx = x + NB_DX[n], ny = y + NB_DY[n];
          if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
          const ni = ny * gridW + nx;
          if (!sim.airMap[ni] || sim.furnitureSolid[ni]) continue;
          const adx = Math.abs(NB_DX[n]), ady = Math.abs(NB_DY[n]);
          if (adx === 1 && ady === 0 && sim.wallH[y * gridW + Math.max(x, nx)]) continue;
          if (adx === 0 && ady === 1 && sim.wallV[Math.max(y, ny) * gridW + x]) continue;
          if (adx === 1 && ady === 1) {
            if (sim.wallH[y * gridW + Math.max(x, nx)] || sim.wallV[Math.max(y, ny) * gridW + x]) continue;
          }
          s += sim.tempBuffer[ni] * NB_W[n]; c += NB_W[n];
        }
        if (c > 0) {
          const ef = sim.furnitureEdge[i];
          const ld = df * (1 - ef * .1 * Math.min(es, 2));
          sim.tempGrid[i] = sim.tempBuffer[i] * (1 - ld) + (s / c) * ld;
        }
      }
    }
  }

  if (sg > 0 && (scene.southSide || scene.westSide)) {
    for (let i = 0; i < gridW * gridH; i++) {
      if (sim.airMap[i] && !sim.furnitureSolid[i] && sim.externalCoeff[i] > 0) {
        const delta = sim.externalTemp[i] - sim.tempGrid[i];
        if (delta > 0) sim.tempGrid[i] += delta * sim.externalCoeff[i] * sg;
      }
    }
  }

  sim.elapsed += 2;
  dom.clock.textContent =
    String(Math.floor(sim.elapsed / 60)).padStart(2, '0') + ':' +
    String(sim.elapsed % 60).padStart(2, '0');

  if (sim.elapsed >= totalSeconds && !sim.done) {
    sim.done = true;
    sim.running = false;
    dom.startBtn.textContent = 'Hotovo';
  }
}
