// ── Constants ──
export const PPM = 80;        // pixels per meter
export const GRID = 0.1;      // grid snap in meters
export const OX = 50;         // canvas origin X offset
export const OY = 36;         // canvas origin Y offset
export const MAX_PARTICLES = 3000;

export const FURNITURE_DEFS = {
  couch: { w: 1.6, h: 0.6, label: 'Gauč',    damping: 0.99,  solid: false },
  bed:   { w: 1.4, h: 1.9, label: 'Posteľ',  damping: 0.995, solid: false },
  ward:  { w: 0.6, h: 1.6, label: 'Skriňa',  damping: 1,     solid: true  },
  table: { w: 0.8, h: 0.5, label: 'Stôl',    damping: 0.995, solid: false },
};

export const AC_MODELS = [
  { name: '2.5kW', width: 77, thrust: 4,   cool: 0.018 },
  { name: '3.5kW', width: 80, thrust: 5.5, cool: 0.025 },
  { name: '5.0kW', width: 90, thrust: 8.4, cool: 0.035 },
];

// ── Canvas state ──
export const canvas = {
  el: null,   // <canvas> element
  ctx: null,  // 2d context
  width: 0,
  height: 0,
};

// ── Scene data ──
export const scene = {
  rooms: [],
  windows: [],
  furniture: [],
  acUnits: [],
  doors: [],
  southSide: null,
  westSide: null,
};

// ── View state (pan, zoom) ──
export const view = {
  x: 0,
  y: 0,
  zoom: 1,
  panActive: false,
  panStartX: 0,
  panStartY: 0,
  panViewX: 0,
  panViewY: 0,
};

// ── Pinch zoom state ──
export const pinch = {
  active: false,
  startDist: 0,
  centerX: 0,
  centerY: 0,
  viewX: 0,
  viewY: 0,
  startZoom: 1,
  wasPinch: false,
};

// ── Editor interaction state ──
export const editor = {
  mode: 'editor',  // 'editor' | 'sim'
  tool: 'room',
  dragStart: null,
  dragEnd: null,
  isDragging: false,
  dragFurnIndex: -1,
  dragOffset: { x: 0, y: 0 },
  cursorX: -1,
  cursorY: -1,
  clickGuard: 0,
  wallDrag: null,
};

// ── Simulation state ──
export const sim = {
  cellSize: 0.1,
  tempGrid: null,       // Float32Array — current temperatures
  tempBuffer: null,     // Float32Array — temp buffer for diffusion
  gridW: 0,
  gridH: 0,
  externalTemp: null,   // Float32Array — external heat source temperatures
  externalCoeff: null,  // Float32Array — external heat coefficients
  airMap: null,         // Uint8Array — 1 if cell is air
  furnitureSolid: null, // Uint8Array — 1 if cell is solid furniture
  furnitureEdge: null,  // Float32Array — furniture edge proximity
  wallH: null,          // Uint8Array — horizontal wall between cells
  wallV: null,          // Uint8Array — vertical wall between cells
  unitPower: [],        // per-unit power output (0..1+)
  unitRoomTemp: [],     // per-unit smoothed room temperature
  unitOutTemp: [],      // per-unit output temperature
  renderX: 0,
  renderY: 0,
  renderW: 0,
  renderH: 0,
  bboxX: 0,
  bboxY: 0,
  offscreen: null,      // offscreen canvas for heatmap
  running: false,
  elapsed: 0,           // seconds elapsed
  done: false,
};

// ── Particle pool ──
export const particles = new Array(MAX_PARTICLES);
for (let i = 0; i < MAX_PARTICLES; i++) {
  particles[i] = { x: 0, y: 0, vx: 0, vy: 0, age: 0, maxAge: 1, on: false, unitIndex: -1 };
}
export let particleHead = 0;
export function getAndAdvanceParticleHead() {
  const idx = particleHead;
  particleHead = (particleHead + 1) % MAX_PARTICLES;
  return idx;
}

// ── Cached DOM references ──
export const dom = {
  unitTemp: [],   // per-unit <span> for room temperature
  unitInfo: [],   // per-unit <span> for power/output info
  toolBtns: [],   // editor toolbar buttons
};

export function cacheDom() {
  dom.modeLabel = document.getElementById('modeLabel');
  dom.statusMsg = document.getElementById('statusMsg');
  dom.zoomSlider = document.getElementById('zoomSlider');
  dom.zoomVal = document.getElementById('zoomVal');
  dom.simBtn = document.getElementById('simBtn');
  dom.editBtn = document.getElementById('editBtn');
  dom.clearBtn = document.getElementById('clearBtn');
  dom.saveBtn = document.getElementById('saveBtn');
  dom.loadBtn = document.getElementById('loadBtn');
  dom.exportBtn = document.getElementById('exportBtn');
  dom.importFile = document.getElementById('importFile');
  dom.edToolbar = document.getElementById('edToolbar');
  dom.simToolbar = document.getElementById('simToolbar');
  dom.tuneRow = document.getElementById('tuneRow');
  dom.unitCards = document.getElementById('unitCards');
  dom.infoBar = document.getElementById('infoBar');
  dom.simLeg = document.getElementById('simLeg');
  dom.clock = document.getElementById('ck');
  dom.startBtn = document.getElementById('sB');
  dom.resetBtn = document.getElementById('rBs');
  dom.targetTemp = document.getElementById('aT');
  dom.simLength = document.getElementById('sL');
  dom.spreadWidth = document.getElementById('sw');
  dom.spreadWidthVal = document.getElementById('swV');
  dom.direction = document.getElementById('dr');
  dom.directionVal = document.getElementById('drV');
  dom.targetMult = document.getElementById('tM');
  dom.targetMultVal = document.getElementById('tMV');
  dom.insulation = document.getElementById('insul');
  dom.extSouth = document.getElementById('extS');
  dom.extWest = document.getElementById('extW');
  dom.edgeSoft = document.getElementById('eS');
  dom.edgeSoftVal = document.getElementById('eSV');
  dom.diffusion = document.getElementById('dF');
  dom.diffusionVal = document.getElementById('dFV');
  dom.sunGain = document.getElementById('sG');
  dom.sunGainVal = document.getElementById('sGV');
  dom.dampCouch = document.getElementById('dG');
  dom.dampCouchVal = document.getElementById('dGV');
  dom.dampBed = document.getElementById('dP');
  dom.dampBedVal = document.getElementById('dPV');
  dom.toolBtns = Array.from(dom.edToolbar.querySelectorAll('.tb'));
}
