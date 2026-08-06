// tests/server/agent-page-wait.test.js
//
// POST /api/sessions/:sessionId/agents/:agentType/page — arrival timing.
//
// This endpoint had NO test coverage, which is the direct reason the bug
// below shipped and survived. The old handler computed:
//
//     minSec = Math.max(60, Math.min(180, configuredMinSec || 60))
//     maxSec = Math.max(minSec, Math.min(180, configuredMaxSec || 180))
//
// Two independent defects in that first line. `configuredMinSec || 60`
// treats a configured 0 as absent, because 0 is falsy — so an author who
// asked for "instant" got one minute. And `Math.max(60, …)` floors it at
// 60 again even if the first defect were fixed. The ceiling line has the
// mirror-image flaw: `configuredMaxSec || 180` turns a configured max of
// 0 into three minutes.
//
// Net effect: 0/0 — the setting that asks for NO wait — produced a
// uniform random 60–180s, the widest band the system could generate.
// Every seeded case shipped a consultant you had to stare at a progress
// bar for. No configuration could turn it off.
//
// Regression lock: instant must be reachable, must be the behaviour when
// nothing is configured, and must be a genuinely different state (no
// 'paged' row, no `arrives_at`) rather than a zero-length countdown.
//
// Harness follows tests/server/case-agents-merge.test.js: spawn the real
// server against a throwaway DB, seed rows through a second sqlite3
// handle on the same file, then drive the HTTP API.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const ADMIN_USERNAME = 'page-wait-admin';
const ADMIN_PASSWORD = 'page-wait-admin-pw-1';

// The handler's typo guard. Mirrors PAGE_WAIT_CEILING_SEC in
// server/routes/agents-routes.js — a duplicated constant on purpose, so
// that widening the ceiling in the handler trips this file rather than
// silently agreeing with itself.
const CEILING_SEC = 15 * 60;

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => (err ? reject(err) : resolve(db)));
    });
}

function closeDb(db) {
    return new Promise((resolve) => (db ? db.close(() => resolve()) : resolve()));
}

function pRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) {
            if (err) reject(err); else resolve(this);
        })
    );
}

function pGet(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)))
    );
}

// Each fixture is an agent_type on one case, carrying a different
// configured response window (MINUTES, as the column stores them).
const AGENTS = {
    // The default every seeded persona now uses.
    instant:   { type: 'nurse',      min: 0,   max: 0 },
    // A deliberate, author-chosen fixed delay.
    fixed:     { type: 'consultant', min: 2,   max: 2 },
    // A deliberate delay with jitter.
    ranged:    { type: 'relative',   min: 1,   max: 3 },
    // A fat-fingered minutes value the ceiling must absorb.
    typo:      { type: 'discussant', min: 600, max: 600 },
};
// Deliberately has NO case_agents row — an agent the case never
// provisioned. Must fall back to instant, not to a wait.
const UNPROVISIONED_TYPE = 'ghost';

