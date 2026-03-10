import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { apiJson, apiPost, apiFetch } from '../../api.js';

export function VoiceSidebar() {
  const { botStatus, effectiveRole } = useApp();
  const [guilds, setGuilds]           = useState([]);
  const [channels, setChannels]       = useState({});   // guildId → []
  const [expanded, setExpanded]       = useState({});   // guildId → bool
  const [autoReconnect, setAutoReconnect] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState(null); // { guildId, channelId, channelName }
  const isAdmin = effectiveRole === 'admin';

  // Charger les guilds + statut vocal
  const loadGuilds = useCallback(async () => {
    try {
      const [guildsData, statusData] = await Promise.all([
        apiJson('/api/guilds'),
        apiJson('/api/voice/status'),
      ]);
      setGuilds(guildsData.guilds || []);
      setVoiceStatus(statusData);
      setAutoReconnect(statusData.autoReconnect ?? false);
    } catch {}
  }, []);

  useEffect(() => { loadGuilds(); }, [loadGuilds]);

  async function loadChannels(guildId) {
    if (channels[guildId]) {
      setExpanded(prev => ({ ...prev, [guildId]: !prev[guildId] }));
      return;
    }
    try {
      const data = await apiJson(`/api/guilds/${guildId}/channels`);
      setChannels(prev => ({ ...prev, [guildId]: data.channels || [] }));
      setExpanded(prev => ({ ...prev, [guildId]: true }));
    } catch {}
  }

  async function joinChannel(guildId, channelId) {
    try {
      await apiPost('/api/voice/join', { guildId, channelId });
      await loadGuilds();
    } catch {}
  }

  async function disconnect() {
    try {
      await apiPost('/api/voice/disconnect', {});
      await loadGuilds();
    } catch {}
  }

  async function toggleAutoReconnect(checked) {
    try {
      await apiPost('/api/auto-reconnect', { enabled: checked });
      setAutoReconnect(checked);
    } catch {}
  }

  const connected = botStatus.inVoice;

  return (
    <div className="voice-sidebar">
      <div className="voice-sidebar-header">
        <span className={`api-dot${connected ? ' ok' : ''}`} />
        <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
          {connected ? (voiceStatus?.channelName || 'Connecté') : 'Non connecté'}
        </span>
      </div>

      <div className="voice-sidebar-guilds">
        {guilds.map(g => (
          <div key={g.id}>
            <div
              className="voice-guild-row"
              onClick={() => loadChannels(g.id)}
              style={{ cursor: 'pointer', padding: '0.3rem 0.5rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <span>{expanded[g.id] ? '▾' : '▸'}</span>
              {g.icon && <img src={g.icon} alt="" style={{ width: 16, height: 16, borderRadius: '50%' }} />}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
            </div>

            {expanded[g.id] && (channels[g.id] || []).map(ch => {
              const isActive = voiceStatus?.channelId === ch.id;
              return (
                <div
                  key={ch.id}
                  onClick={() => (isAdmin || ch.allowed) && joinChannel(g.id, ch.id)}
                  style={{ padding: '0.25rem 0.5rem 0.25rem 1.5rem', fontSize: '0.72rem', color: isActive ? 'var(--accent)' : 'var(--muted)', cursor: (isAdmin || ch.allowed) ? 'pointer' : 'default', opacity: (!isAdmin && !ch.allowed) ? 0.4 : 1 }}
                  title={isActive ? 'Canal actif' : undefined}
                >
                  🔊 {ch.name}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {connected && (
        <>
          <button
            className="obs-btn ghost voice-disconnect-btn"
            onClick={disconnect}
            style={{ fontSize: '0.7rem', margin: '0.5rem' }}
          >
            Déconnecter
          </button>
          {isAdmin && (
            <label style={{ fontSize: '0.72rem', color: 'var(--muted)', margin: '0.4rem 0.5rem', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                checked={autoReconnect}
                onChange={e => toggleAutoReconnect(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              Reconnexion auto au démarrage
            </label>
          )}
        </>
      )}
    </div>
  );
}
