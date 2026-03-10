import { useState, useCallback } from 'react';
import { apiFetch } from '../api.js';

export function useNotifications() {
  const [notifications, setNotifications] = useState([]);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/notifications?unread=true&limit=20');
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications || []);
    } catch {}
  }, []);

  const markRead = useCallback(async (id) => {
    try {
      await apiFetch(`/api/notifications/${id}/read`, { method: 'POST' });
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: 1 } : n));
    } catch {}
  }, []);

  const markAllRead = useCallback(async () => {
    try {
      await apiFetch('/api/notifications/read-all', { method: 'POST' });
      setNotifications(prev => prev.map(n => ({ ...n, read: 1 })));
    } catch {}
  }, []);

  // Ajouter une notif en tête (depuis WebSocket)
  const push = useCallback((notif) => {
    setNotifications(prev => [notif, ...prev]);
  }, []);

  return { notifications, load, markRead, markAllRead, push };
}
