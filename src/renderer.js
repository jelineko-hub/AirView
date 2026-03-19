import {
  PPM, GRID, OX, OY, AC_MODELS, MAX_PARTICLES, DETECT_CELL,
  canvas, scene, view, editor, sim, particles, dom,
} from './state.js';
import { mToP, pToM, allBoundingBox, getObjectPixels, wallDir } from './utils.js';

// ── Grid Drawing ──

function drawGrid() {
  const ctx = canvas.ctx;
  const GW = 30, GH = 20;
  const z = view.zoom;

  ctx.fillStyle = '#f7f6f2';
  ctx.fillRect(-view.x / z, -view.y / z, canvas.width / z, canvas.height / z);

  const vx0 = Math.max(0, Math.floor((-view.x / z - OX) / PPM / GRID) * GRID);
  const vx1 = Math.min(GW, Math.ceil(((canvas.width - view.x) / z - OX) / PPM / GRID) * GRID);
  const vy0 = Math.max(0, Math.floor((-view.y / z - OY) / PPM / GRID) * GRID);
  const vy1 = Math.min(GH, Math.ceil(((canvas.height - view.y) / z - OY) / PPM / GRID) * GRID);

  ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = .5; ctx.beginPath();
  for (let m = vx0; m <= vx1; m += GRID) { ctx.moveTo(OX + m * PPM, OY + vy0 * PPM); ctx.lineTo(OX + m * PPM, OY + vy1 * PPM); }
  for (let m = vy0; m <= vy1; m += GRID) { ctx.moveTo(OX + vx0 * PPM, OY + m * PPM); ctx.lineTo(OX + vx1 * PPM, OY + m * PPM); }
  ctx.stroke();

  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = .7; ctx.beginPath();
  for (let m = 0; m <= GW; m += .5) { ctx.moveTo(OX + m * PPM, OY); ctx.lineTo(OX + m * PPM, OY + GH * PPM); }
  for (let m = 0; m <= GH; m += .5) { ctx.moveTo(OX, OY + m * PPM); ctx.lineTo(OX + GW * PPM, OY + m * PPM); }
  ctx.stroke();

  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.beginPath();
  for (let m = 0; m <= GW; m += 1) { ctx.moveTo(OX + m * PPM, OY); ctx.lineTo(OX + m * PPM, OY + GH * PPM); }
  for (let m = 0; m <= GH; m += 1) { ctx.moveTo(OX, OY + m * PPM); ctx.lineTo(OX + GW * PPM, OY + m * PPM); }
  ctx.stroke();

  ctx.fillStyle = '#777'; ctx.font = '10px DM Sans,sans-serif';
  ctx.textAlign = 'center';
  for (let m = 0; m <= GW; m += 1) ctx.fillText(m + 'm', OX + m * PPM, OY - 8);
  ctx.textAlign = 'right';
  for (let m = 0; m <= GH; m += 1) ctx.fillText(m + 'm', OX - 6, OY + m * PPM + 3);
}

// ── AC Unit Drawing ──

