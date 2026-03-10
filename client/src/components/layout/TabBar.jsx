import { useApp } from '../../context/AppContext.jsx';

const ALL_TABS = [
  { key: 'avatars',       label: '🏠 Accueil',         roles: ['admin', 'client', 'viewer'] },
  { key: 'audio',         label: '🎙 Audio Config',     roles: ['admin', 'client', 'viewer'] },
  { key: 'experiment',    label: '🧪 Expérimentation',  roles: ['admin', 'client', 'viewer'] },
  { key: 'setup',         label: '⚙️ Bot Setup',        roles: ['admin'] },
  { key: 'admin',         label: '👑 Admin',            roles: ['admin'] },
  { key: 'dbview',        label: '🗄 Base de données',  roles: ['admin'] },
  { key: 'sessions',      label: '📡 Sessions',         roles: ['admin', 'client'] },
  { key: 'subscriptions', label: '💎 Abonnement',       roles: ['admin', 'client'] },
  { key: 'apptokens',     label: '🔑 Applications',     roles: ['admin', 'client'] },
];

export function TabBar({ activeTab, onSwitch, botInfo }) {
  const { effectiveRole } = useApp();

  const visible = ALL_TABS.filter(t => t.roles.includes(effectiveRole));

  return (
    <div className="tabs-bar">
      {visible.map(t => (
        <button
          key={t.key}
          className={`tab-btn${activeTab === t.key ? ' active' : ''}`}
          onClick={() => onSwitch(t.key)}
        >
          {t.label}
        </button>
      ))}

      <div style={{ flex: 1 }} />

      {botInfo?.inviteUrl && effectiveRole === 'admin' && (
        <button
          className="discord-invite-btn"
          onClick={() => window.open(botInfo.inviteUrl, '_blank')}
        >
          <svg width="16" height="12" viewBox="0 0 71 55" fill="currentColor">
            <path d="M60.1 4.9A58.5 58.5 0 0045.4.2a.2.2 0 00-.2.1 40.8 40.8 0 00-1.8 3.7 54 54 0 00-16.2 0A37.3 37.3 0 0025.4.3a.2.2 0 00-.2-.1A58.4 58.4 0 0010.5 4.9a.2.2 0 00-.1.1C1.5 18.7-.9 32.2.3 45.5v.1a58.7 58.7 0 0017.7 9 .2.2 0 00.3-.1 42 42 0 003.6-5.9.2.2 0 00-.1-.3 38.6 38.6 0 01-5.5-2.6.2.2 0 010-.4l1.1-.9a.2.2 0 01.2 0 41.9 41.9 0 0035.6 0 .2.2 0 01.2 0l1.1.9a.2.2 0 010 .4 36.4 36.4 0 01-5.5 2.6.2.2 0 00-.1.3 47.2 47.2 0 003.6 5.9.2.2 0 00.3.1A58.5 58.5 0 0070.5 45.6v-.1c1.4-15-2.3-28-9.8-39.6a.2.2 0 00-.1 0zM23.7 37.3c-3.4 0-6.3-3.2-6.3-7s2.8-7 6.3-7 6.3 3.1 6.3 7-2.8 7-6.3 7zm23.2 0c-3.4 0-6.3-3.2-6.3-7s2.8-7 6.3-7 6.3 3.1 6.3 7-2.8 7-6.3 7z" />
          </svg>
          Inviter le bot
        </button>
      )}
    </div>
  );
}
