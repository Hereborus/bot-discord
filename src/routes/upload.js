/**
 * Routes upload et gestion des frames d'avatar
 * ===============================================
 * Gère l'upload, le réordonnement et la suppression des frames PNG/WebP :
 *   POST /upload        → upload une image (multipart/form-data)
 *   POST /reorder       → réordonner les frames d'un état
 *   POST /delete-frame  → supprimer une frame
 *   POST /move-frame    → déplacer une frame d'un état vers un autre
 *
 * Dépendances injectées via `deps` :
 *   stmts, db, IMAGES_DIR, TIER_LIMITS, rateLimit, getClientIp,
 *   uidFor, isKnownToken, broadcastFrameUpdate,
 *   json, readBody, parseMultipart, validateMagicBytes, SAFE_STATE_KEY, SAFE_FILENAME
 *
 * Sanitisation : chaque image est re-encodée via sharp → WebP avant persistance.
 * La validation des magic bytes est une garde secondaire.
 */

import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { json, readBody } from '../http/helpers.js';
import { uidFor, isValidTokenFormat } from '../services/tokenService.js';
import { TIER_LIMITS } from '../services/tierService.js';

// ── Expressions régulières de sécurité ───────────────────────────
// Protection contre les attaques de path traversal.
const SAFE_STATE_KEY = /^[a-zA-Z0-9_-]{1,64}$/;
const SAFE_FILENAME  = /^[a-zA-Z0-9._-]{1,255}$/;

// ── Validation magic bytes ────────────────────────────────────────
// Vérifie que le contenu binaire correspond bien au format déclaré (extension).
// Garde secondaire : la vraie sanitisation est le re-encodage via sharp.
const IMAGE_SIGNATURES = {
    '.png':  [Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])],
    '.jpg':  [Buffer.from([0xFF, 0xD8, 0xFF])],
    '.jpeg': [Buffer.from([0xFF, 0xD8, 0xFF])],
    '.gif':  [Buffer.from('GIF87a'), Buffer.from('GIF89a')],
    '.webp': [Buffer.from('RIFF')], // + WEBP à offset 8
};

function validateMagicBytes(buffer, ext) {
    const sigs = IMAGE_SIGNATURES[ext];
    if (!sigs) return false;
    for (const sig of sigs) {
        if (buffer.length >= sig.length && buffer.subarray(0, sig.length).equals(sig)) {
            if (ext === '.webp') return buffer.length >= 12 && buffer.subarray(8, 12).equals(Buffer.from('WEBP'));
            return true;
        }
    }
    return false;
}

// ── Parser multipart minimaliste ─────────────────────────────────
// Pas de dépendance externe (busboy, formidable).
// Suffisant pour un formulaire simple : token + stateKey + image.
function indexOf(buf, search, start = 0) {
    for (let i = start; i <= buf.length - search.length; i++) {
        let ok = true;
        for (let j = 0; j < search.length; j++) {
            if (buf[i + j] !== search[j]) { ok = false; break; }
        }
        if (ok) return i;
    }
    return -1;
}

function parseMultipart(body, boundary) {
    const parts = [], sep = Buffer.from(`--${boundary}`);
    let offset = 0;
    while (offset < body.length) {
        const start = indexOf(body, sep, offset);
        if (start === -1) break;
        offset = start + sep.length;
        if (body[offset] === 45 && body[offset + 1] === 45) break;
        if (body[offset] === 13) offset += 2;
        const he = indexOf(body, Buffer.from('\r\n\r\n'), offset);
        if (he === -1) break;
        const hs = body.slice(offset, he).toString();
        offset = he + 4;
        const ns = indexOf(body, sep, offset), de = ns === -1 ? body.length : ns - 2, data = body.slice(offset, de);
        offset = ns === -1 ? body.length : ns;
        parts.push({
            name: hs.match(/name="([^"]+)"/)?.[1] || '',
            filename: hs.match(/filename="([^"]+)"/)?.[1] || '',
            contentType: hs.match(/Content-Type:\s*(.+)/i)?.[1]?.trim() || '',
            data,
        });
    }
    return parts;
}

// ── Handlers ─────────────────────────────────────────────────────

/**
 * POST /upload
 * Upload une image dans un état donné (multipart/form-data).
 * Re-encode en WebP via sharp, valide les limites tier.
 */
