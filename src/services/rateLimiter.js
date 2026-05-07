/**
 * Rate Limiter — limitation du débit par clé (IP + route)
 * =========================================================
 * Implémentation "fixed window" en mémoire pure (pas de Redis).
 * La clé composite "<route>:<ip>" permet des limites distinctes
 * par endpoint (ex: upload et auth ont des seuils différents).
 * Suffisant pour un usage mono-instance ; à remplacer par Redis
 * si plusieurs instances sont déployées derrière un LB.
 */

// key = "<route>:<ip>", ex: "auth:1.2.3.4"
// Si count > maxRequests avant la fin de la fenêtre → retourne true (bloqué).
const buckets = new Map(); // key → { count, resetAt }

export function rateLimit(key, maxRequests, windowMs) {
    const now = Date.now();
    let b = buckets.get(key);
    // Créer ou réinitialiser le bucket si la fenêtre est expirée
    if (!b || now > b.resetAt) {
        b = { count: 0, resetAt: now + windowMs };
        buckets.set(key, b);
    }
    b.count++;
    return b.count > maxRequests;
}

// GC des buckets expirés toutes les 60s — évite la fuite mémoire sur des
// serveurs long-running avec de nombreuses IPs distinctes.
setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) if (now > b.resetAt) buckets.delete(k);
}, 60_000);
