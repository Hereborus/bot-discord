import { useState, useEffect } from 'react';
import { apiJson } from '../../api.js';

export function DbViewTab() {
  const [stats, setStats]   = useState(null);
  const [frames, setFrames] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiJson('/api/db/stats'),
      apiJson('/api/db/frames'),
    ])
      .then(([s, f]) => { setStats(s); setFrames(f.frames || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function formatBytes(n) {
    if (n < 1024) return `${n} o`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
    return `${(n / 1024 / 1024).toFixed(2)} Mo`;
  }

  return (
    <div className="panel active" id="panel-dbview">
      <h2 style={{ fontSize: '1rem', marginBottom: '1rem' }}>Base de données</h2>

      {loading ? (
        <div style={{ color: 'var(--muted)' }}>Chargement…</div>
      ) : (
        <>
          {stats && (
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
              {[
                { label: 'Utilisateurs', value: stats.user_count },
                { label: 'Frames',       value: stats.frame_count },
                { label: 'Taille totale', value: formatBytes(stats.total_size || 0) },
              ].map(s => (
                <div key={s.label} style={{ padding: '0.5rem 0.75rem', background: 'var(--bg3)', borderRadius: 'var(--r)', minWidth: 100 }}>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--accent)' }}>{s.value}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>
                  {['Utilisateur', 'Token', 'État', 'Fichier', 'Ext', 'Taille', 'Créé le'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '0.3rem 0.4rem', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {frames.map((f, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)', opacity: 0.9 }}>
                    <td style={{ padding: '0.3rem 0.4rem' }}>{f.display_name || '???'}</td>
                    <td style={{ padding: '0.3rem 0.4rem', fontFamily: 'monospace', fontSize: '0.7rem', color: 'var(--muted)' }}>{f.token?.slice(0, 8)}…</td>
                    <td style={{ padding: '0.3rem 0.4rem' }}>{f.state_key}</td>
                    <td style={{ padding: '0.3rem 0.4rem', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.filename}</td>
                    <td style={{ padding: '0.3rem 0.4rem' }}>{f.original_ext || 'webp'}</td>
                    <td style={{ padding: '0.3rem 0.4rem' }}>{formatBytes(f.file_size || 0)}</td>
                    <td style={{ padding: '0.3rem 0.4rem', color: 'var(--muted)' }}>{f.created_at ? new Date(f.created_at).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
