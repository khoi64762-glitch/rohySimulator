import { test, expect } from '@playwright/test';
import {
  installSyntheticCamera,
  allCameraTracksEnded,
  readStoredWindows,
} from './helpers';
import {
  OYON_HOST_CONTRACT_VERSION,
  OYON_VERSION,
  OYON_WINDOW_BATCH_SCHEMA_VERSION,
} from '../../src/version.js';

/*
 * <oyon-app> embed contract (:5173, examples/embed-host.html) — every
 * promise docs/EMBEDDING.md makes to a host, asserted in a real browser.
 * The host page is deliberately hostile (Comic Sans, lurid colors) so the
 * isolation probes mean something.
 *
 * Encodes the regressions found in the post-2.1.0 review:
 *   - importing the bundle must not touch host history (F1)
 *   - getToken set AFTER connect must authenticate sync (F4)
 *   - the session-id attribute must be coherent across stored windows,
 *     oyon:window events, and the sync endpoint URL (F5)
 *   - removing the element must release the camera (F6)
 */

const HOST_PAGE = `${process.env.OYON_E2E_ROOT_URL ?? 'http://127.0.0.1:5173'}/examples/embed-host.html`;

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => void d.dismiss().catch(() => {}));
});

test('host page isolation: history untouched, styles contained both ways', async ({ page }) => {
  await page.goto(HOST_PAGE);
  await expect(page.locator('oyon-app')).toBeVisible();

  const probes = await page.evaluate(() => {
    const el = document.querySelector('oyon-app') as HTMLElement & {
      version?: string;
      hostContractVersion?: string;
    };
    const constructor = customElements.get('oyon-app') as
      | (CustomElementConstructor & { version?: string })
      | undefined;
    const shadowHost = el.shadowRoot?.querySelector('.oyon-app-host');
    return {
      // F1: loading the element bundle must not write host history state
      // or monkey-patch the history API.
      historyState: window.history.state,
      pushStateNative: String(window.history.pushState).includes('[native code]'),
      replaceStateNative: String(window.history.replaceState).includes('[native code]'),
      // Shadow boundary, inward: host Comic Sans must not pierce.
      hostFont: getComputedStyle(document.body).fontFamily,
      embedFont: shadowHost ? getComputedStyle(shadowHost).fontFamily : null,
      // Shadow boundary, outward: Tailwind preflight must not reset the host.
      hostBodyMargin: getComputedStyle(document.body).margin,
      rendered: Boolean(shadowHost),
      version: el.version,
      hostContractVersion: el.hostContractVersion,
      constructorVersion: constructor?.version,
      dataVersion: el.getAttribute('data-oyon-version'),
      dataContract: el.getAttribute('data-oyon-contract'),
    };
  });

  expect(probes.rendered).toBe(true);
  expect(probes.historyState).toBeNull();
  expect(probes.pushStateNative).toBe(true);
  expect(probes.replaceStateNative).toBe(true);
  expect(probes.hostFont).toContain('Comic Sans');
  expect(probes.embedFont).not.toContain('Comic Sans');
  expect(probes.version).toBe(OYON_VERSION);
  expect(probes.constructorVersion).toBe(OYON_VERSION);
  expect(probes.dataVersion).toBe(OYON_VERSION);
  expect(probes.hostContractVersion).toBe(OYON_HOST_CONTRACT_VERSION);
  expect(probes.dataContract).toBe(OYON_HOST_CONTRACT_VERSION);
  // The host page sets body { margin: 0 } itself, so probe a host heading
  // style Tailwind preflight would zero out if it leaked.
  const hostFontSize = await page.evaluate(() => getComputedStyle(document.body).fontSize);
  expect(hostFontSize).toBe('22px');

  // The full branded app is present: compact brand + workflow nav.
  const app = page.locator('oyon-app');
  await expect(app.getByText('Oyon', { exact: true })).toBeVisible();
  await expect(app.getByRole('link', { name: 'Analytics' })).toBeVisible();

  // Single-instance guard: a second <oyon-app> refuses to mount.
  const second = await page.evaluate(() => {
    const dupe = document.createElement('oyon-app');
    document.body.appendChild(dupe);
    const mounted = Boolean(dupe.shadowRoot?.querySelector('.oyon-app-host'));
    dupe.remove();
    return mounted;
  });
  expect(second).toBe(false);
});

