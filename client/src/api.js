// ── Utilitaire API centralisé ────────────────────────────────────
// Toutes les requêtes vers le backend passent par ces fonctions.
// getApiBase() lit l'override depuis le header (mode debug) ou utilise
// window.location.origin (production same-origin).

let _customBase = '';

export function setApiBase(url) {
  _customBase = (url || '').trim();
}

export function getApiBase() {
  if (_customBase) {
    return _customBase.startsWith('http') ? _customBase : `http://${_customBase}`;
  }
  return window.location.origin;
}

// fetch avec credentials (cookies de session) inclus par défaut
export async function apiFetch(path, options = {}) {
  const url = `${getApiBase()}${path}`;
  return fetch(url, { credentials: 'include', ...options });
}

// fetch + parse JSON + throw si erreur HTTP
export async function apiJson(path, options = {}) {
  const res = await apiFetch(path, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw Object.assign(new Error(err.error || 'Erreur API'), {
      status: res.status,
      data: err,
    });
  }
  return res.json();
}

// POST JSON
export function apiPost(path, body) {
  return apiJson(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// DELETE
export function apiDelete(path) {
  return apiJson(path, { method: 'DELETE' });
}
