import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { useAudioStates } from '../../hooks/useAudioStates.js';

function UserCardImpl({ token, levelInfo, onOpenSettings }) {
  const { configData, audioConfig, effectiveRole, myToken } = useApp();
  const user = configData[token] || { displayName: '???', states: {} };
  const { isClosedState } = useAudioStates(audioConfig);

  const [currentFrame, setCurrentFrame] = useState(null);
  const [currentState, setCurrentState] = useState('silent');
  const canvasRef = useRef(null);
  const flipRef   = useRef({ intervalId: null, frames: [], idx: 0 });
  // Refs pour les valeurs live : evite que le useEffect canvas se ré-init a chaque tick.
  const freqRef     = useRef({ low: 0, mid: 0, high: 0 });
  const speakingRef = useRef(false);
  const smoothRef   = useRef({ low: 0, mid: 0, high: 0 });

  const db       = levelInfo?.db ?? -100;
  const speaking = levelInfo?.speaking ?? false;
  const freq     = levelInfo?.freq ?? { low: 0, mid: 0, high: 0 };

  // Met a jour les refs sans declencher de re-render
  freqRef.current     = freq;
  speakingRef.current = speaking;

  // Resoudre l'etat actif en fonction des seuils
  const resolveState = useCallback(() => {
    if (!speaking) return 'silent';
    const sorted = [...audioConfig.thresholds].sort((a, b) => b.db - a.db);
    for (const t of sorted) {
      if (db >= t.db) return t.key;
    }
    return 'silent';
  }, [db, speaking, audioConfig.thresholds]);

  // Lancer le flipbook sur l'etat courant
  useEffect(() => {
    const state    = resolveState();
    const closedSt = `${state}_closed`;
    const frames   = user.states[speaking ? state : closedSt] || user.states[state] || [];
    if (!frames.length) { setCurrentFrame(null); return; }

    clearInterval(flipRef.current.intervalId);
    flipRef.current = { frames, idx: 0 };
    setCurrentFrame(frames[0]?.url || null);
    setCurrentState(state);

    if (frames.length > 1) {
      flipRef.current.intervalId = setInterval(() => {
        flipRef.current.idx = (flipRef.current.idx + 1) % flipRef.current.frames.length;
        setCurrentFrame(flipRef.current.frames[flipRef.current.idx]?.url || null);
      }, audioConfig.frameSpeed || 150);
    }
    return () => clearInterval(flipRef.current.intervalId);
  }, [resolveState, user.states, audioConfig.frameSpeed, speaking]);

  // Canvas audio bars — initialise UNE fois au mount, lit freq/speaking depuis les refs
  // a chaque frame. Plus de re-init du canvas a chaque tick polling 10x/s.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    let animId;
    function draw() {
      const f  = freqRef.current;
      const sp = speakingRef.current;
      const s  = smoothRef.current;
      s.low  += (f.low  - s.low)  * 0.2;
      s.mid  += (f.mid  - s.mid)  * 0.2;
      s.high += (f.high - s.high) * 0.2;

      ctx.clearRect(0, 0, W, H);
      const bars = [
        { val: s.low,  color: '#4a90e2' },
        { val: s.mid,  color: '#f0a500' },
        { val: s.high, color: '#e74c6c' },
      ];
      const bw = W / bars.length - 2;
      for (let i = 0; i < bars.length; i++) {
        const b = bars[i];
        const h = Math.max(2, b.val * H);
        ctx.fillStyle = b.color;
        ctx.globalAlpha = sp ? 0.8 : 0.25;
        ctx.fillRect(i * (bw + 2), H - h, bw, h);
      }
      ctx.globalAlpha = 1;
      animId = requestAnimationFrame(draw);
    }
    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, []); // Init UNE fois au mount

  const canEdit = effectiveRole === 'admin' || token === myToken;

  return (
    <div className="profile-card">
      <div className="profile-card-header">
        <span className="profile-name">{user.displayName}</span>
        <span className={`speaking-pill${speaking ? ' on' : ''}`}>
          {speaking ? '🎙 parle' : '🔇 silencieux'}
        </span>
      </div>

      {/* Avatar live */}
      <div className="profile-card-stage" style={{ position: 'relative', minHeight: 120 }}>
        {currentFrame
          ? <img src={currentFrame} alt="" style={{ maxWidth: '100%', maxHeight: 180, display: 'block', margin: '0 auto' }} />
          : <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem 0' }}>Aucune frame</div>
        }
        <canvas ref={canvasRef} style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: 32, opacity: 0.7 }} />
      </div>

      <div style={{ fontSize: '0.68rem', color: 'var(--muted)', padding: '0.2rem 0.5rem' }}>
        {db > -100 ? `${db.toFixed(1)} dB — ${currentState}` : 'silence'}
      </div>

      {canEdit && (
        <div className="profile-card-actions">
          <button className="obs-btn" style={{ fontSize: '0.7rem' }} onClick={() => onOpenSettings(token)}>
            ⚙ Configurer
          </button>
        </div>
      )}
    </div>
  );
}

// Memo : evite le re-render quand seules d'autres cartes (autres tokens) changent.
// Comparaison shallow par defaut sur token + onOpenSettings (ref stable depuis parent)
// + levelInfo (objet recree a chaque poll, mais seulement les cartes dont l'objet change ré-rendent).
export const UserCard = memo(UserCardImpl);
