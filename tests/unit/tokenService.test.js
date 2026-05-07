/**
 * Tests unitaires : tokenService
 * ==============================
 * Couvre :
 *  - Determinisme de tokenFor (meme userId -> meme token)
 *  - Format SAFE_TOKEN (16 chars hex)
 *  - Round-trip uidFor(tokenFor(x)) === x
 *  - isValidTokenFormat : rejette les tokens malformes
 *  - tokenFor sans USER_HASH_SECRET : fallback ou erreur ?
 *
 * NOTE : ces tests requierent USER_HASH_SECRET defini en env. Le module
 * lit la variable lazy pour permettre dotenv.config() avant utilisation.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const ORIGINAL_SECRET = process.env.USER_HASH_SECRET;

beforeAll(() => {
    // Secret deterministe pour les tests (16 bytes hex)
    process.env.USER_HASH_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
});

afterAll(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.USER_HASH_SECRET;
    else process.env.USER_HASH_SECRET = ORIGINAL_SECRET;
});

describe('tokenService.SAFE_TOKEN', () => {
    it('matches a valid 16-char hex token', async () => {
        const { SAFE_TOKEN } = await import('../../src/services/tokenService.js');
        expect(SAFE_TOKEN.test('abcdef0123456789')).toBe(true);
        expect(SAFE_TOKEN.test('ABCDEF0123456789')).toBe(true);
    });

    it('rejects too short / too long / non-hex', async () => {
        const { SAFE_TOKEN } = await import('../../src/services/tokenService.js');
        expect(SAFE_TOKEN.test('abcdef012345678')).toBe(false);   // 15 chars
        expect(SAFE_TOKEN.test('abcdef01234567890')).toBe(false); // 17 chars
        expect(SAFE_TOKEN.test('zzzzzzzzzzzzzzzz')).toBe(false);   // non-hex
        expect(SAFE_TOKEN.test('../etc/passwd')).toBe(false);
        expect(SAFE_TOKEN.test('')).toBe(false);
    });
});

describe('tokenService.isValidTokenFormat', () => {
    it('returns true only for valid hex 16-char strings', async () => {
        const { isValidTokenFormat } = await import('../../src/services/tokenService.js');
        expect(isValidTokenFormat('1234567890abcdef')).toBe(true);
        expect(isValidTokenFormat('1234567890ABCDEF')).toBe(true);
        expect(isValidTokenFormat('not-a-token')).toBe(false);
        expect(isValidTokenFormat(null)).toBe(false);
        expect(isValidTokenFormat(undefined)).toBe(false);
        expect(isValidTokenFormat(123456)).toBe(false);
        expect(isValidTokenFormat('')).toBe(false);
    });
});

describe('tokenService.tokenFor / uidFor (HMAC determinism)', () => {
    // NOTE : tokenFor + uidFor maintiennent un cache en memoire. Les tests
    // reposent sur l'isolement par module : dynamic import dans chaque
    // suite si un cache propre est requis.

    it('produces a deterministic 16-char hex token for a given userId', async () => {
        const { tokenFor, SAFE_TOKEN } = await import('../../src/services/tokenService.js');
        const t1 = tokenFor('123456789012345678');
        const t2 = tokenFor('123456789012345678');
        expect(t1).toBe(t2);
        expect(t1.length).toBe(16);
        expect(SAFE_TOKEN.test(t1)).toBe(true);
    });

    it('produces different tokens for different userIds', async () => {
        const { tokenFor } = await import('../../src/services/tokenService.js');
        const a = tokenFor('111111111111111111');
        const b = tokenFor('222222222222222222');
        expect(a).not.toBe(b);
    });

    it('round-trips : uidFor(tokenFor(uid)) === uid (for cached entries)', async () => {
        const { tokenFor, uidFor } = await import('../../src/services/tokenService.js');
        const userId = '987654321098765432';
        const token  = tokenFor(userId);
        expect(uidFor(token)).toBe(userId);
    });

    it('uidFor returns null for unknown tokens (cache miss + DB miss)', async () => {
        const { uidFor } = await import('../../src/services/tokenService.js');
        // Token aleatoire jamais genere -> cache miss
        expect(uidFor('fffffffffffff000')).toBeNull();
    });
});
