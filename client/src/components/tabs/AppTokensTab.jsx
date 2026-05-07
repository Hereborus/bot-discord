import { useState, useEffect } from 'react';
import { apiJson, apiDelete } from '../../api.js';

export function AppTokensTab({ toast }) {
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiJson('/api/app-tokens');
      setTokens(data.tokens || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  async function revoke(id) {
    if (!confirm('Révoquer ce token ?')) return;
    try {
      await apiDelete(`/api/app-tokens/${id}`);
      toast('Token révoqué');
      load();
    } catch (e) { toast(e.message); }
  }

  return (
    <div className="panel active" id="panel-apptokens">
      <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Tokens d'application</h2>
      <p style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: '1rem' }}>
        Ces tokens permettent aux agents locaux (mini-app, scripts) de s'authentifier via Bearer token.
        Générez un token depuis la page Device Auth de votre application.
      </p>

      {loading ? (
        <div style={{ color: 'var(--muted)' }}>Chargement…</div>
      ) : tokens.length === 0 ? (
        <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>Aucun token actif.</div>
      ) : (
        <div>
          {tokens.map(t => (
            <div key={t.id} style={{ padding: '0.5rem 0.75rem', background: 'var(--bg3)', borderRadius: 'var(--r)', marginBottom: '0.4rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text)' }}>{t.device_name || 'Agent'}</div>
                <div style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>
                  Créé le {new Date(t.created_at).toLocaleString()}
                  {t.last_used_at && ` — Dernière utilisation: ${new Date(t.last_used_at).toLocaleString()}`}
                </div>
              </div>
              <button
                className="obs-btn ghost"
                style={{ fontSize: '0.7rem', color: 'var(--danger, #e74c3c)', borderColor: 'var(--danger, #e74c3c)' }}
                onClick={() => revoke(t.id)}
              >
                Révoquer
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
