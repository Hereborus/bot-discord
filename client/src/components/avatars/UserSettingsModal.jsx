import { useState, useCallback } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { useAudioStates } from '../../hooks/useAudioStates.js';
import { apiFetch, apiPost, getApiBase } from '../../api.js';

export function UserSettingsModal({ token, onClose, toast }) {
  const { configData, updateConfigData, audioConfig } = useApp();
  const { allStates, stateColor } = useAudioStates(audioConfig);
  const user = configData[token] || { displayName: '???', states: {} };

  const [uploading, setUploading] = useState({});    // stateKey → bool
  const [dragOver, setDragOver]   = useState(null);  // stateKey en survol

  // ── Upload ────────────────────────────────────────────────────
  const upload = useCallback(async (stateKey, files) => {
    if (!files?.length) return;
    setUploading(u => ({ ...u, [stateKey]: true }));
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append('token', token);
        fd.append('stateKey', stateKey);
        fd.append('image', file, file.name);
        const res = await apiFetch('/upload', { method: 'POST', body: fd, credentials: 'include' });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Upload échoué');
        const newFrame = { file: data.file, url: `${getApiBase()}${data.url}` };
        updateConfigData(token, prev => ({
          ...prev,
          states: {
            ...prev.states,
            [stateKey]: [...(prev.states?.[stateKey] || []), newFrame],
          },
        }));
      }
      toast('Frame(s) uploadée(s)');
    } catch (e) { toast(e.message); }
    setUploading(u => ({ ...u, [stateKey]: false }));
  }, [token, updateConfigData, toast]);

  // ── Supprimer ─────────────────────────────────────────────────
  async function deleteFrame(stateKey, file) {
    try {
      await apiPost('/delete-frame', { token, stateKey, file });
      updateConfigData(token, prev => ({
        ...prev,
        states: {
          ...prev.states,
          [stateKey]: (prev.states?.[stateKey] || []).filter(f => f.file !== file),
        },
      }));
      toast('Frame supprimée');
    } catch (e) { toast(e.message); }
  }

  // ── Ouvrir positioner ─────────────────────────────────────────
  function openPositioner(stateKey) {
    const base  = getApiBase();
    const saved = localStorage.getItem('pngtuber-canvasSize');
    const size  = saved ? JSON.parse(saved) : { w: 800, h: 800 };
    window.open(`${base}/positioner.html?t=${encodeURIComponent(token)}&state=${encodeURIComponent(stateKey)}&w=${size.w}&h=${size.h}`, '_blank');
  }

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="user-settings-modal" style={{ maxWidth: 800, width: '95vw' }}>
        <div className="user-settings-modal-header">
          <h2>{user.displayName} — Frames</h2>
          <button className="obs-btn ghost" onClick={onClose} style={{ fontSize: '0.72rem' }}>Fermer</button>
        </div>

        <div className="user-settings-modal-body" style={{ padding: '1rem', overflowY: 'auto', maxHeight: '70vh' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem' }}>
            {allStates.map(state => {
              const frames = user.states?.[state] || [];
              const color  = stateColor(state);
              const isOver = dragOver === state;
              return (
                <div
                  key={state}
                  style={{ border: `1px solid ${isOver ? color : 'var(--border)'}`, borderRadius: 6, padding: '0.5rem', background: isOver ? `${color}11` : 'var(--bg3)', transition: 'border-color 0.15s' }}
                  onDragOver={e => { e.preventDefault(); setDragOver(state); }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={e => { e.preventDefault(); setDragOver(null); upload(state, e.dataTransfer.files); }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 600, color, textTransform: 'uppercase' }}>{state}</span>
                    <button
                      onClick={() => openPositioner(state)}
                      style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.65rem', padding: '0.1rem 0.2rem' }}
                      title="Éditer position"
                    >
                      📐
                    </button>
                  </div>

                  {/* Frames existantes */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginBottom: '0.4rem' }}>
                    {frames.map(f => (
                      <div key={f.file} style={{ position: 'relative' }}>
                        <img
                          src={f.url}
                          alt={f.file}
                          style={{ width: 48, height: 48, objectFit: 'contain', borderRadius: 4, background: 'rgba(255,255,255,0.05)' }}
                        />
                        <button
                          onClick={() => deleteFrame(state, f.file)}
                          style={{ position: 'absolute', top: -4, right: -4, background: '#e74c3c', color: '#fff', border: 'none', borderRadius: '50%', width: 16, height: 16, cursor: 'pointer', fontSize: '0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                        >×</button>
                      </div>
                    ))}
                  </div>

                  {/* Zone upload */}
                  <label style={{ display: 'block', cursor: 'pointer', textAlign: 'center', padding: '0.3rem', border: '1px dashed var(--border)', borderRadius: 4, fontSize: '0.65rem', color: 'var(--muted)' }}>
                    {uploading[state] ? 'Upload…' : '+ Ajouter'}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      style={{ display: 'none' }}
                      onChange={e => upload(state, e.target.files)}
                    />
                  </label>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
