// Tests for the unified auth TTL — authTtlSeconds() is the single source
// all three login lifetimes derive from (JWT exp, rohy_auth cookie maxAge,
// active_sessions expires_at).
//
// Regression lock: the three lifetimes used to be hardcoded separately
// (all at 4h in three different files); any drift between them silently
// logs users out at the shortest one. These tests pin (a) the env parsing,
// (b) that generateToken's exp claim actually follows authTtlSeconds().

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';

const TEST_JWT_SECRET = 'rohy-ttl-tests-secret';

let authTtlSeconds;
let generateToken;

beforeAll(async () => {
    // middleware/auth.js transitively imports db.js, which opens ROHY_DB at
    // module load — use an in-memory database so this unit test never
    // touches a real one (and there is no temp file to race on teardown).
    process.env.ROHY_DB = ':memory:';
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    delete process.env.JWT_EXPIRY;
    ({ authTtlSeconds, generateToken } = await import('../../server/middleware/auth.js'));
});

afterAll(() => {
    delete process.env.JWT_EXPIRY;
});

describe('authTtlSeconds', () => {
    it('defaults to 7 days when JWT_EXPIRY is unset', () => {
        delete process.env.JWT_EXPIRY;
        expect(authTtlSeconds()).toBe(7 * 24 * 3600);
    });

    it.each([
        ['45s', 45],
        ['90m', 90 * 60],
        ['4h', 4 * 3600],
        ['12H', 12 * 3600],
        ['7d', 7 * 24 * 3600],
        ['3600', 3600],
        [' 2h ', 2 * 3600],
    ])('parses JWT_EXPIRY=%s as %d seconds', (spec, expected) => {
        process.env.JWT_EXPIRY = spec;
        expect(authTtlSeconds()).toBe(expected);
    });

    it.each([['soon'], ['4 hours'], ['-2h'], ['']])(
        'falls back to the default on unparseable JWT_EXPIRY=%j',
        (spec) => {
            process.env.JWT_EXPIRY = spec;
            expect(authTtlSeconds()).toBe(7 * 24 * 3600);
        }
    );
});

describe('generateToken', () => {
    it('issues a JWT whose exp claim follows authTtlSeconds()', () => {
        process.env.JWT_EXPIRY = '4h';
        const before = Math.floor(Date.now() / 1000);
        const token = generateToken({ id: 1, username: 'u', email: 'u@x', role: 'student' });
        const payload = jwt.verify(token, TEST_JWT_SECRET);
        const ttl = payload.exp - before;
        expect(ttl).toBeGreaterThanOrEqual(4 * 3600 - 5);
        expect(ttl).toBeLessThanOrEqual(4 * 3600 + 5);
    });

    it('honours the 7d default when no JWT_EXPIRY is set', () => {
        delete process.env.JWT_EXPIRY;
        const before = Math.floor(Date.now() / 1000);
        const token = generateToken({ id: 1, username: 'u', email: 'u@x', role: 'student' });
        const payload = jwt.verify(token, TEST_JWT_SECRET);
        const ttl = payload.exp - before;
        expect(ttl).toBeGreaterThanOrEqual(7 * 24 * 3600 - 5);
        expect(ttl).toBeLessThanOrEqual(7 * 24 * 3600 + 5);
    });
});
