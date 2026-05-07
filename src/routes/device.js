/**
 * Routes Device Auth Flow (OAuth2 Device Authorization Grant, RFC 8628)
 * ======================================================================
 * Authentification pour les mini-applications locales (agent, plugin OBS)
 * qui ne peuvent pas implémenter le flux OAuth2 classique (pas d'URL callback).
 *
 * Flux :
 *   1. POST /api/device/authorize   → { deviceCode, userCode }
 *   2. L'utilisateur ouvre GET /api/device/verify?user_code=XXXX dans le navigateur
 *   3. POST /api/device/verify (action=approve|deny) → lie deviceCode à la session
 *   4. POST /api/device/poll (deviceCode) → { status: 'authorized', appToken }
 *   5. L'app stocke appToken, l'utilise comme Bearer dans les requêtes suivantes
 *
 * Gestion des app tokens (Bearer) :
 *   GET    /api/app-tokens      → liste des tokens de l'utilisateur
 *   DELETE /api/app-tokens/:id  → révoquer un token
 *
 * Sécurité :
 *   - deviceCodes expirent après 5 minutes
 *   - appToken = 32 octets aléatoires ; seul son SHA-256 est persisté en DB
 *   - appTokens plafonnés au rôle 'client' (jamais 'admin')
 *   - Rate limits : 5/min sur authorize, 30/min sur poll, 10/min sur verify
 *
 * Dépendances : node:crypto, db/repos/appTokens, services/tierService,
 *               http/helpers, http/cors
 */
import crypto from 'node:crypto';
import { appTokens as appTokensRepo } from '../db/repos/appTokens.js';
import { getUserTier } from '../services/tierService.js';
import { tokenFor } from '../services/tokenService.js';
import { json, parseJsonBody } from '../http/helpers.js';
import { BASE_URL, securityHeaders } from '../http/cors.js';
import { escapeHtml } from '../http/helpers.js';

// Stockage en mémoire des demandes d'autorisation en attente
// deviceCode → { userCode, discordId?, status, deviceName, expiresAt, appToken? }
export const deviceAuthRequests = new Map();

// Nettoyage périodique des demandes expirées
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of deviceAuthRequests) {
        if (now > v.expiresAt) deviceAuthRequests.delete(k);
    }
}, 60_000);

// Génère un code utilisateur lisible : XXXX-XXXX (sans ambiguïté 0/O/1/I)
function generateUserCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    const bytes = crypto.randomBytes(8);
    for (let i = 0; i < 8; i++) code += chars[bytes[i] % chars.length];
    return code.slice(0, 4) + '-' + code.slice(4);
}

// Récupère l'IP cliente (respecte TRUST_PROXY)
function getClientIp(req) {
    const TRUST_PROXY = process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1';
    if (TRUST_PROXY) {
        const xff = req.headers['x-forwarded-for'];
        if (xff) return xff.split(',')[0].trim();
    }
    return req.socket?.remoteAddress || 'unknown';
}

// POST /api/device/authorize — l'app demande un couple (deviceCode, userCode)
export async function handleDeviceAuthorize(req, res, ctx, rateLimit) {
    const clientIp = getClientIp(req);
    if (rateLimit(`device:${clientIp}`, 5, 60_000))
        return json(res, { error: 'Trop de requêtes' }, 429, req);
    // Cap mémoire : purger les expirés si > 500 en attente
    if (deviceAuthRequests.size > 500) {
        const now = Date.now();
        for (const [k, v] of deviceAuthRequests) {
            if (now > v.expiresAt) deviceAuthRequests.delete(k);
        }
    }
    let body = {};
    try { body = await parseJsonBody(req); } catch {}
    const deviceCode = crypto.randomBytes(32).toString('hex');
    const userCode = generateUserCode();
    const deviceName = typeof body.deviceName === 'string' ? body.deviceName.slice(0, 64) : 'Agent';
    deviceAuthRequests.set(deviceCode, {
        userCode, discordId: null, status: 'pending',
        deviceName, expiresAt: Date.now() + 5 * 60 * 1000,
    });
    return json(res, {
        deviceCode, userCode,
        verifyUrl: `${BASE_URL}/api/device/verify?user_code=${userCode}`,
        expiresIn: 300,
        interval: 5,
    }, 200, req);
}

