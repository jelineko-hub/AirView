import {
  PPM, GRID, OX, OY, AC_MODELS, MAX_PARTICLES,
  canvas, scene, view, editor, sim, particles, dom,
} from './state.js';
import { mToP, pToM, allBoundingBox, getObjectPixels } from './utils.js';

// ── Wall opening segment splitter ──

function splitByOpenings(x1, y1, x2, y2) {
  const isH = Math.abs(y1 - y2) < 1;
  const cuts = [];

  scene.wallOpenings.forEach(wo => {
    const ox1 = OX + mToP(wo.x1), oy1 = OY + mToP(wo.y1);
    const ox2 = OX + mToP(wo.x2), oy2 = OY + mToP(wo.y2);
    const oIsH = Math.abs(oy1 - oy2) < 1;

    if (isH && oIsH && Math.abs(y1 - oy1) < 3) {
      const oMin = Math.min(ox1, ox2), oMax = Math.max(ox1, ox2);
      const wMin = Math.min(x1, x2), wMax = Math.max(x1, x2);
      if (oMax > wMin && oMin < wMax) cuts.push([Math.max(oMin, wMin), Math.min(oMax, wMax)]);
    } else if (!isH && !oIsH && Math.abs(x1 - ox1) < 3) {
      const oMin = Math.min(oy1, oy2), oMax = Math.max(oy1, oy2);
      const wMin = Math.min(y1, y2), wMax = Math.max(y1, y2);
      if (oMax > wMin && oMin < wMax) cuts.push([Math.max(oMin, wMin), Math.min(oMax, wMax)]);
    }
  });

  if (!cuts.length) return [[x1, y1, x2, y2]];

  cuts.sort((a, b) => a[0] - b[0]);
  const segs = [];
  if (isH) {
    let pos = Math.min(x1, x2);
    const end = Math.max(x1, x2);
    cuts.forEach(([cs, ce]) => {
      if (cs > pos + 1) segs.push([pos, y1, cs, y1]);
      pos = ce;
    });
    if (pos < end - 1) segs.push([pos, y1, end, y1]);
  } else {
    let pos = Math.min(y1, y2);
    const end = Math.max(y1, y2);
    cuts.forEach(([cs, ce]) => {
      if (cs > pos + 1) segs.push([x1, pos, x1, cs]);
      pos = ce;
    });
    if (pos < end - 1) segs.push([x1, pos, x1, end]);
  }
  return segs.length ? segs : [[x1, y1, x2, y2]];
}

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

  // Fine grid (0.1m)
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = .5; ctx.beginPath();
  for (let m = vx0; m <= vx1; m += GRID) { ctx.moveTo(OX + m * PPM, OY + vy0 * PPM); ctx.lineTo(OX + m * PPM, OY + vy1 * PPM); }
  for (let m = vy0; m <= vy1; m += GRID) { ctx.moveTo(OX + vx0 * PPM, OY + m * PPM); ctx.lineTo(OX + vx1 * PPM, OY + m * PPM); }
  ctx.stroke();

  // Medium grid (0.5m)
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = .7; ctx.beginPath();
  for (let m = 0; m <= GW; m += .5) { ctx.moveTo(OX + m * PPM, OY); ctx.lineTo(OX + m * PPM, OY + GH * PPM); }
  for (let m = 0; m <= GH; m += .5) { ctx.moveTo(OX, OY + m * PPM); ctx.lineTo(OX + GW * PPM, OY + m * PPM); }
  ctx.stroke();

  // Coarse grid (1m)
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.beginPath();
  for (let m = 0; m <= GW; m += 1) { ctx.moveTo(OX + m * PPM, OY); ctx.lineTo(OX + m * PPM, OY + GH * PPM); }
  for (let m = 0; m <= GH; m += 1) { ctx.moveTo(OX, OY + m * PPM); ctx.lineTo(OX + GW * PPM, OY + m * PPM); }
  ctx.stroke();

  // Labels
  ctx.fillStyle = '#777'; ctx.font = '10px DM Sans,sans-serif';
  ctx.textAlign = 'center';
  for (let m = 0; m <= GW; m += 1) ctx.fillText(m + 'm', OX + m * PPM, OY - 8);
  ctx.textAlign = 'right';
  for (let m = 0; m <= GH; m += 1) ctx.fillText(m + 'm', OX - 6, OY + m * PPM + 3);
}

// ── AC Unit Drawing ──

