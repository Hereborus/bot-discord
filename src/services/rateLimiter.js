// ── Rate limiter "fixed window" en mémoire ──────────────────────
// key = "<route>:<ip>", ex: "auth:1.2.3.4"
// Si count > maxRequests avant la fin de la fenêtre → retourne true (bloqué).
const buckets = new Map(); // key → { count, resetAt }

export function rateLimit(key, maxRequests, windowMs) {
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now > b.resetAt) {
        b = { count: 0, resetAt: now + windowMs };
        buckets.set(key, b);
    }
    b.count++;
    return b.count > maxRequests;
}

// GC des buckets expirés toutes les 60s — évite la fuite mémoire
setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) if (now > b.resetAt) buckets.delete(k);
}, 60_000);