describe('POST /sessions/:id/agents/:type/page — arrival timing', () => {
    let server;
    let token;
    let sessionId;

    beforeAll(async () => {
        server = await startTestServer({ seed: false });

        const db = await openDb(server.dbPath);
        try {
            const hash = await bcrypt.hash(ADMIN_PASSWORD, 4);
            const admin = await pRun(
                db,
                `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
                 VALUES (?, ?, ?, ?, 'admin', 1, 'active')`,
                [ADMIN_USERNAME, 'Page Wait Admin', 'page-wait@example.com', hash]
            );

            const caseRow = await pRun(
                db,
                `INSERT INTO cases (name, description, system_prompt, config, tenant_id)
                 VALUES (?, ?, ?, ?, 1)`,
                ['Page Wait Case', 'desc', 'case-prompt', '{}']
            );
            const caseId = caseRow.lastID;

            for (const { type, min, max } of Object.values(AGENTS)) {
                const tpl = await pRun(
                    db,
                    `INSERT INTO agent_templates
                        (agent_type, name, role_title, system_prompt, config, tenant_id)
                     VALUES (?, ?, ?, ?, '{}', 1)`,
                    [type, `Tpl ${type}`, type, 'prompt']
                );
                await pRun(
                    db,
                    `INSERT INTO case_agents
                        (case_id, agent_template_id, enabled, availability_type,
                         available_from_minute, response_time_min, response_time_max, tenant_id)
                     VALUES (?, ?, 1, 'on-call', 0, ?, ?, 1)`,
                    [caseId, tpl.lastID, min, max]
                );
            }

            const sess = await pRun(
                db,
                `INSERT INTO sessions (case_id, user_id, student_name, status, tenant_id)
                 VALUES (?, ?, ?, 'active', 1)`,
                [caseId, admin.lastID, 'Page Wait Student']
            );
            sessionId = sess.lastID;
        } finally {
            await closeDb(db);
        }

        const loginRes = await fetch(`${server.baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD })
        });
        expect(loginRes.status).toBe(200);
        token = (await loginRes.json()).token;
        expect(typeof token).toBe('string');
    }, 90_000);

    afterAll(async () => {
        if (server) await server.close();
    });

    async function page(agentType) {
        const res = await fetch(
            `${server.baseUrl}/api/sessions/${sessionId}/agents/${agentType}/page`,
            { method: 'POST', headers: { authorization: `Bearer ${token}` } }
        );
        return { res, body: await res.json() };
    }

    async function stateRow(agentType) {
        const db = await openDb(server.dbPath);
        try {
            return await pGet(
                db,
                `SELECT status, paged_at, arrives_at, arrived_at
                   FROM agent_session_state WHERE session_id = ? AND agent_type = ?`,
                [sessionId, agentType]
            );
        } finally {
            await closeDb(db);
        }
    }

    // -----------------------------------------------------------------
    // Regression lock: instant is reachable at all.
    // Against the pre-fix handler this returned status 'paged' with a
    // wait_seconds somewhere in 60–180.
    // -----------------------------------------------------------------
    it('returns the agent immediately when the case configures 0/0', async () => {
        const { res, body } = await page(AGENTS.instant.type);
        expect(res.status).toBe(200);
        expect(body.wait_seconds).toBe(0);
        expect(body.status).toBe('present');
        expect(body.arrives_at).toBeNull();
    });

    // Instant is a different STATE, not a zero-length countdown. A
    // 0-second 'paged' row would still render the wait card for a tick
    // and still depend on the ETA-convergence loop to clear it — the two
    // things most likely to strand a learner mid-case.
    it('writes no paged state and no ETA for an instant arrival', async () => {
        await page(AGENTS.instant.type);
        const row = await stateRow(AGENTS.instant.type);
        expect(row.status).toBe('present');
        expect(row.arrives_at).toBeNull();
        expect(row.arrived_at).not.toBeNull();
    });

    // Regression lock: an agent the case never provisioned must answer,
    // not impose a wait invented from nothing. Pre-fix this hit
    // `configuredMinSec || 60` with configuredMinSec = 0 and waited.
    it('treats an unprovisioned agent as instant', async () => {
        const { res, body } = await page(UNPROVISIONED_TYPE);
        expect(res.status).toBe(200);
        expect(body.wait_seconds).toBe(0);
        expect(body.status).toBe('present');
    });

    // -----------------------------------------------------------------
    // A configured delay still works — removing the floor must not have
    // removed the feature. This is the opt-in teaching device.
    // -----------------------------------------------------------------
    it('honours a fixed configured delay literally', async () => {
        const { body } = await page(AGENTS.fixed.type);
        expect(body.wait_seconds).toBe(AGENTS.fixed.min * 60);
        expect(body.status).toBe('paged');
        expect(body.arrives_at).toBeTruthy();
        expect(Number.isNaN(Date.parse(body.arrives_at))).toBe(false);
    });

    it('picks a value inside the configured range when min < max', async () => {
        const seen = new Set();
        for (let i = 0; i < 12; i++) {
            const { body } = await page(AGENTS.ranged.type);
            expect(body.wait_seconds).toBeGreaterThanOrEqual(AGENTS.ranged.min * 60);
            expect(body.wait_seconds).toBeLessThanOrEqual(AGENTS.ranged.max * 60);
            expect(body.status).toBe('paged');
            seen.add(body.wait_seconds);
        }
        // Not a strict requirement of the contract, but a single repeated
        // value across 12 draws would mean the jitter is gone.
        expect(seen.size).toBeGreaterThan(1);
    });

    it('stamps a paged row with an ETA for a delayed arrival', async () => {
        await page(AGENTS.fixed.type);
        const row = await stateRow(AGENTS.fixed.type);
        expect(row.status).toBe('paged');
        expect(row.arrives_at).not.toBeNull();
        expect(row.arrived_at).toBeNull();
    });

    // -----------------------------------------------------------------
    // The remaining clamp is a typo guard, not pacing policy.
    // -----------------------------------------------------------------
    it('caps an absurd configured delay at the ceiling', async () => {
        const { body } = await page(AGENTS.typo.type);
        expect(body.wait_seconds).toBe(CEILING_SEC);
        expect(body.status).toBe('paged');
    });

    // -----------------------------------------------------------------
    // The learner-visible consequence: after an instant page the agent
    // is listed as present, so the chat composer unlocks on the next
    // read without waiting for any convergence pass.
    // -----------------------------------------------------------------
    it('reports the instant agent as present on the next GET /agents', async () => {
        await page(AGENTS.instant.type);
        const res = await fetch(`${server.baseUrl}/api/sessions/${sessionId}/agents`, {
            headers: { authorization: `Bearer ${token}` }
        });
        expect(res.status).toBe(200);
        const { agents } = await res.json();
        const nurse = agents.find((a) => a.agent_type === AGENTS.instant.type);
        expect(nurse).toBeTruthy();
        expect(nurse.status).toBe('present');
        expect(nurse.arrives_at).toBeFalsy();
    });
});
