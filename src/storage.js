import { scene, dom } from './state.js';
import { checkReady } from './ui.js';
import { detectRooms } from './utils.js';

const LS_KEY = 'airview_v2';
const LS_KEY_V1 = 'airview_v1';

export function getState() {
  return {
    v: 2,
    walls: scene.walls,
    roomTemps: scene.rooms.map(r => ({ cx: r.cx, cy: r.cy, temp: r.temp })),
    wins: scene.windows,
    furns: scene.furniture,
    doors: scene.doors,
    acUnits: scene.acUnits,
    southSide: scene.southSide,
    westSide: scene.westSide,
    insul: dom.insulation.value,
    extS: dom.extSouth.value,
    extW: dom.extWest.value,
  };
}

export function applyState(s) {
  if (s.v === 2 || s.walls) {
    // V2 format
    scene.walls = s.walls || [];
    scene.windows = s.wins || [];
    scene.furniture = s.furns || [];
    scene.doors = s.doors || [];
    scene.acUnits = s.acUnits || [];
    scene.southSide = s.southSide || null;
    scene.westSide = s.westSide || null;
    if (s.insul) dom.insulation.value = s.insul;
    if (s.extS) dom.extSouth.value = s.extS;
    if (s.extW) dom.extWest.value = s.extW;
    detectRooms();
    // Restore room temperatures
    if (s.roomTemps) {
      s.roomTemps.forEach(rt => {
        const match = scene.rooms.find(r => Math.abs(r.cx - rt.cx) < 1 && Math.abs(r.cy - rt.cy) < 1);
        if (match) match.temp = rt.temp;
      });
    }
  } else {
    // V1 migration: convert rooms to walls
    scene.walls = [];
    scene.windows = [];
    scene.doors = [];
    scene.acUnits = [];
    const rooms = s.rooms || [];
    rooms.forEach((r, ri) => {
      const x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y + r.h;
      const baseWi = scene.walls.length;
      scene.walls.push({ x1, y1: y1, x2, y2: y1 }); // top
      scene.walls.push({ x1, y1: y2, x2, y2: y2 }); // bottom
      scene.walls.push({ x1, y1, x2: x1, y2 }); // left
      scene.walls.push({ x1: x2, y1, x2, y2 }); // right

      // Migrate windows
      const wallMap = { top: baseWi, bottom: baseWi + 1, left: baseWi + 2, right: baseWi + 3 };
      (s.wins || []).filter(w => w.ri === ri).forEach(w => {
        scene.windows.push({ wi: wallMap[w.wall], pos: w.pos });
      });
      (s.doors || []).filter(d => d.ri === ri).forEach(d => {
        scene.doors.push({ wi: wallMap[d.wall], pos: d.pos });
      });
      (s.acUnits || []).filter(u => u.ri === ri).forEach(u => {
        scene.acUnits.push({ wi: wallMap[u.wall], pos: u.pos, model: u.model, mode: u.mode, on: u.on });
      });
    });
    scene.furniture = s.furns || [];
    scene.southSide = s.southSide || null;
    scene.westSide = s.westSide || null;
    if (s.insul) dom.insulation.value = s.insul;
    if (s.extS) dom.extSouth.value = s.extS;
    if (s.extW) dom.extWest.value = s.extW;
    detectRooms();
    // Restore temperatures from old rooms
    rooms.forEach(r => {
      const match = scene.rooms.find(dr => Math.abs(dr.cx - (r.x + r.w / 2)) < 1 && Math.abs(dr.cy - (r.y + r.h / 2)) < 1);
      if (match) match.temp = r.temp;
    });
  }
  checkReady();
}

export function autoSave() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(getState())); } catch (e) { /* ignore */ }
}

export function manualSave() {
  autoSave();
  dom.statusMsg.textContent = 'Uložené ✓';
}

export function load() {
  let data = localStorage.getItem(LS_KEY);
  if (!data) data = localStorage.getItem(LS_KEY_V1); // try v1
  if (!data) { dom.statusMsg.textContent = 'Nič uložené'; return; }
  try {
    applyState(JSON.parse(data));
    dom.statusMsg.textContent = 'Načítané ✓';
  } catch (e) {
    dom.statusMsg.textContent = 'Chyba: poškodené dáta';
  }
}

export function exportJSON() {
  const a = document.createElement('a');
  a.href = 'data:application/json,' + encodeURIComponent(JSON.stringify(getState(), null, 2));
  a.download = 'acdone-podorys.json';
  a.click();
  dom.statusMsg.textContent = 'Exportované ✓';
}

export function importJSON(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      applyState(JSON.parse(ev.target.result));
      dom.statusMsg.textContent = 'Importované ✓';
    } catch (e) {
      dom.statusMsg.textContent = 'Chyba: neplatný súbor';
    }
  };
  reader.readAsText(file);
}