test('embedded analytics expose only the pinned current session', async ({ page }) => {
  await page.goto(HOST_PAGE);
  await expect(page.locator('oyon-app')).toBeVisible();

  await page.evaluate(() => {
    document.querySelector('oyon-app')?.remove();

    const viewer = document.createElement('oyon-app') as HTMLElement & {
      setWindows(windows: Array<Record<string, unknown>>): void;
    };
    viewer.id = 'session-locked-viewer';
    viewer.setAttribute('chrome', 'none');
    viewer.setAttribute('page', '/analyze/gaze');
    viewer.setAttribute('session-id', 'current-session');
    document.body.appendChild(viewer);

    const makeWindow = (id: string, sessionId: string, minute: number) => ({
      id,
      session_id: sessionId,
      user_id: sessionId === 'current-session' ? 'current-user' : 'other-user',
      window_start: `2026-07-24T10:${String(minute).padStart(2, '0')}:00.000Z`,
      window_end: `2026-07-24T10:${String(minute).padStart(2, '0')}:10.000Z`,
      dominant_emotion: 'neutral',
      confidence: 0.9,
      gaze: {
        n_points: 10,
        dispersion: 0.1,
        valid_frame_ratio: 1,
        off_screen_ratio: 0,
        centroid: { x: 0, y: 0 },
      },
    });

    viewer.setWindows([
      makeWindow('current-1', 'current-session', 0),
      makeWindow('other-1', 'other-session', 1),
      makeWindow('current-2', 'current-session', 2),
    ]);
  });

  const viewer = page.locator('#session-locked-viewer');
  await expect(viewer.getByText('current-session', { exact: true })).toBeVisible();
  await expect(viewer.getByText('2 windows', { exact: true })).toBeVisible();
  await expect(viewer.getByRole('button', { name: /Sessions/i })).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: /Users/i })).toHaveCount(0);
  await expect(viewer.getByText('other-session', { exact: true })).toHaveCount(0);
  await expect(viewer.getByText('other-user', { exact: true })).toHaveCount(0);
});

