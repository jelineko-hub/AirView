import { canvas, scene, view, editor, sim, dom, cacheDom, AC_MODELS } from './state.js';
import { drawEditor, drawSim, drawTempLabels } from './renderer.js';
import { initSim, emitParticles, updateParticles, updateGrid } from './simulation.js';
import { setupEditorEvents } from './editor.js';
import { autoSave, load, exportJSON, importJSON, saveToSlot, getSavedSlots, loadFromSlot, deleteSlot } from './storage.js';
import { setTool, switchToSim, switchToEditor, checkReady, syncZoomSlider } from './ui.js';
import { detectRooms, allBoundingBox, cropSimArea } from './utils.js';
import { generateReport } from './report.js';

// ── Initialize canvas ──

function initCanvas() {
  canvas.el = document.getElementById('c');
  canvas.ctx = canvas.el.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
  requestAnimationFrame(() => resize());
}

function resize() {
  const rect = canvas.el.getBoundingClientRect();
  const w = Math.round(rect.width), h = Math.round(rect.height);
  if (w < 10 || h < 10) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.el.width = Math.round(w * dpr);
  canvas.el.height = Math.round(h * dpr);
  canvas.width = w;
  canvas.height = h;
  canvas.ctx.scale(dpr, dpr);
}

// ── Wire up UI buttons ──

function initUI() {
  cacheDom();

  dom.toolBtns.forEach(b => {
    b.onclick = () => setTool(b.dataset.m);
  });

  dom.clearBtn.onclick = () => {
    if (!confirm('Ste si istí, že chcete celý pôdorys vymazať?')) return;
    scene.walls = []; scene.rooms = [];
    scene.windows = []; scene.furniture = [];
    scene.doors = []; scene.acUnits = [];
    scene.southSide = null; scene.westSide = null;
    setTool('room'); checkReady();
  };

  dom.saveBtn.onclick = saveToSlot;
  dom.loadBtn.onclick = openLoadDialog;
  if (dom.exportBtn) dom.exportBtn.onclick = exportJSON;
  if (dom.importFile) dom.importFile.onchange = (e) => { importJSON(e.target.files[0]); e.target.value = ''; };

  dom.simBtn.onclick = switchToSim;
  dom.editBtn.onclick = switchToEditor;

  dom.startBtn.onclick = function() {
    if (sim.done) return;
    sim.running = !sim.running;
    this.textContent = sim.running ? 'Pauza' : 'Štart';
  };

  dom.resetBtn.onclick = () => {
    sim.running = false;
    initSim();
  };

  dom.reportBtn.onclick = () => generateReport();

  dom.zoomSlider.oninput = function() {
    const nz = +this.value / 100;
    const cx = canvas.width / 2, cy = canvas.height / 2;
    view.x = cx - (cx - view.x) * (nz / view.zoom);
    view.y = cy - (cy - view.y) * (nz / view.zoom);
    view.zoom = nz;
    dom.zoomVal.textContent = nz.toFixed(1) + '×';
  };

  dom.edgeSoft.oninput = function() { dom.edgeSoftVal.textContent = (+this.value / 10).toFixed(1); };
  dom.diffusion.oninput = function() { dom.diffusionVal.textContent = (+this.value / 100).toFixed(1) + 'x'; };
  dom.sunGain.oninput = function() { dom.sunGainVal.textContent = this.value + '%'; };
  dom.spreadWidth.oninput = function() { dom.spreadWidthVal.textContent = this.value + '°'; };
  dom.direction.oninput = function() { dom.directionVal.textContent = this.value + '°'; };
  dom.targetMult.oninput = function() { dom.targetMultVal.textContent = (+this.value / 100).toFixed(1) + 'x'; };
}

// ── Snapshot capture ──

function captureSnapshot() {
  if (!sim.running || sim.elapsed === 0) return;
  const interval = (+dom.snapInterval.value) * 60; // seconds
  const nextSnapTime = (sim.lastSnapTime < 0) ? interval : sim.lastSnapTime + interval;
  if (sim.elapsed >= nextSnapTime) {
    const mins = Math.floor(sim.elapsed / 60);
    // Draw temp labels on canvas, capture cropped, then next frame redraws without them
    const ctx = canvas.ctx;
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.zoom, view.zoom);
    drawTempLabels(ctx);
    ctx.restore();
    sim.snapshots.push({
      time: sim.elapsed,
      mins,
      imgData: cropSimArea(),
    });
    sim.lastSnapTime = sim.elapsed;
  }
}

// ── Main loop ──

function loop() {
  const rect = canvas.el.getBoundingClientRect();
  const w = Math.round(rect.width), h = Math.round(rect.height);
  if (w > 10 && h > 10 && (w !== canvas.width || h !== canvas.height)) resize();

  if (editor.mode === 'editor') {
    drawEditor();
  } else {
    emitParticles();
    updateParticles();
    updateGrid();
    drawSim();
    captureSnapshot();
  }
  requestAnimationFrame(loop);
}

// ── Load dialog ──

function openLoadDialog() {
  const dialog = document.getElementById('loadDialog');
  const list = document.getElementById('loadList');
  const empty = document.getElementById('loadEmpty');
  const slots = getSavedSlots();

  list.innerHTML = '';
  if (slots.length === 0) {
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
    slots.forEach(s => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;background:#f8f7f4;border-radius:6px;cursor:pointer';
      row.onmouseenter = () => row.style.background = '#eef5ee';
      row.onmouseleave = () => row.style.background = '#f8f7f4';

      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0';
      const title = document.createElement('div');
      title.style.cssText = 'font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      title.textContent = s.name;
      const sub = document.createElement('div');
      sub.style.cssText = 'font-size:11px;color:#888';
      const parts = [];
      if (s.roomCount > 0) parts.push(s.roomCount + ' izieb');
      if (s.wallCount > 0) parts.push(s.wallCount + ' stien');
      if (s.acCount > 0) parts.push(s.acCount + ' klím');
      if (s.savedAt) {
        const d = new Date(s.savedAt);
        parts.push(d.toLocaleDateString('sk') + ' ' + d.toLocaleTimeString('sk', { hour: '2-digit', minute: '2-digit' }));
      }
      sub.textContent = parts.join(' · ');
      info.appendChild(title);
      info.appendChild(sub);

      const delBtn = document.createElement('button');
      delBtn.style.cssText = 'background:none;border:none;color:#c44;cursor:pointer;font-size:16px;padding:2px 6px;flex-shrink:0';
      delBtn.textContent = '×';
      delBtn.title = 'Vymazať';
      delBtn.onclick = (e) => {
        e.stopPropagation();
        if (confirm('Vymazať pôdorys "' + s.name + '"?')) {
          deleteSlot(s.name);
          openLoadDialog(); // refresh
        }
      };

      row.onclick = () => {
        loadFromSlot(s.name);
        dialog.style.display = 'none';
      };

      row.appendChild(info);
      row.appendChild(delBtn);
      list.appendChild(row);
    });
  }

  dialog.style.display = 'flex';
  document.getElementById('loadDialogClose').onclick = () => { dialog.style.display = 'none'; };
  dialog.onclick = (e) => { if (e.target === dialog) dialog.style.display = 'none'; };
}

// ── Boot ──

initCanvas();
initUI();
setupEditorEvents();
loop();
