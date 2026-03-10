// ── GET /levels — niveaux audio temps réel ───────────────────────
// Clés = tokens opaques (jamais de userId Discord).
// Cache 50ms pour ne pas reconstruire le JSON à chaque polling viewer.
import { json } from '../http/helpers.js';
import { userLevels } from '../services/audioService.js';
import { tokenFor } from '../services/tokenService.js';

let levelsCache = { data: null, ts: 0 };

export async function handleLevels(req, res, ctx) {
    const now = Date.now();
    if (levelsCache.data && now - levelsCache.ts < 50) {
        return json(res, levelsCache.data, 200, req);
    }
    const payload = {};
    for (const [uid, d] of userLevels) {
        payload[tokenFor(uid)] = d;
    }
    levelsCache = { data: payload, ts: now };
    json(res, payload, 200, req);
}