export async function handleUpload(req, res, ctx, { stmts, db, IMAGES_DIR, rateLimit, getClientIp, isKnownToken, broadcastFrameUpdate }) {
    try {
        // Rate limit : 30 uploads par minute par IP
        const clientIp = getClientIp(req);
        if (rateLimit(`upload:${clientIp}`, 30, 60_000))
            return json(res, { error: 'Trop de requêtes, réessayez dans une minute' }, 429, req);

        const body = await readBody(req, 50 * 1024 * 1024),
            ct = req.headers['content-type'] || '',
            bm = ct.match(/boundary=([^\s;]+)/);
        if (!bm) return json(res, { error: 'boundary manquant' }, 400, req);
        const parts = parseMultipart(body, bm[1]), fields = {};
        for (const p of parts) if (!p.filename) fields[p.name] = p.data.toString();
        const imgPart = parts.find(p => p.filename);
        const { token, stateKey } = fields;
        if (!isValidTokenFormat(token))
            return json(res, { error: 'token invalide (format)' }, 400, req);
        if ((!uidFor(token) && !isKnownToken(token)) || !stateKey || !imgPart)
            return json(res, { error: 'token invalide, stateKey ou image manquant' }, 400, req);
        if (!SAFE_STATE_KEY.test(stateKey))
            return json(res, { error: 'stateKey invalide (caractères alphanumériques, _ et - uniquement)' }, 400, req);
        const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
        if (imgPart.data.length > MAX_IMAGE_SIZE)
            return json(res, { error: 'Image trop volumineuse (max 10 Mo)' }, 413, req);
        const ext = path.extname(imgPart.filename).toLowerCase();
        // Formats acceptés : PNG, JPG, GIF, WebP uniquement (SVG interdit — vecteur XSS)
        const ALLOWED_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
        if (!ALLOWED_IMAGE_EXTS.includes(ext))
            return json(res, { error: 'Format non supporté (PNG, JPG, GIF, WebP uniquement)' }, 400, req);
        if (!validateMagicBytes(imgPart.data, ext))
            return json(res, { error: 'Le contenu du fichier ne correspond pas au format déclaré' }, 400, req);

        // Enforcement tier : limites d'upload
        const limits = ctx.tierLimits || TIER_LIMITS.free;
        const isClosed = stateKey.endsWith('_closed');
        const existingStates = db.prepare('SELECT DISTINCT state_key FROM frames WHERE token = ?').all(token);
        const isNewState = !existingStates.some(s => s.state_key === stateKey);
        if (isNewState) {
            const openCount   = existingStates.filter(s => !s.state_key.endsWith('_closed')).length;
            const closedCount = existingStates.filter(s => s.state_key.endsWith('_closed')).length;
            if (isClosed && closedCount >= limits.maxClosedStates)
                return json(res, { error: `Limite atteinte : ${limits.maxClosedStates} états fermés maximum`, tier: ctx.tier || 'free', upgrade: true }, 403, req);
            if (!isClosed && openCount >= limits.maxStates)
                return json(res, { error: `Limite atteinte : ${limits.maxStates} états maximum`, tier: ctx.tier || 'free', upgrade: true }, 403, req);
        }
        const framesInState = stmts.getFramesByState.all(token, stateKey);
        if (framesInState.length >= limits.maxFramesPerState)
            return json(res, { error: `Limite atteinte : ${limits.maxFramesPerState} frames par état`, tier: ctx.tier || 'free', upgrade: true }, 403, req);

        // Conversion sécurisée WebP via sharp (reprocessing = sanitisation principale)
        const isGif = ext === '.gif';
        let outputBuffer;
        try {
            outputBuffer = await sharp(imgPart.data, isGif ? { animated: true } : {})
                .webp({ quality: 85 })
                .toBuffer();
        } catch (sharpErr) {
            return json(res, { error: 'Image invalide ou corrompue' }, 400, req);
        }
        const outputExt = '.webp';

        const dir = path.join(IMAGES_DIR, token, stateKey);
        // Vérification path traversal sur le répertoire cible
        const resolvedDir = path.resolve(dir);
        if (!resolvedDir.startsWith(path.resolve(IMAGES_DIR)))
            return json(res, { error: 'Chemin invalide' }, 403, req);
        fs.mkdirSync(dir, { recursive: true });
        const baseName = path.basename(imgPart.filename, ext).replace(/[^a-zA-Z0-9._-]/g, '_');
        const fname = `${Date.now()}_${baseName}${outputExt}`;
        fs.writeFileSync(path.join(dir, fname), outputBuffer);

        // Insérer en base de données
        const maxOrder = stmts.maxSortOrder.get(token, stateKey).max_order;
        stmts.insertFrame.run(token, stateKey, fname, maxOrder + 1, ext, outputBuffer.length);
        // S'assurer que l'utilisateur existe en DB
        if (!stmts.getUser.get(token)) stmts.upsertUser.run(token, '???', '{}');

        broadcastFrameUpdate(token);
        return json(res, {
            ok: true,
            file: fname,
            url: `/images/${token}/${stateKey}/${fname}`,
        }, 200, req);
    } catch (err) {
        console.error('Upload error:', err);
        return json(res, { error: "Erreur lors de l'upload" }, 500, req);
    }
}

