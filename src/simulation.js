import {
  PPM, OX, OY, AC_MODELS, MAX_PARTICLES,
  scene, sim, dom, particles, getAndAdvanceParticleHead,
} from './state.js';
import { mToP, allBoundingBox, getObjectPixels } from './utils.js';
import { buildUnitCards } from './ui.js';

// ── Tuning parameter getters (cached DOM) ──

function getEdgeSoftness() { return +dom.edgeSoft.value / 10; }
function getDiffusionFactor() { return +dom.diffusion.value / 100; }
function getSunGain() { return +dom.sunGain.value / 100; }
function getTargetMult() { return +dom.targetMult.value / 100; }

// ── Cell helpers ──

function cellRoom(gx, gy) {
  const px = sim.bboxX + (gx + .5) * sim.cellSize;
  const py = sim.bboxY + (gy + .5) * sim.cellSize;
  for (let i = 0; i < scene.rooms.length; i++) {
    const r = scene.rooms[i];
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return i;
  }
  return -1;
}

function cellInDoor(px1, py1, px2, py2) {
  return scene.doors.some(d => {
    const r = scene.rooms[d.ri];
    if (!r) return false;
    let dx, dy;
    const hw = .45;
    if (d.wall === 'top') { dx = r.x + d.pos * r.w; dy = r.y; }
    else if (d.wall === 'bottom') { dx = r.x + d.pos * r.w; dy = r.y + r.h; }
    else if (d.wall === 'left') { dx = r.x; dy = r.y + d.pos * r.h; }
    else { dx = r.x + r.w; dy = r.y + d.pos * r.h; }

    const isH = d.wall === 'top' || d.wall === 'bottom';
    if (isH) return Math.abs((py1 + py2) / 2 - dy) < sim.cellSize * 2 && (px1 + px2) / 2 > dx - hw && (px1 + px2) / 2 < dx + hw;
    return Math.abs((px1 + px2) / 2 - dx) < sim.cellSize * 2 && (py1 + py2) / 2 > dy - hw && (py1 + py2) / 2 < dy + hw;
  });
}

// ── Build wall maps ──

function buildWallMaps() {
  const { gridW, gridH, cellSize, bboxX, bboxY } = sim;
  sim.wallH = new Uint8Array(gridW * gridH);
  sim.wallV = new Uint8Array(gridW * gridH);

  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      if (x > 0) {
        const r1 = cellRoom(x - 1, y), r2 = cellRoom(x, y);
        if (r1 !== r2 && r1 >= 0 && r2 >= 0) {
          const px1 = bboxX + (x - .5) * cellSize, py1 = bboxY + (y + .5) * cellSize;
          const px2 = bboxX + (x + .5) * cellSize, py2 = py1;
          sim.wallH[y * gridW + x] = cellInDoor(px1, py1, px2, py2) ? 0 : 1;
        }
      }
      if (y > 0) {
        const r1 = cellRoom(x, y - 1), r2 = cellRoom(x, y);
        if (r1 !== r2 && r1 >= 0 && r2 >= 0) {
          const px1 = bboxX + (x + .5) * cellSize, py1 = bboxY + (y - .5) * cellSize;
          const px2 = px1, py2 = bboxY + (y + .5) * cellSize;
          sim.wallV[y * gridW + x] = cellInDoor(px1, py1, px2, py2) ? 0 : 1;
        }
      }
    }
  }
}

// ── Build simulation maps ──