export function drawAcUnit(ctx, wall, pos, label, unitSide) {
  if (!wall) return;
  const wx1 = OX + mToP(wall.x1), wy1 = OY + mToP(wall.y1);
  const wx2 = OX + mToP(wall.x2), wy2 = OY + mToP(wall.y2);
  const ax = wx1 + pos * (wx2 - wx1), ay = wy1 + pos * (wy2 - wy1);
  const isH = Math.abs(wall.y1 - wall.y2) < 0.001;
  const uw = 58, uh = 14;

  // Use stored side if available, otherwise fall back to bounding box heuristic
  let offX = 0, offY = 0;
  if (unitSide != null) {
    if (isH) offY = unitSide;
    else offX = unitSide;
  } else {
    const bb = allBoundingBox();
    if (bb) {
      const cx = OX + mToP(bb.x + bb.w / 2), cy = OY + mToP(bb.y + bb.h / 2);
      if (isH) offY = ay < cy ? 1 : -1;
      else offX = ax < cx ? 1 : -1;
    } else {
      if (isH) offY = 1; else offX = 1;
    }
  }

  let bx, by, bw, bh;
  if (isH) {
    bx = ax - uw / 2; by = offY > 0 ? ay : ay - uh; bw = uw; bh = uh;
  } else {
    bx = offX > 0 ? ax : ax - uh; by = ay - uw / 2; bw = uh; bh = uw;
  }

  // Main body — slightly off-white, small radius
  ctx.fillStyle = '#f5f5f5'; ctx.strokeStyle = '#999'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 3); ctx.fill(); ctx.stroke();

  // Bottom vent line (air outlet slit)
  ctx.strokeStyle = '#bbb'; ctx.lineWidth = 0.8;
  if (isH) {
    const ventY = offY > 0 ? by + bh - 3 : by + 3;
    ctx.beginPath(); ctx.moveTo(bx + 6, ventY); ctx.lineTo(bx + bw - 6, ventY); ctx.stroke();
  } else {
    const ventX = offX > 0 ? bx + bw - 3 : bx + 3;
    ctx.beginPath(); ctx.moveTo(ventX, by + 6); ctx.lineTo(ventX, by + bh - 6); ctx.stroke();
  }

  // Label
  ctx.fillStyle = '#777'; ctx.font = '8px DM Sans'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (!isH) {
    ctx.save(); ctx.translate(bx + bw / 2, by + bh / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText(label || 'AC', 0, 0); ctx.restore();
  } else {
    ctx.fillText(label || 'AC', bx + bw / 2, by + bh / 2 - 1);
  }
  ctx.textBaseline = 'alphabetic';
}

// ── Side Label (South/West) ──

function drawSideLabel(ctx, side, label, color) {
  if (!side || !scene.walls.length) return;
  const bb = allBoundingBox();
  if (!bb) return;
  const bx = OX + mToP(bb.x), by = OY + mToP(bb.y), bw = mToP(bb.w), bh = mToP(bb.h);
  let sx, sy, ex, ey, lx, ly;

  if (side === 'top')    { sx = bx; sy = by; ex = bx + bw; ey = by; lx = bx + bw / 2; ly = by - 18; }
  else if (side === 'bottom') { sx = bx; sy = by + bh; ex = bx + bw; ey = by + bh; lx = bx + bw / 2; ly = by + bh + 14; }
  else if (side === 'left')   { sx = bx; sy = by; ex = bx; ey = by + bh; lx = bx - 26; ly = by + bh / 2 + 4; }
  else { sx = bx + bw; sy = by; ex = bx + bw; ey = by + bh; lx = bx + bw + 26; ly = by + bh / 2 + 4; }

  ctx.strokeStyle = color.replace('1)', '0.4)'); ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.fillStyle = color.replace('1)', '0.7)'); ctx.font = 'bold 10px DM Sans'; ctx.textAlign = 'center';
  ctx.fillText(label, lx, ly);
}

// ── Editor Drawing ──

