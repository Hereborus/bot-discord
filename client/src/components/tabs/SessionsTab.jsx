import { useState, useEffect } from 'react';
import { apiJson, apiPost, apiFetch } from '../../api.js';

export function SessionsTab({ toast }) {
  const [sessions, setSessions]     = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading]       = useState(false);
  const [newName, setNewName]       = useState('');
  const [inviteForm, setInviteForm] = useState({ sessionId: null, discordId: '', streamName: '' });

  const load = async () => {
    setLoading(true);
    try {
      const [sessData, invData] = await Promise.all([
        apiJson('/api/sessions'),
        apiJson('/api/my-invitations'),
      ]);
      setSessions(sessData.sessions || []);
      setInvitations(invData.invitations || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  async function createSession() {
    if (!newName.trim()) return;
    try {
      await apiPost('/api/sessions', { name: newName.trim(), type: 'standalone' });
      setNewName('');
      toast('Session créée');
      load();
    } catch (e) { toast(e.message); }
  }

  async function endSession(id) {
    try {
      await apiPost(`/api/sessions/${id}/end`, {});
      toast('Session terminée');
      load();
    } catch (e) { toast(e.message); }
  }

  async function leaveSession(id) {
    try {
      await apiPost(`/api/sessions/${id}/leave`, {});
      toast('Vous avez quitté la session');
      load();
    } catch (e) { toast(e.message); }
  }

  async function sendInvite() {
    const { sessionId, discordId, streamName } = inviteForm;
    if (!sessionId || !discordId.trim()) return;
    try {
      await apiPost('/api/invitations', { sessionId, invitedDiscordId: discordId.trim(), streamName });
      toast('Invitation envoyée');
      setInviteForm({ sessionId: null, discordId: '', streamName: '' });
    } catch (e) { toast(e.message); }
  }

  async function acceptInvitation(id) {
    try {
      await apiPost(`/api/invitations/${id}/accept`, {});
      toast('Invitation acceptée');
      load();
    } catch (e) { toast(e.message); }
  }

  async function declineInvitation(id) {
    try {
      await apiPost(`/api/invitations/${id}/decline`, {});
      toast('Invitation refusée');
      load();
    } catch (e) { toast(e.message); }
  }

  return (
    <div className="panel active" id="panel-sessions">
      <h2 style={{ fontSize: '1rem', marginBottom: '1rem' }}>Sessions collaboratives</h2>

      {/* Créer session */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="Nom de la session"
          onKeyDown={e => e.key === 'Enter' && createSession()}
          style={{ flex: 1, padding: '0.4rem 0.6rem', background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--r)', fontSize: '0.8rem' }}
        />
        <button className="obs-btn" onClick={createSession}>Créer</button>
      </div>

      {/* Invitations reçues */}
      {invitations.length > 0 && (
        <section style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>Invitations reçues</h3>
          {invitations.map(inv => (
            <div key={inv.id} style={{ padding: '0.5rem 0.75rem', background: 'var(--bg3)', borderRadius: 'var(--r)', marginBottom: '0.4rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text)' }}>
                <strong>{inv.session_name}</strong>
                {inv.stream_name && <> — {inv.stream_name}</>}
              </span>
              <div style={{ display: 'flex', gap: '0.3rem' }}>
                <button className="obs-btn" style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }} onClick={() => acceptInvitation(inv.id)}>Accepter</button>
                <button className="obs-btn ghost" style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }} onClick={() => declineInvitation(inv.id)}>Refuser</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Mes sessions */}
      {loading ? (
        <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>Chargement…</div>
      ) : sessions.length === 0 ? (
        <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>Aucune session active.</div>
      ) : sessions.map(s => (
        <div key={s.id} style={{ padding: '0.75rem', background: 'var(--bg3)', borderRadius: 'var(--r)', marginBottom: '0.75rem', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{s.name}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Type: {s.type} — Créée le {new Date(s.created_at).toLocaleDateString()}</div>
            </div>
            <div style={{ display: 'flex', gap: '0.3rem' }}>
              <button
                className="obs-btn ghost"
                style={{ fontSize: '0.7rem' }}
                onClick={() => setInviteForm({ sessionId: s.id, discordId: '', streamName: '' })}
              >
                + Inviter
              </button>
              <button className="obs-btn ghost" style={{ fontSize: '0.7rem' }} onClick={() => leaveSession(s.id)}>Quitter</button>
              {s.owner_discord_id && (
                <button className="obs-btn" style={{ fontSize: '0.7rem', background: 'var(--danger, #e74c3c)', borderColor: 'var(--danger, #e74c3c)' }} onClick={() => endSession(s.id)}>Terminer</button>
              )}
            </div>
          </div>

          {/* Formulaire invitation inline */}
          {inviteForm.sessionId === s.id && (
            <div style={{ marginTop: '0.75rem', padding: '0.5rem', background: 'var(--bg2)', borderRadius: 6, display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <input
                value={inviteForm.discordId}
                onChange={e => setInviteForm(f => ({ ...f, discordId: e.target.value }))}
                placeholder="Discord ID"
                style={{ width: 160, padding: '0.3rem 0.5rem', background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, fontSize: '0.75rem' }}
              />
              <input
                value={inviteForm.streamName}
                onChange={e => setInviteForm(f => ({ ...f, streamName: e.target.value }))}
                placeholder="Nom stream (optionnel)"
                style={{ width: 180, padding: '0.3rem 0.5rem', background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, fontSize: '0.75rem' }}
              />
              <button className="obs-btn" style={{ fontSize: '0.72rem' }} onClick={sendInvite}>Envoyer</button>
              <button className="obs-btn ghost" style={{ fontSize: '0.72rem' }} onClick={() => setInviteForm({ sessionId: null, discordId: '', streamName: '' })}>Annuler</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
