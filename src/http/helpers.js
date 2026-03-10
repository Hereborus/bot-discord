// ── Utilitaires HTTP ─────────────────────────────────────────────
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

export const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 Mo

export function json(res, data, status = 200, req = null) {
    res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders(req), ...securityHeaders() });
    res.end(JSON.stringify(data));
}

export function serveFile(res, filePath, req = null) {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', ...corsHeaders(req), ...securityHeaders() };
    if (ext === '.html' || ext === '.css') {
        headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
        headers['Pragma'] = 'no-cache';
    }
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

export function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