export function drawAcUnit(ctx, rx, ry, rw, rh, wall, pos, label) {
  const uw = 56, uh = 8;
  let bx, by, bw, bh;

  if (wall === 'top')    { const ax = rx + pos * rw; bx = ax - uw / 2; by = ry + 1;      bw = uw; bh = uh; }
  else if (wall === 'bottom') { const ax = rx + pos * rw; bx = ax - uw / 2; by = ry + rh - uh - 1; bw = uw; bh = uh; }
  else if (wall === 'left')   { const ay = ry + pos * rh; bx = rx + 1;      by = ay - uw / 2;      bw = uh; bh = uw; }
  else                        { const ay = ry + pos * rh; bx = rx + rw - uh - 1; by = ay - uw / 2;  bw = uh; bh = uw; }

  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#999'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#555'; ctx.font = 'bold 8px DM Sans'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  const txt = label || 'AC';
  if (wall === 'left' || wall === 'right') {
    ctx.save(); ctx.translate(bx + bw / 2, by + bh / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText(txt, 0, 0); ctx.restore();
  } else {
    ctx.fillText(txt, bx + bw / 2, by + bh / 2);
  }
  ctx.textBaseline = 'alphabetic';
}

// ── Side Label (South/West) ──

function drawSideLabel(ctx, side, label, color) {
  if (!side || !scene.rooms.length) return;
  const bb = allBoundingBox();
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

  // Draw drag preview
  if (isDragging && dragStart && dragEnd) {
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
  }

  // Room fills
  scene.rooms.forEach(r => {
    ctx.fillStyle = '#f0efeb';
    ctx.fillRect(OX + mToP(r.x), OY + mToP(r.y), mToP(r.w), mToP(r.h));
  });

  // Room borders + labels — draw walls as segments, skipping openings
  scene.rooms.forEach(r => {
    const rx = OX + mToP(r.x), ry = OY + mToP(r.y), rw = mToP(r.w), rh = mToP(r.h);
    ctx.strokeStyle = '#222'; ctx.lineWidth = 2.5;
    const walls = [
      [rx, ry, rx + rw, ry],
      [rx, ry + rh, rx + rw, ry + rh],
      [rx, ry, rx, ry + rh],
      [rx + rw, ry, rx + rw, ry + rh],
    ];
    walls.forEach(([x1, y1, x2, y2]) => {
      const segs = splitByOpenings(x1, y1, x2, y2);
      segs.forEach(([sx1, sy1, sx2, sy2]) => {
        ctx.beginPath(); ctx.moveTo(sx1, sy1); ctx.lineTo(sx2, sy2); ctx.stroke();
      });
    });
    // Dashed indicator where openings are
    scene.wallOpenings.forEach(wo => {
      const wx1 = OX + mToP(wo.x1), wy1 = OY + mToP(wo.y1);
      const wx2 = OX + mToP(wo.x2), wy2 = OY + mToP(wo.y2);
      ctx.strokeStyle = 'rgba(10,94,70,.25)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(wx1, wy1); ctx.lineTo(wx2, wy2); ctx.stroke();
      ctx.setLineDash([]);
    });
    ctx.fillStyle = '#0a5e46'; ctx.font = 'bold 13px DM Sans'; ctx.textAlign = 'center';
    ctx.fillText(r.w.toFixed(1) + ' m', rx + rw / 2, ry - 6);
    ctx.save(); ctx.translate(rx - 8, ry + rh / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText(r.h.toFixed(1) + ' m', 0, 0); ctx.restore();
    ctx.fillStyle = '#777'; ctx.font = '11px DM Sans';
    ctx.fillText(Math.round(r.w * r.h * 10) / 10 + ' m²', rx + rw / 2, ry + rh - 10);
    ctx.fillStyle = '#b07030'; ctx.font = 'bold 12px DM Sans';
    ctx.fillText((r.temp || 26) + '°C', rx + rw / 2, ry + 20);
  });

  // Lines (wall lines)
  scene.lines.forEach(ln => {
    ctx.strokeStyle = '#222'; ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(OX + mToP(ln.x1), OY + mToP(ln.y1));
    ctx.lineTo(OX + mToP(ln.x2), OY + mToP(ln.y2));
    ctx.stroke();
  });

  // Line preview with dimensions
  if (editor.lineStart && editor.cursorX > 0) {
    const sx = OX + mToP(editor.lineStart.x), sy = OY + mToP(editor.lineStart.y);
    const curMx = Math.max(0, Math.round(pToM(editor.cursorX - OX) / 0.1) * 0.1);
    const curMy = Math.max(0, Math.round(pToM(editor.cursorY - OY) / 0.1) * 0.1);
    const dx = Math.abs(curMx - editor.lineStart.x), dy = Math.abs(curMy - editor.lineStart.y);
    let ex, ey;
    if (dx >= dy) { ex = curMx; ey = editor.lineStart.y; }
    else { ex = editor.lineStart.x; ey = curMy; }
    const epx = OX + mToP(ex), epy = OY + mToP(ey);
    const len = Math.sqrt((ex - editor.lineStart.x) ** 2 + (ey - editor.lineStart.y) ** 2);

    // Preview line
    if (len > 0.05) {
      ctx.strokeStyle = '#1D9E75'; ctx.lineWidth = 2.5; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(epx, epy); ctx.stroke();
      ctx.setLineDash([]);

      // Dimension label
      const lx = (sx + epx) / 2, ly = (sy + epy) / 2;
      ctx.fillStyle = '#0a5e46'; ctx.font = 'bold 13px DM Sans'; ctx.textAlign = 'center';
      const isH = Math.abs(ey - editor.lineStart.y) < 0.01;
      ctx.fillText(len.toFixed(1) + ' m', lx + (isH ? 0 : -16), ly + (isH ? -10 : 4));
    }

    // Start point dot
    ctx.fillStyle = '#0a5e46';
    ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI * 2); ctx.fill();
    // End point dot
    if (len > 0.05) {
      ctx.beginPath(); ctx.arc(epx, epy, 3, 0, Math.PI * 2); ctx.fill();
    }
  }

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
  scene.windows.forEach(w => {
    const p = getObjectPixels('win', w);
    if (!p) return;
    const isSouth = scene.southSide && w.wall === scene.southSide;
    const isWest = scene.westSide && w.wall === scene.westSide;
    ctx.strokeStyle = isSouth ? 'rgba(255,180,30,.8)' : isWest ? 'rgba(80,140,255,.8)' : '#4090e0';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.stroke();
    if (isSouth || isWest) {
      ctx.fillStyle = isSouth ? 'rgba(255,180,30,.6)' : 'rgba(80,140,255,.6)';
      ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('☀',
        (p.x1 + p.x2) / 2 + (w.wall === 'right' ? 14 : w.wall === 'left' ? -14 : 0),
        (p.y1 + p.y2) / 2 + (w.wall === 'bottom' ? 16 : w.wall === 'top' ? -8 : 4));
    }
  });

  // Side labels
  drawSideLabel(ctx, scene.southSide, 'JUH ☀', 'rgba(255,140,20,1)');
  drawSideLabel(ctx, scene.westSide, 'ZÁPAD ☀', 'rgba(60,120,230,1)');

  // Furniture
  scene.furniture.forEach(f => {
    const fx = OX + mToP(f.x), fy = OY + mToP(f.y), fw = mToP(f.w), fh = mToP(f.h);
    if (f.sol) {
      ctx.fillStyle = 'rgba(70,58,45,.8)'; ctx.strokeStyle = 'rgba(50,40,30,.85)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(fx, fy, fw, fh, 4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = 'bold 11px DM Sans'; ctx.textAlign = 'center';
      ctx.fillText(f.l, fx + fw / 2, fy + fh / 2 + 4);
    } else {
      ctx.strokeStyle = 'rgba(80,60,40,.25)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.roundRect(fx, fy, fw, fh, 4); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.font = '11px DM Sans'; ctx.textAlign = 'center';
      ctx.fillText(f.l, fx + fw / 2, fy + fh / 2 + 4);
    }
  });

  // AC units
  scene.acUnits.forEach((u, i) => {
    const r = scene.rooms[u.ri];
    if (!r) return;
    drawAcUnit(ctx, OX + mToP(r.x), OY + mToP(r.y), mToP(r.w), mToP(r.h), u.wall, u.pos, String(i + 1));
  });

  ctx.restore();
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
    const isAir = sim.airMap[i];
    if (!isAir) { d[j + 3] = 0; continue; }
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
  // Room borders — draw as individual segments, skipping wall openings
  ctx.strokeStyle = '#222'; ctx.lineWidth = 2;
  scene.rooms.forEach(r => {
    const rx = OX + mToP(r.x), ry = OY + mToP(r.y), rw = mToP(r.w), rh = mToP(r.h);
    const walls = [
      [rx, ry, rx + rw, ry],
      [rx, ry + rh, rx + rw, ry + rh],
      [rx, ry, rx, ry + rh],
      [rx + rw, ry, rx + rw, ry + rh],
    ];
    walls.forEach(([x1, y1, x2, y2]) => {
      const segs = splitByOpenings(x1, y1, x2, y2);
      segs.forEach(([sx1, sy1, sx2, sy2]) => {
        ctx.beginPath(); ctx.moveTo(sx1, sy1); ctx.lineTo(sx2, sy2); ctx.stroke();
      });
    });
  });

  // Lines
  scene.lines.forEach(ln => {
    ctx.strokeStyle = '#222'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(OX + mToP(ln.x1), OY + mToP(ln.y1));
    ctx.lineTo(OX + mToP(ln.x2), OY + mToP(ln.y2));
    ctx.stroke();
  });

  // Doors
  scene.doors.forEach(d2 => {
    const p = getObjectPixels('door', d2);
    if (!p) return;
    ctx.strokeStyle = '#f7f6f2'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.stroke();
    ctx.strokeStyle = '#c07030'; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.stroke();
    ctx.setLineDash([]);
  });

  // Windows
  scene.windows.forEach(w => {
    const p = getObjectPixels('win', w);
    if (!p) return;
    const isSouth = scene.southSide && w.wall === scene.southSide;
    const isWest = scene.westSide && w.wall === scene.westSide;
    ctx.strokeStyle = isSouth ? 'rgba(255,180,30,.8)' : isWest ? 'rgba(80,140,255,.8)' : '#4090e0';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.stroke();
    if (isSouth || isWest) {
      ctx.fillStyle = isSouth ? 'rgba(255,180,30,.5)' : 'rgba(80,140,255,.5)';
      ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('☀',
        (p.x1 + p.x2) / 2 + (w.wall === 'right' ? 12 : w.wall === 'left' ? -12 : 0),
        (p.y1 + p.y2) / 2 + (w.wall === 'bottom' ? 14 : w.wall === 'top' ? -8 : 4));
    }
  });

  // Semi-solid furniture
  scene.furniture.forEach(f => {
    if (f.sol) return;
    const fx = OX + mToP(f.x), fy = OY + mToP(f.y), fw = mToP(f.w), fh = mToP(f.h);
    ctx.strokeStyle = 'rgba(80,60,40,.2)'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.roundRect(fx, fy, fw, fh, 3); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(0,0,0,.15)'; ctx.font = '10px DM Sans'; ctx.textAlign = 'center';
    ctx.fillText(f.l, fx + fw / 2, fy + fh / 2 + 3);
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
    const r = scene.rooms[u.ri];
    if (!r) return;
    const rx = OX + mToP(r.x), ry = OY + mToP(r.y), rw = mToP(r.w), rh = mToP(r.h);

    let ax, ay;
    if (u.wall === 'top') { ax = rx + u.pos * rw; ay = ry; }
    else if (u.wall === 'bottom') { ax = rx + u.pos * rw; ay = ry + rh; }
    else if (u.wall === 'left') { ax = rx; ay = ry + u.pos * rh; }
    else { ax = rx + rw; ay = ry + u.pos * rh; }

    const ba = u.wall === 'top' ? Math.PI / 2 : u.wall === 'bottom' ? -Math.PI / 2 : u.wall === 'left' ? 0 : Math.PI;
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

    drawAcUnit(ctx, rx, ry, rw, rh, u.wall, u.pos, String(ui + 1));
  });
}

function drawSimHUD(ctx, cpx) {
  // Dimensions label
  const bb = allBoundingBox();
  ctx.fillStyle = '#999'; ctx.font = '12px DM Sans'; ctx.textAlign = 'center';
  ctx.fillText(bb.w.toFixed(1) + ' × ' + bb.h.toFixed(1) + ' m', sim.renderX + sim.renderW / 2, sim.renderY - 8);

  // Progress bar
  const totalSeconds = (+dom.simLength.value) * 60;
  ctx.fillStyle = 'rgba(0,0,0,.07)'; ctx.fillRect(sim.renderX, sim.renderY + sim.renderH + 6, sim.renderW, 5);
  ctx.fillStyle = '#1D9E75'; ctx.fillRect(sim.renderX, sim.renderY + sim.renderH + 6, sim.renderW * Math.min(sim.elapsed / totalSeconds, 1), 5);

  // Cursor tooltip
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
  drawSimHUD(ctx, cpx);

  ctx.restore();
}
