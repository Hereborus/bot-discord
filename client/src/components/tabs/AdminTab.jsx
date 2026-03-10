import { useState, useEffect } from 'react';
import { apiJson, apiPost, apiDelete, apiFetch } from '../../api.js';

export function AdminTab({ toast }) {
  const [permissions, setPermissions] = useState([]);
  const [botToken, setBotToken]       = useState('');
  const [form, setForm] = useState({ discordId: '', role: 'client' });
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiJson('/api/permissions');
      setPermissions(data.users ? Object.entries(data.users).map(([id, p]) => ({ discordId: id, ...p })) : []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  async function savePermission() {
    if (!form.discordId.trim()) return;
    try {
      await apiPost('/api/permissions', { discordId: form.discordId.trim(), role: form.role });
      toast('Permission mise à jour');
      setForm({ discordId: '', role: 'client' });
      load();
    } catch (e) { toast(e.message); }
  }

  async function removePermission(id) {
    try {
      await apiDelete(`/api/permissions/${id}`);
      toast('Permission supprimée');
      load();
    } catch (e) { toast(e.message); }
  }

  async function saveBotToken() {
    if (!botToken.trim()) return;
    try {
      await apiPost('/bot-token', { token: botToken.trim() });
      toast('Token sauvegardé — redémarrage en cours…');
      setBotToken('');
    } catch (e) { toast(e.message); }
  }

  const ROLE_COLORS = { admin: '#7c3aed', client: '#2563eb', viewer: '#555' };

  return (
    <div className="panel active" id="panel-admin">
      <h2 style={{ fontSize: '1rem', marginBottom: '1.5rem' }}>Administration</h2>

      {/* Token Discord */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>Token Discord du bot</h3>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="password"
            value={botToken}
            onChange={e => setBotToken(e.target.value)}
            placeholder="Nouveau token Discord…"
            style={{ flex: 1, padding: '0.4rem 0.6rem', background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--r)', fontSize: '0.8rem' }}
          />
          <button className="obs-btn" onClick={saveBotToken}>Enregistrer</button>
        </div>
      </section>

      {/* Permissions */}
      <section>
        <h3 style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>Permissions utilisateurs</h3>

        {/* Formulaire ajout */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <input
            value={form.discordId}
            onChange={e => setForm(f => ({ ...f, discordId: e.target.value }))}
            placeholder="Discord ID"
            style={{ width: 180, padding: '0.35rem 0.5rem', background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, fontSize: '0.78rem' }}
          />
          <select
            value={form.role}
            onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
            style={{ padding: '0.35rem 0.5rem', background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, fontSize: '0.78rem' }}
          >
            <option value="admin">admin</option>
            <option value="client">client</option>
            <option value="viewer">viewer</option>
          </select>
          <button className="obs-btn" style={{ fontSize: '0.75rem' }} onClick={savePermission}>Ajouter / Modifier</button>
        </div>

        {/* Liste */}
        {loading ? (
          <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>Chargement…</div>
        ) : permissions.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>Aucune permission configurée.</div>
        ) : permissions.map(p => (
          <div key={p.discordId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0.6rem', background: 'var(--bg3)', borderRadius: 4, marginBottom: '0.3rem' }}>
            <div>
              <span style={{ fontSize: '0.82rem', color: 'var(--text)' }}>{p.displayName || p.discordId}</span>
              <span style={{ marginLeft: '0.5rem', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', color: ROLE_COLORS[p.role] || '#888' }}>
                {p.role}
              </span>
              <span style={{ marginLeft: '0.4rem', fontSize: '0.65rem', color: 'var(--muted)' }}>{p.discordId}</span>
            </div>
            <button
              className="obs-btn ghost"
              style={{ fontSize: '0.65rem', color: 'var(--danger, #e74c3c)', borderColor: 'var(--danger, #e74c3c)' }}
              onClick={() => removePermission(p.discordId)}
            >
              Supprimer
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
