import { useApp } from '../../context/AppContext.jsx';
import { useAudioStates } from '../../hooks/useAudioStates.js';
import { getApiBase } from '../../api.js';

export function ExperimentTab() {
  const { configData, levels, audioConfig } = useApp();
  const { allStates, stateColor, isClosedState, isEmotionSilent } = useAudioStates(audioConfig);

  const tokens = Object.keys(configData);

  if (!tokens.length) {
    return (
      <div className="panel active" id="panel-experiment">
        <div className="empty-state">
          <div className="icon">🧪</div>
          <p>Aucun utilisateur connecté.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel active" id="panel-experiment">
      <h2 style={{ fontSize: '1rem', marginBottom: '1rem' }}>Expérimentation — Prévisualisation des frames</h2>
      {tokens.map(token => {
        const user = configData[token];
        return (
          <div key={token} style={{ marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '0.85rem', marginBottom: '0.75rem', color: 'var(--text)' }}>
              {user.displayName || token}
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {allStates.map(state => {
                const frames = user.states?.[state] || [];
                const color = stateColor(state);
                return (
                  <div
                    key={state}
                    style={{ padding: '0.4rem 0.5rem', background: 'var(--bg3)', border: `1px solid ${color}33`, borderRadius: 6, minWidth: 80, textAlign: 'center' }}
                  >
                    <div style={{ fontSize: '0.65rem', color, fontWeight: 600, marginBottom: '0.3rem', textTransform: 'uppercase' }}>
                      {state}
                    </div>
                    {frames.length > 0 ? (
                      <img
                        src={`${getApiBase()}${frames[0].url.replace(getApiBase(), '')}`}
                        alt={state}
                        style={{ maxWidth: 64, maxHeight: 64, display: 'block', margin: '0 auto' }}
                      />
                    ) : (
                      <div style={{ width: 64, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto', color: 'var(--muted)', fontSize: '0.65rem' }}>
                        vide
                      </div>
                    )}
                    <div style={{ fontSize: '0.6rem', color: 'var(--muted)', marginTop: '0.2rem' }}>
                      {frames.length} frame{frames.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
