import {
  FURNITURE_DEFS, scene, canvas, view, editor, pinch, dom,
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
    removeWallAndRefs(hit.wi);
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
      scene.acUnits.push({ wi: hit.wi, pos: hit.pos, model: 1, mode: 1, on: true });
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
