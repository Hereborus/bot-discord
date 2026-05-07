/**
 * Routes d'authentification OAuth2 Discord
 * ==========================================
 * Gère le flux OAuth2 complet pour la connexion navigateur :
 *   GET  /auth/login    → redirection vers Discord OAuth2
 *   GET  /auth/callback → échange du code → session cookie
 *   GET  /auth/logout   → suppression de la session
 *   GET  /auth/me       → infos de la session courante
 *   POST /api/test-mode → admin simule un rôle client (toggle)
 *
 * Sécurité : état OAuth anti-CSRF (nonce 16 octets), cookie HttpOnly signé,
 * rate limit sur /auth/login (30/min par IP) pour limiter les abus.
 *
 * Dépendances : services/authService, services/tierService,
 *               http/cors, http/helpers, node:crypto
 */
import crypto from 'node:crypto';
import {
    sessions, oauthStates, AUTH_ENABLED,
    parseCookies, getSession, createSession,
    setSessionCookie, getUserRole,
} from '../services/authService.js';
import { getUserTier, TIER_LIMITS } from '../services/tierService.js';
import { BASE_URL } from '../http/cors.js';
import { json, escapeHtml, readBody } from '../http/helpers.js';

// Récupère l'IP cliente (prend en compte TRUST_PROXY si configuré)
function getClientIp(req) {
    const TRUST_PROXY = process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1';
    if (TRUST_PROXY) {
        const xff = req.headers['x-forwarded-for'];
        if (xff) return xff.split(',')[0].trim();
    }
    return req.socket?.remoteAddress || 'unknown';
}

// Vérification d'un cookie signé — utilisé par handleAuthLogout
function verifyCookie(signed) {
    const idx = signed.lastIndexOf('.');
    if (idx === -1) return null;
    const value = signed.slice(0, idx);
    const sig = signed.slice(idx + 1);
    const secret = process.env.SESSION_SECRET;
    if (!secret) return null;
    const expected = crypto.createHmac('sha256', secret).update(value).digest('base64url');
    if (sig.length !== expected.length) return null;
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? value : null;
}

// GET /auth/login — initie le flux OAuth2 Discord
export async function handleAuthLogin(req, res, ctx, rateLimit) {
    const clientIp = getClientIp(req);
    if (rateLimit(`auth:${clientIp}`, 30, 60_000)) {
        res.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h2>Trop de tentatives</h2><p>Réessayez dans une minute.</p>');
        return;
    }
    // Cap mémoire : max 1000 états OAuth en attente
    if (oauthStates.size > 1000) {
        const oldest = [...oauthStates.entries()].sort((a, b) => {
            const ea = typeof a[1] === 'number' ? a[1] : a[1]?.expiresAt || 0;
            const eb = typeof b[1] === 'number' ? b[1] : b[1]?.expiresAt || 0;
            return ea - eb;
        });
        for (let i = 0; i < 200; i++) oauthStates.delete(oldest[i][0]);
    }
    const clientId = process.env.DISCORD_CLIENT_ID;
    const redirectUri = process.env.DISCORD_REDIRECT_URI || `${BASE_URL}/auth/callback`;
    if (!clientId) return json(res, { error: 'OAuth2 non configuré' }, 500, req);
    // Conserver le paramètre next pour redirection post-login
    const next = ctx.url.searchParams.get('next');
    const safeNext = (next && next.startsWith('/') && !next.startsWith('//')) ? next : null;
    const state = crypto.randomBytes(16).toString('hex');
    oauthStates.set(state, { expiresAt: Date.now() + 5 * 60 * 1000, next: safeNext });
    const url = `https://discord.com/oauth2/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=identify%20guilds&state=${state}`;
    res.writeHead(302, { Location: url });
    res.end();
}

