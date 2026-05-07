import { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { apiJson, apiPost, apiDelete } from '../../api.js';

export function SubscriptionsTab({ toast }) {
  const { effectiveRole, tier } = useApp();
  const [sub, setSub]     = useState(null);
  const [seats, setSeats] = useState([]);
  const [loading, setLoading] = useState(true);
  // Admin — formulaire d'attribution
  const [adminForm, setAdminForm] = useState({ discordId: '', tier: 'premium', maxSeats: 1, expiresAt: '' });
  // Streamer — ajout siège
  const [newSeatId, setNewSeatId] = useState('');

  const isAdmin = effectiveRole === 'admin';

  const load = async () => {
    setLoading(true);
    try {
      const [subData, seatsData] = await Promise.all([
        apiJson('/api/subscription'),
        apiJson('/api/subscription/seats').catch(() => ({ seats: [] })),
      ]);
      setSub(subData.subscription || null);
      setSeats(seatsData.seats || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  async function adminSet() {
    try {
      await apiPost('/api/subscription', {
        discordId: adminForm.discordId,
        tier: adminForm.tier,
        maxSeats: Number(adminForm.maxSeats),
        expiresAt: adminForm.expiresAt || null,
      });
      toast('Abonnement attribué');
      load();
    } catch (e) { toast(e.message); }
  }

  async function adminCancel() {
    if (!adminForm.discordId) return;
    try {
      await apiDelete(`/api/subscription/${adminForm.discordId}`);
      toast('Abonnement annulé');
      load();
    } catch (e) { toast(e.message); }
  }

  async function addSeat() {
    if (!newSeatId.trim()) return;
    try {
      await apiPost('/api/subscription/seats', { discordId: newSeatId.trim() });
      setNewSeatId('');
      toast('Siège ajouté');
      load();
    } catch (e) { toast(e.message); }
  }

  async function removeSeat(discordId) {
    try {
      await apiDelete(`/api/subscription/seats/${discordId}`);
      toast('Siège retiré');
      load();
    } catch (e) { toast(e.message); }
  }

  const TIER_LABELS = { free: 'Gratuit', premium: 'Premium', streamer: 'Streamer' };
  const TIER_COLORS = { free: '#888', premium: '#2563eb', streamer: '#7c3aed' };

  return (
    <div className="panel active" id="panel-subscriptions">
      <h2 style={{ fontSize: '1rem', marginBottom: '1rem' }}>Abonnement</h2>

      {loading ? (
        <div style={{ color: 'var(--muted)' }}>Chargement…</div>
      ) : (
        <>
          {/* Mon tier actuel */}
          <div style={{ padding: '0.75rem', background: 'var(--bg3)', borderRadius: 'var(--r)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ padding: '0.2rem 0.6rem', borderRadius: 4, fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', background: TIER_COLORS[tier] || '#888', color: '#fff' }}>
              {TIER_LABELS[tier] || tier}
            </span>
            {sub && (
              <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                {sub.expires_at ? `Expire le ${new Date(sub.expires_at).toLocaleDateString()}` : 'Sans expiration'}
              </span>
            )}
          </div>

          {/* Sièges streamer */}
          {(tier === 'streamer' || isAdmin) && (
            <section style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>Sièges ({seats.length} utilisé(s))</h3>
              {seats.map(s => (
                <div key={s.discord_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.35rem 0.6rem', background: 'var(--bg2)', borderRadius: 4, marginBottom: '0.3rem' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text)' }}>{s.discord_id}</span>
                  <button className="obs-btn ghost" style={{ fontSize: '0.65rem', padding: '0.15rem 0.4rem', color: 'var(--danger, #e74c3c)', borderColor: 'var(--danger, #e74c3c)' }} onClick={() => removeSeat(s.discord_id)}>
                    Retirer
                  </button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <input
                  value={newSeatId}
                  onChange={e => setNewSeatId(e.target.value)}
                  placeholder="Discord ID"
                  style={{ flex: 1, padding: '0.3rem 0.5rem', background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, fontSize: '0.78rem' }}
                />
                <button className="obs-btn" style={{ fontSize: '0.75rem' }} onClick={addSeat}>+ Ajouter</button>
              </div>
            </section>
          )}

          {/* Panel admin */}
          {isAdmin && (
            <section>
              <h3 style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>Attribuer un abonnement (admin)</h3>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                <input
                  value={adminForm.discordId}
                  onChange={e => setAdminForm(f => ({ ...f, discordId: e.target.value }))}
                  placeholder="Discord ID"
                  style={{ width: 160, padding: '0.3rem 0.5rem', background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, fontSize: '0.75rem' }}
                />
                <select
                  value={adminForm.tier}
                  onChange={e => setAdminForm(f => ({ ...f, tier: e.target.value }))}
                  style={{ padding: '0.3rem 0.5rem', background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, fontSize: '0.75rem' }}
                >
                  <option value="premium">Premium</option>
                  <option value="streamer">Streamer</option>
                </select>
                <input
                  type="number" min={1} max={50}
                  value={adminForm.maxSeats}
                  onChange={e => setAdminForm(f => ({ ...f, maxSeats: e.target.value }))}
                  placeholder="Sièges"
                  style={{ width: 70, padding: '0.3rem 0.5rem', background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, fontSize: '0.75rem' }}
                />
                <input
                  type="date"
                  value={adminForm.expiresAt}
                  onChange={e => setAdminForm(f => ({ ...f, expiresAt: e.target.value }))}
                  style={{ padding: '0.3rem 0.5rem', background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, fontSize: '0.75rem' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="obs-btn" style={{ fontSize: '0.75rem' }} onClick={adminSet}>Attribuer</button>
                <button className="obs-btn ghost" style={{ fontSize: '0.75rem', color: 'var(--danger, #e74c3c)', borderColor: 'var(--danger, #e74c3c)' }} onClick={adminCancel}>Annuler</button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
