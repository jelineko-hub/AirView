import { canvas, scene, view, editor, sim, dom, cacheDom } from './state.js';
import { drawEditor, drawSim } from './renderer.js';
import { initSim, emitParticles, updateParticles, updateGrid } from './simulation.js';
import { setupEditorEvents } from './editor.js';
import { autoSave, manualSave, load, exportJSON, importJSON } from './storage.js';
import { setTool, switchToSim, switchToEditor, checkReady, syncZoomSlider } from './ui.js';

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

  // Toolbar buttons
  dom.toolBtns.forEach(b => {
    b.onclick = () => setTool(b.dataset.m);
  });

  // Header buttons
  dom.clearBtn.onclick = () => {
    scene.rooms = []; scene.windows = []; scene.furniture = [];
    scene.doors = []; scene.acUnits = [];
    scene.southSide = null; scene.westSide = null;
    setTool('room'); checkReady();
  };

  dom.saveBtn.onclick = manualSave;
  dom.loadBtn.onclick = load;
  dom.exportBtn.onclick = exportJSON;
  dom.importFile.onchange = (e) => { importJSON(e.target.files[0]); e.target.value = ''; };

  dom.simBtn.onclick = switchToSim;
  dom.editBtn.onclick = switchToEditor;

  // Simulation controls
  dom.startBtn.onclick = function() {
    if (sim.done) return;
    sim.running = !sim.running;
    this.textContent = sim.running ? 'Pauza' : 'Štart';
  };

  dom.resetBtn.onclick = () => {
    sim.running = false;
    initSim();
  };

  // Zoom slider
  dom.zoomSlider.oninput = function() {
    const nz = +this.value / 100;
    const cx = canvas.width / 2, cy = canvas.height / 2;
    view.x = cx - (cx - view.x) * (nz / view.zoom);
    view.y = cy - (cy - view.y) * (nz / view.zoom);
    view.zoom = nz;
    dom.zoomVal.textContent = nz.toFixed(1) + '×';
  };

  // Tuning sliders
  dom.spreadWidth.oninput = function() { dom.spreadWidthVal.textContent = this.value + '°'; };
  dom.direction.oninput = function() { dom.directionVal.textContent = this.value + '°'; };
  dom.targetMult.oninput = function() { dom.targetMultVal.textContent = (+this.value / 100).toFixed(1) + 'x'; };
  dom.dampCouch.oninput = function() { dom.dampCouchVal.textContent = '.' + String(this.value).padStart(3, '0').slice(-3); };
  dom.dampBed.oninput = function() { dom.dampBedVal.textContent = '.' + String(this.value).padStart(3, '0').slice(-3); };
  dom.edgeSoft.oninput = function() { dom.edgeSoftVal.textContent = (+this.value / 10).toFixed(1); };
  dom.diffusion.oninput = function() { dom.diffusionVal.textContent = (+this.value / 100).toFixed(1) + 'x'; };
  dom.sunGain.oninput = function() { dom.sunGainVal.textContent = this.value + '%'; };
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
  }
  requestAnimationFrame(loop);
}

// ── Boot ──

initCanvas();
initUI();
setupEditorEvents();
loop();
