// Dérive les états audio/émotions depuis audioConfig.
// Utilisé par AvatarsTab, AudioTab, ExperimentTab.
export function useAudioStates(audioConfig) {
  const sorted = [...audioConfig.thresholds].sort((a, b) => a.db - b.db);

  // ['silent', 'low', 'medium', 'high']
  const audioStates = ['silent', ...sorted.map(t => t.key)];

  // Tous les états exposés dans la grille upload
  const allStates = [
    ...audioStates.flatMap(s => [s, `${s}_closed`]),
    ...(audioConfig.emotions || []).flatMap(e => [e.key, `${e.key}_silent`]),
  ];

  function isClosedState(key)    { return key.endsWith('_closed'); }
  function isEmotionSilent(key)  { return key.endsWith('_silent') && !audioStates.includes(key.replace(/_silent$/, '')); }
  function baseState(key)        { return key.replace(/_closed$|_silent$/, ''); }
  function isAudioState(key)     { return audioStates.includes(key); }
  function isEmotion(key)        { return !isAudioState(key) && !isClosedState(key) && !isEmotionSilent(key); }

  function stateColor(key) {
    const base = baseState(key);
    const t  = audioConfig.thresholds.find(t => t.key === base);
    if (t) return t.color;
    if (base === 'silent') return 'var(--c-silent)';
    const em = (audioConfig.emotions || []).find(e => e.key === base);
    return em?.color || 'var(--accent)';
  }

  return { audioStates, allStates, isClosedState, isEmotionSilent, baseState, isAudioState, isEmotion, stateColor };
}
