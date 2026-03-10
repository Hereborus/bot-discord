import { useApp } from '../../context/AppContext.jsx';
import { UserCard } from '../avatars/UserCard.jsx';

export function AvatarsTab({ onOpenSettings }) {
  const { levels, botStatus, configData, apiConnected, effectiveRole, myToken } = useApp();

  const tokens = Object.keys(levels).filter(t => {
    if (effectiveRole === 'client' && myToken && t !== myToken) return false;
    return true;
  });

  // État vide
  if (!tokens.length) {
    let icon = '🎙️', msg = 'Connexion au bot…';
    if (apiConnected === false) {
      icon = '⚠️'; msg = 'Le bot Discord n\'est pas connecté.';
    } else if (apiConnected === true && !botStatus.connected) {
      icon = '⚠️'; msg = 'Le bot Discord n\'est pas connecté.';
    } else if (botStatus.connected && !botStatus.inVoice) {
      icon = '🔊'; msg = 'Rejoins un salon vocal depuis la sidebar pour commencer.';
    } else if (botStatus.inVoice) {
      icon = '🎙️'; msg = `Connecté à ${botStatus.channelName || 'canal'} — en attente de parole…`;
    }
    return (
      <div className="panel active" id="panel-avatars">
        <div className="empty-state">
          <div className="icon">{icon}</div>
          <p dangerouslySetInnerHTML={{ __html: msg }} />
        </div>
      </div>
    );
  }

  return (
    <div className="panel active" id="panel-avatars">
      <div className="profile-cards-grid">
        {tokens.map(token => (
          <UserCard
            key={token}
            token={token}
            levelInfo={levels[token]}
            onOpenSettings={onOpenSettings}
          />
        ))}
      </div>
    </div>
  );
}
