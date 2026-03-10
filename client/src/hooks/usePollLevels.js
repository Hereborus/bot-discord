import { useEffect, useRef, useCallback } from 'react';
import { getApiBase } from '../api.js';
import { useApp } from '../context/AppContext.jsx';

// Polling de /levels toutes les `interval` ms.
// Auto-charge les frames des nouveaux utilisateurs détectés.
export function usePollLevels(interval = 100) {
  const {
    setLevels, setBotStatus, setApiConnected,
    configData, updateConfigData,
    audioConfig,
  } = useApp();

  const configDataRef = useRef(configData);
  configDataRef.current = configData;

  const audioCfgRef = useRef(audioConfig);
  audioCfgRef.current = audioConfig;

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/levels`, { cache: 'no-store' });
      if (!res.ok) throw new Error('not ok');
      const data = await res.json();
      setApiConnected(true);

      const { _bot, ...userLevels } = data;
      setBotStatus(_bot || { connected: false, inVoice: false });
      setLevels(userLevels);

      // Charger les frames pour les nouveaux tokens
      for (const token of Object.keys(userLevels)) {
        if (configDataRef.current[token]) {
          // Mettre à jour le displayName si changé
          const incoming = userLevels[token]?.displayName;
          if (incoming && configDataRef.current[token].displayName !== incoming) {
            updateConfigData(token, { displayName: incoming });
          }
          continue;
        }
        // Nouveau user — charger ses frames
        const base = getApiBase();
        fetch(`${base}/frames/${token}`, { cache: 'no-store' })
          .then(r => r.ok ? r.json() : {})
          .then(frames => {
            updateConfigData(token, {
              displayName: userLevels[token]?.displayName || '???',
              states: frames,
            });
          })
          .catch(() => {});
      }
    } catch {
      setApiConnected(false);
    }
  }, [setLevels, setBotStatus, setApiConnected, updateConfigData]);

  useEffect(() => {
    poll();
    const id = setInterval(poll, interval);
    return () => clearInterval(id);
  }, [poll, interval]);
}
