import { scene, dom, editor, sim, view } from './state.js';
import { initSim } from './simulation.js';

/** Check if simulation button should be visible */
export function checkReady() {
  dom.simBtn.style.display = (scene.rooms.length && scene.acUnits.length) ? '' : 'none';
}

/** Set active editor tool */
export function setTool(t) {
  editor.tool = t;
  editor.clickGuard = Date.now();
  dom.toolBtns.forEach(b =>
    b.classList.toggle('active', b.dataset.m === t)
  );
  const messages = {
    room: 'Ťahaj = nový obdĺžnik (4 steny)',
    wall: 'Ťahaj = nová stena',
    delwall: 'Klikni na stenu pre vymazanie',
    win: 'Klikni na stenu pre okno',
    south: 'Klikni kdekoľvek – najbližšia strana = JUH',
    west: 'Klikni kdekoľvek – najbližšia strana = ZÁPAD',
    door: 'Klikni na stenu pre dvere',
    ac: 'Klikni na stenu pre klimu',
    ward: 'Klikni do izby pre skriňu',
    temp: 'Klikni na izbu = zmeniť teplotu',
  };
  dom.statusMsg.textContent = messages[t] || '';
}

/** Switch to simulation mode */
export function switchToSim() {
  editor.mode = 'sim';
  initSim();
  dom.modeLabel.textContent = 'Simulácia';
  dom.statusMsg.textContent = 'Simulácia beží';
  dom.edToolbar.style.display = 'none';
  dom.simToolbar.style.display = 'flex';
  dom.tuneRow.style.display = 'flex';
  dom.unitCards.style.display = 'flex';
  dom.infoBar.style.display = 'none';
  dom.simLeg.style.display = 'flex';
  dom.simBtn.style.display = 'none';
  dom.editBtn.style.display = '';
  dom.clearBtn.style.display = 'none';
}

/** Switch to editor mode */
export function switchToEditor() {
  editor.mode = 'editor';
  sim.running = false;
  dom.modeLabel.textContent = 'Editor';
  dom.statusMsg.textContent = 'Kresli steny';
  dom.edToolbar.style.display = 'flex';
  dom.simToolbar.style.display = 'none';
  dom.tuneRow.style.display = 'none';
  dom.unitCards.style.display = 'none';
  dom.infoBar.style.display = 'none';
  dom.simLeg.style.display = 'none';
  dom.simBtn.style.display = '';
  dom.editBtn.style.display = 'none';
  dom.clearBtn.style.display = '';
}

/** Sync zoom slider with current zoom value */
export function syncZoomSlider() {
  dom.zoomSlider.value = Math.round(view.zoom * 100);
  dom.zoomVal.textContent = view.zoom.toFixed(1) + '×';
}

/** Build unit cards for simulation toolbar */
export function buildUnitCards() {
  dom.unitCards.innerHTML = '';
  dom.unitTemp = [];
  dom.unitInfo = [];
  scene.acUnits.forEach((u, i) => {
    const card = document.createElement('div');
    card.className = 'ucard' + (u.on ? '' : ' off');
    card.innerHTML =
      `<span class="unum">${i + 1}</span>` +
      `<select class="umd" data-i="${i}">` +
        `<option value="0"${u.model === 0 ? ' selected' : ''}>2.5kW</option>` +
        `<option value="1"${u.model === 1 ? ' selected' : ''}>3.5kW</option>` +
        `<option value="2"${u.model === 2 ? ' selected' : ''}>5.0kW</option>` +
      `</select>` +
      `<select class="umo" data-i="${i}">` +
        `<option value="0"${u.mode === 0 ? ' selected' : ''}>Tichý</option>` +
        `<option value="1"${u.mode === 1 ? ' selected' : ''}>Norm</option>` +
        `<option value="2"${u.mode === 2 ? ' selected' : ''}>Turbo</option>` +
      `</select>` +
      `<span class="utemp" id="ut${i}">26°C</span>` +
      `<span class="uinfo" id="ui${i}">100%</span>`;

    dom.unitTemp.push(card.querySelector('.utemp'));
    dom.unitInfo.push(card.querySelector('.uinfo'));

    card.querySelector('.unum').onclick = (e) => {
      e.stopPropagation();
      u.on = !u.on;
      card.className = 'ucard' + (u.on ? '' : ' off');
    };
    card.querySelector('.umd').onchange = function() { u.model = +this.value; };
    card.querySelector('.umo').onchange = function() { u.mode = +this.value; };
    dom.unitCards.appendChild(card);
  });
}
