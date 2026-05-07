import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { apiJson, apiPost, apiFetch } from '../../api.js';
import { useAudioStates } from '../../hooks/useAudioStates.js';

// ── Helpers ───────────────────────────────────────────────────────────────────
function hz(v)    { return v > 0 ? `${Math.round(v)} Hz` : '—'; }
function fmtDb(v) { return typeof v === 'number' ? `${v.toFixed(1)} dB` : '—'; }

// Qualité du profil vocal selon le nombre de frames collectées
function profileQuality(n) {
  if (n >= 1000) return { label: 'Excellent', color: '#00d4aa' };
  if (n >= 400)  return { label: 'Bon',       color: '#90e060' };
  if (n >= 150)  return { label: 'Minimal (affinage actif)', color: '#f0a500' };
  return { label: `En cours… (${n}/150)`, color: 'var(--muted)' };
}

// Estime la std à partir du spread IQR du profil vocal (p75-p25)/1.35 ≈ σ
function iqrStd(stats, key, fallback) {
  const m = stats?.markers?.[key];
  if (!m || m.p75 === undefined || m.p25 === undefined) return fallback;
  return Math.max((m.p75 - m.p25) / 1.35, fallback * 0.3);
}

// ── Composant principal ───────────────────────────────────────────────────────
export function AudioTab({ toast }) {
  const { configData, audioConfig, setAudioConfig, levels } = useApp();
  const [selectedToken, setSelectedToken] = useState('');
  const [saving, setSaving]               = useState(false);
  const [fingerprints, setFingerprints]   = useState({});
  const [addingEmotion, setAddingEmotion] = useState(false);
  const [newEmotionKey, setNewEmotionKey] = useState('');
  const [newEmotionColor, setNewEmotionColor] = useState('#00d4aa');
  const [capturing, setCapturing]         = useState(null); // clé d'émotion en cours de capture
  const [voiceProfile, setVoiceProfile]   = useState(null);
  const [newHotkeyCode, setNewHotkeyCode]     = useState('');
  const [newHotkeyEmotion, setNewHotkeyEmotion] = useState('');
  const [newHotkeyMode, setNewHotkeyMode]     = useState('toggle');
  const [listeningKey, setListeningKey]       = useState(false);

  const { audioStates } = useAudioStates(audioConfig);
  const tokens = Object.keys(configData);

  useEffect(() => {
    if (!selectedToken && tokens.length) setSelectedToken(tokens[0]);
  }, [tokens, selectedToken]);

  // Charger config + empreintes + profil vocal au changement de token
  useEffect(() => {
    if (!selectedToken) return;
    apiJson(`/user-config/${selectedToken}`)
      .then(cfg => {
        setAudioConfig(prev => ({ ...prev, ...cfg }));
        setFingerprints(cfg.emotionFingerprints || {});
        setVoiceProfile(cfg.voiceProfile || null);
      })
      .catch(() => {});
  }, [selectedToken, setAudioConfig]);

  // ── Sauvegarde config ────────────────────────────────────────────────────────
  const save = async () => {
    if (!selectedToken) return;
    setSaving(true);
    try {
      await apiPost(`/user-config/${selectedToken}`, audioConfig);
      toast('Configuration sauvegardée');
    } catch (e) { toast(e.message || 'Erreur sauvegarde'); }
    setSaving(false);
  };

  const updateThreshold = (idx, field, value) => {
    setAudioConfig(prev => {
      const thresholds = [...prev.thresholds];
      thresholds[idx] = { ...thresholds[idx], [field]: value };
      return { ...prev, thresholds };
    });
  };

  // ── Émotions — ajout/suppression ─────────────────────────────────────────────
  const addEmotion = () => {
    const key = newEmotionKey.trim().toLowerCase().replace(/\s+/g, '_');
    if (!key) return;
    if ((audioConfig.emotions || []).some(e => e.key === key)) { toast('Clé déjà utilisée'); return; }
    setAudioConfig(prev => ({
      ...prev,
      emotions: [...(prev.emotions || []), { key, color: newEmotionColor, label: newEmotionKey.trim() }],
    }));
    setNewEmotionKey(''); setAddingEmotion(false);
  };

  const removeEmotion = (key) => {
    setAudioConfig(prev => ({ ...prev, emotions: (prev.emotions || []).filter(e => e.key !== key) }));
  };

  // ── Capture fingerprint — snapshot passif ────────────────────────────────────
  // Lit les valeurs live depuis levels[], calcule les std depuis le profil vocal,
  // sauvegarde directement. Aucun enregistrement temporisé nécessaire.
  const captureFingerprint = useCallback(async (emotionKey) => {
    if (!selectedToken) return;
    const live = levels[selectedToken];
    if (!live || !live.speaking) { toast('Parlez pour capturer une empreinte'); return; }
    setCapturing(emotionKey);
    try {
      const vp = voiceProfile; // stats DB (persistées) — sert pour les std
      const fp = {};

      const addM = (key, value, defaultStd) => {
        if (typeof value !== 'number' || !isFinite(value)) return;
        fp[key] = { mean: +value.toFixed(3), std: +iqrStd(vp, key, defaultStd).toFixed(3) };
      };

      addM('db',        live.db,              5);
      addM('zcr',       live.zcr,             0.03);
      addM('centroid',  live.centroid,        200);
      addM('energyVar', live.energyVar,       5);
      addM('freq_low',  live.freq?.low,       0.05);
      addM('freq_mid',  live.freq?.mid,       0.05);
      addM('freq_high', live.freq?.high,      0.05);
      if ((live.formants?.f1 || 0) > 0) addM('f1', live.formants.f1, 50);
      if ((live.formants?.f2 || 0) > 0) addM('f2', live.formants.f2, 100);
      if ((live.formants?.f3 || 0) > 0) addM('f3', live.formants.f3, 150);

      // Renommer les clés freq_* → formant_* pour les formants (convention audio.js)
      if (fp.f1) { fp['formant_f1'] = fp.f1; delete fp.f1; }
      if (fp.f2) { fp['formant_f2'] = fp.f2; delete fp.f2; }
      if (fp.f3) { fp['formant_f3'] = fp.f3; delete fp.f3; }

      await apiPost(`/calibration/${selectedToken}/save-fingerprint`, { emotionKey, fingerprint: fp });
      const cfg = await apiJson(`/user-config/${selectedToken}`);
      setFingerprints(cfg.emotionFingerprints || {});
      toast(`✓ Empreinte "${emotionKey}" capturée (${Object.keys(fp).length} marqueurs)`);
    } catch (e) { toast(e.message || 'Erreur capture'); }
    setCapturing(null);
  }, [selectedToken, levels, voiceProfile, toast]);

  const deleteFp = async (key) => {
    try {
      await apiFetch(`/calibration/${selectedToken}/fingerprint/${encodeURIComponent(key)}`, { method: 'DELETE' });
      setFingerprints(prev => { const n = { ...prev }; delete n[key]; return n; });
      toast(`Empreinte "${key}" supprimée`);
    } catch (e) { toast(e.message || 'Erreur'); }
  };

  // ── Raccourcis ────────────────────────────────────────────────────────────────
  const addHotkey = () => {
    if (!newHotkeyCode || !newHotkeyEmotion) return;
    setAudioConfig(prev => ({
      ...prev,
      emotionHotkeys: [...(prev.emotionHotkeys || []),
        { code: newHotkeyCode, emotion: newHotkeyEmotion, mode: newHotkeyMode }],
    }));
    setNewHotkeyCode(''); setNewHotkeyEmotion('');
  };
  const removeHotkey = (idx) =>
    setAudioConfig(prev => ({ ...prev, emotionHotkeys: (prev.emotionHotkeys || []).filter((_, i) => i !== idx) }));
  const captureKey = (e) => { e.preventDefault(); setNewHotkeyCode(e.code); setListeningKey(false); };

  // ── Données live ─────────────────────────────────────────────────────────────
  const live       = levels[selectedToken];
  const formants   = live?.formants  || { f1: 0, f2: 0, f3: 0 };
  const vpN        = live?.voiceProfileN || 0;
  const qual       = profileQuality(vpN);
  const emotions   = audioConfig.emotions || [];
  const hotkeys    = audioConfig.emotionHotkeys || [];

  // ── Rendu ─────────────────────────────────────────────────────────────────────
  return (
    <div className="panel active" id="panel-audio">

      {/* Sélecteur utilisateur */}
      <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', padding:'0.6rem 0.85rem', background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'var(--r)', maxWidth:520, marginBottom:'1rem' }}>
        <span style={{ fontSize:'0.75rem', color:'var(--muted)', whiteSpace:'nowrap' }}>Utilisateur :</span>
        <select value={selectedToken} onChange={e => setSelectedToken(e.target.value)}
          style={{ flex:1, background:'var(--bg2)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:4, padding:'0.3rem 0.5rem', fontSize:'0.8rem' }}>
          {tokens.map(t => <option key={t} value={t}>{configData[t]?.displayName || t}</option>)}
        </select>
      </div>

      {/* ── Live audio + profil vocal ─────────────────────────────── */}
      {live && (
        <div style={{ padding:'0.6rem 0.85rem', background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:'var(--r)', marginBottom:'1.25rem' }}>
          <div style={{ display:'flex', flexWrap:'wrap', gap:'1rem', alignItems:'center', marginBottom:'0.4rem' }}>
            <span style={{ fontSize:'0.75rem', color: live.speaking ? 'var(--accent)' : 'var(--muted)' }}>
              {live.speaking ? '🎙' : '🔇'} {fmtDb(live.db)}
            </span>
            <span style={{ fontSize:'0.75rem', color:'var(--muted)' }}>
              F1 <strong style={{ color:'var(--accent2)' }}>{hz(formants.f1)}</strong>
              {' · '}F2 <strong style={{ color:'var(--accent2)' }}>{hz(formants.f2)}</strong>
              {' · '}F3 <strong style={{ color:'var(--accent2)' }}>{hz(formants.f3)}</strong>
            </span>
            {live.detectedEmotion && (
              <span style={{ fontSize:'0.72rem', background:'var(--accent)', color:'#000', borderRadius:4, padding:'0.1rem 0.4rem', fontWeight:600 }}>
                {live.detectedEmotion}
              </span>
            )}
            <span style={{ marginLeft:'auto', fontSize:'0.7rem', color: qual.color }}>
              Profil : {qual.label}
            </span>
          </div>

          {/* Tableau profil vocal — 10 marqueurs min/p50/max depuis DB */}
          {voiceProfile && voiceProfile.n >= 150 && (
            <details style={{ marginTop:'0.4rem' }}>
              <summary style={{ fontSize:'0.68rem', color:'var(--muted)', cursor:'pointer' }}>
                Détails du profil vocal ({voiceProfile.n} frames)
              </summary>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(160px,1fr))', gap:'0.3rem', marginTop:'0.4rem' }}>
                {Object.entries(voiceProfile.markers || {}).map(([key, s]) => s && (
                  <div key={key} style={{ background:'var(--bg2)', borderRadius:4, padding:'0.25rem 0.4rem', fontSize:'0.65rem' }}>
                    <span style={{ color:'var(--accent2)', fontWeight:600 }}>{key}</span>
                    <span style={{ color:'var(--muted)', marginLeft:'0.3rem' }}>
                      {+s.min.toFixed(1)} · <strong>{+s.p50.toFixed(1)}</strong> · {+s.max.toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* ── Seuils audio ─────────────────────────────────────────── */}
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

      {/* ── Vitesse + hold ───────────────────────────────────────── */}
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

      {/* ── Émotions personnalisées ───────────────────────────────── */}
      <section style={{ marginBottom:'1.5rem' }}>
        <h3 style={{ fontSize:'0.85rem', marginBottom:'0.25rem', color:'var(--text)' }}>Émotions personnalisées</h3>
        <p style={{ fontSize:'0.72rem', color:'var(--muted)', marginBottom:'0.75rem' }}>
          Parlez dans l'état émotionnel voulu, puis cliquez <strong>Capturer</strong>.
          Le profil vocal passif affine automatiquement la détection au fil du temps.
        </p>

        {emotions.map(em => {
          const fp   = fingerprints[em.key];
          const hasFp = !!fp;
          const fpF1 = fp?.formant_f1?.mean;
          const fpF2 = fp?.formant_f2?.mean;
          const fpF3 = fp?.formant_f3?.mean;
          const isCapturing = capturing === em.key;
          return (
            <div key={em.key} style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.45rem', padding:'0.4rem 0.6rem', background:'var(--bg3)', border:`1px solid ${em.color}44`, borderRadius:'var(--r)' }}>
              <span style={{ width:10, height:10, borderRadius:'50%', background:em.color, flexShrink:0 }} />
              <span style={{ fontWeight:600, fontSize:'0.8rem', minWidth:70 }}>{em.key}</span>
              {hasFp ? (
                <span style={{ fontSize:'0.68rem', color:'var(--muted)' }}>
                  {fpF1 ? `F1 ${fpF1} · F2 ${fpF2} · F3 ${fpF3} Hz` : '✓ empreinte'}
                  {' · '}{Object.keys(fp).length} marqueurs
                </span>
              ) : (
                <span style={{ fontSize:'0.68rem', color:'var(--muted)' }}>— aucune empreinte</span>
              )}
              <div style={{ marginLeft:'auto', display:'flex', gap:'0.4rem' }}>
                <button className="obs-btn" disabled={!!capturing}
                  onClick={() => captureFingerprint(em.key)}
                  style={{ fontSize:'0.68rem', padding:'0.2rem 0.5rem', opacity: isCapturing ? 0.6 : 1 }}>
                  {isCapturing ? '…' : hasFp ? '↺ Capturer' : '⊕ Capturer'}
                </button>
                {hasFp && (
                  <button className="obs-btn ghost" onClick={() => deleteFp(em.key)}
                    style={{ fontSize:'0.68rem', padding:'0.2rem 0.5rem' }}>✕</button>
                )}
                <button className="obs-btn ghost" onClick={() => removeEmotion(em.key)}
                  style={{ fontSize:'0.68rem', padding:'0.2rem 0.5rem' }}>✕ émotion</button>
              </div>
            </div>
          );
        })}

        {addingEmotion ? (
          <div style={{ display:'flex', gap:'0.5rem', alignItems:'center', marginTop:'0.5rem' }}>
            <input type="color" value={newEmotionColor} onChange={e => setNewEmotionColor(e.target.value)}
              style={{ width:28, height:28, border:'none', borderRadius:4, cursor:'pointer', flexShrink:0 }} />
            <input placeholder="Nom (ex: joie)" value={newEmotionKey}
              onChange={e => setNewEmotionKey(e.target.value)}
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

      {/* ── Raccourcis émotions ───────────────────────────────────── */}
      {emotions.length > 0 && (
        <section style={{ marginBottom:'1.5rem' }}>
          <h3 style={{ fontSize:'0.85rem', marginBottom:'0.5rem', color:'var(--text)' }}>Raccourcis émotions</h3>
          {hotkeys.map((h, i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.3rem', fontSize:'0.8rem' }}>
              <code style={{ background:'var(--bg3)', padding:'0.1rem 0.4rem', borderRadius:3 }}>{h.code}</code>
              <span style={{ color:'var(--muted)' }}>→</span>
              <strong>{h.emotion}</strong>
              <span style={{ fontSize:'0.7rem', color:'var(--muted)' }}>({h.mode || 'toggle'})</span>
              <button className="obs-btn ghost" onClick={() => removeHotkey(i)}
                style={{ marginLeft:'auto', fontSize:'0.68rem', padding:'0.15rem 0.4rem' }}>✕</button>
            </div>
          ))}
          <div style={{ display:'flex', gap:'0.5rem', alignItems:'center', marginTop:'0.5rem', flexWrap:'wrap' }}>
            <button className="obs-btn ghost" style={{ fontSize:'0.75rem', minWidth:120 }}
              onClick={() => setListeningKey(true)}
              onKeyDown={listeningKey ? captureKey : undefined}>
              {listeningKey ? '⌨ Appuyer…' : newHotkeyCode || 'Capturer touche'}
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
              disabled={!newHotkeyCode || !newHotkeyEmotion} style={{ fontSize:'0.75rem' }}>+ Ajouter</button>
          </div>
        </section>
      )}

      <button className="obs-btn" onClick={save} disabled={saving || !selectedToken} style={{ minWidth:120 }}>
        {saving ? 'Sauvegarde…' : 'Sauvegarder'}
      </button>
    </div>
  );
}