function buildSimMaps() {
  const bb = allBoundingBox();
  sim.bboxX = bb.x;
  sim.bboxY = bb.y;
  sim.gridW = Math.ceil(bb.w / sim.cellSize);
  sim.gridH = Math.ceil(bb.h / sim.cellSize);

  const { gridW, gridH, cellSize, bboxX, bboxY } = sim;

  sim.airMap = new Uint8Array(gridW * gridH);
  sim.furnitureSolid = new Uint8Array(gridW * gridH);
  sim.furnitureEdge = new Float32Array(gridW * gridH);
  sim.externalTemp = new Float32Array(gridW * gridH);
  sim.externalCoeff = new Float32Array(gridW * gridH);

  sim.cellRoomMap = new Int16Array(gridW * gridH);
  const roomCellCount = [];
  for (let i = 0; i < scene.rooms.length; i++) roomCellCount.push(0);

  for (let x = 0; x < gridW; x++) {
    for (let y = 0; y < gridH; y++) {
      const ri = cellRoom(x, y);
      const idx = y * gridW + x;
      sim.cellRoomMap[idx] = ri;
      sim.airMap[idx] = ri >= 0 ? 1 : 0;
      if (ri >= 0) roomCellCount[ri]++;
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
    scene.windows.forEach(w => {
      if (w.wall !== side) return;
      const r = scene.rooms[w.ri];
      if (!r) return;
      for (let y = 0; y < gridH; y++) {
        for (let x = 0; x < gridW; x++) {
          if (!sim.airMap[y * gridW + x]) continue;
          const px = (x + .5) * cellSize + bboxX - r.x;
          const py = (y + .5) * cellSize + bboxY - r.y;
          let dist, along;
          if (w.wall === 'right') { dist = r.w - px; along = py / r.h; }
          else if (w.wall === 'left') { dist = px; along = py / r.h; }
          else if (w.wall === 'bottom') { dist = r.h - py; along = px / r.w; }
          else { dist = py; along = px / r.w; }

          if (dist > 4) continue;
          const band = Math.exp(-Math.pow((along - w.pos) / .15, 2));
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
      const ri = cellRoom(x, y);
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

  const bb = allBoundingBox();
  sim.renderX = OX + mToP(bb.x);
  sim.renderY = OY + mToP(bb.y);
  sim.renderW = mToP(bb.w);
  sim.renderH = mToP(bb.h);

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
  const r = scene.rooms[u.ri];
  const rx = OX + mToP(r.x), ry = OY + mToP(r.y), rw = mToP(r.w), rh = mToP(r.h);
  if (u.wall === 'top') return [rx + u.pos * rw, ry];
  if (u.wall === 'bottom') return [rx + u.pos * rw, ry + rh];
  if (u.wall === 'left') return [rx, ry + u.pos * rh];
  return [rx + rw, ry + u.pos * rh];
}

function getUnitBaseAngle(u) {
  return u.wall === 'top' ? Math.PI / 2 : u.wall === 'bottom' ? -Math.PI / 2 : u.wall === 'left' ? 0 : Math.PI;
}

function getRoomAvgTemp(u) {
  const ri = u.ri;
  if (ri < 0 || ri >= scene.rooms.length) return 25;
  const cnt = sim.roomCellCount[ri];
  if (!cnt) return 25;
  const { gridW, gridH, cellRoomMap, furnitureSolid, tempGrid } = sim;
  let s = 0;
  for (let i = 0, len = gridW * gridH; i < len; i++) {
    if (cellRoomMap[i] === ri && !furnitureSolid[i]) {
      s += tempGrid[i];
    }
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
  const isH = u.wall === 'top' || u.wall === 'bottom';

  let px, py;
  if (isH) { px = ax + off; py = ay + (u.wall === 'top' ? 10 : -10); }
  else { px = ax + (u.wall === 'left' ? 10 : -10); py = ay + off; }

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

// ── Particle door check ──

function isParticleInDoor(px, py) {
  return scene.doors.some(d => {
    const r = scene.rooms[d.ri];
    if (!r) return false;
    const hw = .45 * PPM;
    let dx, dy;
    if (d.wall === 'top') { dx = OX + mToP(r.x + d.pos * r.w); dy = OY + mToP(r.y); }
    else if (d.wall === 'bottom') { dx = OX + mToP(r.x + d.pos * r.w); dy = OY + mToP(r.y + r.h); }
    else if (d.wall === 'left') { dx = OX + mToP(r.x); dy = OY + mToP(r.y + d.pos * r.h); }
    else { dx = OX + mToP(r.x + r.w); dy = OY + mToP(r.y + d.pos * r.h); }

    const isH = d.wall === 'top' || d.wall === 'bottom';
    return isH ? Math.abs(py - dy) < 8 && Math.abs(px - dx) < hw : Math.abs(px - dx) < 8 && Math.abs(py - dy) < hw;
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

// ── Update particles ──

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

    // Track back to source
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

  // Neighbor offsets: [dx, dy, weight] — precomputed outside loop
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

  // Sun heat
  if (sg > 0 && (scene.southSide || scene.westSide)) {
    for (let i = 0; i < gridW * gridH; i++) {
      if (sim.airMap[i] && !sim.furnitureSolid[i] && sim.externalCoeff[i] > 0) {
        const delta = sim.externalTemp[i] - sim.tempGrid[i];
        if (delta > 0) sim.tempGrid[i] += delta * sim.externalCoeff[i] * sg;
      }
    }
  }

  // Advance clock
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
