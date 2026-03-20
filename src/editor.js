import {
  FURNITURE_DEFS, scene, canvas, view, editor, pinch, dom, OX, OY,
} from './state.js';
import { mToP, pToM, snapGrid, snapGrid2, wallAtPixel, detectRooms, isInsideAnyRoom, getObjectPixels, allBoundingBox, roomAtMeter } from './utils.js';

import { autoSave } from './storage.js';
import { checkReady, setTool, syncZoomSlider } from './ui.js';

// ── Helpers ──

function addWall(x1, y1, x2, y2) {
  scene.walls.push({ x1, y1, x2, y2 });
}

function removeWallAndRefs(wi) {
  // Remove objects referencing this wall
  scene.windows = scene.windows.filter(o => o.wi !== wi);
  scene.doors = scene.doors.filter(o => o.wi !== wi);
  scene.acUnits = scene.acUnits.filter(o => o.wi !== wi);
  // Adjust indices for objects on walls after the removed one
  scene.windows.forEach(o => { if (o.wi > wi) o.wi--; });
  scene.doors.forEach(o => { if (o.wi > wi) o.wi--; });
  scene.acUnits.forEach(o => { if (o.wi > wi) o.wi--; });
  scene.walls.splice(wi, 1);
}

function afterWallChange() {
  detectRooms();
  checkReady();
  autoSave();
}

// ── Delete object at click position ──

function tryDeleteAt(mx, my) {
  // Windows
  for (let i = scene.windows.length - 1; i >= 0; i--) {
    const p = getObjectPixels('win', scene.windows[i]);
    if (!p) continue;
    if (Math.sqrt((mx - (p.x1 + p.x2) / 2) ** 2 + (my - (p.y1 + p.y2) / 2) ** 2) < 30) {
      scene.windows.splice(i, 1);
      dom.statusMsg.textContent = 'Okno vymazané';
      return true;
    }
  }
  // Doors
  for (let i = scene.doors.length - 1; i >= 0; i--) {
    const p = getObjectPixels('door', scene.doors[i]);
    if (!p) continue;
    if (Math.sqrt((mx - (p.x1 + p.x2) / 2) ** 2 + (my - (p.y1 + p.y2) / 2) ** 2) < 30) {
      scene.doors.splice(i, 1);
      dom.statusMsg.textContent = 'Dvere vymazané';
      return true;
    }
  }
  // Furniture
  for (let i = scene.furniture.length - 1; i >= 0; i--) {
    const f = scene.furniture[i];
    const fx = 50 + mToP(f.x), fy = 36 + mToP(f.y);
    if (mx > fx && mx < fx + mToP(f.w) && my > fy && my < fy + mToP(f.h)) {
      scene.furniture.splice(i, 1);
      dom.statusMsg.textContent = f.l + ' vymazaný';
      return true;
    }
  }
  // AC Units
  for (let i = scene.acUnits.length - 1; i >= 0; i--) {
    const u = scene.acUnits[i];
    const w = scene.walls[u.wi];
    if (!w) continue;
    const p = getObjectPixels('ac', u);
    if (!p) continue;
    const ax = (p.x1 + p.x2) / 2, ay = (p.y1 + p.y2) / 2;
    if (Math.sqrt((mx - ax) ** 2 + (my - ay) ** 2) < 35) {
      scene.acUnits.splice(i, 1);
      dom.statusMsg.textContent = 'Klima vymazaná';
      checkReady();
      return true;
    }
  }
  return false;
}

// ── Setup all canvas event listeners ──

