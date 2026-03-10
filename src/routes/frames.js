/**
 * Routes frames — upload, réordonnancement, suppression, déplacement
 * ===================================================================
 * Gère le cycle de vie complet des frames d'avatar :
 *   - GET  /frames/:token  : liste des frames par état audio
 *   - POST /upload         : upload multipart, re-encodage WebP via sharp
 *   - POST /reorder        : réordonner les frames d'un état
 *   - POST /delete-frame   : supprimer une frame (fichier + DB)
 *   - POST /move-frame     : déplacer une frame vers un autre état
 *
 * Sécurité :
 *   - SAFE_STATE_KEY et SAFE_FILENAME filtrent les noms pour prévenir
 *     toute traversée de chemin (path traversal).
 *   - path.resolve() + startsWith() comme garde supplémentaire.
 *   - Re-encodage sharp : neutralise les payloads dans les métadonnées image.
 *
 * Dépendances : node:path, node:fs, sharp, http/helpers, db/repos/users,
 *               services/tokenService, services/tierService
 */
import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';
import { json, readBody } from '../http/helpers.js';
import { frames as frameRepo, users as userRepo } from '../db/repos/users.js';
import { tokenFor } from '../services/tokenService.js';
import { TIER_LIMITS } from '../services/tierService.js';

const DATA_ROOT  = process.env.DATA_ROOT || process.cwd();
const IMAGES_DIR = path.join(DATA_ROOT, 'images');

// Regex de validation : seuls les caractères alphanumériques, tirets et underscores autorisés
const SAFE_STATE_KEY = /^[a-zA-Z0-9_-]{1,64}$/;
const SAFE_FILENAME  = /^[a-zA-Z0-9._-]{1,255}$/;

// ── GET /frames/:token ───────────────────────────────────────────
export async function handleGetFrames(req, res, ctx) {
    const { token } = ctx.params;
    const rows = frameRepo.byToken.all(token);
    // Grouper par state_key pour retourner { silent: [...], low: [...], ... }
    const result = {};
    for (const row of rows) {
        if (!result[row.state_key]) result[row.state_key] = [];
        result[row.state_key].push({
            file: row.filename,
            url:  `/images/${token}/${row.state_key}/${row.filename}`,
        });
    }
    json(res, result, 200, req);
}

// ── POST /upload ─────────────────────────────────────────────────
export async function handleUpload(req, res, ctx) {
    // Le parsing multipart est délégué au handler global dans index.js
    // qui injecte ctx._parts après parsing.
    const parts = ctx._parts;
    if (!parts) return json(res, { error: 'Multipart requis' }, 400, req);

    const tokenField = parts.find(p => p.name === 'token')?.data?.toString().trim();
    const stateKey   = parts.find(p => p.name === 'stateKey')?.data?.toString().trim();
    const imagePart  = parts.find(p => p.name === 'image' && p.filename);

    if (!tokenField || !stateKey || !imagePart) return json(res, { error: 'Champs manquants' }, 400, req);
    if (!SAFE_STATE_KEY.test(stateKey)) return json(res, { error: 'stateKey invalide' }, 400, req);

    const destDir = path.join(IMAGES_DIR, tokenField, stateKey);
    fs.mkdirSync(destDir, { recursive: true });

    const maxOrder = frameRepo.maxOrder.get(tokenField, stateKey)?.max_order ?? -1;
    const ext      = path.extname(imagePart.filename).toLowerCase();
    const basename = path.basename(imagePart.filename, ext);
    // Nom de sortie unique (timestamp) pour éviter les collisions + nettoyage des caractères spéciaux
    const outName  = `${Date.now()}_${basename.replace(/[^a-zA-Z0-9_-]/g, '_')}.webp`;
    const outPath  = path.join(destDir, outName);

    // Re-encoder via sharp — c'est la sanitisation principale :
    // supprime les métadonnées EXIF/ICC et neutralise les payloads malveillants.
    await sharp(imagePart.data).webp({ quality: 90 }).toFile(outPath);

    const fileSize = fs.statSync(outPath).size;
    frameRepo.insert.run(tokenField, stateKey, outName, maxOrder + 1, ext, fileSize);

    // Créer l'entrée utilisateur en DB si elle n'existe pas encore
    if (!userRepo.get.get(tokenField)) {
        userRepo.upsert.run(tokenField, '???', '{}');
    }

    json(res, { ok: true, file: outName, url: `/images/${tokenField}/${stateKey}/${outName}` }, 200, req);
}

// ── POST /reorder ────────────────────────────────────────────────
export async function handleReorder(req, res, ctx) {
    const { token, stateKey, order } = ctx._parsedBody || {};
    if (!token || !stateKey || !Array.isArray(order)) return json(res, { error: 'Données invalides' }, 400, req);
    const updateOrder = frameRepo.updateOrder;
    // Utiliser une transaction si disponible pour garantir l'atomicité du réordonnancement
    const tx = frameRepo.updateOrder._db?.transaction
        ? frameRepo.updateOrder._db.transaction(() => { order.forEach((f, i) => updateOrder.run(i, token, stateKey, f)); })
        : null;
    if (tx) tx(); else order.forEach((f, i) => updateOrder.run(i, token, stateKey, f));
    json(res, { ok: true }, 200, req);
}

// ── POST /delete-frame ───────────────────────────────────────────
export async function handleDeleteFrame(req, res, ctx) {
    const { token, stateKey, file } = ctx._parsedBody || {};
    if (!token || !stateKey || !file) return json(res, { error: 'Données invalides' }, 400, req);
    if (!SAFE_STATE_KEY.test(stateKey) || !SAFE_FILENAME.test(file)) return json(res, { error: 'Nom invalide' }, 400, req);

    const fp = path.resolve(path.join(IMAGES_DIR, token, stateKey, file));
    // Garde finale : le chemin résolu doit rester sous IMAGES_DIR
    if (fp.startsWith(path.resolve(IMAGES_DIR))) {
        try { fs.unlinkSync(fp); } catch {}
    }
    frameRepo.delete.run(token, stateKey, file);
    json(res, { ok: true }, 200, req);
}

// ── POST /move-frame ─────────────────────────────────────────────
export async function handleMoveFrame(req, res, ctx) {
    const { token, file, fromState, toState } = ctx._parsedBody || {};
    if (!token || !file || !fromState || !toState) return json(res, { error: 'Données invalides' }, 400, req);

    const src = path.resolve(path.join(IMAGES_DIR, token, fromState, file));
    const destDir = path.join(IMAGES_DIR, token, toState);
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, file);

    if (src.startsWith(path.resolve(IMAGES_DIR))) {
        try { fs.renameSync(src, dest); } catch {}
    }
    frameRepo.move.run(toState, token, fromState, file);
    json(res, { ok: true }, 200, req);
}
