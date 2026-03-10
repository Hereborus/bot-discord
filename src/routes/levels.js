/**
 * Route GET /levels — niveaux audio temps réel
 * =============================================
 * Endpoint public consommé par les viewers OBS et le panneau React.
 * Traduit la Map interne (userId → data) en objet (token → data) :
 * les IDs Discord ne sortent jamais en clair via HTTP.
 *
 * Cache 50ms : le polling des viewers peut atteindre 100ms (configurable).
 * Sans cache, chaque tick de polling reconstruit le JSON inutilement.
 *
 * Dépendances : http/helpers, services/audioService, services/tokenService
 */
import { json } from '../http/helpers.js';
import { userLevels } from '../services/audioService.js';
import { tokenFor } from '../services/tokenService.js';

let levelsCache = { data: null, ts: 0 };

export async function handleLevels(req, res, ctx) {
    const now = Date.now();
    // Retourner le cache si moins de 50ms se sont écoulés
    if (levelsCache.data && now - levelsCache.ts < 50) {
        return json(res, levelsCache.data, 200, req);
    }
    const payload = {};
    for (const [uid, d] of userLevels) {
        // Substitution userId → token : seul le token est exposé publiquement
        payload[tokenFor(uid)] = d;
    }
    levelsCache = { data: payload, ts: now };
    json(res, payload, 200, req);
}
