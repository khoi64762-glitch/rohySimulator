// Session-running pathways — regression locks for the IDOR + tenant-escape
// defects the audit found in the labs / exam / treatment routes.
//
// Server-integration tier: a real Express child on a throwaway sqlite DB
// (startTestServer), driven over HTTP. Users, cases, investigations and
// sessions are seeded straight into the DB so the tests exercise the ROUTE
// gates, not a registration flow.
//
// Each `it` here fails against the pre-fix code and passes against the fix —
// the marker of a regression lock, not a happy-path smoke test.
//
// NOT covered here (deliberately): the administer double-fire 409. Its loser
// only appears when two requests pass the status pre-check before either
// writes — a race no deterministic test can force. The sequential status
// guard it sits behind is already locked by administer-route.test.js.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';
import { openDb, closeDb, seedUser, run, get, asUser } from '../utils/authHttp.js';

describe('session-running pathways (IDOR + tenant scope)', () => {
    let server;
    let db;
    let owner;      // student who owns session 600 (tenant 1)
    let intruder;   // a different student in the SAME tenant
    let t2;         // a student in tenant 2, owns session 602

    beforeAll(async () => {
        server = await startTestServer({ env: { ROHY_DISABLE_AUTH_RATE_LIMIT: '1' } });
        db = await openDb(server.dbPath);

        const ownerId = await seedUser(db, { username: 'sr_owner', role: 'student', tenantId: 1 });
        await seedUser(db, { username: 'sr_intruder', role: 'student', tenantId: 1 });
        const t2Id = await seedUser(db, { username: 'sr_t2', role: 'student', tenantId: 2 });

        // Three cases: the owner's (tenant 1), a FOREIGN case in another tenant
        // that carries a configured investigation, and the tenant-2 student's own.
        await run(db, `INSERT INTO cases (id, name, system_prompt, tenant_id) VALUES (50, 'Owner case', 'be a patient', 1)`);
        await run(db, `INSERT INTO cases (id, name, system_prompt, tenant_id) VALUES (51, 'Foreign case', 'be a patient', 2)`);
        await run(db, `INSERT INTO cases (id, name, system_prompt, tenant_id) VALUES (52, 'T2 case', 'be a patient', 2)`);

        // Investigation 9001 belongs to the FOREIGN case (51), never to case 50.
        await run(db,
            `INSERT INTO case_investigations (id, case_id, investigation_type, test_name, turnaround_minutes)
             VALUES (9001, 51, 'lab', 'Secret Panel', 3)`);

        await run(db,
            `INSERT INTO sessions (id, case_id, user_id, student_name, status, tenant_id)
             VALUES (600, 50, ?, 'sr_owner', 'active', 1)`, [ownerId]);
        await run(db,
            `INSERT INTO sessions (id, case_id, user_id, student_name, status, tenant_id)
             VALUES (602, 52, ?, 'sr_t2', 'active', 2)`, [t2Id]);

        owner = await asUser(server.baseUrl, 'sr_owner');
        intruder = await asUser(server.baseUrl, 'sr_intruder');
        t2 = await asUser(server.baseUrl, 'sr_t2');
    });

    afterAll(async () => {
        await closeDb(db);
        await server.close();
    });

    it('refuses one student the lab-results of another student', async () => {
        // The owner can read their own (empty) results.
        const mine = await owner('/api/sessions/600/lab-results');
        expect(mine.status).toBe(200);

        // Regression lock: GET /lab-results carried `authenticateToken` and
        // nothing else — no ownership check, no tenant filter, WHERE
        // io.session_id = :id straight from the URL. Any logged-in student could
        // walk session ids and read every other learner's results — the answer
        // key of the graded act.
        const theirs = await intruder('/api/sessions/600/lab-results');
        expect(theirs.status).toBe(403);
    });

    it('will not order an investigation configured for a different case', async () => {
        // 9001 is case 51's investigation; session 600 is case 50.
        const res = await owner('/api/sessions/600/order-labs', {
            method: 'POST', json: { lab_ids: ['9001'] },
        });
        expect(res.status).toBe(200);   // the request itself is well-formed…

        // Regression lock: without `AND case_id = ?` the server bound ANY case's
        // (or tenant's) investigation to this session, after which its results
        // were readable back out. Nothing foreign may be ordered.
        const leaked = await get(db,
            `SELECT COUNT(*) AS n FROM investigation_orders
              WHERE session_id = 600 AND investigation_id = 9001`);
        expect(leaked.n).toBe(0);
    });

    it("binds an exam finding to the session's case and tenant, ignoring the body", async () => {
        const res = await t2('/api/sessions/602/exam-findings', {
            method: 'POST',
            json: {
                body_region: 'chest', exam_type: 'auscultation', finding: 'clear',
                case_id: 99999,   // a lie the client must not be able to tell
            },
        });
        expect(res.status).toBe(200);

        // Regression lock: case_id was read from the body (a learner could file a
        // finding against another case and skew its analytics) and tenant_id was
        // omitted entirely, defaulting to 1 — so a tenant-2 learner's finding
        // landed in tenant 1, out of their own view AND out of reach of the
        // right-to-erasure purge (WHERE tenant_id = ? AND user_id = ?).
        const row = await get(db,
            `SELECT case_id, tenant_id FROM physical_exam_findings
              WHERE session_id = 602 ORDER BY id DESC LIMIT 1`);
        expect(row.case_id).toBe(52);   // the session's real case, not 99999
        expect(row.tenant_id).toBe(2);  // the learner's tenant, not the default 1
    });
});