export function setupEditorEvents() {
  const cv = canvas.el;

  // Pinch zoom (touch)
  cv.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (e.touches.length >= 2) {
      view.panActive = false;
      pinch.active = true;
      pinch.wasPinch = true;
      const t = e.touches;
      pinch.startDist = Math.hypot(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY);
      const mx = (t[0].clientX + t[1].clientX) / 2, my = (t[0].clientY + t[1].clientY) / 2;
      const rc = cv.getBoundingClientRect();
      pinch.centerX = (mx - rc.left) * (canvas.width / rc.width);
      pinch.centerY = (my - rc.top) * (canvas.height / rc.height);
      pinch.viewX = view.x;
      pinch.viewY = view.y;
      pinch.startZoom = view.zoom;
    }
  }, { passive: false });

  cv.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (pinch.active && e.touches.length >= 2) {
      const t = e.touches;
      const nd = Math.hypot(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY);
      const dz = nd / pinch.startDist;
      const nz = Math.max(.3, Math.min(4, pinch.startZoom * dz));
      const adz = nz / pinch.startZoom;
      const mx = (t[0].clientX + t[1].clientX) / 2, my = (t[0].clientY + t[1].clientY) / 2;
      const rc = cv.getBoundingClientRect();
      const sx = (mx - rc.left) * (canvas.width / rc.width);
      const sy = (my - rc.top) * (canvas.height / rc.height);
      view.zoom = nz;
      view.x = sx - (pinch.centerX - pinch.viewX) * adz;
      view.y = sy - (pinch.centerY - pinch.viewY) * adz;
      syncZoomSlider();
    }
  }, { passive: false });

  cv.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) pinch.active = false;
    if (e.touches.length === 0) setTimeout(() => { pinch.wasPinch = false; }, 100);
  }, { passive: false });

  // Pointer events
  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);

    if (e.pointerType === 'touch') {
      if (pinch.active) return;
      if (!view.panActive) {
        view.panActive = true;
        view.panStartX = e.clientX; view.panStartY = e.clientY;
        view.panViewX = view.x; view.panViewY = view.y;
      }
      return;
    }

    if (e.button === 1) {
      view.panActive = true;
      view.panStartX = e.clientX; view.panStartY = e.clientY;
      view.panViewX = view.x; view.panViewY = view.y;
      return;
    }

    if (editor.mode !== 'editor') return;

    const rc = cv.getBoundingClientRect();
    const mx = ((e.clientX - rc.left) * (canvas.width / rc.width) - view.x) / view.zoom;
    const my = ((e.clientY - rc.top) * (canvas.height / rc.height) - view.y) / view.zoom;

    // Room tool: drag to create 4 walls (rectangle)
    if (editor.tool === 'room') {
      const mxM = snapGrid(pToM(mx - 50)), myM = snapGrid(pToM(my - 36));
      if (mxM >= 0 && myM >= 0) {
        editor.dragStart = { mx: mxM, my: myM };
        editor.isDragging = true;
        editor.dragEnd = { mx: mxM, my: myM };
      }
      return;
    }

    // Wall tool: drag to create 1 wall segment
    if (editor.tool === 'wall') {
      const mxM = snapGrid(pToM(mx - 50)), myM = snapGrid(pToM(my - 36));
      if (mxM >= 0 && myM >= 0) {
        editor.dragStart = { mx: mxM, my: myM };
        editor.isDragging = true;
        editor.dragEnd = { mx: mxM, my: myM };
      }
      return;
    }

    // Furniture drag
    if (editor.tool === 'ward') {
      for (let i = scene.furniture.length - 1; i >= 0; i--) {
        const f = scene.furniture[i];
        const fx = 50 + mToP(f.x), fy = 36 + mToP(f.y);
        if (mx > fx && mx < fx + mToP(f.w) && my > fy && my < fy + mToP(f.h)) {
          editor.dragFurnIndex = i;
          editor.dragOffset = { x: mx - fx, y: my - fy };
          return;
        }
      }
    }
  });

  cv.addEventListener('pointermove', (e) => {
    e.preventDefault();
    if (e.pointerType === 'touch' && pinch.active) return;

    if (view.panActive) {
      view.x = view.panViewX + (e.clientX - view.panStartX);
      view.y = view.panViewY + (e.clientY - view.panStartY);
      return;
    }

    const rc = cv.getBoundingClientRect();
    editor.cursorX = ((e.clientX - rc.left) * (canvas.width / rc.width) - view.x) / view.zoom;
    editor.cursorY = ((e.clientY - rc.top) * (canvas.height / rc.height) - view.y) / view.zoom;

    if (editor.isDragging && editor.mode === 'editor') {
      editor.dragEnd = {
        mx: Math.max(0, snapGrid(pToM(editor.cursorX - 50))),
        my: Math.max(0, snapGrid(pToM(editor.cursorY - 36))),
      };
    }

    if (editor.dragFurnIndex >= 0 && editor.mode === 'editor') {
      scene.furniture[editor.dragFurnIndex].x = snapGrid2(pToM(editor.cursorX - editor.dragOffset.x - 50));
      scene.furniture[editor.dragFurnIndex].y = snapGrid2(pToM(editor.cursorY - editor.dragOffset.y - 36));
    }
  });

  cv.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'touch') {
      view.panActive = false;
      if (pinch.wasPinch) {
        editor.isDragging = false; editor.dragStart = null; editor.dragEnd = null;
        editor.dragFurnIndex = -1;
        return;
      }
      const noAct = !editor.isDragging;
      editor.isDragging = false; editor.dragStart = null; editor.dragEnd = null;
      editor.dragFurnIndex = -1;
      if (scene.walls.length) autoSave();
      if (noAct) cv.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: e.clientX, clientY: e.clientY }));
      return;
    }

    if (view.panActive) { view.panActive = false; return; }

    if (editor.isDragging && editor.mode === 'editor' && editor.dragStart && editor.dragEnd) {
      const s = editor.dragStart, en = editor.dragEnd;

      if (editor.tool === 'room') {
        // Create 4 walls forming a rectangle
        const w = Math.abs(en.mx - s.mx), h = Math.abs(en.my - s.my);
        if (w >= .5 && h >= .5) {
          const x1 = Math.min(s.mx, en.mx), y1 = Math.min(s.my, en.my);
          const x2 = x1 + w, y2 = y1 + h;
          addWall(x1, y1, x2, y1); // top
          addWall(x1, y2, x2, y2); // bottom
          addWall(x1, y1, x1, y2); // left
          addWall(x2, y1, x2, y2); // right
          dom.statusMsg.textContent = 'Obdĺžnik pridaný (' + w.toFixed(1) + ' × ' + h.toFixed(1) + ' m)';
          editor.clickGuard = Date.now();
          afterWallChange();
        }
      } else if (editor.tool === 'wall') {
        // Create 1 wall segment (constrain to H or V)
        const dx = Math.abs(en.mx - s.mx), dy = Math.abs(en.my - s.my);
        if (dx >= 0.2 || dy >= 0.2) {
          let ex, ey;
          if (dx >= dy) { ex = en.mx; ey = s.my; }
          else { ex = s.mx; ey = en.my; }
          addWall(s.mx, s.my, ex, ey);
          const len = Math.sqrt((ex - s.mx) ** 2 + (ey - s.my) ** 2);
          dom.statusMsg.textContent = 'Stena pridaná (' + len.toFixed(1) + ' m)';
          editor.clickGuard = Date.now();
          afterWallChange();
        }
      }
    }

    editor.isDragging = false; editor.dragStart = null; editor.dragEnd = null;
    editor.dragFurnIndex = -1;
  });

  // Click handler (tools)
  function handleDeleteWallClick(mx, my) {
    const hit = wallAtPixel(mx, my);
    if (!hit) { dom.statusMsg.textContent = 'Klikni na stenu'; return; }

    const w = scene.walls[hit.wi];
    const isH = Math.abs(w.y1 - w.y2) < 0.001;
    const wFixed = isH ? w.y1 : w.x1;
    const wMin = isH ? Math.min(w.x1, w.x2) : Math.min(w.y1, w.y2);
    const wMax = isH ? Math.max(w.x1, w.x2) : Math.max(w.y1, w.y2);
    const clickAlong = wMin + hit.pos * (wMax - wMin);

    // 1. Find T-junction split points: perpendicular walls intersecting clicked wall
    const splits = [wMin, wMax];
    for (let i = 0; i < scene.walls.length; i++) {
      if (i === hit.wi) continue;
      const w2 = scene.walls[i];
      const isH2 = Math.abs(w2.y1 - w2.y2) < 0.001;
      if (isH === isH2) continue; // skip parallel walls
      if (isH) {
        // Clicked wall horizontal (fixed y). w2 is vertical at x=w2.x1
        const w2x = w2.x1;
        const w2yMin = Math.min(w2.y1, w2.y2), w2yMax = Math.max(w2.y1, w2.y2);
        if (w2x > wMin + 0.01 && w2x < wMax - 0.01 &&
            wFixed >= w2yMin - 0.05 && wFixed <= w2yMax + 0.05) {
          splits.push(w2x);
        }
      } else {
        // Clicked wall vertical (fixed x). w2 is horizontal at y=w2.y1
        const w2y = w2.y1;
        const w2xMin = Math.min(w2.x1, w2.x2), w2xMax = Math.max(w2.x1, w2.x2);
        if (w2y > wMin + 0.01 && w2y < wMax - 0.01 &&
            wFixed >= w2xMin - 0.05 && wFixed <= w2xMax + 0.05) {
          splits.push(w2y);
        }
      }
    }
    splits.sort((a, b) => a - b);
    // Deduplicate
    const uniqSplits = [splits[0]];
    for (let i = 1; i < splits.length; i++) {
      if (splits[i] - uniqSplits[uniqSplits.length - 1] > 0.01) uniqSplits.push(splits[i]);
    }

    // 2. Find which segment was clicked
    let segMin = wMin, segMax = wMax;
    if (uniqSplits.length > 2) {
      for (let i = 0; i < uniqSplits.length - 1; i++) {
        if (clickAlong >= uniqSplits[i] - 0.01 && clickAlong <= uniqSplits[i + 1] + 0.01) {
          segMin = uniqSplits[i];
          segMax = uniqSplits[i + 1];
          break;
        }
      }
    }

    // 3. Also find collinear overlapping walls in the segment zone
    const collinear = [];
    for (let i = 0; i < scene.walls.length; i++) {
      if (i === hit.wi) continue;
      const w2 = scene.walls[i];
      const isH2 = Math.abs(w2.y1 - w2.y2) < 0.001;
      if (isH !== isH2) continue;
      const f2 = isH2 ? w2.y1 : w2.x1;
      if (Math.abs(f2 - wFixed) > 0.01) continue;
      const min2 = isH2 ? Math.min(w2.x1, w2.x2) : Math.min(w2.y1, w2.y2);
      const max2 = isH2 ? Math.max(w2.x1, w2.x2) : Math.max(w2.y1, w2.y2);
      if (min2 < segMax - 0.01 && max2 > segMin + 0.01) {
        collinear.push({ idx: i, min: min2, max: max2 });
      }
    }

    // 4. Compute delete zone: segment, narrowed by overlap if collinear walls exist
    let delMin = segMin, delMax = segMax;
    if (collinear.length > 0) {
      collinear.forEach(c => { delMin = Math.max(delMin, c.min); delMax = Math.min(delMax, c.max); });
    }

    // 5. Remove clicked wall, replace with remaining segments
    // Remove objects in the delete zone
    [scene.windows, scene.doors, scene.acUnits].forEach(arr => {
      for (let j = arr.length - 1; j >= 0; j--) {
        if (arr[j].wi !== hit.wi) continue;
        const absPos = wMin + arr[j].pos * (wMax - wMin);
        if (absPos > delMin - 0.01 && absPos < delMax + 0.01) arr.splice(j, 1);
      }
    });
    scene.walls.splice(hit.wi, 1);
    [scene.windows, scene.doors, scene.acUnits].forEach(arr => {
      arr.forEach(o => { if (o.wi > hit.wi) o.wi--; });
    });

    // Add remaining segments of the clicked wall
    const keepSegments = [];
    if (wMin < delMin - 0.05) keepSegments.push([wMin, delMin]);
    if (wMax > delMax + 0.05) keepSegments.push([delMax, wMax]);
    keepSegments.forEach(([a, b]) => {
      if (isH) scene.walls.push({ x1: a, y1: wFixed, x2: b, y2: wFixed });
      else scene.walls.push({ x1: wFixed, y1: a, x2: wFixed, y2: b });
    });

    // 6. Also remove overlapping collinear walls' overlap portions
    if (collinear.length > 0) {
      // Adjust indices after removing hit.wi
      collinear.forEach(c => { if (c.idx > hit.wi) c.idx--; });
      collinear.sort((a, b) => b.idx - a.idx);
      collinear.forEach(c => {
        [scene.windows, scene.doors, scene.acUnits].forEach(arr => {
          for (let j = arr.length - 1; j >= 0; j--) {
            if (arr[j].wi !== c.idx) continue;
            const absPos = c.min + arr[j].pos * (c.max - c.min);
            if (absPos > delMin - 0.01 && absPos < delMax + 0.01) arr.splice(j, 1);
          }
        });
        scene.walls.splice(c.idx, 1);
        [scene.windows, scene.doors, scene.acUnits].forEach(arr => {
          arr.forEach(o => { if (o.wi > c.idx) o.wi--; });
        });
        collinear.forEach(c2 => { if (c2.idx > c.idx) c2.idx--; });
        if (c.min < delMin - 0.05) {
          if (isH) scene.walls.push({ x1: c.min, y1: wFixed, x2: delMin, y2: wFixed });
          else scene.walls.push({ x1: wFixed, y1: c.min, x2: wFixed, y2: delMin });
        }
        if (c.max > delMax + 0.05) {
          if (isH) scene.walls.push({ x1: delMax, y1: wFixed, x2: c.max, y2: wFixed });
          else scene.walls.push({ x1: wFixed, y1: delMax, x2: wFixed, y2: c.max });
        }
      });
    }

    dom.statusMsg.textContent = 'Stena vymazaná';
    afterWallChange();
  }

  function handleSolarClick(mx, my) {
    const bb = allBoundingBox();
    if (!bb) return;
    const bx = 50 + mToP(bb.x), by = 36 + mToP(bb.y), bw = mToP(bb.w), bh = mToP(bb.h);
    const cx2 = bx + bw / 2, cy2 = by + bh / 2, dx2 = mx - cx2, dy2 = my - cy2;
    let side;
    if (Math.abs(dx2) > Math.abs(dy2)) side = dx2 < 0 ? 'left' : 'right';
    else side = dy2 < 0 ? 'top' : 'bottom';

    const names = { top: 'hore', bottom: 'dole', left: 'vľavo', right: 'vpravo' };
    if (editor.tool === 'south') {
      if (side === scene.westSide) { dom.statusMsg.textContent = 'Táto strana je už Západ!'; return; }
      scene.southSide = scene.southSide === side ? null : side;
      dom.statusMsg.textContent = scene.southSide ? 'Juh ☀ = ' + names[side] : 'Juh zrušený';
    } else {
      if (side === scene.southSide) { dom.statusMsg.textContent = 'Táto strana je už Juh!'; return; }
      scene.westSide = scene.westSide === side ? null : side;
      dom.statusMsg.textContent = scene.westSide ? 'Západ ☀ = ' + names[side] : 'Západ zrušený';
    }
    autoSave();
  }

  function handleTempClick(mx, my) {
    const mxM = pToM(mx - 50), myM = pToM(my - 36);
    const ri = roomAtMeter(mxM, myM);
    if (ri < 0) return;
    const r = scene.rooms[ri];
    const temps = [22, 24, 26, 28, 30, 32, 34];
    const ci = temps.indexOf(r.temp || 26);
    r.temp = temps[(ci + 1) % temps.length];
    dom.statusMsg.textContent = 'Izba: ' + r.temp + '°C';
    autoSave();
  }

  function handleWallToolClick(mx, my) {
    const hit = wallAtPixel(mx, my);
    if (!hit) return;
    if (editor.tool === 'win') {
      scene.windows.push({ wi: hit.wi, pos: hit.pos });
      dom.statusMsg.textContent = 'Okno pridané';
      checkReady(); autoSave();
    } else if (editor.tool === 'door') {
      scene.doors.push({ wi: hit.wi, pos: hit.pos });
      dom.statusMsg.textContent = 'Dvere pridané';
      detectRooms(); autoSave();
    } else if (editor.tool === 'ac') {
      // Determine which side of the wall to place AC — must be inside a room
      const w = scene.walls[hit.wi];
      const isH = Math.abs(w.y1 - w.y2) < 0.001;
      // Wall position along the wall at the click point (in meters)
      const posM = isH
        ? { x: w.x1 + hit.pos * (w.x2 - w.x1), y: w.y1 }
        : { x: w.x1, y: w.y1 + hit.pos * (w.y2 - w.y1) };
      // Check which side has a room (probe 0.15m into each side)
      const probe = 0.15;
      let sideA, sideB;
      if (isH) {
        sideA = roomAtMeter(posM.x, posM.y - probe); // above = side -1
        sideB = roomAtMeter(posM.x, posM.y + probe); // below = side +1
      } else {
        sideA = roomAtMeter(posM.x - probe, posM.y); // left = side -1
        sideB = roomAtMeter(posM.x + probe, posM.y); // right = side +1
      }
      let side;
      if (sideA >= 0 && sideB >= 0) {
        // Both sides are rooms — use click position to decide
        const wallPx = isH ? (OY + mToP(w.y1)) : (OX + mToP(w.x1));
        const clickPx = isH ? my : mx;
        side = clickPx > wallPx ? 1 : -1;
      } else if (sideB >= 0) {
        side = 1;  // only below/right is a room
      } else if (sideA >= 0) {
        side = -1; // only above/left is a room
      } else {
        dom.statusMsg.textContent = 'Klima musí byť na stene izby!';
        return;
      }
      scene.acUnits.push({ wi: hit.wi, pos: hit.pos, side, model: 1, mode: 1, on: true });
      dom.statusMsg.textContent = 'Klima umiestnená!';
      checkReady(); autoSave();
    }
  }

  function handleFurnitureClick(mx, my) {
    if (!isInsideAnyRoom(mx, my)) return;
    const fd = FURNITURE_DEFS[editor.tool];
    scene.furniture.push({
      x: snapGrid2(pToM(mx - 50) - fd.w / 2),
      y: snapGrid2(pToM(my - 36) - fd.h / 2),
      w: fd.w, h: fd.h, l: fd.label, d: fd.damping, sol: fd.solid,
    });
    dom.statusMsg.textContent = fd.label + ' pridaný';
    autoSave();
  }

  cv.addEventListener('click', (e) => {
    const rc = cv.getBoundingClientRect();
    const mx = ((e.clientX - rc.left) * (canvas.width / rc.width) - view.x) / view.zoom;
    const my = ((e.clientY - rc.top) * (canvas.height / rc.height) - view.y) / view.zoom;

    if (editor.mode !== 'editor') return;
    if (Date.now() - editor.clickGuard < 250) return;

    if (editor.tool === 'delwall') { handleDeleteWallClick(mx, my); return; }

    if (!['room', 'wall', 'delwall'].includes(editor.tool) && tryDeleteAt(mx, my)) { checkReady(); autoSave(); return; }

    if (!scene.walls.length) return;

    if (editor.tool === 'south' || editor.tool === 'west') { handleSolarClick(mx, my); return; }
    if (editor.tool === 'temp') { handleTempClick(mx, my); return; }
    if (editor.tool === 'win' || editor.tool === 'door' || editor.tool === 'ac') { handleWallToolClick(mx, my); return; }
    if (editor.tool === 'ward') { handleFurnitureClick(mx, my); }
  });

  // Wheel zoom
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const dz = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const rc = cv.getBoundingClientRect();
    const sx = (e.clientX - rc.left) * (canvas.width / rc.width);
    const sy = (e.clientY - rc.top) * (canvas.height / rc.height);
    view.x = sx - (sx - view.x) * dz;
    view.y = sy - (sy - view.y) * dz;
    view.zoom = Math.max(.3, Math.min(4, view.zoom * dz));
    syncZoomSlider();
  }, { passive: false });

  cv.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
  cv.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });

  cv.addEventListener('pointerleave', () => {
    editor.cursorX = -1; editor.cursorY = -1;
    view.panActive = false;
  });
  cv.addEventListener('pointercancel', () => {
    view.panActive = false; pinch.active = false;
  });
}