export function drawEditor() {
  const ctx = canvas.ctx;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(view.x, view.y);
  ctx.scale(view.zoom, view.zoom);
  drawGrid();

  const { isDragging, dragStart, dragEnd } = editor;

  // Draw drag preview (room or wall)
  if (isDragging && dragStart && dragEnd) {
    if (editor.tool === 'room') {
      const x1 = OX + mToP(Math.min(dragStart.mx, dragEnd.mx));
      const y1 = OY + mToP(Math.min(dragStart.my, dragEnd.my));
      const w = mToP(Math.abs(dragEnd.mx - dragStart.mx));
      const h = mToP(Math.abs(dragEnd.my - dragStart.my));
      if (w > 5 && h > 5) {
        ctx.fillStyle = 'rgba(29,158,117,.05)'; ctx.fillRect(x1, y1, w, h);
        ctx.strokeStyle = '#1D9E75'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
        ctx.strokeRect(x1, y1, w, h); ctx.setLineDash([]);
        const wm = Math.abs(dragEnd.mx - dragStart.mx), hm = Math.abs(dragEnd.my - dragStart.my);
        ctx.fillStyle = '#0a5e46'; ctx.font = 'bold 15px DM Sans'; ctx.textAlign = 'center';
        ctx.fillText(wm.toFixed(1) + ' m', x1 + w / 2, y1 - 12);
        ctx.save(); ctx.translate(x1 - 14, y1 + h / 2); ctx.rotate(-Math.PI / 2);
        ctx.fillText(hm.toFixed(1) + ' m', 0, 0); ctx.restore();
        ctx.fillStyle = 'rgba(10,94,70,.4)'; ctx.font = '13px DM Sans';
        ctx.fillText(Math.round(wm * hm * 10) / 10 + ' m²', x1 + w / 2, y1 + h / 2 + 5);
      }
    } else if (editor.tool === 'wall') {
      const sx = OX + mToP(dragStart.mx), sy = OY + mToP(dragStart.my);
      const dx = Math.abs(dragEnd.mx - dragStart.mx), dy = Math.abs(dragEnd.my - dragStart.my);
      let ex, ey;
      if (dx >= dy) { ex = OX + mToP(dragEnd.mx); ey = sy; }
      else { ex = sx; ey = OY + mToP(dragEnd.my); }
      const len = Math.sqrt((pToM(ex - sx)) ** 2 + (pToM(ey - sy)) ** 2);
      if (len > 0.05) {
        ctx.strokeStyle = '#1D9E75'; ctx.lineWidth = 2.5; ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.setLineDash([]);
        const lx = (sx + ex) / 2, ly = (sy + ey) / 2;
        ctx.fillStyle = '#0a5e46'; ctx.font = 'bold 13px DM Sans'; ctx.textAlign = 'center';
        const isH = Math.abs(ey - sy) < 1;
        ctx.fillText(len.toFixed(1) + ' m', lx + (isH ? 0 : -16), ly + (isH ? -10 : 4));
        ctx.fillStyle = '#0a5e46';
        ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(ex, ey, 3, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // Detected room fills — use offscreen canvas for smooth rendering
  const cs = DETECT_CELL;
  const roomColors = ['rgba(200,225,210,.35)', 'rgba(210,220,235,.35)', 'rgba(235,220,200,.35)', 'rgba(220,210,230,.35)'];
  if (scene.rooms.length) {
    const bb = allBoundingBox();
    if (bb) {
      const fillPx = mToP(cs);
      scene.rooms.forEach((r, ri) => {
        ctx.fillStyle = roomColors[ri % roomColors.length];
        // Batch fill: group cells into horizontal runs for faster rendering
        const cellsByRow = {};
        r.cells.forEach(c => {
          const key = c.y.toFixed(2);
          if (!cellsByRow[key]) cellsByRow[key] = [];
          cellsByRow[key].push(c.x);
        });
        Object.entries(cellsByRow).forEach(([yStr, xs]) => {
          xs.sort((a, b) => a - b);
          let start = xs[0], end = xs[0];
          for (let i = 1; i <= xs.length; i++) {
            if (i < xs.length && Math.abs(xs[i] - end - cs) < 0.01) {
              end = xs[i];
            } else {
              ctx.fillRect(OX + mToP(start), OY + mToP(+yStr), mToP(end - start + cs), fillPx);
              if (i < xs.length) { start = xs[i]; end = xs[i]; }
            }
          }
        });
      });
    }
  }

  // Walls
  ctx.strokeStyle = '#222'; ctx.lineWidth = 2.5;
  scene.walls.forEach(w => {
    ctx.beginPath();
    ctx.moveTo(OX + mToP(w.x1), OY + mToP(w.y1));
    ctx.lineTo(OX + mToP(w.x2), OY + mToP(w.y2));
    ctx.stroke();
  });

  // Room labels (area, temp)
  scene.rooms.forEach((r, ri) => {
    ctx.fillStyle = '#777'; ctx.font = '11px DM Sans'; ctx.textAlign = 'center';
    ctx.fillText(r.area.toFixed(1) + ' m²', OX + mToP(r.cx), OY + mToP(r.cy) - 2);
    ctx.fillStyle = '#b07030'; ctx.font = 'bold 12px DM Sans';
    ctx.fillText((r.temp || 26) + '°C', OX + mToP(r.cx), OY + mToP(r.cy) + 14);
  });

  // Doors
  scene.doors.forEach(d => {
    const p = getObjectPixels('door', d);
    if (!p) return;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.stroke();
    ctx.strokeStyle = '#c07030'; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.stroke();
    ctx.setLineDash([]);
  });

  // Windows
  scene.windows.forEach(win => {
    const p = getObjectPixels('win', win);
    if (!p) return;
    const w = scene.walls[win.wi];
    if (!w) return;
    const side = getWallSide(w);
    const isSouth = scene.southSide && side === scene.southSide;
    const isWest = scene.westSide && side === scene.westSide;
    ctx.strokeStyle = isSouth ? 'rgba(255,180,30,.8)' : isWest ? 'rgba(80,140,255,.8)' : '#4090e0';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.stroke();
    if (isSouth || isWest) {
      ctx.fillStyle = isSouth ? 'rgba(255,180,30,.6)' : 'rgba(80,140,255,.6)';
      ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
      const isH = wallDir(w) === 'h';
      const cx = (p.x1 + p.x2) / 2, cy = (p.y1 + p.y2) / 2;
      ctx.fillText('☀', cx + (isH ? 0 : (side === 'right' ? 14 : -14)), cy + (isH ? (side === 'bottom' ? 16 : -8) : 4));
    }
  });

  // Side labels
  drawSideLabel(ctx, scene.southSide, 'JUH ☀', 'rgba(255,140,20,1)');
  drawSideLabel(ctx, scene.westSide, 'ZÁPAD ☀', 'rgba(60,120,230,1)');

  // Furniture
  scene.furniture.forEach(f => {
    const fx = OX + mToP(f.x), fy = OY + mToP(f.y), fw = mToP(f.w), fh = mToP(f.h);
    ctx.fillStyle = 'rgba(70,58,45,.8)'; ctx.strokeStyle = 'rgba(50,40,30,.85)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(fx, fy, fw, fh, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = 'bold 11px DM Sans'; ctx.textAlign = 'center';
    ctx.fillText(f.l, fx + fw / 2, fy + fh / 2 + 4);
  });

  // AC units
  scene.acUnits.forEach((u, i) => {
    const w = scene.walls[u.wi];
    if (!w) return;
    drawAcUnit(ctx, w, u.pos, String(i + 1), u.side);
  });

  // Bounding box dimensions
  const bb = allBoundingBox();
  if (bb && bb.w > 0) {
    ctx.fillStyle = '#999'; ctx.font = '11px DM Sans'; ctx.textAlign = 'center';
    ctx.fillText(bb.w.toFixed(1) + ' × ' + bb.h.toFixed(1) + ' m',
      OX + mToP(bb.x + bb.w / 2), OY + mToP(bb.y) - 22);
  }

  ctx.restore();
}

/** Get wall side relative to bounding box */
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

// ── Temperature Color ──

function tempToRGB(t) {
  t = Math.max(16, Math.min(30, t));
  const n = (t - 16) / 14;
  const stops = [[16, 66, 208], [32, 160, 208], [64, 200, 64], [224, 208, 32], [224, 112, 32], [208, 32, 32]];
  const p = n * (stops.length - 1), lo = Math.floor(p), hi = Math.min(lo + 1, stops.length - 1), f = p - lo;
  return [
    Math.round(stops[lo][0] + (stops[hi][0] - stops[lo][0]) * f),
    Math.round(stops[lo][1] + (stops[hi][1] - stops[lo][1]) * f),
    Math.round(stops[lo][2] + (stops[hi][2] - stops[lo][2]) * f),
  ];
}

// ── Simulation Drawing ──

function drawHeatmap(ctx) {
  const gw = sim.gridW, gh = sim.gridH;
  if (!sim.offscreen || sim.offscreen.width !== gw || sim.offscreen.height !== gh) {
    sim.offscreen = document.createElement('canvas');
    sim.offscreen.width = gw;
    sim.offscreen.height = gh;
  }
  const oc = sim.offscreen.getContext('2d');
  const img = oc.createImageData(gw, gh);
  const d = img.data;

  for (let i = 0, len = gw * gh; i < len; i++) {
    const j = i * 4;
    if (!sim.airMap[i]) { d[j + 3] = 0; continue; }
    if (sim.furnitureSolid[i]) {
      d[j] = 90; d[j + 1] = 75; d[j + 2] = 60; d[j + 3] = 240;
    } else {
      const rgb = tempToRGB(sim.tempGrid[i]);
      d[j] = rgb[0]; d[j + 1] = rgb[1]; d[j + 2] = rgb[2]; d[j + 3] = 220;
    }
  }
  oc.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(sim.offscreen, Math.round(sim.renderX), Math.round(sim.renderY),
    Math.round(sim.renderW), Math.round(sim.renderH));
}

function drawSceneOverlays(ctx) {
  // Walls
  ctx.strokeStyle = '#222'; ctx.lineWidth = 2;
  scene.walls.forEach(w => {
    ctx.beginPath();
    ctx.moveTo(OX + mToP(w.x1), OY + mToP(w.y1));
    ctx.lineTo(OX + mToP(w.x2), OY + mToP(w.y2));
    ctx.stroke();
  });

  // Doors
  scene.doors.forEach(d => {
    const p = getObjectPixels('door', d);
    if (!p) return;
    ctx.strokeStyle = '#f7f6f2'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.stroke();
    ctx.strokeStyle = '#c07030'; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.stroke();
    ctx.setLineDash([]);
  });

  // Windows
  scene.windows.forEach(win => {
    const p = getObjectPixels('win', win);
    if (!p) return;
    const w = scene.walls[win.wi];
    if (!w) return;
    const side = getWallSide(w);
    const isSouth = scene.southSide && side === scene.southSide;
    const isWest = scene.westSide && side === scene.westSide;
    ctx.strokeStyle = isSouth ? 'rgba(255,180,30,.8)' : isWest ? 'rgba(80,140,255,.8)' : '#4090e0';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.stroke();
  });
}

function drawParticles(ctx) {
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const p = particles[i];
    if (!p.on) continue;
    const a = Math.max(.04, .5 - p.age / p.maxAge * .46);
    const sz = Math.max(.6, 2.2 - p.age / p.maxAge * 1.2);
    ctx.fillStyle = 'rgba(255,255,255,' + a + ')';
    ctx.beginPath(); ctx.arc(p.x, p.y, sz, 0, Math.PI * 2); ctx.fill();
  }
}

function drawAcCones(ctx) {
  scene.acUnits.forEach((u, ui) => {
    if (!u.on) return;
    const m = AC_MODELS[u.model];
    const w = scene.walls[u.wi];
    if (!w) return;
    const isH = wallDir(w) === 'h';
    const wx1 = OX + mToP(w.x1), wy1 = OY + mToP(w.y1);
    const wx2 = OX + mToP(w.x2), wy2 = OY + mToP(w.y2);
    const ax = wx1 + u.pos * (wx2 - wx1), ay = wy1 + u.pos * (wy2 - wy1);

    // Determine base angle from wall normal — use stored side if available
    let ba;
    if (u.side != null) {
      if (isH) ba = u.side > 0 ? Math.PI / 2 : -Math.PI / 2;
      else ba = u.side > 0 ? 0 : Math.PI;
    } else {
      const bb = allBoundingBox();
      if (isH) ba = bb && w.y1 < bb.y + bb.h / 2 ? Math.PI / 2 : -Math.PI / 2;
      else ba = bb && w.x1 < bb.x + bb.w / 2 ? 0 : Math.PI;
    }

    const pw = Math.max(sim.unitPower[ui], .2);
    const tmVal = +dom.targetMult.value / 100;
    const tpx = m.thrust * PPM * pw * tmVal;
    const dr = +dom.direction.value * Math.PI / 180;
    const ha = (+dom.spreadWidth.value / 2) * Math.PI / 180;
    const ea = ba + dr;

    ctx.strokeStyle = 'rgba(32,100,200,.08)'; ctx.lineWidth = .5;
    ctx.beginPath(); ctx.arc(ax, ay, tpx, ea - ha, ea + ha); ctx.stroke();
    ctx.strokeStyle = 'rgba(10,94,70,.2)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(ax, ay); ctx.lineTo(ax + Math.cos(ea + ha) * 45, ay + Math.sin(ea + ha) * 45);
    ctx.moveTo(ax, ay); ctx.lineTo(ax + Math.cos(ea - ha) * 45, ay + Math.sin(ea - ha) * 45);
    ctx.stroke(); ctx.setLineDash([]);

    drawAcUnit(ctx, w, u.pos, String(ui + 1), u.side);
  });
}

function drawSimHUD(ctx, cpx) {
  const bb = allBoundingBox();
  if (!bb) return;
  // Use bb (actual walls) for HUD positioning, not padded sim render area
  const hudX = OX + mToP(bb.x), hudY = OY + mToP(bb.y);
  const hudW = mToP(bb.w), hudH = mToP(bb.h);
  ctx.fillStyle = '#999'; ctx.font = '12px DM Sans'; ctx.textAlign = 'center';
  ctx.fillText(bb.w.toFixed(1) + ' × ' + bb.h.toFixed(1) + ' m', hudX + hudW / 2, hudY - 8);

  const totalSeconds = (+dom.simLength.value) * 60;
  ctx.fillStyle = 'rgba(0,0,0,.07)'; ctx.fillRect(hudX, hudY + hudH + 6, hudW, 5);
  ctx.fillStyle = '#1D9E75'; ctx.fillRect(hudX, hudY + hudH + 6, hudW * Math.min(sim.elapsed / totalSeconds, 1), 5);

  if (editor.cursorX > sim.renderX && editor.cursorX < sim.renderX + sim.renderW &&
      editor.cursorY > sim.renderY && editor.cursorY < sim.renderY + sim.renderH) {
    const gx = Math.floor((editor.cursorX - sim.renderX) / cpx);
    const gy = Math.floor((editor.cursorY - sim.renderY) / cpx);
    if (gx >= 0 && gx < sim.gridW && gy >= 0 && gy < sim.gridH && sim.airMap[gy * sim.gridW + gx]) {
      const isSolid = sim.furnitureSolid[gy * sim.gridW + gx];
      const tmp = isSolid ? null : sim.tempGrid[gy * sim.gridW + gx];
      const label = tmp !== null ? tmp.toFixed(1) + '°C' : '—';

      ctx.beginPath(); ctx.arc(editor.cursorX, editor.cursorY, 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1; ctx.stroke();

      const tw = ctx.measureText(label).width, bw = tw + 12, bh = 20;
      let bx = editor.cursorX - bw / 2, by = editor.cursorY - 32;
      if (bx < sim.renderX) bx = sim.renderX;
      if (by < sim.renderY) by = editor.cursorY + 12;

      ctx.fillStyle = 'rgba(0,0,0,.8)'; ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 4); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px DM Sans'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, bx + bw / 2, by + bh / 2);
      ctx.textBaseline = 'alphabetic';
    }
  }
}

export function drawTempLabels(ctx) {
  const { gridW, gridH, cellSize, bboxX, bboxY } = sim;
  const step = Math.round(1 / cellSize); // cells per meter
  ctx.font = '9px DM Sans';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let gy = Math.floor(step / 2); gy < gridH; gy += step) {
    for (let gx = Math.floor(step / 2); gx < gridW; gx += step) {
      const i = gy * gridW + gx;
      if (!sim.airMap[i] || sim.furnitureSolid[i]) continue;
      const t = sim.tempGrid[i];
      const px = sim.renderX + (gx + 0.5) * cellSize * PPM;
      const py = sim.renderY + (gy + 0.5) * cellSize * PPM;
      const label = t.toFixed(1) + '°';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.beginPath();
      ctx.roundRect(px - tw / 2 - 3, py - 6, tw + 6, 12, 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(label, px, py);
    }
  }
}

export function drawSim() {
  const ctx = canvas.ctx;
  const cpx = sim.cellSize * PPM;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(view.x, view.y);
  ctx.scale(view.zoom, view.zoom);
  ctx.fillStyle = '#f7f6f2';
  ctx.fillRect(-view.x / view.zoom, -view.y / view.zoom, canvas.width / view.zoom, canvas.height / view.zoom);

  drawHeatmap(ctx);
  drawSceneOverlays(ctx);
  drawParticles(ctx);
  drawAcCones(ctx);
  if (!sim.running && sim.elapsed > 0) drawTempLabels(ctx);
  drawSimHUD(ctx, cpx);

  ctx.restore();
}
