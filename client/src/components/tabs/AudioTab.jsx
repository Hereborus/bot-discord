import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { apiJson, apiPost, apiFetch, getApiBase } from '../../api.js';
import { useAudioStates } from '../../hooks/useAudioStates.js';

export function AudioTab({ toast }) {
  const { configData, audioConfig, setAudioConfig, levels } = useApp();
  const [selectedToken, setSelectedToken] = useState('');
  const [saving, setSaving] = useState(false);
  const { audioStates } = useAudioStates(audioConfig);

  const tokens = Object.keys(configData);

  useEffect(() => {
    if (!selectedToken && tokens.length) setSelectedToken(tokens[0]);
  }, [tokens, selectedToken]);

  // Charger config serveur pour le token sélectionné
  useEffect(() => {
    if (!selectedToken) return;
    apiJson(`/user-config/${selectedToken}`)
      .then(cfg => setAudioConfig(prev => ({ ...prev, ...cfg })))
      .catch(() => {});
  }, [selectedToken, setAudioConfig]);

  const save = async () => {
    if (!selectedToken) return;
    setSaving(true);
    try {
      await apiPost(`/user-config/${selectedToken}`, audioConfig);
      toast('Configuration sauvegardée');
    } catch (e) {
      toast(e.message || 'Erreur sauvegarde');
    }
    setSaving(false);
  };

  // Modifier un seuil
  const updateThreshold = (idx, field, value) => {
    setAudioConfig(prev => {
      const thresholds = [...prev.thresholds];
      thresholds[idx] = { ...thresholds[idx], [field]: value };
      return { ...prev, thresholds };
    });
  };

  const liveInfo = levels[selectedToken];

  return (
    <div className="panel active" id="panel-audio">
      {/* Sélecteur d'utilisateur */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.85rem', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--r)', maxWidth: 520, marginBottom: '1rem' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>Utilisateur :</span>
        <select
          value={selectedToken}
          onChange={e => setSelectedToken(e.target.value)}
          style={{ flex: 1, background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '0.3rem 0.5rem', fontSize: '0.8rem' }}
        >
          {tokens.map(t => (
            <option key={t} value={t}>
              {configData[t]?.displayName || t}
            </option>
          ))}
        </select>
      </div>

      {/* Indicateur live */}
      {liveInfo && (
        <div style={{ padding: '0.4rem 0.75rem', background: 'var(--bg3)', borderRadius: 'var(--r)', marginBottom: '1rem', fontSize: '0.75rem', color: 'var(--muted)' }}>
          {liveInfo.speaking ? '🎙 Parle' : '🔇 Silence'} — {(liveInfo.db ?? -100).toFixed(1)} dB
        </div>
      )}

      {/* Seuils audio */}
      <section style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '0.85rem', marginBottom: '0.5rem', color: 'var(--text)' }}>Seuils audio</h3>
        {audioConfig.thresholds.map((t, i) => (
          <div key={t.key} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem' }}>
            <input
              type="color"
              value={t.color}
              onChange={e => updateThreshold(i, 'color', e.target.value)}
              style={{ width: 28, height: 28, border: 'none', borderRadius: 4, cursor: 'pointer' }}
            />
            <span style={{ width: 60, fontSize: '0.78rem' }}>{t.label}</span>
            <input
              type="range"
              min={-80} max={0} step={1}
              value={t.db}
              onChange={e => updateThreshold(i, 'db', Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span style={{ width: 50, fontSize: '0.75rem', color: 'var(--muted)', textAlign: 'right' }}>
              {t.db} dB
            </span>
          </div>
        ))}
      </section>

      {/* Vitesse flipbook + hold émotion */}
      <section style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <label style={{ fontSize: '0.78rem', color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          Vitesse flipbook (ms)
          <input
            type="number" min={50} max={1000} step={10}
            value={audioConfig.frameSpeed}
            onChange={e => setAudioConfig(prev => ({ ...prev, frameSpeed: Number(e.target.value) }))}
            style={{ width: 80, padding: '0.25rem', background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, fontSize: '0.8rem' }}
          />
        </label>
        <label style={{ fontSize: '0.78rem', color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          Maintien émotion (ms)
          <input
            type="number" min={0} max={5000} step={50}
            value={audioConfig.emotionHoldMs}
            onChange={e => setAudioConfig(prev => ({ ...prev, emotionHoldMs: Number(e.target.value) }))}
            style={{ width: 80, padding: '0.25rem', background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, fontSize: '0.8rem' }}
          />
        </label>
      </section>

      <button
        className="obs-btn"
        onClick={save}
        disabled={saving || !selectedToken}
        style={{ minWidth: 120 }}
      >
        {saving ? 'Sauvegarde…' : 'Sauvegarder'}
      </button>
    </div>
  );
}
