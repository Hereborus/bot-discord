import { createContext, useContext, useState, useCallback, useMemo } from 'react';

const AppContext = createContext(null);

// Config audio par défaut — miroir exact de DEFAULT_AUDIO_CONFIG dans index.html
const DEFAULT_AUDIO_CONFIG = {
  thresholds: [
    { key: 'low',    label: 'Low',    db: -55, color: '#4a90e2' },
    { key: 'medium', label: 'Medium', db: -35, color: '#f0a500' },
    { key: 'high',   label: 'High',   db: -15, color: '#e74c6c' },
  ],
  emotionHoldMs: 800,
  frameSpeed: 150,
  emotions: [],
  blinkSettings: {},
};

export function AppProvider({ children }) {
  // ── Auth ─────────────────────────────────────────────────────
  const [authRole, setAuthRole]           = useState('viewer');
  const [effectiveRole, setEffectiveRole] = useState('viewer');
  const [myToken, setMyToken]             = useState(null);
  const [tier, setTier]                   = useState('free');
  const [tierLimits, setTierLimits]       = useState({});
  const [authUser, setAuthUser]           = useState(null); // { username, avatar, discordId }

  // ── API host override (debug) ────────────────────────────────
  const [apiHost, setApiHost] = useState('');

  // ── Audio config (partagée entre onglets Avatars + Audio) ────
  const [audioConfig, setAudioConfig] = useState(DEFAULT_AUDIO_CONFIG);

  // ── Config data par token user (frames, displayName) ─────────
  // token → { displayName, states: { stateKey → [{file, url}] } }
  const [configData, setConfigData] = useState({});

  // ── Données live de /levels ──────────────────────────────────
  const [levels, setLevels]       = useState({});
  const [botStatus, setBotStatus] = useState({ connected: false, inVoice: false });
  const [apiConnected, setApiConnected] = useState(null); // null | true | false

  // Helper: mettre à jour un seul token sans écraser les autres
  const updateConfigData = useCallback((token, updater) => {
    setConfigData(prev => ({
      ...prev,
      [token]: typeof updater === 'function'
        ? updater(prev[token] || { displayName: '???', states: {} })
        : { ...(prev[token] || {}), ...updater },
    }));
  }, []);

  // Memoize l'objet value pour eviter de re-creer une reference a chaque render
  // du Provider. Sans cette memo, les ~10 setLevels par seconde (polling /levels)
  // recreent l'objet et tous les consommateurs de useApp() re-render — meme
  // ceux qui ne lisent pas levels (ex: Header, TabBar, Modal de config).
  // useMemo + dependances explicites = re-render uniquement quand UNE des
  // valeurs lues change reellement.
  const value = useMemo(() => ({
    authRole, setAuthRole,
    effectiveRole, setEffectiveRole,
    myToken, setMyToken,
    tier, setTier,
    tierLimits, setTierLimits,
    authUser, setAuthUser,
    apiHost, setApiHost,
    audioConfig, setAudioConfig,
    configData, setConfigData, updateConfigData,
    levels, setLevels,
    botStatus, setBotStatus,
    apiConnected, setApiConnected,
  }), [
    authRole, effectiveRole, myToken, tier, tierLimits, authUser,
    apiHost, audioConfig, configData, levels, botStatus, apiConnected,
    updateConfigData,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  return useContext(AppContext);
}
