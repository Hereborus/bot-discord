import { useEffect, useRef } from 'react';
import { getApiBase } from '../api.js';

// Connexion WebSocket avec reconnexion automatique (5s après fermeture).
// onMessage reçoit l'objet JSON parsé.
export function useWebSocket(onMessage) {
  const onMsgRef = useRef(onMessage);
  onMsgRef.current = onMessage;

  useEffect(() => {
    let ws = null;
    let retryTimer = null;
    let destroyed = false;

    function connect() {
      if (destroyed) return;
      try {
        const base = getApiBase();
        const proto = base.startsWith('https') ? 'wss' : 'ws';
        const host  = base.replace(/^https?:\/\//, '');
        ws = new WebSocket(`${proto}://${host}`);

        ws.onmessage = evt => {
          try { onMsgRef.current?.(JSON.parse(evt.data)); } catch {}
        };
        ws.onclose = () => {
          if (!destroyed) retryTimer = setTimeout(connect, 5000);
        };
        ws.onerror = () => ws.close();
      } catch {}
    }

    connect();
    return () => {
      destroyed = true;
      clearTimeout(retryTimer);
      ws?.close();
    };
  }, []);
}
