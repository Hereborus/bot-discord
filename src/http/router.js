/**
 * Mini-routeur HTTP — enregistrement et matching de routes
 * =========================================================
 * Implémentation légère sans dépendance externe (pas d'Express).
 * Supporte trois types de patterns :
 *   1. Exact : '/status'
 *   2. Segments dynamiques : '/frames/:token' → ctx.params.token
 *   3. Wildcard suffix : '/images/*' → ctx.params['*']
 *
 * Les handlers ont la signature : async (req, res, ctx) → bool|void
 * Retourner false interrompt la chaîne de handlers (réponse déjà envoyée).
 *
 * Dépendances : aucune
 */
const routes = [];

export function route(method, pattern, ...handlers) {
    routes.push({ method, pattern, handlers });
}

export function matchRoute(method, pathname) {
    for (const r of routes) {
        if (r.method !== method && r.method !== '*') continue;
        // Correspondance exacte — cas le plus fréquent, court-circuit rapide
        if (r.pattern === pathname) return { route: r, params: {} };

        // Segments dynamiques : '/frames/:token' → params.token
        const rParts = r.pattern.split('/');
        const pParts = pathname.split('/');
        if (rParts.length === pParts.length) {
            const params = {};
            let ok = true;
            for (let i = 0; i < rParts.length; i++) {
                if (rParts[i].startsWith(':')) {
                    params[rParts[i].slice(1)] = decodeURIComponent(pParts[i]);
                } else if (rParts[i] !== pParts[i]) {
                    ok = false; break;
                }
            }
            if (ok) return { route: r, params };
        }

        // Wildcard suffix : '/images/*' — couvre tout ce qui commence par le préfixe
        if (r.pattern.endsWith('/*')) {
            const prefix = r.pattern.slice(0, -2);
            if (pathname.startsWith(prefix + '/') || pathname === prefix)
                return { route: r, params: { '*': pathname.slice(prefix.length + 1) } };
        }
    }
    return null;
}
