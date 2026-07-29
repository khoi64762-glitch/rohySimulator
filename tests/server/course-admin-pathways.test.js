// Course-administration pathways — regression locks for the co-teacher
// visibility, PATCH-merge, join-code and case-move defects the audit found in
// the cohorts / lessons routes.
//
// Server-integration tier: a real Express child on a throwaway sqlite DB.
// Educators, students and cases are seeded straight into the DB; the courses
// themselves are built over HTTP as the owning teacher, because building them
// is part of what these tests exercise.
//
// Every `it` fails against the pre-fix code and passes against the fix.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';
import { openDb, closeDb, seedUser, run, get, asUser } from '../utils/authHttp.js';

describe('course-administration pathways', () => {
    let server;
    let db;
    let teacherA;   // owns every course built below
    let teacherB;   // a co-teacher on one course, a stranger to another
    let student;

    // Course ids captured from the create calls.
    let courseCo;       // teacherB is a co-teacher here
    let courseMove;     // holds caseX; teacherB does NOT manage it
    let courseWindow;   // holds caseY; used for the PATCH-merge test
    let joinCode;       // of a fourth course, for the join-normalisation test

    const CASE_X = 60;
    const CASE_Y = 61;

    beforeAll(async () => {
        server = await startTestServer({ env: { ROHY_DISABLE_AUTH_RATE_LIMIT: '1' } });
        db = await openDb(server.dbPath);

        await seedUser(db, { username: 'ca_teacherA', role: 'educator', tenantId: 1 });
        await seedUser(db, { username: 'ca_teacherB', role: 'educator', tenantId: 1 });
        await seedUser(db, { username: 'ca_student', role: 'student', tenantId: 1 });
        await run(db, `INSERT INTO cases (id, name, system_prompt, tenant_id) VALUES (?, 'Case X', 'be a patient', 1)`, [CASE_X]);
        await run(db, `INSERT INTO cases (id, name, system_prompt, tenant_id) VALUES (?, 'Case Y', 'be a patient', 1)`, [CASE_Y]);

        teacherA = await asUser(server.baseUrl, 'ca_teacherA');
        teacherB = await asUser(server.baseUrl, 'ca_teacherB');
        student = await asUser(server.baseUrl, 'ca_student');

        const mk = async (payload) => {
            const r = await teacherA('/api/cohorts', { method: 'POST', json: payload });
            if (r.status !== 201) throw new Error(`cohort create failed: ${r.status} ${await r.text()}`);
            return (await r.json()).cohort;
        };

        courseCo = (await mk({ name: 'Co-taught', coteacher_identifiers: ['ca_teacherB'] })).id;
        courseMove = (await mk({ name: 'Has case X', case_ids: [CASE_X] })).id;
        courseWindow = (await mk({ name: 'Windowed', case_ids: [CASE_Y] })).id;
        joinCode = (await mk({ name: 'Joinable', join_code: true })).join_code;
    });

    afterAll(async () => {
        await closeDb(db);
        await server.close();
    });

    it('lists a course to a co-teacher, not only its owner', async () => {
        // Regression lock: the /cohorts list filtered on owner_user_id alone, so
        // a co-teacher whom loadOwnedCohort() lets PATCH/assign/read a course
        // never saw it in the list that course lives in — unreachable from the UI.
        const r = await teacherB('/api/cohorts');
        expect(r.status).toBe(200);
        const { cohorts } = await r.json();
        expect(cohorts.some((c) => c.id === courseCo)).toBe(true);
    });

    it('merges a case-window PATCH instead of wiping the untouched bound', async () => {
        // Set both bounds first.
        const first = await teacherA(`/api/cohorts/${courseWindow}/cases/${CASE_Y}`, {
            method: 'PATCH', json: { available_from: '2026-01-01', available_until: '2026-06-01' },
        });
        expect(first.status).toBe(200);

        // Then extend ONLY the deadline. Regression lock: this used to write both
        // columns unconditionally, so touching available_until silently nulled
        // available_from and re-opened the case earlier than the teacher set.
        const second = await teacherA(`/api/cohorts/${courseWindow}/cases/${CASE_Y}`, {
            method: 'PATCH', json: { available_until: '2026-07-01' },
        });
        expect(second.status).toBe(200);
        const body = await second.json();
        expect(body.available_from).toBeTruthy();                 // NOT wiped
        expect(String(body.available_from)).toContain('2026-01-01');
        expect(String(body.available_until)).toContain('2026-07-01');
    });

    it('accepts a join code with wrong casing and stray separators', async () => {
        // The stored code is upper-case and alphabet-only; a student reads it off
        // a slide and types it lower-cased with a hyphen. Regression lock: a raw
        // trim()+exact match 404'd this as "no cohort for that join code".
        const mangled = `${joinCode.toLowerCase().slice(0, 4)}-${joinCode.toLowerCase().slice(4)}`;
        const r = await student('/api/cohorts/join', { method: 'POST', json: { join_code: mangled } });
        expect(r.status).toBe(200);
        const { cohort } = await r.json();
        expect(cohort.name).toBe('Joinable');
    });

    it('refuses to rip a case out of a course the caller does not manage', async () => {
        // teacherB is an educator but manages neither courseMove nor caseX.
        // Regression lock: permission was checked only on the course a case moves
        // TO; an unassign ({cohortId:null}) checked nothing it moved OUT OF, so any
        // educator could strip another teacher's case from their course.
        const r = await teacherB(`/api/cases/${CASE_X}/course`, {
            method: 'PUT', json: { cohortId: null },
        });
        expect(r.status).toBe(403);

        // The link survived: caseX is still live in courseMove.
        const link = await get(db,
            `SELECT COUNT(*) AS n FROM cohort_cases
              WHERE cohort_id = ? AND case_id = ? AND deleted_at IS NULL`,
            [courseMove, CASE_X]);
        expect(link.n).toBe(1);
    });
});
