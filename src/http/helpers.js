/**
 * Helpers HTTP — utilitaires de réponse et lecture de corps
 * ==========================================================
 * Fonctions partagées par tous les handlers de routes :
 *   - json() : réponse JSON avec CORS + security headers
 *   - serveFile() : servir un fichier statique avec MIME approprié
 *   - readBody() : lire le corps de la requête avec limite de taille
 *   - parseJsonBody() : raccourci readBody + JSON.parse
 *   - escapeHtml() : protection contre XSS dans les templates HTML inline
 *
 * Dépendances : node:fs, node:path, http/cors
 */
import fs from 'node:fs';
import path from 'node:path';
import { corsHeaders, securityHeaders } from './cors.js';

export const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript',
    '.css':  'text/css',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.webp': 'image/webp',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
    '.json': 'application/json',
};

// Limite de taille par défaut : protège contre les requêtes trop volumineuses
export const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 Mo

export function json(res, data, status = 200, req = null) {
    res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders(req), ...securityHeaders() });
    res.end(JSON.stringify(data));
}

export function serveFile(res, filePath, req = null) {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', ...corsHeaders(req), ...securityHeaders() };
    // HTML et CSS : empêcher le cache navigateur pour refléter les mises à jour immédiates
    if (ext === '.html' || ext === '.css') {
        headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
        headers['Pragma'] = 'no-cache';
    }
    // SVG : Content-Security-Policy restrictive + inline plutôt qu'attachment
    // pour éviter l'exécution de scripts embarqués dans des SVG malveillants
    if (ext === '.svg') {
        headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'";
        headers['Content-Disposition'] = 'inline';
    }
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
    return true;
}

export function readBody(req, maxSize = MAX_BODY_SIZE) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', chunk => {
            size += chunk.length;
            // Détruire la connexion immédiatement pour libérer les ressources
            if (size > maxSize) { req.destroy(); reject(new Error('Corps trop volumineux')); return; }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

export async function parseJsonBody(req) {
    const raw = await readBody(req);
    return JSON.parse(raw.toString());
}

// Utilisé dans les templates HTML inline pour éviter les injections XSS
export function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
