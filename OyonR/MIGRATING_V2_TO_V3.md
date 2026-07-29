# Migrating an embedded host from Oyon 2 to Oyon 3

Oyon 3 keeps the v2 `<oyon-app>` capture and viewer surface compatible:
`user-id`, `session-id`, `page`, `chrome`, `gaze-engine`, `start()`, `stop()`,
`setWindows()`, `setGazeAois()`, `oyon:status`, `oyon:sample`, and
`oyon:window` remain available.

Pin an exact immutable release:

```bash
npm install --save-exact oyon@3.0.3
npx oyon host-check
```

For self-hosted assets:

```bash
npx oyon install-assets ./public
npx oyon download-models ./public
npx oyon host-check ./public
```

## Changes hosts must review

### Live sample delivery

Oyon 3's existing default remains full source-rate `oyon:sample` delivery.
Version 3.0.3 adds explicit host controls without changing that default:

```html
<!-- Existing/Rohy behavior: every source sample -->
<oyon-app sample-events="source"></oyon-app>

<!-- UI-oriented host: at most 1 event per second -->
<oyon-app sample-events="throttled" sample-event-hz="1"></oyon-app>

<!-- No per-sample DOM events; aggregate windows still capture normally -->
<oyon-app sample-events="off"></oyon-app>
```

The legacy `live-samples` attribute remains accepted. `live-samples="0"` (or
`"false"` / `"off"`) suppresses host sample events; every other value preserves
the v3 source-rate default. `sample-events` wins when both are present.

These controls change only DOM event dispatch. Internal inference,
aggregation, persistence, `oyon:window`, and the standalone live display keep
their original cadence.

### Runtime and contract identity

Every element exposes:

```js
el.version;                         // "3.0.3"
el.hostContractVersion;             // "3.1"
el.dataset.oyonVersion;             // "3.0.3"
el.dataset.oyonContract;            // "3.1"
customElements.get('oyon-app').version;
```

Every `oyon:status`, `oyon:sample`, and `oyon:window` detail also includes
`oyonVersion` and `contractVersion`. Existing fields are unchanged.

### Versioned batch envelope

`HttpEmotionTransport` now sends:

```json
{
  "schema_version": "oyon-window-batch-v3",
  "events": []
}
```

`validateEmotionBatch()` still accepts an unversioned `{ "events": [...] }`
payload from Oyon 2 and Rohy. When `schema_version` is present it must be a
supported value; the validation result exposes `schemaVersion` (`null` for
legacy payloads).

The version lives on the envelope, not each window, so existing window tables
and unique keys do not require a migration.

### Semantic DOM gaze targets

Hosts no longer need to duplicate viewport/browser-chrome/physical-screen
coordinate conversion:

```js
import { elementToGazeAoi } from 'oyon/gaze/aoi';

const aoi = elementToGazeAoi(document.querySelector('#patient'), {
  id: 'patient_face',
  region: { left: 0.19, top: 0.08, width: 0.62, height: 0.70 },
  minSize: 0.12,
});
el.setGazeAois(aoi ? [aoi] : []);
```

Use `domRectToGazeAoi(rect, screenGeometry, options)` when a framework already
measures the DOM rect. Recompute on resize, scroll, layout changes, and target
unmount. The output remains Oyon's `[-0.5, 0.5]` physical-screen convention.

## Compatibility rules

- Keep at most one real capture element (`full`, `capture`, or
  `capture-analytics`) per page. Any number of `chrome="none"` viewers may
  coexist.
- Set `session-id` before the next capture start. It remains the host's
  attribution spine.
- Existing listeners may ignore the new event-detail metadata and batch
  envelope field.
- Existing v3 hosts that set no sample-event attributes behave exactly as
  before.
- Run the fake-camera embed E2E suite before adopting a new major version; it
  covers capture, sync, identity, teardown, event controls, and viewer
  coexistence.

## Rollback

Restore the exact v2 package/tag, reinstall matching peer assets, rerun the
host build, and verify capture plus persistence. Oyon 3.0.3 adds no required
database migration, so rollback is an application/artifact operation.
