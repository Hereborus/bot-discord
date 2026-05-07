/**
 * Middleware d'authentification et de contrôle d'accès
 * =====================================================
 * Trois middlewares à composer dans les chaînes de route :
 *   - requireAuth : vérifie session cookie OU Bearer token
 *   - requireAdmin : rôle admin uniquement
 *   - requireClientOrAdmin : admin, ou client sur ses propres données
 *
 * Si AUTH_ENABLED = false (pas de DISCORD_CLIENT_ID configuré), tous les
 * middlewares passent — utile pour un déploiement local sans OAuth2.
 *
 * requireClientOrAdmin s'appuie sur ctx.params.token (route params) ou
 * ctx._bodyToken (injecté après parsing du corps multipart) pour vérifier
 * que le client n'accède qu'à ses propres données.
 *
 * Dépendances : services/authService, http/helpers, services/tokenService
 */
import { AUTH_ENABLED, resolveAuth } from '../services/authService.js';
import { json } from './helpers.js';
import { tokenFor } from '../services/tokenService.js';

export function requireAuth(req, res, ctx) {
    if (!AUTH_ENABLED) {
        // Mode sans auth : session anonyme avec tous les droits pour le dev local
        ctx.session = ctx.session || { discordId: 'anonymous', role: 'admin', username: 'Anonymous' };
        return true;
    }
    const session = resolveAuth(req);
    if (!session) {
        // Rediriger vers /auth/login pour les navigateurs, JSON 401 pour les appels API
        const accept = req.headers.accept || '';
        if (accept.includes('application/json') || req.headers['content-type']) {
            json(res, { error: 'Non authentifié' }, 401, req);
        } else {
            res.writeHead(302, { Location: '/auth/login' });
            res.end();
        }
        return false;
    }
    ctx.session = session;
    return true;
}

export function requireAdmin(req, res, ctx) {
    if (!AUTH_ENABLED) return true;
    if (!ctx.session || ctx.session.role !== 'admin') {
        json(res, { error: "Accès réservé à l'administrateur" }, 403, req);
        return false;
    }
    return true;
}

export function requireClientOrAdmin(req, res, ctx) {
    if (!AUTH_ENABLED) return true;
    if (!ctx.session) { json(res, { error: 'Non authentifié' }, 401, req); return false; }
    if (ctx.session.role === 'admin') return true;
    if (ctx.session.role === 'client') {
        const paramToken = ctx.params?.token;
        const ownToken   = tokenFor(ctx.session.discordId);
        // Vérification double : le token dans l'URL OU dans le corps de la requête
        if (paramToken && paramToken === ownToken) return true;
        if (ctx._bodyToken && ctx._bodyToken === ownToken) return true;
    }
    json(res, { error: 'Accès refusé' }, 403, req);
    return false;
}
