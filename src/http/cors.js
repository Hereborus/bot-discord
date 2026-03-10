// ── CORS dynamique + headers de sécurité ────────────────────────
// "Access-Control-Allow-Origin: *" est interdit avec credentials=true.
// On valide l'origine contre une liste blanche et on la retourne telle quelle.
const PORT    = process.env.LEVELS_PORT || 3000;
const BASE_URL = (() => {
    if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/+$/, '');
    if (process.env.DISCORD_REDIRECT_URI) {
        try { return new URL(process.env.DISCORD_REDIRECT_URI).origin; } catch {}
    }
    return `http://localhost:${PORT}`;
})();

export { BASE_URL };

export function getAllowedOrigins() {
    const origins = new Set([
        `http://localhost:${PORT}`,
        `http://127.0.0.1:${PORT}`,
        `http://localhost:5173`,  // Vite dev server
        BASE_URL,
    ]);
    if (process.env.CORS_ORIGINS) {
        for (const o of process.env.CORS_ORIGINS.split(',')) origins.add(o.trim());
    }
    return [...origins];
}

export function corsHeaders(req) {
    const origin  = req?.headers?.origin || '';
    const allowed = getAllowedOrigins();
    const headers = {
        'Access-Control-Allow-Methods':     'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers':     'Content-Type',
        'Access-Control-Allow-Credentials': 'true',
    };
    if (origin && allowed.includes(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
    } else if (!origin) {
        headers['Access-Control-Allow-Origin'] = '*';
        delete headers['Access-Control-Allow-Credentials'];
    }
    return headers;
}

export function securityHeaders(extra = {}) {
    const h = {
        'X-Content-Type-Options': 'nosniff',
        'X-XSS-Protection':       '1; mode=block',
        'Referrer-Policy':        'strict-origin-when-cross-origin',
        ...extra,
    };
    if (BASE_URL.startsWith('https://'))
        h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
    return h;
}