/**
 * POST /reorder  { token, stateKey, order: [] }
 * Réordonne les frames d'un état via une transaction SQLite.
 */
export async function handleReorder(req, res, ctx, { stmts, db, isKnownToken }) {
    try {
        const { token, stateKey, order } = ctx._parsedBody || JSON.parse((await readBody(req)).toString());
        if (!isValidTokenFormat(token))
            return json(res, { error: 'token invalide (format)' }, 400, req);
        if ((!uidFor(token) && !isKnownToken(token)) || !stateKey || !Array.isArray(order))
            return json(res, { error: 'params manquants' }, 400, req);
        const updateOrder = db.transaction(files => {
            for (let i = 0; i < files.length; i++) {
                stmts.updateFrameOrder.run(i, token, stateKey, files[i]);
            }
        });
        updateOrder(order);
        return json(res, { ok: true }, 200, req);
    } catch (err) {
        console.error('Reorder error:', err);
        return json(res, { error: 'Erreur lors du réordonnement' }, 500, req);
    }
}

/**
 * POST /delete-frame  { token, stateKey, file }
 * Supprime une frame sur disque et dans la DB.
 */
export async function handleDeleteFrame(req, res, ctx, { stmts, IMAGES_DIR, isKnownToken, broadcastFrameUpdate }) {
    try {
        const { token, stateKey, file } = ctx._parsedBody || JSON.parse((await readBody(req)).toString());
        if (!isValidTokenFormat(token))
            return json(res, { error: 'token invalide (format)' }, 400, req);
        if ((!uidFor(token) && !isKnownToken(token)) || !stateKey || !file)
            return json(res, { error: 'params manquants' }, 400, req);
        if (!SAFE_STATE_KEY.test(stateKey) || !SAFE_FILENAME.test(file))
            return json(res, { error: 'Paramètres invalides' }, 400, req);
        const fp = path.resolve(path.join(IMAGES_DIR, token, stateKey, file));
        if (!fp.startsWith(path.resolve(IMAGES_DIR)))
            return json(res, { error: 'Interdit' }, 403, req);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
        stmts.deleteFrame.run(token, stateKey, file);
        broadcastFrameUpdate(token);
        return json(res, { ok: true }, 200, req);
    } catch (err) {
        console.error('Delete frame error:', err);
        return json(res, { error: 'Erreur lors de la suppression' }, 500, req);
    }
}

/**
 * POST /move-frame  { token, file, fromState, toState }
 * Déplace une frame d'un état vers un autre (single-frame mode : écrase l'état cible).
 */
export async function handleMoveFrame(req, res, ctx, { stmts, IMAGES_DIR, isKnownToken, broadcastFrameUpdate }) {
    try {
        const { token, file, fromState, toState } = ctx._parsedBody || JSON.parse((await readBody(req)).toString());
        if (!isValidTokenFormat(token))
            return json(res, { error: 'token invalide (format)' }, 400, req);
        if (!token || !file || !fromState || !toState)
            return json(res, { error: 'params manquants' }, 400, req);
        if (!SAFE_STATE_KEY.test(fromState) || !SAFE_STATE_KEY.test(toState) || !SAFE_FILENAME.test(file))
            return json(res, { error: 'Paramètres invalides' }, 400, req);
        if (fromState === toState)
            return json(res, { ok: true }, 200, req);
        const srcPath = path.resolve(path.join(IMAGES_DIR, token, fromState, file));
        if (!srcPath.startsWith(path.resolve(IMAGES_DIR)))
            return json(res, { error: 'Interdit' }, 403, req);
        // Single-frame mode : supprimer les frames existantes dans toState
        const existing = stmts.getFramesByState.all(token, toState);
        for (const f of existing) {
            const p = path.join(IMAGES_DIR, token, toState, f.filename);
            if (fs.existsSync(p)) fs.unlinkSync(p);
            stmts.deleteFrame.run(token, toState, f.filename);
        }
        // Déplacer le fichier sur disque
        const destDir = path.join(IMAGES_DIR, token, toState);
        fs.mkdirSync(destDir, { recursive: true });
        const destPath = path.join(destDir, file);
        if (fs.existsSync(srcPath)) fs.renameSync(srcPath, destPath);
        // Mettre à jour la DB
        stmts.moveFrame.run(toState, token, fromState, file);
        broadcastFrameUpdate(token);
        return json(res, { ok: true }, 200, req);
    } catch (err) {
        console.error('Move frame error:', err);
        return json(res, { error: 'Erreur lors du déplacement' }, 500, req);
    }
}
