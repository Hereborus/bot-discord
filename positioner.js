// ════════════════════════════════════════════════════════════════
// PARAMS
// ════════════════════════════════════════════════════════════════
const params   = new URLSearchParams(location.search);
const USER_ID  = params.get('t') || params.get('userId') || ''; // 't' = token opaque
const STATE    = params.get('state')  || 'low';
const API_BASE = `http://${location.host}`;

document.getElementById('state-badge').textContent  = STATE;
document.getElementById('user-badge').textContent   = '…';
document.getElementById('frames-sec').textContent   = `Frames — ${STATE}`;

// Canvas size depuis params si fourni
const pw = parseInt(params.get('w') || '500');
const ph = parseInt(params.get('h') || '500');
document.getElementById('cw').value = pw;
document.getElementById('ch').value = ph;

// ════════════════════════════════════════════════════════════════
// ÉTAT
// ════════════════════════════════════════════════════════════════

// positions[file] = { x, y, s }
const positions = {};

// frames de l'état cible
let stateFrames  = [];
// frame silent (première)
let silentFrames = [];

let selectedFile = null;

// ════════════════════════════════════════════════════════════════
// LOCALSTORAGE
// ════════════════════════════════════════════════════════════════
function posKey(file) {
  // Utilise le token opaque comme clé (non-réversible)
  return `pos__${USER_ID}__${STATE}__${file}`;
}

function loadPositions() {
  for (const f of stateFrames) {
    try {
      const saved = localStorage.getItem(posKey(f.file));
      positions[f.file] = saved ? JSON.parse(saved) : { x:0, y:0, s:1 };
    } catch {
      positions[f.file] = { x:0, y:0, s:1 };
    }
  }
}

function saveAll() {
  for (const [file, pos] of Object.entries(positions)) {
    localStorage.setItem(posKey(file), JSON.stringify(pos));
  }
  // Notifier viewer.html
  try { new BroadcastChannel('pngtuber-positions').postMessage({ userId: USER_ID, state: STATE }); } catch {}
  showToast();
}

function resetAll() {
  for (const f of stateFrames) {
    positions[f.file] = { x:0, y:0, s:1 };
    localStorage.removeItem(posKey(f.file));
  }
  updateAllLayers();
  if (selectedFile) updateSliders(positions[selectedFile]);
  showToast();
}

function showToast() {
  const t = document.getElementById('saved-toast');
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1500);
}

// ════════════════════════════════════════════════════════════════
// CHARGEMENT DES FRAMES DEPUIS LE BOT
// ════════════════════════════════════════════════════════════════
async function loadFrames() {
  const res  = await fetch(`${API_BASE}/frames/${USER_ID}`, { cache: 'no-store' });
  const data = await res.json();

  silentFrames = data['silent']    || data['silent_open'] || [];
  stateFrames  = data[STATE]       || [];

  // Afficher le displayName si dispo via /levels
  try {
    const lr = await fetch(`${API_BASE}/levels`, { cache:'no-store' });
    const ld = await lr.json();
    if (ld[USER_ID]?.displayName) {
      document.getElementById('user-badge').textContent = ld[USER_ID].displayName;
    } else {
      document.getElementById('user-badge').textContent = USER_ID.slice(0,8)+'…';
    }
  } catch {
    document.getElementById('user-badge').textContent = USER_ID.slice(0,8)+'…';
  }

  loadPositions();
  renderSilent();
  renderFrameList();
  renderLayers();
  resizeCanvas();

  // Sélectionner la première frame auto
  if (stateFrames.length > 0) selectFrame(stateFrames[0].file);
}

// ════════════════════════════════════════════════════════════════
// SILENT DE FOND
// ════════════════════════════════════════════════════════════════
function renderSilent() {
  const img = document.getElementById('silent-img');
  if (silentFrames.length > 0) {
    img.src   = `${API_BASE}${silentFrames[0].url}`;
    img.style.display = 'block';
    img.style.opacity = '1';
    img.style.transform = 'translate(0px, 0px) scale(1)';
  } else {
    img.style.display = 'none';
  }
}

// ════════════════════════════════════════════════════════════════
// FRAME LIST (sidebar)
// ════════════════════════════════════════════════════════════════
function renderFrameList() {
  const list = document.getElementById('frame-list');
  list.innerHTML = '';

  if (stateFrames.length === 0) {
    list.innerHTML = `<div style="font-size:0.75rem;color:var(--muted);">Aucune frame pour cet état.</div>`;
    return;
  }

  for (const f of stateFrames) {
    const card = document.createElement('div');
    card.className = 'frame-card';
    card.id = `fc-${f.file}`;
    card.innerHTML = `
      <div class="frame-card-head">
        <img class="frame-thumb" src="${API_BASE}${f.url}" alt="">
        <span class="frame-name">${esc(f.file)}</span>
        <span class="frame-active-badge">actif</span>
      </div>
      <div style="font-size:0.62rem;color:var(--muted);font-family:var(--mono);" id="fpos-${f.file}">
        x:0 y:0 s:1.00
      </div>
    `;
    card.addEventListener('click', () => selectFrame(f.file));
    list.appendChild(card);
    updateFrameCardPos(f.file);
  }
}

function updateFrameCardPos(file) {
  const el = document.getElementById(`fpos-${file}`);
  if (!el) return;
  const p = positions[file] || { x:0, y:0, s:1 };
  el.textContent = `x:${Math.round(p.x)} y:${Math.round(p.y)} s:${(+p.s).toFixed(2)}`;
}

