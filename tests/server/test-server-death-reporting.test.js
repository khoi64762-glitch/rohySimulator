// Regression lock: a spawned test server that died AFTER readiness was
// invisible. Nothing watched the child, so every later request failed
// ECONNREFUSED in ~1 ms and the run reported a pile of unrelated-looking
// assertion failures; the stderr was only dumped in afterAll, far from the
// failing test and truncated in CI logs. That is how the intermittent
// cohorts-routes failure (CI run 32849292369, 2026-08-25) presented — six
// red tests, including one that shares no state with the others, which is
// what gave the crash away.
//
// CONTRACT (locked from tests/utils/startTestServer.js):
//   - getExitInfo() is null while the child is healthy.
//   - After an unexpected death it returns {code, signal, at}, so a suite can
//     say "the server is gone" instead of guessing at a connection error.
//   - close() is an EXPECTED exit and must NOT be reported as a death.

import { describe, it, expect, afterEach } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';

describe('startTestServer — unexpected child death is visible', () => {
    let server;
    afterEach(async () => { await server?.close(); server = null; });

    it('reports null exit info while the server is healthy', async () => {
        server = await startTestServer({ seed: false });
        const res = await fetch(`${server.baseUrl}/api/health`);
        expect(res.status).toBe(200);
        expect(server.getExitInfo()).toBeNull();
    }, 90_000);

    it('records the exit once the child dies on its own', async () => {
        server = await startTestServer({ seed: false });
        expect(server.getExitInfo()).toBeNull();

        // Kill it the way a crash would: the handle never learns through
        // close(), so this exercises the same path a real mid-run death takes.
        const killed = await fetch(`${server.baseUrl}/api/health`).then(r => r.status);
        expect(killed).toBe(200);
        process.kill(server.pid ?? 0, 0); // pid must be exposed or this throws

        // eslint-disable-next-line no-undef
        const { execSync } = await import('node:child_process');
        execSync(`kill -9 ${server.pid}`);

        // Give the exit event a tick to land.
        await new Promise((r) => setTimeout(r, 500));

        const info = server.getExitInfo();
        expect(info).not.toBeNull();
        expect(info.signal === 'SIGKILL' || info.code !== 0).toBe(true);
        expect(info.at).toBeTruthy();
    }, 90_000);
});