// POST /api/device/poll — l'app interroge le statut de sa demande
export async function handleDevicePoll(req, res, ctx, rateLimit) {
    const clientIp = getClientIp(req);
    if (rateLimit(`poll:${clientIp}`, 30, 60_000))
        return json(res, { error: 'Trop de requêtes' }, 429, req);
    const body = await parseJsonBody(req);
    const entry = deviceAuthRequests.get(body?.deviceCode);
    if (!entry) return json(res, { status: 'expired' }, 200, req);
    if (Date.now() > entry.expiresAt) {
        deviceAuthRequests.delete(body.deviceCode);
        return json(res, { status: 'expired' }, 200, req);
    }
    if (entry.status === 'denied') {
        deviceAuthRequests.delete(body.deviceCode);
        return json(res, { status: 'denied' }, 200, req);
    }
    if (entry.status === 'authorized' && entry.appToken) {
        const token = entry.appToken;
        const userToken = tokenFor(entry.discordId);
        const tier = getUserTier(entry.discordId);
        deviceAuthRequests.delete(body.deviceCode);
        return json(res, { status: 'authorized', appToken: token, userToken, tier }, 200, req);
    }
    return json(res, { status: 'pending' }, 200, req);
}

// GET /api/device/verify — page HTML de vérification du code utilisateur
export async function handleDeviceVerifyPage(req, res, ctx) {
    const userCode = ctx.url.searchParams.get('user_code') || '';
    const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Autoriser l'application</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#1a1a2e;color:#e0e0e0;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}
  .card{background:#16213e;border-radius:16px;padding:2rem;max-width:420px;width:90%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.3)}
  h1{font-size:1.4rem;margin-bottom:.5rem}
  .code{font-size:2rem;font-weight:bold;letter-spacing:.3em;color:#7c3aed;background:#0f0f23;padding:.8rem 1.5rem;border-radius:8px;margin:1.5rem 0;font-family:monospace}
  .device{color:#a78bfa;font-weight:600}
  .btn{display:inline-block;padding:.7rem 2rem;border-radius:8px;border:none;font-size:1rem;cursor:pointer;margin:.3rem;font-weight:600;transition:all .2s}
  .approve{background:#7c3aed;color:#fff}.approve:hover{background:#6d28d9}
  .deny{background:#374151;color:#9ca3af}.deny:hover{background:#4b5563}
  .result{margin-top:1rem;padding:1rem;border-radius:8px;display:none}
  .success{background:#064e3b;color:#34d399;display:block}
  .error{background:#450a0a;color:#f87171;display:block}
  input{background:#0f0f23;border:2px solid #374151;color:#e0e0e0;padding:.7rem 1rem;border-radius:8px;font-size:1.2rem;text-align:center;letter-spacing:.2em;width:80%;font-family:monospace;text-transform:uppercase}
  input:focus{border-color:#7c3aed;outline:none}
</style></head><body>
<div class="card">
  <h1>Autoriser l'application</h1>
  <p>Entrez le code affiché dans votre application :</p>
  <div><input id="codeInput" type="text" maxlength="9" placeholder="XXXX-XXXX" value="${escapeHtml(userCode)}"></div>
  <div id="deviceInfo" style="margin:1rem 0;display:none">
    <p>L'application <span class="device" id="deviceName"></span> demande l'accès à votre compte.</p>
    <p style="color:#9ca3af;font-size:.9rem">Cela lui permettra de contrôler vos avatars PNGTuber.</p>
  </div>
  <div id="actions" style="margin-top:1rem">
    <button class="btn approve" onclick="verify()">Vérifier</button>
  </div>
  <div id="result" class="result"></div>
</div>
<script>
const input = document.getElementById('codeInput');
input.addEventListener('input', e => {
    let v = e.target.value.replace(/[^A-Za-z0-9]/g,'').toUpperCase();
    if(v.length>4) v=v.slice(0,4)+'-'+v.slice(4,8);
    e.target.value=v;
});
async function verify() {
    const code = input.value.trim();
    if(code.length<9) return;
    try {
        const r = await fetch('/api/device/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userCode:code,action:'check'})});
        const d = await r.json();
        if(d.found) {
            document.getElementById('deviceName').textContent=d.deviceName;
            document.getElementById('deviceInfo').style.display='block';
            document.getElementById('actions').innerHTML='<button class="btn approve" onclick="approve()">Autoriser</button><button class="btn deny" onclick="deny()">Refuser</button>';
        } else {
            showResult('Code invalide ou expiré','error');
        }
    } catch(e) { showResult('Erreur réseau','error'); }
}
async function approve() { await submit('approve'); }
async function deny() { await submit('deny'); }
async function submit(action) {
    const code = input.value.trim();
    try {
        const r = await fetch('/api/device/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userCode:code,action})});
        const d = await r.json();
        if(d.ok) showResult(action==='approve'?'Application autorisée ! Vous pouvez fermer cette page.':'Accès refusé.',action==='approve'?'success':'error');
        else showResult(d.error||'Erreur','error');
    } catch(e) { showResult('Erreur réseau','error'); }
}
function showResult(msg,cls) {
    const el = document.getElementById('result');
    el.textContent=msg; el.className='result '+cls;
    document.getElementById('actions').style.display='none';
}
if(input.value.length>=9) verify();
</script></body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...securityHeaders() });
    res.end(html);
}

// POST /api/device/verify — l'utilisateur connecté approuve ou refuse la demande
export async function handleDeviceVerifySubmit(req, res, ctx, rateLimit) {
    const clientIp = getClientIp(req);
    if (rateLimit(`device-verify:${clientIp}`, 10, 60_000))
        return json(res, { error: 'Trop de tentatives, réessayez dans 1 minute' }, 429, req);
    const body = await parseJsonBody(req);
    const userCode = typeof body?.userCode === 'string' ? body.userCode.toUpperCase().trim() : '';
    const action = body?.action;
    // Recherche du deviceCode par userCode
    let found = null, foundKey = null;
    for (const [k, v] of deviceAuthRequests) {
        if (v.userCode === userCode && v.status === 'pending' && Date.now() < v.expiresAt) {
            found = v; foundKey = k; break;
        }
    }
    if (!found) return json(res, { found: false, error: 'Code invalide ou expiré' }, 200, req);
    if (action === 'check') {
        return json(res, { found: true, deviceName: found.deviceName }, 200, req);
    }
    if (action === 'deny') {
        found.status = 'denied';
        return json(res, { ok: true }, 200, req);
    }
    if (action === 'approve') {
        // La mini-app requiert un abonnement premium
        const tier = getUserTier(ctx.session.discordId);
        if (tier === 'free') {
            return json(res, { ok: false, error: 'Fonctionnalité premium requise pour la mini-application' }, 403, req);
        }
        const rawToken = crypto.randomBytes(32).toString('hex');
        const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
        appTokensRepo.create.run(hash, ctx.session.discordId, found.deviceName);
        found.status = 'authorized';
        found.discordId = ctx.session.discordId;
        found.appToken = rawToken; // retourné une seule fois via /api/device/poll
        return json(res, { ok: true }, 200, req);
    }
    return json(res, { error: 'Action invalide' }, 400, req);
}

// GET /api/app-tokens — liste des tokens API de l'utilisateur connecté
export async function handleListAppTokens(req, res, ctx) {
    const rows = appTokensRepo.byUser.all(ctx.session.discordId);
    return json(res, { tokens: rows }, 200, req);
}

// DELETE /api/app-tokens/:id — révoquer un token par son ID
export async function handleRevokeAppToken(req, res, ctx) {
    const id = parseInt(ctx.params.id, 10);
    if (isNaN(id)) return json(res, { error: 'ID invalide' }, 400, req);
    appTokensRepo.revoke.run(id, ctx.session.discordId);
    return json(res, { ok: true }, 200, req);
}
