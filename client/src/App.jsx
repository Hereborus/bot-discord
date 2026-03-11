import { useState, useEffect } from 'react';
import { useApp } from './context/AppContext.jsx';
import { apiJson, getApiBase } from './api.js';

import { PositionerApp } from './components/positioner/PositionerApp.jsx';

import { usePollLevels }     from './hooks/usePollLevels.js';
import { useWebSocket }      from './hooks/useWebSocket.js';
import { useToast }          from './hooks/useToast.js';
import { useNotifications }  from './hooks/useNotifications.js';

import { Header }       from './components/layout/Header.jsx';
import { VoiceSidebar } from './components/layout/VoiceSidebar.jsx';
import { TabBar }       from './components/layout/TabBar.jsx';
import { ToastContainer } from './components/ui/Toast.jsx';
import { Modal, ModalRow } from './components/ui/Modal.jsx';

import { AvatarsTab }       from './components/tabs/AvatarsTab.jsx';
import { AudioTab }         from './components/tabs/AudioTab.jsx';
import { ExperimentTab }    from './components/tabs/ExperimentTab.jsx';
import { SetupTab }         from './components/tabs/SetupTab.jsx';
import { AdminTab }         from './components/tabs/AdminTab.jsx';
import { DbViewTab }        from './components/tabs/DbViewTab.jsx';
import { SessionsTab }      from './components/tabs/SessionsTab.jsx';
import { SubscriptionsTab } from './components/tabs/SubscriptionsTab.jsx';
import { AppTokensTab }     from './components/tabs/AppTokensTab.jsx';

// Modal inline pour la configuration d'un utilisateur (frames upload)
import { UserSettingsModal } from './components/avatars/UserSettingsModal.jsx';

// ── Détection de route /positioner (évaluée une seule fois au module load) ──
// window.location.pathname est stable durant toute la durée de vie de la page.
const IS_POSITIONER = window.location.pathname === '/positioner';

// ── Composant principal de l'app de contrôle ────────────────────
function ControlApp() {
  const {
    setAuthRole, setEffectiveRole, setMyToken,
    setTier, setTierLimits, setAuthUser,
  } = useApp();

  const [activeTab, setActiveTab]         = useState('avatars');
  const [obsModalOpen, setObsModalOpen]   = useState(false);
  const [settingsToken, setSettingsToken] = useState(null);
  const [botInfo, setBotInfo]             = useState(null);

  const { toasts, toast }   = useToast();
  const { notifications, load: loadNotifs, markRead, markAllRead, push: pushNotif } = useNotifications();

  // ── Démarrage — charger session auth ────────────────────────────
  useEffect(() => {
    async function bootstrap() {
      try {
        const me = await apiJson('/auth/me');
        setAuthUser({ username: me.username, avatar: me.avatar, discordId: me.discordId });
        setAuthRole(me.role);
        setEffectiveRole(me.effectiveRole || me.role);
        setMyToken(me.token || null);
        setTier(me.tier || 'free');
        setTierLimits(me.tierLimits || {});
        loadNotifs();
      } catch {
        // Auth désactivée ou non connecté — session fictive viewer
        setEffectiveRole('viewer');
      }

      try {
        const info = await apiJson('/bot-info');
        setBotInfo(info);
      } catch {}
    }
    bootstrap();
  }, []);

  // ── Polling /levels ─────────────────────────────────────────────
  usePollLevels(100);

  // ── WebSocket — notifications temps réel ────────────────────────
  useWebSocket(msg => {
    if (msg.type === 'notification') pushNotif(msg.notification);
  });

  // ── Switch onglet ────────────────────────────────────────────────
  function switchTab(name) {
    setActiveTab(name);
  }

  // ── URL viewer OBS ───────────────────────────────────────────────
  function openViewer() {
    window.open(`${getApiBase()}/viewer.html`, '_blank');
  }

  return (
    <>
      <Header
        onOpenObsModal={() => setObsModalOpen(true)}
        onOpenViewer={openViewer}
        notifications={notifications}
        onMarkRead={markRead}
        onMarkAllRead={markAllRead}
      />

      <div className="app-layout">
        <VoiceSidebar />

        <div className="app-main">
          <TabBar activeTab={activeTab} onSwitch={switchTab} botInfo={botInfo} />

          {/* Panneau actif */}
          <div style={{ flex: 1, overflow: 'auto' }}>
            {activeTab === 'avatars'       && <AvatarsTab onOpenSettings={setSettingsToken} />}
            {activeTab === 'audio'         && <AudioTab toast={toast} />}
            {activeTab === 'experiment'    && <ExperimentTab />}
            {activeTab === 'setup'         && <SetupTab toast={toast} />}
            {activeTab === 'admin'         && <AdminTab toast={toast} />}
            {activeTab === 'dbview'        && <DbViewTab />}
            {activeTab === 'sessions'      && <SessionsTab toast={toast} />}
            {activeTab === 'subscriptions' && <SubscriptionsTab toast={toast} />}
            {activeTab === 'apptokens'     && <AppTokensTab toast={toast} />}
          </div>
        </div>
      </div>

      {/* Modal URL OBS */}
      <Modal open={obsModalOpen} onClose={() => setObsModalOpen(false)} title="Browser Source OBS">
        <p>Colle cette URL dans une <strong>Browser Source</strong> OBS.<br />Chaque streamer a ses propres images — rien n'est partagé.</p>
        <div className="modal-url">{`${getApiBase()}/viewer.html`}</div>
        <ModalRow>
          <button className="obs-btn" onClick={() => { navigator.clipboard.writeText(`${getApiBase()}/viewer.html`); toast('Copié !'); }}>
            Copier
          </button>
          <button className="obs-btn ghost" onClick={() => setObsModalOpen(false)}>Fermer</button>
        </ModalRow>
      </Modal>

      {/* Modal configuration utilisateur */}
      {settingsToken && (
        <UserSettingsModal
          token={settingsToken}
          onClose={() => setSettingsToken(null)}
          toast={toast}
        />
      )}

      <ToastContainer toasts={toasts} />
    </>
  );
}

// ── Export par défaut — router simple basé sur le pathname ───────
// /positioner → outil d'édition de positions des frames (PositionerApp)
// tout autre chemin → panneau de contrôle normal (ControlApp)
export default function App() {
  if (IS_POSITIONER) return <PositionerApp />;
  return <ControlApp />;
}
