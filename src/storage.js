import { scene, dom } from './state.js';
import { checkReady } from './ui.js';

const LS_KEY = 'airview_v1';

export function getState() {
  return {
    rooms: scene.rooms,
    wins: scene.windows,
    furns: scene.furniture,
    doors: scene.doors,
    lines: scene.lines,
    wallOpenings: scene.wallOpenings,
    acUnits: scene.acUnits,
    southSide: scene.southSide,
    westSide: scene.westSide,
    insul: dom.insulation.value,
    extS: dom.extSouth.value,
    extW: dom.extWest.value,
  };
}

export function applyState(s) {
  scene.rooms = s.rooms || [];
  scene.windows = s.wins || [];
  scene.furniture = s.furns || [];
  scene.doors = s.doors || [];
  scene.lines = s.lines || [];
  scene.wallOpenings = s.wallOpenings || [];
  scene.acUnits = s.acUnits || [];
  scene.southSide = s.southSide || null;
  scene.westSide = s.westSide || null;
  if (s.insul) dom.insulation.value = s.insul;
  if (s.extS) dom.extSouth.value = s.extS;
  if (s.extW) dom.extWest.value = s.extW;
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
  const data = localStorage.getItem(LS_KEY);
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
  a.download = 'airview-podorys.json';
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