test('capture contract: late getToken auth, session-id coherence, sync POSTs, teardown on removal', async ({ page }) => {
  await installSyntheticCamera(page);

  // Mock the host backend the sync leg POSTs to.
  const syncRequests: Array<{
    url: string;
    auth: string | null;
    events: number;
    schemaVersion: string | null;
  }> = [];
  await page.route('**/api/sessions/**/emotions/batch', async (route) => {
    const req = route.request();
    const body = req.postDataJSON() as {
      schema_version?: string;
      events?: unknown[];
    } | null;
    syncRequests.push({
      url: req.url(),
      auth: await req.headerValue('authorization'),
      events: body?.events?.length ?? 0,
      schemaVersion: body?.schema_version ?? null,
    });
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto(HOST_PAGE);
  await expect(page.locator('oyon-app')).toBeVisible();

  // Configure the embed the way the docs say a host does — AFTER the
  // element is connected (the only thing a markup-created element allows).
  await page.evaluate(() => {
    const el = document.querySelector('oyon-app') as HTMLElement & {
      getToken: (() => string) | null;
    };
    el.setAttribute('api-base-url', 'https://backend.example');
    el.setAttribute('session-id', 'e2e-embed-session');
    el.setAttribute('sample-events', 'throttled');
    el.setAttribute('sample-event-hz', '2');
    el.getToken = () => 'e2e-token-42';
    const state = window as typeof window & {
      __oyonSamples?: Array<Record<string, unknown>>;
      __oyonWindows?: Array<Record<string, unknown>>;
    };
    state.__oyonSamples = [];
    state.__oyonWindows = [];
    el.addEventListener('oyon:sample', (event) => {
      state.__oyonSamples!.push({
        ...(event as CustomEvent<Record<string, unknown>>).detail,
        receivedAt: performance.now(),
      });
    });
    el.addEventListener('oyon:window', (event) => {
      state.__oyonWindows!.push((event as CustomEvent<Record<string, unknown>>).detail);
    });
  });

  await page.evaluate(() => (document.getElementById('start') as HTMLButtonElement).click());

  // The host receives oyon:window events whose sessionId matches the
  // override (the embed-host page prints them into #events).
  await expect(page.locator('#events')).toContainText(
    'session e2e-embed-session · user acme-student-42',
    { timeout: 60_000 },
  );

  // The sync leg POSTed with the late-set bearer token, to the overridden
  // session's endpoint, with a non-empty validated batch.
  await expect.poll(() => syncRequests.length, { timeout: 30_000 }).toBeGreaterThan(0);
  const post = syncRequests[0];
  expect(post.auth).toBe('Bearer e2e-token-42');
  expect(post.url).toContain('/api/sessions/e2e-embed-session/emotions/batch');
  expect(post.events).toBeGreaterThan(0);
  expect(post.schemaVersion).toBe(OYON_WINDOW_BATCH_SCHEMA_VERSION);

  const hostEvents = await page.evaluate(() => {
    const state = window as typeof window & {
      __oyonSamples?: Array<Record<string, unknown>>;
      __oyonWindows?: Array<Record<string, unknown>>;
    };
    return {
      samples: state.__oyonSamples ?? [],
      windows: state.__oyonWindows ?? [],
    };
  });
  expect(hostEvents.samples.length).toBeGreaterThan(0);
  expect(hostEvents.windows.length).toBeGreaterThan(0);
  expect(hostEvents.samples[0].oyonVersion).toBe(OYON_VERSION);
  expect(hostEvents.samples[0].contractVersion).toBe(OYON_HOST_CONTRACT_VERSION);
  expect(hostEvents.windows[0].oyonVersion).toBe(OYON_VERSION);
  expect(hostEvents.windows[0].contractVersion).toBe(OYON_HOST_CONTRACT_VERSION);
  const received = hostEvents.samples
    .map((sample) => Number(sample.receivedAt))
    .filter(Number.isFinite);
  for (let i = 1; i < received.length; i += 1) {
    expect(received[i] - received[i - 1]).toBeGreaterThanOrEqual(350);
  }

  // Delivery controls apply live without stopping capture or aggregate
  // persistence. Once off, no further host sample event may cross the element.
  const samplesBeforeOff = hostEvents.samples.length;
  await page.evaluate(() => {
    document.querySelector('oyon-app')!.setAttribute('sample-events', 'off');
  });
  await page.waitForTimeout(1_200);
  const samplesAfterOff = await page.evaluate(() => {
    const state = window as typeof window & {
      __oyonSamples?: Array<Record<string, unknown>>;
    };
    return state.__oyonSamples?.length ?? 0;
  });
  expect(samplesAfterOff).toBe(samplesBeforeOff);

  // Stored windows (IDB primary + localStorage fallback) carry the same
  // session + the host-attribute user id.
  const stored = await readStoredWindows(page);
  expect(stored.count).toBeGreaterThan(0);
  expect(stored.sessions).toContain('e2e-embed-session');
  expect(stored.users).toContain('acme-student-42');

  // F6: removing the element from the DOM stops capture — every camera
  // track the page ever handed out must end.
  await page.evaluate(() => document.querySelector('oyon-app')!.remove());
  await expect.poll(() => allCameraTracksEnded(page), { timeout: 20_000 }).toBe(true);
});

test('sync endpoint failure never blocks local persistence (local-first tee)', async ({ page }) => {
  await installSyntheticCamera(page);
  // Backend is down hard — every sync POST 500s.
  await page.route('**/api/sessions/**/emotions/batch', (route) =>
    route.fulfill({ status: 500, body: 'nope' }),
  );

  await page.goto(HOST_PAGE);
  await page.evaluate(() => {
    const el = document.querySelector('oyon-app')!;
    el.setAttribute('api-base-url', 'https://backend.example');
    const state = window as typeof window & { __defaultSampleCount?: number };
    state.__defaultSampleCount = 0;
    el.addEventListener('oyon:sample', () => {
      state.__defaultSampleCount = (state.__defaultSampleCount ?? 0) + 1;
    });
  });
  await page.evaluate(() => (document.getElementById('start') as HTMLButtonElement).click());

  // Windows still persist locally and host events still flow.
  await expect(page.locator('#events')).toContainText('window batch:', { timeout: 60_000 });
  const defaultSampleCount = await page.evaluate(() =>
    (window as typeof window & { __defaultSampleCount?: number }).__defaultSampleCount ?? 0,
  );
  expect(defaultSampleCount).toBeGreaterThan(0);
  const stored = await readStoredWindows(page);
  expect(stored.count).toBeGreaterThan(0);

  await page.evaluate(() => (document.getElementById('stop') as HTMLButtonElement).click());
});
