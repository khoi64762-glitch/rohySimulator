import { expect, test } from '@playwright/test';

const ROOT = process.env.OYON_E2E_ROOT_URL ?? 'http://127.0.0.1:5173';

test('vendored WebEyeTrack snapshot exposes the reviewed upstream API in a browser', async ({ page }) => {
  await page.goto(`${ROOT}/`);
  const exports = await page.evaluate(async () => {
    const runtime = await import('/vendor/webeyetrack.js');
    return {
      WebcamClient: typeof runtime.WebcamClient,
      WebEyeTrackProxy: typeof runtime.WebEyeTrackProxy,
      WebEyeTrack: typeof runtime.WebEyeTrack,
    };
  });
  expect(exports).toEqual({
    WebcamClient: 'function',
    WebEyeTrackProxy: 'function',
    WebEyeTrack: 'function',
  });
});