// GET /auth/callback — échange du code OAuth2 → session
export async function handleAuthCallback(req, res, ctx) {
    const code = ctx.url.searchParams.get('code');
    const state = ctx.url.searchParams.get('state');
    const stateData = oauthStates.get(state);
    oauthStates.delete(state);
    // Support ancien format (nombre) et nouveau format (objet)
    const expiry = typeof stateData === 'number' ? stateData : stateData?.expiresAt;
    const nextUrl = typeof stateData === 'object' ? stateData?.next : null;
    if (!expiry || Date.now() > expiry) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end("<h2>Session OAuth expirée ou invalide</h2><a href='/auth/login'>Réessayer</a>");
        return;
    }
    try {
        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: process.env.DISCORD_CLIENT_ID,
                client_secret: process.env.DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: process.env.DISCORD_REDIRECT_URI || `${BASE_URL}/auth/callback`,
            }),
        });
        if (!tokenRes.ok) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end("<h2>Échec échange token OAuth</h2><a href='/auth/login'>Réessayer</a>");
            return;
        }
        const { access_token } = await tokenRes.json();
        const userRes = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` },
        });
        if (!userRes.ok) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end("<h2>Échec récupération profil</h2><a href='/auth/login'>Réessayer</a>");
            return;
        }
        const discordUser = await userRes.json();
        // Récupérer les serveurs de l'utilisateur via le scope guilds
        let userGuildIds = [];
        try {
            const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', {
                headers: { Authorization: `Bearer ${access_token}` },
            });
            if (guildsRes.ok) {
                const guilds = await guildsRes.json();
                userGuildIds = guilds.map(g => g.id);
            }
        } catch {}
        const role = getUserRole(discordUser.id);
        const redirectTo = nextUrl || '/';
        if (role === 'admin' || role === 'client') {
            const sessionId = createSession(discordUser, userGuildIds);
            setSessionCookie(res, sessionId, BASE_URL, req);
            res.writeHead(302, { Location: redirectTo });
            res.end();
        } else {
            // Utilisateur inconnu → 403
            res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h2>Accès refusé</h2><p>Vous n\'avez pas les permissions nécessaires pour accéder à cette interface.</p>');
        }
    } catch (err) {
        console.error('OAuth callback error:', err);
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h2>Erreur OAuth</h2><p>${escapeHtml(err.message)}</p><a href='/auth/login'>Réessayer</a>`);
    }
}

// GET /auth/logout — suppression de la session + redirection login
export async function handleAuthLogout(req, res, ctx) {
    const cookies = parseCookies(req);
    const signed = cookies['pngtuber_session'];
    if (signed) {
        const sessionId = verifyCookie(signed);
        if (sessionId) sessions.delete(sessionId);
    }
    res.setHeader('Set-Cookie', 'pngtuber_session=; Path=/; HttpOnly; Max-Age=0');
    res.writeHead(302, { Location: '/auth/login' });
    res.end();
}

// GET /auth/me — infos de la session courante
export async function handleAuthMe(req, res, ctx) {
    const session = getSession(req);
    if (!session) return json(res, { authenticated: false }, 401, req);
    const effectiveRole = session.testRole || session.role || 'viewer';
    const tier = getUserTier(session.discordId);
    return json(res, {
        authenticated: true,
        username: session.username,
        discordId: session.discordId,
        role: session.role || 'viewer',
        effectiveRole,
        testMode: !!session.testRole,
        tier,
        tierLimits: TIER_LIMITS[tier],
    }, 200, req);
}

// POST /api/test-mode — admin simule un rôle client (toggle debug)
export async function handleTestMode(req, res, ctx) {
    if (ctx.session.role !== 'admin') return json(res, { error: 'Admin uniquement' }, 403, req);
    const body = ctx._parsedBody || JSON.parse((await readBody(req)).toString());
    const session = getSession(req);
    if (body.enabled) {
        session.testRole = 'client';
    } else {
        delete session.testRole;
    }
    return json(res, { ok: true, testMode: !!session.testRole, effectiveRole: session.testRole || session.role }, 200, req);
}
