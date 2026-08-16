// tests/server/scenario-seed.test.js
//
// Adversarial-review regression lock for `POST /scenarios/seed`:
//
//   - the INSERT omitted `tenant_id` (column default 1), so a tenant-2 admin
//     seeded PUBLIC scenarios into tenant 1 — rows now land in the caller's
//     tenant;
//   - every call inserted the six built-ins again — a built-in whose name is
//     already live in that tenant is now skipped, reported as `skipped`
//     (existing `inserted` / `errors` / `message` fields kept).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';
import { openDb, closeDb, run, all, seedUser, asUser } from '../utils/authHttp.js';

const TENANT_B = 2;

async function scenarioRows(dbPath) {
    const db = await openDb(dbPath);
    try {
        return await all(db, `SELECT name, tenant_id, is_public, language, deleted_at FROM scenarios ORDER BY id`);
    } finally {
        await closeDb(db);
    }
}

describe('POST /scenarios/seed — tenant-scoped + idempotent', () => {
    let server;
    let adminA; // tenant 1
    let adminB; // tenant 2

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const db = await openDb(server.dbPath);
        try {
            await run(db,
                `INSERT OR IGNORE INTO tenants (id, slug, name, is_default) VALUES (?, ?, ?, 0)`,
                [TENANT_B, 'tenant-b', 'Tenant B']);
            await seedUser(db, { username: 'seed-admin-a', role: 'admin', tenantId: 1 });
            await seedUser(db, { username: 'seed-admin-b', role: 'admin', tenantId: TENANT_B });
        } finally {
            await closeDb(db);
        }
        adminA = await asUser(server.baseUrl, 'seed-admin-a');
        adminB = await asUser(server.baseUrl, 'seed-admin-b');
    }, 90_000);

    afterAll(async () => {
        if (server) await server.close();
    });

    // Regression lock: seeded rows carry the CALLER's tenant, not the column default.
    it('a tenant-2 admin seeds into tenant 2 only', async () => {
        const res = await adminB('/api/scenarios/seed', { method: 'POST' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.inserted).toBe(6);
        expect(body.skipped).toBe(0);
        expect(body.errors).toBe(0);
        expect(typeof body.message).toBe('string');

        const rows = await scenarioRows(server.dbPath);
        expect(rows).toHaveLength(6);
        expect(rows.every((r) => r.tenant_id === TENANT_B)).toBe(true);
        expect(rows.every((r) => r.is_public === 1)).toBe(true);
        expect(rows.every((r) => r.language === 'en')).toBe(true);

        // Tenant 1 sees none of them.
        const listA = await adminA('/api/scenarios');
        expect(listA.status).toBe(200);
        expect((await listA.json()).scenarios).toHaveLength(0);
        // Tenant 2 sees all six.
        const listB = await adminB('/api/scenarios');
        expect((await listB.json()).scenarios).toHaveLength(6);
    });

    // Regression lock: repeated calls do not duplicate.
    it('a second call in the same tenant inserts 0 and reports 6 skipped', async () => {
        const res = await adminB('/api/scenarios/seed', { method: 'POST' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({ inserted: 0, skipped: 6, errors: 0 });

        const rows = await scenarioRows(server.dbPath);
        expect(rows).toHaveLength(6);
    });

    it('another tenant still gets its own full set (per-tenant idempotency)', async () => {
        const res = await adminA('/api/scenarios/seed', { method: 'POST' });
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ inserted: 6, skipped: 0, errors: 0 });

        const rows = await scenarioRows(server.dbPath);
        expect(rows).toHaveLength(12);
        expect(rows.filter((r) => r.tenant_id === 1)).toHaveLength(6);
        expect(rows.filter((r) => r.tenant_id === TENANT_B)).toHaveLength(6);
    });

    it('a soft-deleted built-in is re-seeded (only LIVE names count as present)', async () => {
        const db = await openDb(server.dbPath);
        try {
            await run(db,
                `UPDATE scenarios SET deleted_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND name = 'STEMI Progression'`,
                [TENANT_B]);
        } finally {
            await closeDb(db);
        }
        const res = await adminB('/api/scenarios/seed', { method: 'POST' });
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ inserted: 1, skipped: 5, errors: 0 });

        const rows = await scenarioRows(server.dbPath);
        const liveB = rows.filter((r) => r.tenant_id === TENANT_B && r.deleted_at === null);
        expect(liveB).toHaveLength(6);
    });
});
