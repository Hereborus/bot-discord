import { useState } from 'react';

export function NotificationBell({ notifications, onMarkRead, onMarkAllRead }) {
  const [open, setOpen] = useState(false);
  const unread = notifications.filter(n => !n.read);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', position: 'relative', fontSize: '1rem', padding: '0.1rem 0.3rem' }}
        title="Notifications"
      >
        🔔
        {unread.length > 0 && (
          <span style={{ position: 'absolute', top: '-2px', right: 0, background: '#e74c3c', color: '#fff', fontSize: '0.55rem', minWidth: 14, height: 14, lineHeight: '14px', textAlign: 'center', borderRadius: 7, fontWeight: 700 }}>
            {unread.length > 9 ? '9+' : unread.length}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Overlay invisible pour fermer au clic extérieur */}
          <div style={{ position: 'fixed', inset: 0, zIndex: 998 }} onClick={() => setOpen(false)} />
          <div style={{ position: 'absolute', top: '2rem', right: 0, width: 320, maxHeight: 360, overflowY: 'auto', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 999, padding: '0.5rem 0' }}>
            <div style={{ padding: '0.3rem 0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', marginBottom: '0.3rem' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text)' }}>Notifications</span>
              <button onClick={() => { onMarkAllRead(); }} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.65rem' }}>
                Tout lire
              </button>
            </div>
            <div style={{ fontSize: '0.72rem' }}>
              {notifications.length === 0 ? (
                <div style={{ padding: '0.5rem 0.75rem', color: 'var(--muted)', textAlign: 'center' }}>Aucune notification</div>
              ) : notifications.map(n => (
                <NotifItem key={n.id} notif={n} onMarkRead={onMarkRead} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function NotifItem({ notif, onMarkRead }) {
  const payload = typeof notif.payload_json === 'string'
    ? JSON.parse(notif.payload_json)
    : (notif.payload || {});

  let text = '';
  if (notif.type === 'invitation') {
    const who  = payload.inviterName || 'Quelqu\'un';
    const sess = payload.streamName || payload.sessionName || 'une session';
    text = `${who} vous invite à rejoindre ${sess}`;
  } else if (notif.type === 'invitation_accepted') {
    text = `${payload.participantName || 'Un utilisateur'} a rejoint votre session`;
  } else if (notif.type === 'session_started') {
    text = `Session ${payload.sessionName || ''} démarrée`;
  } else {
    text = payload.message || notif.type;
  }

  return (
    <div
      onClick={() => onMarkRead(notif.id)}
      style={{ padding: '0.4rem 0.75rem', borderBottom: '1px solid var(--border)', opacity: notif.read ? 0.5 : 1, background: notif.read ? '' : 'rgba(91,79,245,0.06)', cursor: 'pointer' }}
    >
      <div style={{ color: 'var(--text)', lineHeight: 1.4 }}>{text}</div>
      <div style={{ fontSize: '0.6rem', color: 'var(--muted)', marginTop: '0.15rem' }}>
        {new Date(notif.created_at).toLocaleString()}
      </div>
    </div>
  );
}