// ════════════════════════════════════════════════════════════════
// LAYERS CANVAS
// ════════════════════════════════════════════════════════════════
function renderLayers() {
  const cont = document.getElementById('layers-container');
  cont.innerHTML = '';

  for (const f of stateFrames) {
    const layer = document.createElement('div');
    layer.className = 'layer draggable';
    layer.id        = `layer-${f.file}`;
    layer.style.zIndex = '1';

    const img = document.createElement('img');
    img.src     = `${API_BASE}${f.url}`;
    img.dataset.file = f.file;
    img.style.opacity = '0.35';
    layer.appendChild(img);

    // Drag
    let dragging = false, startX, startY, startPosX, startPosY;
    layer.addEventListener('mousedown', e => {
      selectFrame(f.file);
      dragging  = true;
      startX    = e.clientX;
      startY    = e.clientY;
      startPosX = positions[f.file].x;
      startPosY = positions[f.file].y;
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!dragging || selectedFile !== f.file) return;
      positions[f.file].x = startPosX + (e.clientX - startX);
      positions[f.file].y = startPosY + (e.clientY - startY);
      applyTransform(f.file);
      updateSliders(positions[f.file]);
      updateFrameCardPos(f.file);
    });
    window.addEventListener('mouseup', () => { if (dragging) { dragging = false; saveAll(); } });

    cont.appendChild(layer);
    applyTransform(f.file);
  }
}

function applyTransform(file) {
  const layer = document.getElementById(`layer-${file}`);
  if (!layer) return;
  const p   = positions[file] || { x:0, y:0, s:1 };
  const img = layer.querySelector('img');
  img.style.transform = `translate(${p.x}px, ${p.y}px) scale(${p.s})`;
}

function updateAllLayers() {
  for (const f of stateFrames) {
    applyTransform(f.file);
    updateFrameCardPos(f.file);
  }
}

// ════════════════════════════════════════════════════════════════
// SÉLECTION DE FRAME
// ════════════════════════════════════════════════════════════════
function selectFrame(file) {
  selectedFile = file;

  // Sidebar cards
  document.querySelectorAll('.frame-card').forEach(c => c.classList.remove('active'));
  document.getElementById(`fc-${file}`)?.classList.add('active');

  // Opacité layers
  for (const f of stateFrames) {
    const img = document.querySelector(`#layer-${f.file} img`);
    if (!img) continue;
    img.style.opacity  = f.file === file ? '0.65' : '0.35';
  }
  // Z-index
  document.querySelectorAll('#layers-container .layer').forEach(l => l.style.zIndex = '1');
  const activeLayer = document.getElementById(`layer-${file}`);
  if (activeLayer) activeLayer.style.zIndex = '2';

  // Panel transform
  document.getElementById('transform-panel').style.display = 'block';
  document.getElementById('selected-frame-name').textContent = file.length > 28 ? '…'+file.slice(-25) : file;
  updateSliders(positions[file] || { x:0, y:0, s:1 });
}

// ════════════════════════════════════════════════════════════════
// SLIDERS
// ════════════════════════════════════════════════════════════════
function updateSliders(pos) {
  document.getElementById('sl-x').value = pos.x;
  document.getElementById('sl-y').value = pos.y;
  document.getElementById('sl-s').value = pos.s;
  document.getElementById('val-x').textContent = Math.round(pos.x) + 'px';
  document.getElementById('val-y').textContent = Math.round(pos.y) + 'px';
  document.getElementById('val-s').textContent = (+pos.s).toFixed(2) + '×';
}

function onSliderChange(axis, val) {
  if (!selectedFile) return;
  if (!positions[selectedFile]) positions[selectedFile] = { x:0, y:0, s:1 };
  positions[selectedFile][axis] = +val;
  document.getElementById(`val-${axis}`).textContent =
    axis === 's' ? (+val).toFixed(2)+'×' : Math.round(val)+'px';
  applyTransform(selectedFile);
  updateFrameCardPos(selectedFile);
}

function resetAxis(axis) {
  if (!selectedFile) return;
  const def = axis === 's' ? 1 : 0;
  positions[selectedFile][axis] = def;
  document.getElementById(`sl-${axis}`).value = def;
  document.getElementById(`val-${axis}`).textContent =
    axis === 's' ? '1.00×' : '0px';
  applyTransform(selectedFile);
  updateFrameCardPos(selectedFile);
  saveAll();
}

// ════════════════════════════════════════════════════════════════
// CANVAS RESIZE
// ════════════════════════════════════════════════════════════════
function resizeCanvas() {
  const w = parseInt(document.getElementById('cw').value) || 500;
  const h = parseInt(document.getElementById('ch').value) || 500;
  const wrap = document.getElementById('canvas-wrap');
  wrap.style.width  = w + 'px';
  wrap.style.height = h + 'px';
}

// ════════════════════════════════════════════════════════════════
// UTILS
// ════════════════════════════════════════════════════════════════
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════
if (!USER_ID) {
  document.getElementById('canvas-area').innerHTML =
    '<div style="color:#e74c6c;font-size:0.9rem;padding:2rem;">❌ userId manquant dans l\'URL</div>';
} else {
  loadFrames().catch(err => {
    document.getElementById('canvas-area').innerHTML =
      `<div style="color:#e74c6c;font-size:0.9rem;padding:2rem;">❌ Erreur: ${err.message}</div>`;
  });
}