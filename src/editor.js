import {
  FURNITURE_DEFS, scene, canvas, view, editor, pinch, dom,
} from './state.js';
import { mToP, pToM, snapGrid, snapGrid2, wallAt, wallNear, isSharedWall, isInsideAnyRoom, getObjectPixels, allBoundingBox } from './utils.js';
import { autoSave } from './storage.js';
import { checkReady, setTool, syncZoomSlider } from './ui.js';

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
    const fx = 50 + mToP(f.x), fy = 36 + mToP(f.y);  // OX=50, OY=36
    if (mx > fx && mx < fx + mToP(f.w) && my > fy && my < fy + mToP(f.h)) {
      scene.furniture.splice(i, 1);
      dom.statusMsg.textContent = f.l + ' vymazaný';
      return true;
    }
  }
  // AC Units
  for (let i = scene.acUnits.length - 1; i >= 0; i--) {
    const u = scene.acUnits[i], r = scene.rooms[u.ri];
    if (!r) continue;
    const rx = 50 + mToP(r.x), ry = 36 + mToP(r.y), rw = mToP(r.w), rh = mToP(r.h);
    let ax, ay;
    if (u.wall === 'top') { ax = rx + u.pos * rw; ay = ry; }
    else if (u.wall === 'bottom') { ax = rx + u.pos * rw; ay = ry + rh; }
    else if (u.wall === 'left') { ax = rx; ay = ry + u.pos * rh; }
    else { ax = rx + rw; ay = ry + u.pos * rh; }
    if (Math.sqrt((mx - ax) ** 2 + (my - ay) ** 2) < 35) {
      scene.acUnits.splice(i, 1);
      dom.statusMsg.textContent = 'Klima #' + (i + 1) + ' vymazaná';
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

    if (editor.tool === 'room') {
      const wd = wallNear(mx, my, view.zoom);
      if (wd) {
        editor.wallDrag = { ri: wd.ri, wall: wd.wall, orig: { ...scene.rooms[wd.ri] } };
        return;
      }
      const mxM = snapGrid(pToM(mx - 50)), myM = snapGrid(pToM(my - 36));
      if (mxM >= 0 && myM >= 0) {
        editor.dragStart = { mx: mxM, my: myM };
        editor.isDragging = true;
        editor.dragEnd = { mx: mxM, my: myM };
      }
      return;
    }

    if (['couch', 'bed', 'ward', 'table'].includes(editor.tool)) {
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

    if (editor.wallDrag && editor.mode === 'editor') {
      const r = scene.rooms[editor.wallDrag.ri], o = editor.wallDrag.orig;
      const mxM = Math.max(0, snapGrid(pToM(editor.cursorX - 50)));
      const myM = Math.max(0, snapGrid(pToM(editor.cursorY - 36)));
      if (editor.wallDrag.wall === 'top') { const ny = Math.min(myM, o.y + o.h - .5); r.y = Math.max(0, ny); r.h = o.y + o.h - r.y; }
      else if (editor.wallDrag.wall === 'bottom') { r.h = Math.max(.5, myM - o.y); }
      else if (editor.wallDrag.wall === 'left') { const nx = Math.min(mxM, o.x + o.w - .5); r.x = Math.max(0, nx); r.w = o.x + o.w - r.x; }
      else { r.w = Math.max(.5, mxM - o.x); }
      return;
    }

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
        editor.dragFurnIndex = -1; editor.wallDrag = null;
        return;
      }
      const noAct = !editor.isDragging && !editor.wallDrag;
      editor.isDragging = false; editor.dragStart = null; editor.dragEnd = null;
      editor.dragFurnIndex = -1; editor.wallDrag = null;
      checkReady();
      if (scene.rooms.length) autoSave();
      if (noAct) cv.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: e.clientX, clientY: e.clientY }));
      return;
    }

    if (view.panActive) { view.panActive = false; return; }
    if (editor.wallDrag) { editor.wallDrag = null; autoSave(); return; }

    if (editor.isDragging && editor.mode === 'editor' && editor.dragStart && editor.dragEnd) {
      const w = Math.abs(editor.dragEnd.mx - editor.dragStart.mx);
      const h = Math.abs(editor.dragEnd.my - editor.dragStart.my);
      if (w >= .5 && h >= .5) {
        scene.rooms.push({
          x: Math.min(editor.dragStart.mx, editor.dragEnd.mx),
          y: Math.min(editor.dragStart.my, editor.dragEnd.my),
          w, h, temp: 26,
        });
        dom.statusMsg.textContent = 'Izba #' + scene.rooms.length + ' pridaná';
        editor.clickGuard = Date.now();
      }
    }

    editor.isDragging = false; editor.dragStart = null; editor.dragEnd = null;
    editor.dragFurnIndex = -1;
    checkReady();
    if (scene.rooms.length) autoSave();
  });

  // Click handler (tools) — dispatched per tool
  function handleRoomClick(mx, my) {
    for (let i = scene.rooms.length - 1; i >= 0; i--) {
      const r = scene.rooms[i];
      const rx = 50 + mToP(r.x), ry = 36 + mToP(r.y), rw = mToP(r.w), rh = mToP(r.h);
      if (mx > rx && mx < rx + rw && my > ry && my < ry + rh) {
        scene.windows = scene.windows.filter(w => w.ri !== i);
        scene.doors = scene.doors.filter(d => d.ri !== i);
        scene.acUnits = scene.acUnits.filter(u => u.ri !== i);
        scene.windows.forEach(w => { if (w.ri > i) w.ri--; });
        scene.doors.forEach(d => { if (d.ri > i) d.ri--; });
        scene.acUnits.forEach(u => { if (u.ri > i) u.ri--; });
        scene.rooms.splice(i, 1);
        dom.statusMsg.textContent = 'Izba vymazaná';
        checkReady(); autoSave();
        return;
      }
    }
  }

  function handleSolarClick(mx, my) {
    const bb = allBoundingBox();
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
    for (let i = scene.rooms.length - 1; i >= 0; i--) {
      const r = scene.rooms[i];
      const rx = 50 + mToP(r.x), ry = 36 + mToP(r.y), rw = mToP(r.w), rh = mToP(r.h);
      if (mx > rx && mx < rx + rw && my > ry && my < ry + rh) {
        const temps = [22, 24, 26, 28, 30, 32, 34];
        const ci = temps.indexOf(r.temp || 26);
        r.temp = temps[(ci + 1) % temps.length];
        dom.statusMsg.textContent = 'Izba #' + (i + 1) + ': ' + r.temp + '°C';
        autoSave();
        return;
      }
    }
  }

  function handleWallToolClick(mx, my) {
    const w = wallAt(mx, my);
    if (!w) return;
    if (editor.tool === 'win') {
      scene.windows.push({ ri: w.ri, wall: w.wall, pos: w.pos });
      dom.statusMsg.textContent = 'Okno pridané'; checkReady(); autoSave();
    } else if (editor.tool === 'door') {
      if (isSharedWall(w.ri, w.wall)) {
        scene.doors.push({ ri: w.ri, wall: w.wall, pos: w.pos });
        dom.statusMsg.textContent = 'Dvere pridané'; autoSave();
      } else {
        dom.statusMsg.textContent = 'Dvere len na steny medzi izbami!';
      }
    } else if (editor.tool === 'ac') {
      scene.acUnits.push({ ri: w.ri, wall: w.wall, pos: w.pos, model: 1, mode: 1, on: true });
      dom.statusMsg.textContent = 'Klima #' + scene.acUnits.length + ' umiestnená!';
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

    if (editor.tool !== 'room' && tryDeleteAt(mx, my)) { checkReady(); autoSave(); return; }

    if (editor.tool === 'room') { handleRoomClick(mx, my); return; }
    if (!scene.rooms.length) return;

    if (editor.tool === 'south' || editor.tool === 'west') { handleSolarClick(mx, my); return; }
    if (editor.tool === 'temp') { handleTempClick(mx, my); return; }
    if (editor.tool === 'win' || editor.tool === 'door' || editor.tool === 'ac') { handleWallToolClick(mx, my); return; }
    if (['couch', 'bed', 'ward', 'table'].includes(editor.tool)) { handleFurnitureClick(mx, my); }
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

  // Prevent Safari gesture events
  cv.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
  cv.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });

  cv.addEventListener('pointerleave', () => {
    editor.cursorX = -1; editor.cursorY = -1;
    view.panActive = false; editor.wallDrag = null;
  });
  cv.addEventListener('pointercancel', () => {
    view.panActive = false; pinch.active = false; editor.wallDrag = null;
  });
}
