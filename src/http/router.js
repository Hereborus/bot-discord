// ── Mini-routeur HTTP sans dépendance externe ────────────────────
// route(METHOD, '/path/:param', ...handlers) enregistre une route.
// matchRoute(method, pathname) retourne { route, params } ou null.
// Les handlers ont la signature : async (req, res, ctx) → bool|void
//   false = arrêter la chaîne (réponse déjà envoyée par le middleware)
const routes = [];

export function route(method, pattern, ...handlers) {
    routes.push({ method, pattern, handlers });
}

export function matchRoute(method, pathname) {
    for (const r of routes) {
        if (r.method !== method && r.method !== '*') continue;
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

        // Wildcard suffix : '/images/*'
        if (r.pattern.endsWith('/*')) {
            const prefix = r.pattern.slice(0, -2);
            if (pathname.startsWith(prefix + '/') || pathname === prefix)
                return { route: r, params: { '*': pathname.slice(prefix.length + 1) } };
        }
    }
    return null;
}
