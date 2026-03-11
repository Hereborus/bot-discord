/**
 * PositionerApp — outil d'édition de position des frames PNG
 *
 * Reproduit fidèlement le comportement de positioner.html :
 *  - Drag & drop des frames sur le canvas
 *  - Sliders X / Y / Scale par frame
 *  - Persistance dans localStorage (clé basée sur slug + state)
 *  - Notification du viewer via BroadcastChannel("pngtuber-positions")
 *
 * Paramètres URL attendus :
 *   ?t=TOKEN  (ou ?userId=TOKEN)
 *   &state=STATE   (défaut : "low")
 *   &w=500         (largeur canvas)
 *   &h=500         (hauteur canvas)
 *   &slug=SLUG     (pseudo lisible pour les clés localStorage)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import './positioner.css';

// ════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════

/** Échappe les caractères HTML (utilisé pour l'affichage des noms de fichiers) */
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Tronque un nom de fichier trop long pour l'affichage */
function truncateName(name, max = 28) {
  return name.length > max ? '…' + name.slice(-(max - 1)) : name;
}

// ════════════════════════════════════════════════════════════════
// Constantes issues des query params (lues une seule fois au montage)
// ════════════════════════════════════════════════════════════════
const params  = new URLSearchParams(window.location.search);
const USER_ID = params.get('t') || params.get('userId') || '';
const STATE   = params.get('state') || 'low';
const API_BASE = `${window.location.protocol}//${window.location.host}`;
const INIT_W  = parseInt(params.get('w') || '500');
const INIT_H  = parseInt(params.get('h') || '500');
const USER_SLUG = params.get('slug') || USER_ID.slice(0, 8);

// ════════════════════════════════════════════════════════════════
// Clé localStorage
// ════════════════════════════════════════════════════════════════
/** Génère la clé localStorage pour une frame donnée.
 *  Utilise le slug (pseudo) plutôt que l'userId Discord pour
 *  rester lisible côté navigateur et éviter d'exposer l'id brut. */
function posKey(file) {
  return `pos__${USER_SLUG}__${STATE}__${file}`;
}

