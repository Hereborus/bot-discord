import { useApp } from '../../context/AppContext.jsx';
import { setApiBase } from '../../api.js';
import { NotificationBell } from '../ui/NotificationBell.jsx';

const TIER_COLORS = { premium: '#2563eb', streamer: '#7c3aed' };

export function Header({ onOpenObsModal, onOpenViewer, notifications, onMarkRead, onMarkAllRead }) {
  const { apiHost, setApiHost, apiConnected, authUser, tier } = useApp();

  function handleApiHostChange(e) {
    setApiHost(e.target.value);
    setApiBase(e.target.value);
  }

  const dotClass = `api-dot${apiConnected === true ? ' ok' : apiConnected === false ? ' err' : ''}`;

  return (
    <header>
      <div className="logo">PNG<em>Tuber</em></div>

      <div className="api-row">
        <span className={dotClass} />
        <label>BOT</label>
        <input
          className="api-input"
          value={apiHost}
          onChange={handleApiHostChange}
          placeholder="auto"
        />
      </div>

      {authUser && (
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: 'var(--muted)' }}>
          {tier !== 'free' && (
            <span style={{ fontSize: '0.6rem', padding: '0.15rem 0.4rem', borderRadius: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', background: TIER_COLORS[tier] || '#555', color: '#fff' }}>
              {tier}
            </span>
          )}
          <span>{authUser.username}</span>
          <NotificationBell
            notifications={notifications}
            onMarkRead={onMarkRead}
            onMarkAllRead={onMarkAllRead}
          />
          <a href="/auth/logout" style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: '0.7rem' }}>
            Déconnexion
          </a>
        </div>
      )}

      <div className="hflex ml">
        <button className="obs-btn ghost" onClick={onOpenObsModal}>URL OBS</button>
        <button className="obs-btn" onClick={onOpenViewer}>▶ Viewer</button>
      </div>
    </header>
  );
}
