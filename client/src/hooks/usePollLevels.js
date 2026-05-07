import { useEffect, useRef, useCallback } from 'react';
import { getApiBase } from '../api.js';
import { useApp } from '../context/AppContext.jsx';

// Polling adaptatif de /levels :
//  - intervalle par defaut 100 ms (10x/s) quand l'onglet est actif et que /levels reussit
//  - pause complete si l'onglet est cache (Page Visibility API), reprise au focus
//  - exponential backoff sur erreur reseau : 100 ms -> 200 -> 400 -> 800 -> ... cap a 5 s
//  - reset du backoff au premier succes apres erreur
//
// Charge automatiquement les frames des nouveaux tokens detectes.
export function usePollLevels(interval = 100) {
  const {
    setLevels, setBotStatus, setApiConnected,
    configData, updateConfigData,
  } = useApp();

  const configDataRef = useRef(configData);
  configDataRef.current = configData;

  // delay courant (peut grandir avec le backoff). Pas de state -> evite re-render.
  const currentDelayRef = useRef(interval);
  const timeoutRef      = useRef(null);
  const stoppedRef      = useRef(false);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/levels`, { cache: 'no-store' });
      if (!res.ok) throw new Error('not ok');
      const data = await res.json();
      setApiConnected(true);

      const { _bot, ...userLevels } = data;
      setBotStatus(_bot || { connected: false, inVoice: false });
      setLevels(userLevels);

      // Reset backoff au succes
      currentDelayRef.current = interval;

      // Charger les frames pour les nouveaux tokens
      for (const token of Object.keys(userLevels)) {
        if (configDataRef.current[token]) {
          const incoming = userLevels[token]?.displayName;
          if (incoming && configDataRef.current[token].displayName !== incoming) {
            updateConfigData(token, { displayName: incoming });
          }
          continue;
        }
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
      // Backoff exponentiel : double le delay, cap a 5 s.
      currentDelayRef.current = Math.min(currentDelayRef.current * 2, 5000);
    }
  }, [setLevels, setBotStatus, setApiConnected, updateConfigData, interval]);

  useEffect(() => {
    stoppedRef.current = false;
    currentDelayRef.current = interval;

    function scheduleNext() {
      if (stoppedRef.current) return;
      timeoutRef.current = setTimeout(async () => {
        if (stoppedRef.current) return;
        // Skip le poll si la page est cachee (tab inactif, fenetre minimisee)
        if (document.hidden) {
          scheduleNext();
          return;
        }
        await poll();
        scheduleNext();
      }, currentDelayRef.current);
    }

    // Premier poll immediat
    poll().then(scheduleNext);

    // Reprendre au focus / changement de visibilite
    function onVisibility() {
      if (!document.hidden) {
        // Reset backoff au focus pour reprendre rapidement
        currentDelayRef.current = interval;
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        poll().then(scheduleNext);
      }
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stoppedRef.current = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [poll, interval]);
}