// ════════════════════════════════════════════════════════════════
// Composant principal
// ════════════════════════════════════════════════════════════════
export function PositionerApp() {
  // ── State ──────────────────────────────────────────────────────
  const [stateFrames,   setStateFrames]   = useState([]);
  const [silentFrames,  setSilentFrames]  = useState([]);
  const [displayName,   setDisplayName]   = useState('…');
  const [selectedFile,  setSelectedFile]  = useState(null);
  const [canvasW,       setCanvasW]       = useState(INIT_W);
  const [canvasH,       setCanvasH]       = useState(INIT_H);
  const [toastVisible,  setToastVisible]  = useState(false);
  const [error,         setError]         = useState(null);

  // positions[file] = { x, y, s } — mutable ref pour éviter des re-renders à chaque drag
  const positionsRef = useRef({});

  // Ref vers le conteneur de layers pour attacher/détacher les listeners
  const layersContainerRef = useRef(null);

  // AbortController pour nettoyer les mousemove/mouseup entre deux renders de layers
  const abortCtrlRef = useRef(null);

  // Ref vers l'état sélectionné, accessible dans les closures de drag sans stale ref
  const selectedFileRef = useRef(null);

  // ── Sync selectedFileRef ────────────────────────────────────────
  useEffect(() => {
    selectedFileRef.current = selectedFile;
  }, [selectedFile]);

  // ════════════════════════════════════════════════════════════════
  // Toast "Sauvegardé"
  // ════════════════════════════════════════════════════════════════
  const showToast = useCallback(() => {
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 1500);
  }, []);

  // ════════════════════════════════════════════════════════════════
  // BroadcastChannel — notifier viewer.html après sauvegarde
  // ════════════════════════════════════════════════════════════════
  const broadcastSave = useCallback(() => {
    try {
      new BroadcastChannel('pngtuber-positions').postMessage({
        userId: USER_ID,
        state:  STATE,
      });
    } catch {
      // BroadcastChannel non supporté ou contexte restreint — silencieux
    }
  }, []);

  // ════════════════════════════════════════════════════════════════
  // Persistance localStorage
  // ════════════════════════════════════════════════════════════════

  /** Charge les positions sauvegardées pour les frames données */
  function loadPositions(frames) {
    const pos = {};
    for (const f of frames) {
      try {
        const saved = localStorage.getItem(posKey(f.file));
        pos[f.file] = saved ? JSON.parse(saved) : { x: 0, y: 0, s: 1 };
      } catch {
        pos[f.file] = { x: 0, y: 0, s: 1 };
      }
    }
    positionsRef.current = pos;
  }

  /** Sauvegarde atomique de toutes les frames de l'état courant */
  const saveAll = useCallback(() => {
    const positions = positionsRef.current;
    for (const [file, pos] of Object.entries(positions)) {
      localStorage.setItem(posKey(file), JSON.stringify(pos));
    }
    broadcastSave();
    showToast();
  }, [broadcastSave, showToast]);

  /** Remet à zéro toutes les positions et supprime les clés localStorage */
  const resetAll = useCallback(() => {
    const positions = positionsRef.current;
    for (const file of Object.keys(positions)) {
      positions[file] = { x: 0, y: 0, s: 1 };
      localStorage.removeItem(posKey(file));
    }
    // Force un re-render pour mettre à jour les layers et le panel
    setSelectedFile(f => f); // même valeur → trigger useEffect layers
    showToast();
  }, [showToast]);

  // ════════════════════════════════════════════════════════════════
  // Chargement des frames depuis le backend
  // ════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!USER_ID) return;

    async function loadFrames() {
      // Le backend renvoie les frames déjà triées (ordre utilisateur + fallback fichiers présents).
      const res  = await fetch(`${API_BASE}/frames/${USER_ID}`, { cache: 'no-store' });
      const data = await res.json();

      const silent = data['silent'] || data['silent_open'] || [];
      const state  = data[STATE] || [];

      setSilentFrames(silent);
      setStateFrames(state);
      loadPositions(state);

      // Sélectionner la première frame automatiquement
      if (state.length > 0) setSelectedFile(state[0].file);

      // Afficher le displayName via /levels
      try {
        const lr = await fetch(`${API_BASE}/levels`, { cache: 'no-store' });
        const ld = await lr.json();
        if (ld[USER_ID]?.displayName) {
          setDisplayName(ld[USER_ID].displayName);
        } else {
          setDisplayName(USER_ID.slice(0, 8) + '…');
        }
      } catch {
        setDisplayName(USER_ID.slice(0, 8) + '…');
      }
    }

    loadFrames().catch(err => setError(err.message));
  }, []);

  // ════════════════════════════════════════════════════════════════
  // Drag & drop — attaché après chaque render des layers
  // ════════════════════════════════════════════════════════════════
  useEffect(() => {
    // Nettoyer les anciens listeners avant de relier
    if (abortCtrlRef.current) abortCtrlRef.current.abort();
    abortCtrlRef.current = new AbortController();
    const signal = abortCtrlRef.current.signal;

    const container = layersContainerRef.current;
    if (!container) return;

    // Pour chaque frame, on récupère l'élément layer déjà rendu dans le DOM
    for (const f of stateFrames) {
      const layer = container.querySelector(`[data-layer="${f.file}"]`);
      if (!layer) continue;

      let dragging = false;
      let startX, startY, startPosX, startPosY;

      layer.addEventListener('mousedown', (e) => {
        // Sélectionner la frame cliquée
        setSelectedFile(f.file);
        selectedFileRef.current = f.file;

        dragging  = true;
        startX    = e.clientX;
        startY    = e.clientY;
        const cur = positionsRef.current[f.file] || { x: 0, y: 0, s: 1 };
        startPosX = cur.x;
        startPosY = cur.y;
        e.preventDefault();
      }, { signal });

      window.addEventListener('mousemove', (e) => {
        if (!dragging || selectedFileRef.current !== f.file) return;
        const pos = positionsRef.current[f.file];
        if (!pos) return;
        pos.x = startPosX + (e.clientX - startX);
        pos.y = startPosY + (e.clientY - startY);
        // Appliquer directement au DOM (sans re-render React) pour la fluidité
        applyTransformDOM(container, f.file, pos);
        // Mettre à jour l'indicateur de position dans la sidebar
        updateFramePosDOM(container, f.file, pos);
        // Mettre à jour les sliders via une mutation directe (plus rapide qu'un setState)
        updateSlidersDOM(pos);
      }, { signal });

      window.addEventListener('mouseup', () => {
        if (dragging) {
          dragging = false;
          saveAll();
        }
      }, { signal });
    }

    return () => {
      if (abortCtrlRef.current) abortCtrlRef.current.abort();
    };
  }, [stateFrames, saveAll]);

  // ════════════════════════════════════════════════════════════════
  // Mutations DOM directes pour la fluidité du drag
  // (évitent des re-renders React à chaque mouvement de souris)
  // ════════════════════════════════════════════════════════════════

  /** Applique le transform CSS sur l'img du layer correspondant */
  function applyTransformDOM(container, file, pos) {
    const layer = container?.querySelector(`[data-layer="${file}"]`);
    if (!layer) return;
    const img = layer.querySelector('img');
    if (!img) return;
    img.style.transform = `translate(${pos.x}px, ${pos.y}px) scale(${pos.s})`;
  }

  /** Met à jour l'indicateur textuel dans la sidebar */
  function updateFramePosDOM(container, file, pos) {
    // L'indicateur est dans la sidebar, pas dans le container des layers
    // On passe par document pour le cibler
    const el = document.querySelector(`[data-fpos="${file}"]`);
    if (!el) return;
    el.textContent = `x:${Math.round(pos.x)} y:${Math.round(pos.y)} s:${(+pos.s).toFixed(2)}`;
  }

  /** Met à jour les sliders du panel transform directement dans le DOM */
  function updateSlidersDOM(pos) {
    const slX = document.getElementById('pos-sl-x');
    const slY = document.getElementById('pos-sl-y');
    const slS = document.getElementById('pos-sl-s');
    const vX  = document.getElementById('pos-val-x');
    const vY  = document.getElementById('pos-val-y');
    const vS  = document.getElementById('pos-val-s');
    if (slX) slX.value = pos.x;
    if (slY) slY.value = pos.y;
    if (slS) slS.value = pos.s;
    if (vX)  vX.textContent  = Math.round(pos.x) + 'px';
    if (vY)  vY.textContent  = Math.round(pos.y) + 'px';
    if (vS)  vS.textContent  = (+pos.s).toFixed(2) + '×';
  }

  // ════════════════════════════════════════════════════════════════
  // Appliquer les transforms à tous les layers après un reset ou
  // un changement d'état qui reconstruit le DOM
  // ════════════════════════════════════════════════════════════════
  useEffect(() => {
    const container = layersContainerRef.current;
    if (!container) return;
    for (const f of stateFrames) {
      const pos = positionsRef.current[f.file] || { x: 0, y: 0, s: 1 };
      applyTransformDOM(container, f.file, pos);
      updateFramePosDOM(container, f.file, pos);
    }
  }, [stateFrames, selectedFile]);

  // ════════════════════════════════════════════════════════════════
  // Sliders (panel transform)
  // ════════════════════════════════════════════════════════════════

  /** Appelé quand un slider change de valeur */
  function onSliderChange(axis, val) {
    if (!selectedFile) return;
    const pos = positionsRef.current[selectedFile];
    if (!pos) return;
    pos[axis] = +val;

    const container = layersContainerRef.current;
    applyTransformDOM(container, selectedFile, pos);
    updateFramePosDOM(container, selectedFile, pos);

    // Mettre à jour l'affichage de la valeur dans le span
    const el = document.getElementById(`pos-val-${axis}`);
    if (el) {
      el.textContent = axis === 's'
        ? (+val).toFixed(2) + '×'
        : Math.round(val) + 'px';
    }
  }

  /** Remet un axe à sa valeur par défaut */
  function resetAxis(axis) {
    if (!selectedFile) return;
    const def = axis === 's' ? 1 : 0;
    const pos = positionsRef.current[selectedFile];
    if (!pos) return;
    pos[axis] = def;

    // Mettre à jour le slider et l'affichage via le DOM
    const sl = document.getElementById(`pos-sl-${axis}`);
    const vl = document.getElementById(`pos-val-${axis}`);
    if (sl) sl.value = def;
    if (vl) vl.textContent = axis === 's' ? '1.00×' : '0px';

    const container = layersContainerRef.current;
    applyTransformDOM(container, selectedFile, pos);
    updateFramePosDOM(container, selectedFile, pos);
    saveAll();
  }

  // ════════════════════════════════════════════════════════════════
  // Sélection d'une frame (depuis la sidebar ou le drag)
  // ════════════════════════════════════════════════════════════════
  function selectFrame(file) {
    setSelectedFile(file);
    selectedFileRef.current = file;

    // Mettre à jour les sliders avec les valeurs actuelles de la frame
    const pos = positionsRef.current[file] || { x: 0, y: 0, s: 1 };
    updateSlidersDOM(pos);

    // Mettre à jour les opacités et z-index via le DOM pour la réactivité
    const container = layersContainerRef.current;
    if (container) {
      for (const f of stateFrames) {
        const layer = container.querySelector(`[data-layer="${f.file}"]`);
        if (!layer) continue;
        const img = layer.querySelector('img');
        if (img) img.style.opacity = f.file === file ? '0.65' : '0.35';
        layer.style.zIndex = f.file === file ? '2' : '1';
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  // Valeurs des sliders pour le rendu initial (contrôlé)
  // ════════════════════════════════════════════════════════════════
  function getSelectedPos() {
    if (!selectedFile) return { x: 0, y: 0, s: 1 };
    return positionsRef.current[selectedFile] || { x: 0, y: 0, s: 1 };
  }

  // ════════════════════════════════════════════════════════════════
  // Rendu
  // ════════════════════════════════════════════════════════════════

  // Cas d'erreur : USER_ID manquant
  if (!USER_ID) {
    return (
      <div className="positioner-root">
        <div className="positioner-canvas-area">
          <p className="positioner-error">userId manquant dans l'URL</p>
        </div>
      </div>
    );
  }

  // Cas d'erreur : fetch échoué
  if (error) {
    return (
      <div className="positioner-root">
        <div className="positioner-canvas-area">
          <p className="positioner-error">Erreur : {error}</p>
        </div>
      </div>
    );
  }

  const selPos = getSelectedPos();

  return (
    <div className="positioner-root">
      {/* ── Header ──────────────────────────────────────────────── */}
      <header className="positioner-header">
        <div className="positioner-logo">
          PNG<em>Tuber</em> ·{' '}
          <span style={{ color: 'var(--muted)' }}>Position Editor</span>
        </div>

        <span className="positioner-badge">{STATE}</span>

        <span className="positioner-badge-user">{displayName}</span>

        <span className={`positioner-saved-toast${toastVisible ? ' show' : ''}`}>
          ✓ Sauvegardé
        </span>

        <div className="positioner-header-actions">
          <button className="positioner-btn ghost" onClick={resetAll}>
            ↺ Reset tout
          </button>
          <button className="positioner-btn primary" onClick={saveAll}>
            ✓ Sauvegarder
          </button>
        </div>
      </header>

      {/* ── Workspace ───────────────────────────────────────────── */}
      <div className="positioner-workspace">

        {/* SIDEBAR */}
        <div className="positioner-sidebar">
          <div className="positioner-sidebar-scroll">

            {/* Taille du canvas */}
            <div>
              <div className="positioner-sec">Taille du canvas</div>
              <div className="positioner-canvas-size-row">
                <input
                  type="number"
                  value={canvasW}
                  min="100"
                  max="2000"
                  step="10"
                  onChange={e => setCanvasW(parseInt(e.target.value) || 500)}
                />
                <span>×</span>
                <input
                  type="number"
                  value={canvasH}
                  min="100"
                  max="2000"
                  step="10"
                  onChange={e => setCanvasH(parseInt(e.target.value) || 500)}
                />
                <span>px</span>
              </div>
            </div>

            {/* Liste des frames */}
            <div>
              <div className="positioner-sec">Frames — {STATE}</div>
              <div className="positioner-frame-list">
                {stateFrames.length === 0 ? (
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                    Aucune frame pour cet état.
                  </div>
                ) : (
                  stateFrames.map(f => {
                    const pos = positionsRef.current[f.file] || { x: 0, y: 0, s: 1 };
                    return (
                      <div
                        key={f.file}
                        className={`positioner-frame-card${selectedFile === f.file ? ' active' : ''}`}
                        onClick={() => selectFrame(f.file)}
                      >
                        <div className="positioner-frame-card-head">
                          <img
                            className="positioner-frame-thumb"
                            src={`${API_BASE}${f.url}`}
                            alt=""
                          />
                          <span className="positioner-frame-name">
                            {esc(f.file)}
                          </span>
                          <span className="positioner-frame-active-badge">actif</span>
                        </div>
                        <div
                          className="positioner-frame-pos"
                          data-fpos={f.file}
                        >
                          x:{Math.round(pos.x)} y:{Math.round(pos.y)} s:{(+pos.s).toFixed(2)}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Panel transform (affiché seulement si une frame est sélectionnée) */}
            {selectedFile && (
              <div className="positioner-transform-panel">
                <div className="positioner-sec">
                  Position —{' '}
                  <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--accent2)' }}>
                    {truncateName(selectedFile)}
                  </span>
                </div>

                <div className="positioner-transform-group">
                  {/* Axe X */}
                  <div className="positioner-tf-row">
                    <span className="positioner-tf-label">X</span>
                    <input
                      id="pos-sl-x"
                      className="positioner-tf-slider"
                      type="range"
                      min="-500"
                      max="500"
                      step="1"
                      defaultValue={selPos.x}
                      onInput={e => onSliderChange('x', e.target.value)}
                    />
                    <span id="pos-val-x" className="positioner-tf-val">
                      {Math.round(selPos.x)}px
                    </span>
                    <button className="positioner-tf-reset" onClick={() => resetAxis('x')} title="Reset X">
                      ↺
                    </button>
                  </div>

                  {/* Axe Y */}
                  <div className="positioner-tf-row">
                    <span className="positioner-tf-label">Y</span>
                    <input
                      id="pos-sl-y"
                      className="positioner-tf-slider"
                      type="range"
                      min="-500"
                      max="500"
                      step="1"
                      defaultValue={selPos.y}
                      onInput={e => onSliderChange('y', e.target.value)}
                    />
                    <span id="pos-val-y" className="positioner-tf-val">
                      {Math.round(selPos.y)}px
                    </span>
                    <button className="positioner-tf-reset" onClick={() => resetAxis('y')} title="Reset Y">
                      ↺
                    </button>
                  </div>

                  {/* Scale */}
                  <div className="positioner-tf-row">
                    <span className="positioner-tf-label">S</span>
                    <input
                      id="pos-sl-s"
                      className="positioner-tf-slider"
                      type="range"
                      min="0.1"
                      max="3"
                      step="0.01"
                      defaultValue={selPos.s}
                      onInput={e => onSliderChange('s', e.target.value)}
                    />
                    <span id="pos-val-s" className="positioner-tf-val">
                      {(+selPos.s).toFixed(2)}×
                    </span>
                    <button className="positioner-tf-reset" onClick={() => resetAxis('s')} title="Reset Scale">
                      ↺
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Légende opacité */}
            <div className="positioner-opacity-info">
              🖼 <strong>Silent</strong> = fond de référence (opaque)<br />
              Frames de l'état = semi-transparentes<br />
              Frame <strong>sélectionnée</strong> = légèrement plus visible
            </div>
          </div>
        </div>

        {/* CANVAS AREA */}
        <div className="positioner-canvas-area">
          <div
            className="positioner-canvas-wrap"
            style={{ width: canvasW + 'px', height: canvasH + 'px' }}
          >
            {/* Crosshair de centrage */}
            <div className="positioner-crosshair" />

            {/* Layer silent (fond de référence, opaque) */}
            <div className="positioner-layer">
              {silentFrames.length > 0 && (
                <img
                  src={`${API_BASE}${silentFrames[0].url}`}
                  alt=""
                  style={{
                    opacity: 1,
                    transform: 'translate(0px, 0px) scale(1)',
                  }}
                />
              )}
            </div>

            {/* Layers des frames de l'état (draggables) */}
            <div ref={layersContainerRef}>
              {stateFrames.map(f => {
                const pos = positionsRef.current[f.file] || { x: 0, y: 0, s: 1 };
                return (
                  <div
                    key={f.file}
                    className="positioner-layer draggable"
                    data-layer={f.file}
                    style={{ zIndex: selectedFile === f.file ? 2 : 1 }}
                  >
                    <img
                      src={`${API_BASE}${f.url}`}
                      alt=""
                      data-file={f.file}
                      style={{
                        opacity: selectedFile === f.file ? 0.65 : 0.35,
                        transform: `translate(${pos.x}px, ${pos.y}px) scale(${pos.s})`,
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
