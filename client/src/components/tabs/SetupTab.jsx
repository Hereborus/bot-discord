import { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { apiJson, apiPost, getApiBase } from '../../api.js';

export function SetupTab({ toast }) {
  const { configData, myToken } = useApp();
  const [viewerToken, setViewerToken] = useState('');
  const [viewerUrl, setViewerUrl]     = useState('');
  const [genLoading, setGenLoading]   = useState(false);

  const tokens = Object.keys(configData);

  useEffect(() => {
    if (!viewerToken && tokens.length) setViewerToken(tokens[0]);
  }, [tokens, viewerToken]);

  async function generateViewerUrl() {
    if (!viewerToken) return;
    setGenLoading(true);
    try {
      const data = await apiPost('/api/viewer-session', { userToken: viewerToken });
      const base = getApiBase();
      const url  = `${base}/viewer.html?s=${data.sessionId}`;
      setViewerUrl(url);
    } catch (e) { toast(e.message); }
    setGenLoading(false);
  }

  function copyUrl() {
    navigator.clipboard.writeText(viewerUrl).then(() => toast('URL copiée !'));
  }

  function openViewer() {
    if (viewerUrl) window.open(viewerUrl, '_blank');
  }

  return (
    <div className="panel active" id="panel-setup">
      <h2 style={{ fontSize: '1rem', marginBottom: '1.5rem' }}>Configuration Bot</h2>

      {/* Générateur URL viewer */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>URL Browser Source OBS</h3>
        <p style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: '0.75rem' }}>
          Génère une URL sécurisée pour une Browser Source OBS. L'URL ne contient pas ton token — elle utilise un ID de session temporaire.
        </p>

        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
          <select
            value={viewerToken}
            onChange={e => setViewerToken(e.target.value)}
            style={{ padding: '0.4rem 0.6rem', background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, fontSize: '0.8rem' }}
          >
            {tokens.map(t => (
              <option key={t} value={t}>{configData[t]?.displayName || t}</option>
            ))}
          </select>
          <button className="obs-btn" onClick={generateViewerUrl} disabled={genLoading}>
            {genLoading ? 'Génération…' : 'Générer l\'URL'}
          </button>
        </div>

        {viewerUrl && (
          <div>
            <div className="modal-url" style={{ marginBottom: '0.5rem', wordBreak: 'break-all', padding: '0.5rem 0.75rem', background: 'var(--bg3)', borderRadius: 4, fontSize: '0.78rem', fontFamily: 'monospace' }}>
              {viewerUrl}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="obs-btn" onClick={copyUrl}>Copier</button>
              <button className="obs-btn ghost" onClick={openViewer}>Ouvrir</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
