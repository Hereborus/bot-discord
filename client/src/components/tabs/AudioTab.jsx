import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { apiJson, apiPost, apiFetch, getApiBase } from '../../api.js';
import { useAudioStates } from '../../hooks/useAudioStates.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function hz(v) { return v > 0 ? `${Math.round(v)} Hz` : '—'; }
function fmtDb(v) { return typeof v === 'number' ? `${v.toFixed(1)} dB` : '—'; }

// ── Composant principal ───────────────────────────────────────────────────────
export function AudioTab({ toast }) {
  const { configData, audioConfig, setAudioConfig, levels } = useApp();
  const [selectedToken, setSelectedToken] = useState('');
  const [saving, setSaving]               = useState(false);
  const { audioStates } = useAudioStates(audioConfig);

  // État section émotions
  const [fingerprints, setFingerprints]   = useState({});
  const [recording, setRecording]         = useState(false);
  const [recCountdown, setRecCountdown]   = useState(0);
  const [pendingFp, setPendingFp]         = useState(null); // fingerprint calculé, en attente de nom
  const [newEmotionKey, setNewEmotionKey] = useState('');
  const [newEmotionColor, setNewEmotionColor] = useState('#00d4aa');
  const [addingEmotion, setAddingEmotion] = useState(false);
  const [recordingFor, setRecordingFor]   = useState(null); // clé d'émotion en cours d'enregistrement

  // État raccourcis
  const [newHotkeyCode, setNewHotkeyCode]       = useState('');
  const [newHotkeyEmotion, setNewHotkeyEmotion] = useState('');
  const [newHotkeyMode, setNewHotkeyMode]       = useState('toggle');
  const [listeningKey, setListeningKey]         = useState(false);

  const recTimerRef = useRef(null);
  const tokens = Object.keys(configData);

  // Sélection automatique du premier token
  useEffect(() => {
    if (!selectedToken && tokens.length) setSelectedToken(tokens[0]);
  }, [tokens, selectedToken]);

  // Charger config + empreintes au changement de token
  useEffect(() => {
    if (!selectedToken) return;
    apiJson(`/user-config/${selectedToken}`)
      .then(cfg => {
        setAudioConfig(prev => ({ ...prev, ...cfg }));
        setFingerprints(cfg.emotionFingerprints || {});
      })
      .catch(() => {});
  }, [selectedToken, setAudioConfig]);

  // ── Sauvegarde config de base ───────────────────────────────────────────────
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

  // ── Seuils audio ────────────────────────────────────────────────────────────
  const updateThreshold = (idx, field, value) => {
    setAudioConfig(prev => {
      const thresholds = [...prev.thresholds];
      thresholds[idx] = { ...thresholds[idx], [field]: value };
      return { ...prev, thresholds };
    });
  };

  // ── Émotions — ajout/suppression ────────────────────────────────────────────
  const addEmotion = () => {
    const key = newEmotionKey.trim().toLowerCase().replace(/\s+/g, '_');
    if (!key) return;
    if ((audioConfig.emotions || []).some(e => e.key === key)) {
      toast('Clé déjà utilisée'); return;
    }
    setAudioConfig(prev => ({
      ...prev,
      emotions: [...(prev.emotions || []), { key, color: newEmotionColor, label: newEmotionKey.trim() }],
    }));
    setNewEmotionKey('');
    setAddingEmotion(false);
  };

  const removeEmotion = (key) => {
    setAudioConfig(prev => ({
      ...prev,
      emotions: (prev.emotions || []).filter(e => e.key !== key),
    }));
  };

  // ── Enregistrement d'empreinte vocale ───────────────────────────────────────
  const startRecord = useCallback(async (emotionKey) => {
    if (!selectedToken) return;
    const DUR = 5000;
    try {
      await apiPost(`/calibration/${selectedToken}/record-start`, { durationMs: DUR });
      setRecording(true);
      setRecordingFor(emotionKey);
      setRecCountdown(DUR / 1000);
      recTimerRef.current = setInterval(() => {
        setRecCountdown(n => {
          if (n <= 1) { clearInterval(recTimerRef.current); return 0; }
          return n - 1;
        });
      }, 1000);
      // Arrêt automatique après DUR + 500ms de marge
      setTimeout(async () => {
        clearInterval(recTimerRef.current);
        try {
          const res = await apiPost(`/calibration/${selectedToken}/record-stop`, {});
          if (res.fingerprint) {
            // Sauvegarde directe si on connaît déjà la clé d'émotion
            await apiPost(`/calibration/${selectedToken}/save-fingerprint`, {
              emotionKey,
              fingerprint: res.fingerprint,
            });
            const cfg = await apiJson(`/user-config/${selectedToken}`);
            setFingerprints(cfg.emotionFingerprints || {});
            toast(`Empreinte "${emotionKey}" sauvegardée (${res.sampleCount} samples)`);
          }
        } catch (e) { toast(e.message || 'Erreur stop'); }
        setRecording(false);
        setRecordingFor(null);
        setRecCountdown(0);
      }, DUR + 600);
    } catch (e) { toast(e.message || 'Erreur record'); }
  }, [selectedToken, toast]);

  const deleteFp = async (key) => {
    try {
      await apiFetch(`/calibration/${selectedToken}/fingerprint/${encodeURIComponent(key)}`, { method: 'DELETE' });
      setFingerprints(prev => { const n = { ...prev }; delete n[key]; return n; });
      toast(`Empreinte "${key}" supprimée`);
    } catch (e) { toast(e.message || 'Erreur suppression'); }
  };

  // ── Raccourcis ──────────────────────────────────────────────────────────────
  const addHotkey = () => {
    if (!newHotkeyCode || !newHotkeyEmotion) return;
    setAudioConfig(prev => ({
      ...prev,
      emotionHotkeys: [...(prev.emotionHotkeys || []), {
        code: newHotkeyCode,
        emotion: newHotkeyEmotion,
        mode: newHotkeyMode,
      }],
    }));
    setNewHotkeyCode('');
    setNewHotkeyEmotion('');
  };

  const removeHotkey = (idx) => {
    setAudioConfig(prev => ({
      ...prev,
      emotionHotkeys: (prev.emotionHotkeys || []).filter((_, i) => i !== idx),
    }));
  };

  const captureKey = (e) => {
    e.preventDefault();
    setNewHotkeyCode(e.code);
    setListeningKey(false);
  };

  // ── Données live ────────────────────────────────────────────────────────────
  const live = levels[selectedToken];
  const formants  = live?.formants  || { f1: 0, f2: 0, f3: 0 };
  const baseline  = live?.baseline;
  const fpCount   = baseline?.formantSampleCount || 0;
  const calibQuality = fpCount >= 500 ? 'Excellent' : fpCount >= 200 ? 'Bon' : fpCount >= 100 ? 'Minimal' : 'En cours';
  const calibColor   = fpCount >= 500 ? '#00d4aa' : fpCount >= 200 ? '#90e060' : fpCount >= 100 ? '#f0a500' : 'var(--muted)';

  const emotions = audioConfig.emotions || [];
  const hotkeys  = audioConfig.emotionHotkeys || [];

  // ── Rendu ────────────────────────────────────────────────────────────────────
  return (
    <div className="panel active" id="panel-audio">

      {/* Sélecteur d'utilisateur */}
      <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', padding:'0.6rem 0.85rem', background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'var(--r)', maxWidth:520, marginBottom:'1rem' }}>
        <span style={{ fontSize:'0.75rem', color:'var(--muted)', whiteSpace:'nowrap' }}>Utilisateur :</span>
        <select value={selectedToken} onChange={e => setSelectedToken(e.target.value)}
          style={{ flex:1, background:'var(--bg2)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:4, padding:'0.3rem 0.5rem', fontSize:'0.8rem' }}>
          {tokens.map(t => <option key={t} value={t}>{configData[t]?.displayName || t}</option>)}
        </select>
      </div>

      {/* ── Live audio ───────────────────────────────────────────────── */}
      {live && (
        <div style={{ padding:'0.6rem 0.85rem', background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'var(--r)', marginBottom:'1.25rem', display:'flex', flexWrap:'wrap', gap:'1rem', alignItems:'center' }}>
          <span style={{ fontSize:'0.75rem', color: live.speaking ? 'var(--accent)' : 'var(--muted)' }}>
            {live.speaking ? '🎙' : '🔇'} {fmtDb(live.db)}
          </span>
          <span style={{ fontSize:'0.75rem', color:'var(--muted)' }}>
            F1 <strong style={{ color:'var(--accent2)' }}>{hz(formants.f1)}</strong>
            {' · '}F2 <strong style={{ color:'var(--accent2)' }}>{hz(formants.f2)}</strong>
            {' · '}F3 <strong style={{ color:'var(--accent2)' }}>{hz(formants.f3)}</strong>
          </span>
          {live.detectedEmotion && (
            <span style={{ fontSize:'0.72rem', background:'var(--accent)', color:'#000', borderRadius:4, padding:'0.1rem 0.4rem' }}>
              {live.detectedEmotion}
            </span>
          )}
          <span style={{ fontSize:'0.7rem', marginLeft:'auto', color: calibColor }}>
            Calibration : {calibQuality} ({fpCount} échantillons)
          </span>
          {baseline?.formantMean && fpCount >= 100 && (
            <span style={{ fontSize:'0.68rem', color:'var(--muted)', width:'100%' }}>
              Voix calibrée — F1 ref {Math.round(baseline.formantMean.f1)} Hz · F2 {Math.round(baseline.formantMean.f2)} Hz · F3 {Math.round(baseline.formantMean.f3)} Hz
            </span>
          )}
        </div>
      )}

      {/* ── Seuils audio ────────────────────────────────────────────── */}
      <section style={{ marginBottom:'1.5rem' }}>
        <h3 style={{ fontSize:'0.85rem', marginBottom:'0.5rem', color:'var(--text)' }}>Seuils audio</h3>
        {audioConfig.thresholds.map((t, i) => (
          <div key={t.key} style={{ display:'flex', gap:'0.5rem', alignItems:'center', marginBottom:'0.4rem' }}>
            <input type="color" value={t.color} onChange={e => updateThreshold(i, 'color', e.target.value)}
              style={{ width:28, height:28, border:'none', borderRadius:4, cursor:'pointer' }} />
            <span style={{ width:60, fontSize:'0.78rem' }}>{t.label}</span>
            <input type="range" min={-80} max={0} step={1} value={t.db}
              onChange={e => updateThreshold(i, 'db', Number(e.target.value))} style={{ flex:1 }} />
            <span style={{ width:50, fontSize:'0.75rem', color:'var(--muted)', textAlign:'right' }}>{t.db} dB</span>
          </div>
        ))}
      </section>

      {/* ── Vitesse + hold ──────────────────────────────────────────── */}
      <section style={{ display:'flex', gap:'1.5rem', flexWrap:'wrap', marginBottom:'1.5rem' }}>
        <label style={{ fontSize:'0.78rem', color:'var(--muted)', display:'flex', flexDirection:'column', gap:4 }}>
          Vitesse flipbook (ms)
          <input type="number" min={50} max={1000} step={10} value={audioConfig.frameSpeed}
            onChange={e => setAudioConfig(prev => ({ ...prev, frameSpeed: Number(e.target.value) }))}
            style={{ width:80, padding:'0.25rem', background:'var(--bg2)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:4, fontSize:'0.8rem' }} />
        </label>
        <label style={{ fontSize:'0.78rem', color:'var(--muted)', display:'flex', flexDirection:'column', gap:4 }}>
          Maintien émotion (ms)
          <input type="number" min={0} max={5000} step={50} value={audioConfig.emotionHoldMs}
            onChange={e => setAudioConfig(prev => ({ ...prev, emotionHoldMs: Number(e.target.value) }))}
            style={{ width:80, padding:'0.25rem', background:'var(--bg2)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:4, fontSize:'0.8rem' }} />
        </label>
      </section>

      {/* ── Émotions personnalisées ──────────────────────────────────── */}
      <section style={{ marginBottom:'1.5rem' }}>
        <h3 style={{ fontSize:'0.85rem', marginBottom:'0.5rem', color:'var(--text)' }}>Émotions personnalisées</h3>
        <p style={{ fontSize:'0.72rem', color:'var(--muted)', marginBottom:'0.75rem' }}>
          Chaque émotion génère deux états d'animation : <code>{'{clé}'}</code> (parle) et <code>{'{clé}_silent'}</code> (muet).
          Une empreinte vocale est nécessaire pour la détection automatique.
        </p>

        {emotions.map(em => {
          const fp = fingerprints[em.key];
          const hasFp = !!fp;
          const fpF1 = fp?.formant_f1?.mean;
          const fpF2 = fp?.formant_f2?.mean;
          const fpF3 = fp?.formant_f3?.mean;
          const isRec = recording && recordingFor === em.key;
          return (
            <div key={em.key} style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.5rem', padding:'0.4rem 0.6rem', background:'var(--bg3)', border:`1px solid ${em.color}44`, borderRadius:'var(--r)' }}>
              <span style={{ width:10, height:10, borderRadius:'50%', background: em.color, flexShrink:0 }} />
              <span style={{ fontWeight:600, fontSize:'0.8rem', minWidth:70 }}>{em.key}</span>
              {hasFp ? (
                <span style={{ fontSize:'0.68rem', color:'var(--muted)' }}>
                  {fpF1 ? `F1 ${fpF1}Hz · F2 ${fpF2}Hz · F3 ${fpF3}Hz` : '✓ empreinte'}
                </span>
              ) : (
                <span style={{ fontSize:'0.68rem', color:'var(--muted)' }}>aucune empreinte</span>
              )}
              <div style={{ marginLeft:'auto', display:'flex', gap:'0.4rem' }}>
                <button
                  className="obs-btn"
                  disabled={recording}
                  onClick={() => startRecord(em.key)}
                  style={{ fontSize:'0.68rem', padding:'0.2rem 0.5rem', background: isRec ? '#e74c3c' : undefined }}
                >
                  {isRec ? `⏺ ${recCountdown}s…` : hasFp ? '↺ Ré-enregistrer' : '⏺ Enregistrer'}
                </button>
                {hasFp && (
                  <button className="obs-btn ghost" onClick={() => deleteFp(em.key)}
                    style={{ fontSize:'0.68rem', padding:'0.2rem 0.5rem' }}>✕ Empreinte</button>
                )}
                <button className="obs-btn ghost" onClick={() => removeEmotion(em.key)}
                  style={{ fontSize:'0.68rem', padding:'0.2rem 0.5rem' }}>✕</button>
              </div>
            </div>
          );
        })}

        {addingEmotion ? (
          <div style={{ display:'flex', gap:'0.5rem', alignItems:'center', marginTop:'0.5rem' }}>
            <input type="color" value={newEmotionColor} onChange={e => setNewEmotionColor(e.target.value)}
              style={{ width:28, height:28, border:'none', borderRadius:4, cursor:'pointer', flexShrink:0 }} />
            <input placeholder="Nom (ex: joie)" value={newEmotionKey} onChange={e => setNewEmotionKey(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addEmotion()}
              style={{ flex:1, background:'var(--bg2)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:4, padding:'0.3rem 0.5rem', fontSize:'0.8rem' }} />
            <button className="obs-btn" onClick={addEmotion} style={{ fontSize:'0.75rem' }}>Ajouter</button>
            <button className="obs-btn ghost" onClick={() => setAddingEmotion(false)} style={{ fontSize:'0.75rem' }}>Annuler</button>
          </div>
        ) : (
          <button className="obs-btn ghost" onClick={() => setAddingEmotion(true)}
            style={{ marginTop:'0.4rem', fontSize:'0.75rem' }}>+ Ajouter une émotion</button>
        )}
      </section>

      {/* ── Raccourcis émotions ──────────────────────────────────────── */}
      {emotions.length > 0 && (
        <section style={{ marginBottom:'1.5rem' }}>
          <h3 style={{ fontSize:'0.85rem', marginBottom:'0.5rem', color:'var(--text)' }}>Raccourcis émotions</h3>
          <p style={{ fontSize:'0.72rem', color:'var(--muted)', marginBottom:'0.75rem' }}>
            <strong>Toggle</strong> : appuyer pour activer/désactiver. <strong>Hold</strong> : maintenir la touche enfoncée.
          </p>
          {hotkeys.map((h, i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.35rem', fontSize:'0.8rem' }}>
              <code style={{ background:'var(--bg3)', padding:'0.1rem 0.4rem', borderRadius:3 }}>{h.code}</code>
              <span style={{ color:'var(--muted)' }}>→</span>
              <strong>{h.emotion}</strong>
              <span style={{ fontSize:'0.7rem', color:'var(--muted)' }}>({h.mode || 'toggle'})</span>
              <button className="obs-btn ghost" onClick={() => removeHotkey(i)}
                style={{ marginLeft:'auto', fontSize:'0.68rem', padding:'0.15rem 0.4rem' }}>✕</button>
            </div>
          ))}

          <div style={{ display:'flex', gap:'0.5rem', alignItems:'center', marginTop:'0.5rem', flexWrap:'wrap' }}>
            <button
              className="obs-btn ghost"
              style={{ fontSize:'0.75rem', minWidth:110 }}
              onKeyDown={listeningKey ? captureKey : undefined}
              onClick={() => setListeningKey(true)}
            >
              {listeningKey ? '⌨ Appuyer une touche…' : newHotkeyCode || 'Capturer touche'}
            </button>
            <select value={newHotkeyEmotion} onChange={e => setNewHotkeyEmotion(e.target.value)}
              style={{ background:'var(--bg2)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:4, padding:'0.25rem 0.4rem', fontSize:'0.75rem' }}>
              <option value="">— émotion —</option>
              {emotions.map(e => <option key={e.key} value={e.key}>{e.key}</option>)}
            </select>
            <select value={newHotkeyMode} onChange={e => setNewHotkeyMode(e.target.value)}
              style={{ background:'var(--bg2)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:4, padding:'0.25rem 0.4rem', fontSize:'0.75rem' }}>
              <option value="toggle">Toggle</option>
              <option value="hold">Hold</option>
            </select>
            <button className="obs-btn" onClick={addHotkey}
              disabled={!newHotkeyCode || !newHotkeyEmotion}
              style={{ fontSize:'0.75rem' }}>+ Ajouter</button>
          </div>
        </section>
      )}

      <button className="obs-btn" onClick={save} disabled={saving || !selectedToken} style={{ minWidth:120 }}>
        {saving ? 'Sauvegarde…' : 'Sauvegarder'}
      </button>
    </div>
  );
}
