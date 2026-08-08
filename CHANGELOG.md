# Changelog

All notable changes to rohy are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Going forward: bump versions with `npm version major|minor|patch` from the
repo root (this updates `package.json` + `package-lock.json` and creates a
tag in one step). Add a new section at the top of this file for every
release before tagging.

## [2.9.26] — 2026-08-08

### Fixed

- **Emotion-questionnaire answers were stored but invisible everywhere**
  (tester bug report 2.9.15 #19). Both admin log feeds queried
  `el.created_at` — the `emotion_logs` column is `timestamp` — and the
  feed helper silently converted the SQL error into an empty result, so
  the source vanished with no trace. Columns fixed in both feeds; the
  helper now logs swallowed subquery failures; and the emotion-logs
  endpoints are tenant-scoped (the GET was a cross-tenant read, and the
  POST now stamps the caller's tenant so scoped reads keep seeing new
  rows).

- **Virtual patient and consultant were indistinguishable in Logs →
  Chat log — both just "assistant"** (tester bug report 2.9.15 #20).
  The persona was stored and returned all along but hidden behind a
  default-hidden column labeled "model". A visible "speaker" column now
  shows patient / student / the agent's role (e.g. consultant).

## [2.9.25] — 2026-08-08

### Fixed

- **Lesson-editor image/video/file uploads always failed with "Something
  went wrong"** (tester bug report 2.9.15 #12). The vendored lessons
  module's auth shim was stubbed to `null` (wrongly assuming rohy is
  cookie-only), so its raw upload XHR carried no `Authorization` and no
  `X-CSRF-Token` — the cookie path then failed CSRF with a 403 the toast
  swallowed. The shim now reads the real bearer token, the XHR attaches
  both headers, endpoints resolve through `apiUrl()` (base-path safe
  under `/rohy/`), and the server's actual error message reaches the
  toast. Seven regression tests lock the wire shape.

## [2.9.24] — 2026-08-08

### Fixed

- **"Brunette — middle-aged" and "Brunette — elderly" were the same 3D
  head** (tester bug report 2.9.15 #1). `brunette-t.glb` is a
  texture-reduced copy of `brunette.glb` with identical geometry — not
  an older person — and it was also the only entry in the
  `female.elderly` auto-pick bucket, giving every elderly female patient
  a mislabeled face. It is now labeled honestly ("middle-aged, light
  textures", kept so saved cases referencing it don't lose their
  avatar), and `female.elderly` falls back to the full-quality
  `brunette.glb` — mirroring how the male side already handles the
  missing-elderly-head gap. Four manifest-integrity regression tests
  now lock bucket/label consistency.

## [2.9.23] — 2026-08-08

### Fixed

- **The monitor's "Alarm" bell and "Monitor settings" gear opened the
  exact same window for students** (tester bug report 2.9.15 #17).
  Non-admins have exactly one drawer tab (alarms), so the gear was a
  duplicate of the bell; it is now rendered for admins only, where it
  opens on the rhythm tab. A source-contract test locks the rule.

## [2.9.22] — 2026-08-08

### Fixed

- **Enabled AI agents showed "Not Available" during simulation — no Call
  button, dead composer** (tester bug report 2.9.15 #11). The
  session-agents endpoint's hand-built projection never included
  `enabled`; the client treats an absent field as disabled, so every
  agent was unreachable even though the SQL only returns enabled ones.
  The projection now emits `enabled: true` and a server regression test
  pins the field; the 2.9.19 paging test's fixture (which hardcoded a
  shape the server never produced, masking this) now matches the real
  wire format.

## [2.9.21] — 2026-08-08

### Fixed

- **The session clock reset to 0 on every room switch, and the vital-sign
  scenario replayed from the beginning** (tester bug report 2.9.15 #14).
  `PatientMonitor` unmounts whenever the learner leaves the patient room,
  and both the clock and the scenario position were plain counters inside
  it. Both are now wall-clock anchored and *recomputed* each tick instead
  of incremented: the clock anchors to the server's `sessions.start_time`,
  and the scenario timeline persists an anchor
  (`{sessionId, scenarioId, startMs, offsetSec, playing}` — see
  `src/utils/sessionAnchors.js`, declared in the storage registry) so
  room switches, page refreshes, pause/resume, and background-tab timer
  throttling all land on the true position. Anchor reads are
  sessionId-scoped, so stale anchors from ended sessions are inert.

- **Alarms re-fired their audio every time the learner returned to the
  patient room.** `useAlarms` fire-state died with the unmount, so every
  still-breaching vital counted as a brand-new breach. Fire-state now
  parks per session in sessionStorage (per-tab, self-pruning) and is
  restored on mount — only genuinely new breaches sound.

## [2.9.20] — 2026-08-08

### Fixed

- **Logins collapsed after 4 idle hours — and a laptop sleeping through
  the refresh window got logged out mid-case.** The login lifetime was
  hardcoded in three places that silently had to agree: the JWT's `exp`,
  the `rohy_auth` cookie's maxAge, and the `active_sessions` row. All
  three now derive from one source, `authTtlSeconds()` (`JWT_EXPIRY`
  env; default raised to **7 days** — safe because every request
  re-checks server-side revocation, so logout/force-logout/password
  change still invalidate a token instantly).

  Separately, the client's "refresh 5 minutes before expiry" timer does
  not run while the machine sleeps and is throttled in hidden tabs, so
  it could fire *after* expiry — and any failed refresh (including a
  transient network error at wake) hard-logged the user out.
  `AuthContext` now also refreshes on tab wake/focus/reconnect when the
  token is inside its last hour, and a failed refresh consults
  `/auth/verify` before ending the session: only a definitive rejection
  logs out. Logout additionally clears the scenario anchor introduced
  in 2.9.21.

## [2.9.19] — 2026-08-07

### Fixed

- **Paging an agent did nothing visible, and the agent never arrived.**
  `agents` is fetched once per session and never written again;
  `agentStates` is the live layer the paging flow and the ETA-convergence
  loop keep current. `currentAgent` read straight off the stale array, so
  `agentStatus` — which gates the countdown card, the Call button *and*
  the composer's `disabled` attribute — never moved off its page-load
  value.

  From the learner's chair: you press "Call Dr. Chen" and nothing
  changes, so you press it again, which re-stamps the ETA and pushes the
  arrival further away. When the consultant does arrive, the convergence
  loop refreshes `agentStates` only — so the tab dot turns green next to
  a chat box that still refuses to accept input. The one escape was
  leaving the room and coming back, which remounted the chat and
  refetched the list. Status now reads through a single live overlay.

- **"Instant" was unreachable, and asking for it gave the longest wait
  in the system.** The page handler computed
  `Math.max(60, Math.min(180, configuredMinSec || 60))`. Two defects in
  one line: `|| 60` treats a configured **0 as absent** because 0 is
  falsy, and `Math.max(60, …)` floors it there again regardless. The
  ceiling had the mirror flaw, turning a configured max of 0 into 180.

  Net effect: `0/0` — the setting that asks for **no** wait — produced a
  uniform random 60–180 second wait, the widest band the system could
  generate, so configuring instant was strictly worse than configuring
  1–2 minutes. Wait times are now honoured literally. What remains is a
  15-minute ceiling, and it is a typo guard rather than pacing policy.

- **Instant is now a distinct state, not a zero-length countdown.** An
  instant page writes `present` with no `arrives_at`, so no wait card
  renders and nothing has to converge — the two mechanisms most likely
  to strand a learner are simply not involved.

### Changed

- **Agent arrival is instant by default.** Every seeded persona ships
  `response_time 0/0`, and migration `0042` zeroes existing rows plus the
  seeded consultant's template config (which shipped 2–5 minutes, i.e.
  2–3 minutes of every training session spent on a progress bar). A
  delay is now a deliberate teaching device a case author opts into —
  and, for the first time, one that behaves as configured. The
  consultant stays `on-call`: deciding to ask for help is still a
  decision the learner makes, it just no longer costs wall-clock.

- **`On-call · responds in 1–3 minutes` → `On-call · answers when you
  call`** across all six languages and the pseudo-locale. The old string
  described the removed clamp.

### Removed

- **`AgentService.calculateWaitTime()`** — a second, client-side
  implementation of the arrival delay that only its own unit tests ever
  called. It returned *minutes* where the live server path returns
  *seconds* and applied none of the clamping, so wiring it up would have
  shipped a wait an order of magnitude off. Its tests passed for the
  entire period the real feature was broken.

### Added

- **`docs/design/agent-behaviour-model.md`** — the four-axis model
  (availability · knowledge · stance · initiative) for supporting agents,
  what each proposed scenario needs, the `briefed` knowledge source that
  would make a handoff mean something, the learner-role gap behind
  nurse-student cases, and honest effort estimates. Includes a post-mortem
  of the delay bug above.

- **Coverage for `POST /sessions/:id/agents/:type/page`**
  (`tests/server/agent-page-wait.test.js`) and the client paging contract
  (`src/components/chat/ChatInterface.paging.test.jsx`). The endpoint had
  none, which is why the bug shipped and survived. Both suites were
  confirmed to fail against the pre-fix code.

## [2.9.18] — 2026-08-06

### Fixed

- **`docker compose up` no longer fails on the compose file itself.**
  Since v2.9.12 the file set

  ```yaml
  FRONTEND_URL: "${FRONTEND_URL:-https://${ROHY_HOSTNAME:-localhost}/rohy}"
  ```

  which puts one interpolation inside another's default. Compose has no
  nested interpolation and rejects the whole file:
  `invalid interpolation format for services.rohy.environment.FRONTEND_URL`.
  Every Docker deploy was dead on arrival, and nothing in the repo ran
  this file, so lint, tests and CI all stayed green.

  The composition itself is the documented contract — `.env.example` has
  always said `FRONTEND_URL` is derived from `ROHY_HOSTNAME` — so it moved
  to `entrypoint.sh`, where a shell can express a fallback and a test can
  execute it. Compose now passes both variables through unmodified.

  Note for anyone who patched this locally: escaping to
  `$${ROHY_HOSTNAME:-localhost}` makes the error go away but is worse than
  the error. `$$` is Compose's literal-dollar escape, so the container
  receives the text `https://${ROHY_HOSTNAME:-localhost}/rohy` verbatim
  and uses it, unexpanded, as its public origin.

- **Setting no hostname is now fatal instead of silently wrong.** The old
  default resolved to `https://localhost/rohy` whenever `ROHY_HOSTNAME`
  was unset, which defeated the entrypoint's own guard against booting
  production without a known origin. An unset hostname now reaches that
  guard and the container refuses to start, naming both ways to fix it.

### Changed

- **Documented the compose project name.** With no `name:` in the file,
  Compose derives the project from its directory — `deploy/docker/` — so
  resources land under the generic project `docker` (the DB volume is
  `docker_rohy-db`). A leftover volume of that name from an unrelated
  stack gets adopted by this one, which shows up as a container that
  never turns healthy rather than as a collision error. `.env.example`
  now ships `COMPOSE_PROJECT_NAME=rohy`, the quickstart uses `-p rohy`,
  and `docs/DEPLOY.md` explains why it must be chosen before the first
  run — plus how to move the volume if it wasn't. The default is
  unchanged, so no existing deploy loses sight of its database.

### Added

- **`tests/server/docker-compose-contract.test.js`** — nine checks that
  parse `compose.yml`, reject nested interpolation and `$$`-escaped
  values in any environment block, and execute the real `entrypoint.sh`
  to confirm the derivation, the explicit-override precedence, and the
  production refusal. The interpolation bug shipped because the only
  detector was a human typing `docker compose up`; this is that detector.
  Verified to fail against the v2.9.12 file.

## [2.9.17] — 2026-08-06

### Fixed

- **The patient room no longer clips the monitor on an iPad in portrait.**
  The chat column and the monitor column carried 350px and 600px minimum
  widths inside a viewport that never scrolls, so on any screen under
  950px the right-hand edge of the monitor — including part of the vitals
  column — was cut off with no way to reach it. Below 1024px the two now
  stack: conversation on top, vitals underneath. Desktop layout unchanged.
- **Vitals boxes no longer shrink and clip their own readings.** Each box
  in the monitor's vitals column is a fixed-height flex child that hides
  its overflow, but none of them declared `shrink-0`. In a column shorter
  than their combined height the browser squeezed them instead of
  scrolling — the heart-rate box rendered at 25px against its declared
  96px, showing the bottom half of "110" as if it were the whole reading.
  A clipped vital that still looks like a number is the worst failure in
  this list. Reproduced on any short window, not only tablets.
- **The lab and radiology rooms are usable on a tablet.** Their three
  columns left the report viewer about 280px wide in portrait, enough to
  wrap a one-line empty state over ten lines and to overlap the
  READY/PENDING/VIEWED counters. Below 1024px the panes stack full-width.
- **Room headers no longer run underneath the capture pill.** The Oyon
  pill is a fixed overlay centred at the top of the viewport; on a
  tablet-width header the case title ran beneath it. Titles now stop short
  of the centre, and "End & Debrief" collapses to its icon.
- **The body-map legend no longer clips.** Four keys in one non-wrapping
  row need ~330px and had ~250px; the first and last were cut mid-word.
- **The case wizard no longer strands an author mid-way.** The step strip
  put eleven equal-width buttons in one non-shrinking row, so on anything
  narrower than a desktop the later steps overflowed off-screen; the row
  now wraps below 1280px. The footer separately treated step 9 as the last
  (it was, before two steps were added), so "Next" disappeared after
  Records and Treatments/Agents offered only "Save & Finish" — the last
  step is now derived from the step list. Regression-locked in
  `ConfigPanel.test.jsx`.
- **The physical exam editor stacks below 1024px.** The body map at a
  third of a tablet's content column was too small to hit a region
  reliably, and its 500px inner scroller became a scroll trap once
  stacked.

### Added

- `npm run test:e2e:tablet` — Playwright checks every student-facing room
  at 820x1180 and 1180x820, asserting no horizontal overflow (the failure
  mode above: content pushed outside a clipped container is unreachable,
  not merely ugly) and writing a screenshot per room per viewport to
  `test-results/tablet-layout/`. Requires `npm run build` first; like the
  rest of the Playwright suite it is not in CI.

## [2.9.16] — 2026-08-06

### Fixed

- **The Voice settings tab no longer claims the default voice is a
  fallback.** It said the per-language default plays "when a configured
  voice can't — missing engine, missing key, or a paid-service outage".
  That is the opposite of how the platform behaves: a character whose case
  or persona names a voice keeps that voice, and goes silent with an error
  if it cannot play. Admins who changed the default expecting a broken
  cloud voice to be replaced got silence instead. The tab now states the
  real rule — a default speaks only for a character with no voice
  configured at all — and points at the case editor and persona editor.

### Changed

- **The case wizard's second step is now labelled "Avatar & Voice"**
  (was "Avatar") in all six languages. The patient's voice picker has
  always lived there; the label hid it, so authors looked for a voice
  setting in the case editor and did not find one.
- **Voice diagnostics now name where a voice is configured.** The resolver
  reports a `source` (`case`, `persona template`, `platform default`)
  alongside the existing tier, and the diagnostic bar shows it on the
  speaker table, the runtime panel and the compact one-liner. A case voice
  and a persona-template voice both reported tier `override`, which left
  "why did changing the platform default do nothing?" unanswerable without
  reading the database.

## [2.9.15] — 2026-07-31

### Fixed

- **Saving a case no longer fails when the interface is not in English.**
  Creating or updating a case returned a server error in German, Spanish,
  Finnish, Italian and Swedish. Authors could edit a case but never save it;
  English was unaffected, so the fault only appeared once someone worked in
  another language.

  The patient-gender dropdown stored whatever it displayed. Because the
  displayed text is translated, choosing "Männlich" tried to store the word
  "Männlich" in a column that only accepts `Male`, `Female` or `Other`, and the
  save was rejected at the last possible moment. English worked purely by
  coincidence — its label for that option is the word "Male", which the column
  happens to accept.

  Every dropdown of this kind now stores a fixed English value and translates
  only what you see. The same fault affected the marital-status and persona
  dropdowns; those did not fail visibly, but they did store the label in
  whatever language the author happened to be using, so the persona instruction
  sent to the model changed with the interface language. Both now store a
  stable value. A case saved before this fix keeps its old value and still
  shows it in the dropdown rather than appearing blank.

- **A patient's sex is no longer read as male whenever the value is
  unfamiliar.** The body map and examination manikin decided sex by testing
  whether the stored value was exactly the English word "female". Anything else
  — including a correct value in another language — silently produced a male
  body map, with no error to notice. That decision now lives in one place, and
  the male default applies only where there genuinely is no distinct anatomy.

- **A rejected save now explains itself.** The failure surfaced as an internal
  server error carrying raw database text, which said nothing useful and
  exposed schema internals. Both the create and update paths now check the
  value first and answer with a plain message naming the accepted values.
  A value that is merely lower-case (`male`) is corrected rather than refused,
  so older API clients and imported cases keep working.

### Added

- **A guard so this class of bug cannot return.** The patient-demographic
  vocabularies live in one shared module (`server/shared/patientDemographics.js`)
  used by both the editor and the server. A new test fails on any dropdown whose
  label is translated but whose stored value is left implicit — the exact shape
  of this bug, which is invisible in review and in every English-language test
  run. A second test drives a real server in all five languages and locks the
  rejection behaviour for both create and update.

## [2.9.14] — 2026-07-31

### Changed

- **rohy is now licensed under the Carm Research License v1.4**, replacing MIT
  and bringing it in line with the rest of the Carm ecosystem (Oyon, ChatOyon,
  Carm, LAILA). It is free for research, teaching, personal learning and
  non-profit use — including industry-sponsored and collaboratively funded
  academic work, which v1.4 places explicitly inside the free grant regardless
  of funding source. Commercial use requires a paid license. Anything you
  produce by running rohy on your own data remains entirely yours.

  MIT was not merely a different choice, it was an inaccurate one. rohy
  git-tracks the vendored `OyonR/` addon — 658 files including its own
  `LICENSE`, `NOTICE.md` and nine third-party texts — which is licensed under
  the Carm Research License and forbids sublicensing and resale. The root
  `LICENSE` was simultaneously granting permission to "sublicense, and/or sell"
  that same tree. The two statements could not both be true.

  The license text is fetched from the canonical
  [carm-license](https://github.com/mohsaqr/carm-license) repository at its
  **version tag**, never `main`, so a routine build cannot silently relicense
  the product; adopting a future version is a deliberate one-line edit.

### Added

- **`NOTICE.md` — a complete index of everything rohy redistributes**, with
  every license embedded in full rather than linked, as the Carm license
  requires. `scripts/licenses.manifest.mjs` is its single source of truth;
  `npm run license:sync` refreshes every text from its canonical upstream on
  each build, `npm run license:verify` is the strict release form, and
  `npm run license:latest` reports when a newer Carm License version exists.

- **`tests/server/license-contract.test.js`** — 54 fully offline assertions
  covering the whole contract: every manifest entry has real committed text,
  every text is linked from `NOTICE.md` alongside its live upstream, the
  version string agrees in every file that names it, the Carm license is
  pinned to a tag rather than a branch, and the Docker image genuinely
  carries `LICENSE`, `NOTICE.md` and `licenses/`.

### Fixed

- **The container image no longer ships without its license.**
  `deploy/docker/Dockerfile` labelled images `MIT` and copied no license file
  at all. It now copies `LICENSE`, `NOTICE.md` and `licenses/` into the
  runtime stage, and `.dockerignore` re-includes `NOTICE.md` past the blanket
  `*.md` exclusion — the same two-gate trap that previously shipped broken
  images for `Lab_database.json`, `heart.txt` and `CHANGELOG.md`.

### Disclosed

Three obligations that were already true but written down nowhere. None of
them change how rohy runs; all three matter before you deploy it.

- **Building the image with `INCLUDE_PIPER=1` redistributes GPL-3.0 software.**
  Piper TTS is `OHF-Voice/piper1-gpl`, and that build variant bakes it into the
  image. The default build does not, and rohy's own terms are unaffected. The
  full GPL text now ships at `licenses/piper1-gpl.COPYING.txt`.

- **The default Piper voices are not uniformly MIT.** The voice repository
  declares MIT, but each voice's `MODEL_CARD` names its own dataset license and
  several are research-restricted — `en_US-lessac-*`, installed by default,
  is trained on the CSTR Blizzard 2013 corpus. Check the card for each voice
  you enable before deploying commercially.

- **The CALIPER paediatric reference ranges are CC BY-NC-SA**, whose
  non-commercial term is incompatible with a commercial deployment. They are
  isolated behind their own `data_sources` row by design, so that source can be
  dropped cleanly without disturbing the adult ranges or the LOINC coding.

`NOTICE.md` also records one unresolved item: the auscultation audio in
`public/sounds/` is committed and shipped, but its origin and license are not
recorded anywhere in the repository or its history. It is listed as unresolved
rather than omitted, because an unknown license is a risk to a redistributor
and an empty row is more honest than an invented one.

## [2.9.13] — 2026-07-31

### Fixed

- **The dark strip below the Oyon dashboard is gone.** The panel stopped short
  of the bottom of the window, leaving a dead band of empty space. It now fills
  the room properly.

## [2.9.12] — 2026-07-30

### Fixed

- **The container image builds again.** The v2.9.11 image build failed outright:
  the Oyon asset verifier added in "build: harden Oyon asset installation" runs
  during `npm install`, but the Docker builder did not copy `scripts/` until
  after that step, so the install aborted and no image was produced. The air-gap
  tarball was unaffected. Operators should use v2.9.12; the v2.9.11 release has
  no container image.

## [2.9.11] — 2026-07-30

### Fixed

- **The Oyon dashboard no longer goes blank after a page refresh.** It used to
  render on the way in and then show "No stored windows yet" on reload. The
  embedded Oyon viewer only ever displays one session at a time — a deliberate
  privacy boundary — and with no session selected it shows nothing at all. The
  dashboard now names the session it is showing and offers a picker for the
  others, so a refresh lands on real data instead of an empty panel.
- The same fault meant only the live session was ever reachable; every earlier
  session in the fetched pool was invisible. All of them can now be opened.

## [2.9.10] — 2026-07-30

### Added

- An end-to-end test covering the whole signal path — real capture engine, real
  window shapes, real validation — so a break in the joins between capture and
  storage is caught before it reaches a learner.

## [2.9.9] — 2026-07-30

### Added

- **Typing rhythm is now actually recorded** for tenants that enabled it: pauses,
  bursts, revisions and whether a message was sent or abandoned — never the
  words themselves. Consented learners only.
- Interaction signals (pointer, scroll, focus, idle) record alongside it.

### Fixed

- Signal capture no longer depends on the camera being switched on. Consent for a
  session is registered once and shared, so a tenant running Oyon without the
  camera gets typing analytics instead of silence.

## [2.9.8] — 2026-07-30

### Added

- The plumbing that carries the new Oyon signals to the server, loaded only when
  a tenant has enabled them and the learner has consented.

### Changed

- The Oyon signal engine is loaded on demand, keeping it out of the main
  application bundle: startup is unchanged for everyone.
- Excluded an unused inference runtime from the browser bundle, cutting about
  48 MB from the shipped build and the container image. Nothing that runs in the
  browser needed it — the same runtime is already served alongside Oyon's models.

## [2.9.7] — 2026-07-30

### Added

- **A consent prompt for the widened capture scope.** Learners who previously
  agreed to camera-based emotion capture are now asked once, plainly, about the
  additional signals: typing rhythm (pauses and bursts, never the words),
  on-screen interaction, and the style of the messages they send. Saying no
  leaves their existing emotion-capture choice untouched, and either choice can
  be changed later under Settings → Oyon.
- The consent version a learner actually saw is recorded when they answer, so a
  future change of scope asks again rather than assuming.

### Changed

- Learners who declined are not asked again, and learners who have never
  answered continue to see the first-run consent card rather than this prompt.

## [2.9.6] — 2026-07-30

### Added

- **Consent version 2, covering the non-camera signals.** Typing dynamics,
  interaction telemetry, discourse analytics and AI-assistance cycles are new
  categories of personal data rather than more camera-derived affect, so they
  are not covered by the original consent. Rohy now records **which consent
  version each learner actually accepted**, and refuses to store any of the new
  signals for a learner whose accepted version predates it. Camera-derived
  signals are unaffected and continue to work under the original consent.
- Administrators get switches for typing, interaction, discourse and
  AI-assistance under Settings → Oyon → Signals. They stay dormant until a
  learner accepts the new consent, whatever the switches say.

### Changed

- Tenants still using the original default consent version are moved to the new
  one. An administrator who set a custom consent version keeps it.

### Security

- The consent check runs on the server at ingest, not only as a prompt in the
  browser, so an out-of-date client cannot record signals a learner never agreed
  to. A client that does not state which consent version it displayed is treated
  as having shown the original one, and so cannot grant itself the new scope.

## [2.9.5] — 2026-07-30

### Added

- **Administrator control over Oyon's signal families.** Settings → Oyon now has
  a Signals section with a switch per family: facial signals, eye/engagement,
  gaze, illumination, learner heart rate, learner respiration, dynamical
  features, body posture, and whether signals travel on one window or their own.
  These signals were already being recorded by the capture component's own
  defaults, and the platform previously had no way to switch any of them off —
  this closes that gap, so the settings now reflect what actually runs.
- Heart rate and respiration are labelled explicitly as camera-derived research
  estimates about the **learner** — never clinical measurements, and unrelated to
  the simulated patient's vital signs.

### Changed

- Body posture is **off by default**. Its pose model is not bundled with rohy, so
  switching it on makes the browser download the model from an external CDN,
  which breaks the guarantee that air-gapped installations never reach the
  internet. The toggle is labelled accordingly and stays available for
  administrators who accept that trade-off.

## [2.9.4] — 2026-07-30

### Added

- **A named Oyon dashboard for educators and administrators.** A new full-page
  surface, reachable from the top-bar menu, that renders Oyon's own Analyze
  dashboards over the platform's stored windows. It sits beside the existing
  Emotion Analytics view rather than replacing it: Emotion Analytics remains
  Rohy's own dashboard, while this surface shows the engine's, so newly enabled
  signals appear here as the engine gains support for them. Access uses the
  existing Oyon permission — educator or administrator, subject to the
  per-role tenant setting — and all authorisation stays on the server.
- Window-shared signal blocks captured under Oyon 3 (facial, posture, heart
  rate, respiration, illumination, capture quality) are now passed through to
  the dashboards, so the new signals can be displayed as they start arriving.

### Changed

- The German, Spanish, Italian, Finnish and Swedish strings for the new
  dashboard are provisional and awaiting native review.

## [2.9.3] — 2026-07-30

### Fixed

- Regenerated the `en-XA` pseudo-locale for `authoring_config`, which had been
  stale since the 2.7.x registration/approval-queue work: 25 keys existed in
  `src/locales/en/authoring_config.json` with no pseudo counterpart, so
  `?pseudo=1` rendered them as plain English and could not flag them as
  translated-but-unverified or catch truncation.

## [2.9.2] — 2026-07-30

### Added

- **Storage and a read API for Oyon 3's new signal modalities** — the groundwork
  that makes enabling them safe, landed before any capture flag is turned on.
  Migration `0039` adds an `oyon_signal_windows` table for standalone
  modality-only windows and host-bounded episodes (typing, voice, interaction,
  discourse, ai-assist), plus six nullable columns on `oyon_emotion_records` for
  the blocks that ride on the emotion window. New `GET /addons/oyon/
  signal-windows` sits behind the existing Oyon read policy (role + per-role
  tenant flag, tenant scoping, redaction) and reports which modalities hold data.

### Fixed

- **Oyon 3 window blocks were discarded on ingest.** Every `*_window_share`
  setting defaults on, so `facial`, `posture`, `heart_rate`, `respiration`,
  `illumination` and `capture_quality` arrive as extra keys on the ordinary
  emotion window — and `insertEmotionRecord` had no columns for them, so they
  were dropped without a trace. This is the same defect migration `0028` records
  about v1 discarding `gaze` and `engagement`, repeated for the v3 signals.
- **A standalone modality window failed its whole batch.** With
  `*_window_share` off (and on stop/flush) Oyon emits `facial_only` /
  `posture_only` / `heart_rate_only` events that carry no emotion data and keep
  `valid_frames` inside the modality block. Routed into `oyon_emotion_records`
  that bound NULL into a NOT NULL column, so the insert threw and the entire
  batch was rejected — losing the emotion windows travelling with it.

### Changed

- Ingest now splits on Oyon's own `isModalityOnlyEvent` seam, so emotion windows
  keep their existing path unchanged. `inserted` / `skipped` still count emotion
  records only; new modality counts are reported separately as
  `signals_inserted` / `signals_skipped`. Existing dashboards, queries and
  response shapes are untouched — the new rows live in a separate table that
  legacy SQL cannot address.

## [2.9.1] — 2026-07-30

### Fixed

- Regenerated `docs/reference/cli/index.md`, which had drifted since 2.9.0: the
  release added `scripts/verify-oyon-install.mjs` and the `verify:oyon` script
  (and chained it into `setup:oyon`) without regenerating the CLI reference, so
  `npm run docs:check` failed on a clean 2.9.0 checkout. No workflow runs on
  release branches, so nothing caught it.

## [2.9.0] — 2026-07-29

### Changed

- Upgraded the isolated 2.9 release line from vendored Oyon 2.2.0 to the
  immutable Oyon 3.3.2 release, retaining Rohy's existing capture, consent,
  same-origin asset, session identity, and database integration contracts.
- Added Oyon v3's sensing, typing, voice, interaction, discourse, and analytics
  modules and its versioned `tnaj` bundle without enabling new capture
  modalities by default.
- Pinned Oyon updates to version 3.3.2 and narrowed runtime-asset preservation
  so future syncs refresh versioned source vendors without deleting downloaded
  MediaPipe, ONNX Runtime, or model assets.
- Hardened fresh installs with atomic, checksummed model downloads and a
  fail-fast verifier covering peer-version runtime copies, models, workers,
  WASM, the multi-file element artifact, and Rohy's persistent sync overlays.
- Rohy now sends the explicit `oyon-window-batch-v4` envelope and requests
  source-rate live sample events from the v3 web component.

## [2.8.0] — 2026-07-29

This is the first published release of the development line previously
versioned as 2.6.x and 2.7.x. The detailed 2.7.x milestone entries remain
below for traceability; they were not published as separate GitHub releases.

### Added

- **Courses, lessons, and surveys.** Educators can organise learners into
  courses, author rich lessons, assign cases, collect surveys, and run the
  student classroom experience from the same platform.
- **Six-language experience.** German, Spanish, Italian, Finnish, and Swedish
  join English across the learner and instructor UI, with language-aware cases,
  voices, and local Piper voice packs.
- **Voice 2.0.** Case-owned voice identity, multilingual Google TTS, improved
  Kokoro and Piper routing, provider-aware settings, and clearer voice controls.
- **First-run onboarding.** Administrators get a platform setup checklist;
  learners and teachers get role-appropriate welcome flows and saved language,
  microphone, voice, and consent choices.
- **Registration governance.** Open, closed, invite-only, and
  administrator-approval modes; email-domain rules; revocable invitation links
  and codes; course auto-enrolment; and an approval queue that stores only
  password hashes.
- **Consent-bound affect routing.** When explicitly enabled, fresh local Oyon
  affect signals can inform the AI patient's in-character response without
  exposing raw camera data or claiming to measure emotion.

### Changed

- Redesigned LLM settings, consolidated top-bar controls, expanded course and
  case browsing, immutable case languages and codes, and plain-text response
  support.
- Fresh installations default to closed registration while preserving a safe
  first-admin claim or explicit `ROHY_ADMIN_*` provisioning path. Existing
  installations retain their prior open behavior until configured.
- Brought forward the verified 2.5 release pipeline: required Oyon asyncify and
  MediaPipe assets are packaged and probed across Docker, air-gap, and
  published-image installation paths.

### Fixed

- Corrected course co-teacher visibility, availability-window updates,
  join-code normalisation, course case-move authorization, affect-setting error
  logging, and a broken lesson survey response action.
- Corrected account lockout timestamp handling east of UTC, refused suspended
  accounts before token creation, and aligned client/server password rules.
- Corrected hard deletion of auto-enrolled users by removing their course
  membership inside the same cleanup transaction.
- Corrected LLM error-message namespace extraction so the i18n gate no longer
  creates empty duplicate keys in the shared catalogue.
- Added regression coverage for registration pathways, course administration,
  first-run bootstrap, runtime assets, and session-running authorization.

### Security

- Closed session and order IDOR paths, enforced session ownership and tenant/case
  binding for lab results, examinations, treatments, and staff access, and made
  order administration atomic.
- Enforced target-rank ceilings so administrators cannot edit, reset, or delete
  peer administrators through direct API calls.

## [2.7.14] — 2026-07-15

### Changed

- Regenerated the `docs/reference/**` reference from source now that the new
  registration/approval routes and migration 0038 have landed (adds the
  registration API page and refreshes the data/schema and config references), and
  synced the i18n catalogues with the approval-queue UI strings. Keeps the
  `docs:check` and `i18n:check` gates green.

## [2.7.13] — 2026-07-15

### Added

- **Server regression tests locking the audit fixes.** New pathway suites:
  `session-running-pathways` (lab-results IDOR, order-labs case binding, exam
  tenant/case trinity), `course-admin-pathways` (co-teacher visibility, window
  read-merge, join-code normalisation, case-move authorisation), and the
  registration/approval-queue pathways (park/approve/reject/re-apply, invite
  skips queue, closed-admits-invite, lockout east of UTC, suspended login).
  Shared `tests/utils/authHttp.js` helper for HTTP + DB seeding.

## [2.7.12] — 2026-07-15

### Fixed

- The affect-settings load/update handlers now log the error before returning
  500 — the failure was previously swallowed, leaving a 500 with no trace. Also
  dropped an unused `getAllProviderStatus` import from the proxy routes.

## [2.7.11] — 2026-07-15

### Fixed

- **Course-administration defects (audit).** A co-teacher now sees the courses
  they co-teach in `GET /cohorts` — the list filtered on `owner_user_id` alone,
  so a course a co-teacher could PATCH and assign cases to never appeared for
  them. The cohort-case window PATCH now read-merges: sending only
  `available_until` no longer wipes `available_from` (which quietly re-opened the
  case earlier than the teacher set). Join codes are normalised on the way in
  (case-folded, separators dropped), so `RKM7-PQ2H` and `rkm7pq2h` are the same
  code. Moving a case out of a course you don't manage is refused (403) — the
  permission was checked on the course the case moved *to* and on nothing it
  moved out of, so any educator could strip another teacher's case from theirs.

## [2.7.10] — 2026-07-15

### Added

- **Registration approval queue (migration 0038).** `approval` mode was
  selectable and advertised by the public probe, but `/auth/register` had no
  branch for it — it behaved exactly like `open`, admitting everyone with a token.
  It now parks an applicant in `registration_requests` (hashed at request time,
  never a user row) and an admin approves or rejects from the Users workspace; on
  approval the hash moves into the new `users` row untouched, so the applicant
  signs in with the password they chose. A valid invite skips the queue.

### Fixed

- **Auth-entry hardening (audit).** Account lockout compared a SQLite UTC
  timestamp parsed as local time, so on a server east of UTC the lock was always
  already "in the past" and did nothing (unlimited guessing) — it now converts
  correctly. Suspended/deleted accounts are refused before bcrypt instead of
  minting a token that immediately stops working. A valid invite now opens a
  `closed` door (closed governs strangers, not admin-issued invitees).

## [2.7.9] — 2026-07-15

### Fixed

- **Session-running IDOR and tenant escapes (audit).** `GET
  /sessions/:id/lab-results` now requires session ownership — it previously
  carried `authenticateToken` and nothing else, so any logged-in student could
  walk session ids and read another learner's results (the graded answer key).
  Lab orders are bound to the session's own case (`AND case_id = ?`), so a client
  can no longer order another case's — or tenant's — investigations. Exam findings
  and treatment orders now persist the caller's `tenant_id` (they defaulted to
  tenant 1, silently moving a tenant-2 learner's data out of their own tenant and
  out of reach of the erasure purge), and take `case_id` from the session rather
  than the request body. `verifySessionOwnership` scopes staff access to their own
  tenant. Administering an order is now a compare-and-swap (409 on a double-fire)
  and the client-supplied turnaround override is clamped, so `Infinity` can no
  longer permanently brick an investigation.

## [2.7.8] — 2026-07-15

### Fixed

- **ESLint is back to zero errors.** Cleared 12 pre-existing errors that were
  blocking a clean lint gate: unused imports/props in `App.jsx`,
  `InvestigationWorklist.jsx`, `LanguageContext.jsx`, a server test, and the
  vendored `lessons/**` editors; one unnecessary regex escape in the lessons
  `sanitize.js` URI allow-list (semantically identical); and a real bug in the
  lessons `SurveyManager` — the injected `onViewResponses` handler was destructured
  by the parent but never threaded to `SurveysTable`, so the "Responses" row action
  referenced an undefined variable (a `ReferenceError` on click, masked only because
  it fell through to the LAILA URL). The handler is now passed down. Warnings are
  untouched; behaviour is otherwise unchanged.

## [2.7.7] — 2026-07-14

### Added

- **A front door worth arriving at.** The logged-out screens now sit in a split layout:
  a brand panel that says what Rohy is — AI patients, an AI care team, real labs and
  radiology, consent-bound affect capture, process analytics — beside the sign-in card.
  The language picker moved into that panel, so it is chosen once and the whole
  login/register flow follows.
- **The invite code has a home on the login card.** "Register with an invitation code"
  opens the register form with the code field already expanded. A code is one artifact
  with two deliveries — a link and something you can read down the phone — so the box
  is now reachable in *every* mode that permits registration, not only invite-only.
  Left collapsed behind a one-line prompt otherwise, and marked optional when it is.

### Fixed

- **The register form no longer accepts passwords the server rejects.** It asked for six
  characters; the server demanded eight with an uppercase letter, a lowercase letter and
  a number, and refused the account after the fact. The rules are now shown as a live
  checklist as you type, from `src/utils/passwordRules.js` — the client mirror of the
  server's `validatePassword()`. Password fields can be revealed.

## [2.7.6] — 2026-07-14

### Added

- **Invites — a link and a code, and they are the same thing.** An administrator
  can mint an invite in Settings → Users → Invites, choose the role and the course
  it grants, cap how many people may use it, and set when it expires. Share it as
  a link (`/register?invite=…`) or read the code out loud — both are the same
  token, so there is nothing to keep in sync. Anyone who uses it lands in the
  course automatically.
- **Invite-only registration.** With the mode set to *Invite only*, an invite is
  required to sign up. A valid invite also gets someone in when self-registration
  is otherwise closed — that is what an invite is: a named exception to the rule
  on the front door.
- Invites are revocable (people who already joined keep their accounts), and every
  redemption is recorded. The code itself never reaches the audit log.

### Fixed

- **Invite links would have 404'd in production.** Only `/` ever served the app,
  so any path-based link died at the web server — invisible in development, where
  Vite's history fallback quietly covers it. `/register` is now served explicitly
  (not by a wildcard, which would have swallowed the docs site).

### Notes

- Rohy still cannot send email, so an invite is a copy-paste artifact — like the
  course join codes teachers already share. The dialog puts the link and the code
  in front of you, ready to copy, rather than making you hunt for them.

## [2.7.5] — 2026-07-14

### Added

- **Registration is no longer always open.** An administrator now chooses how
  people get accounts, in Settings → Platform → Users: **Open** (anyone who can
  reach the page signs up — what Rohy has always done) or **Closed** (only
  administrators create accounts). *Approval required* and *Invite only* appear
  in the picker and land next.
- **Allowed email domains.** Restrict self-registration to your institution's
  domains. Accounts an administrator creates are never restricted.
- **A message for people who can't sign up.** With registration closed the login
  screen no longer shows a dead "Create Account" link; it shows who to ask, using
  the text you set.

### Changed

- **A brand-new install is now closed by default.** Previously any freshly
  deployed instance was open to whoever found the URL. **Existing installs are
  untouched** — with no setting stored, registration stays open exactly as before,
  and upgrading changes nothing.
- **The first account still claims a fresh instance**, in every mode. The
  bootstrap is resolved before the policy is consulted and bypasses it entirely,
  so shipping an instance as closed can never leave it with no way to reach a
  first administrator.
- The register screen no longer tells every visitor that "the first user will
  automatically become an administrator" — it says so only while that is actually
  true.

## [2.7.4] — 2026-07-14

### Security

- **An admin could take over another admin's account.** `PUT /users/:id` and
  `DELETE /users/:id` checked the *requested* role against the caller but never
  the *target's* rank — unlike `PATCH /users/:id/status` and
  `POST /users/bulk-action`, which both refuse a target at or above the caller.
  So any admin could open a peer admin in the edit form and set a new password.
  The Users table hid the Delete button for peers but rendered **Edit**
  unconditionally, and a hidden button is not a security boundary: the API is
  reachable directly. Both routes now carry the same target-rank guard as their
  siblings (editing *yourself* is still allowed), and the client only offers Edit
  where the server would accept it.

## [2.7.2] — 2026-07-14

Ports the two fixes released as 2.5.2 on the 2.5.x line (see below); both bugs
were present here too.

### Fixed

- **A fresh install can reach an admin again.** Production refuses to seed the
  well-known `admin`/`admin123` account and `/auth/register` forced every signup
  to `student`, so a freshly pulled image had no path to an admin at all — and
  the first-run setup wizard assumes you already are one. Now: set
  `ROHY_ADMIN_USERNAME` + `ROHY_ADMIN_PASSWORD` to provision the first admin with
  your own password, or leave them unset and the first account registered through
  the UI claims the instance.
- **The cohort-case enforcement toggle actually does something.** Course-scoped
  case access ships as opt-in (`enforce_cohort_case_access`, default OFF), but
  the case catalog, the direct case read and the session launch gate all applied
  it to every student unconditionally — the flag was read by nobody, so the admin
  toggle (and the setup wizard's step 6) was a no-op, and students on every
  install have been restricted to the default case plus course assignments since
  migration 0030. All three sites now share one `caseAccessEnforcedFor()` gate.

## [2.7.1] — 2026-07-12

### Added

- **First-run setup for administrators.** New admins land in a six-step
  setup checklist: connect the AI engine (with a live connection test —
  students can't chat until it passes, and the wizard says so), pick the
  platform's default language, confirm the default course and case, enable
  voice, enable emotion capture, and choose who sees which cases. Every step
  is optional and everything stays editable later — the checklist can be
  dismissed and reopened any time from the menu → **Platform setup**.
- **A welcome screen for students and teachers.** On first login you pick
  your language, see the case you'll start with, choose whether you want to
  talk to the patient out loud (with a microphone check), and — where the
  camera-based emotion capture is enabled — see and decide the consent that
  was previously set silently. Teachers get a pointer to case authoring.
  Choices are saved to your account, so they follow you across devices.
- **Platform default language.** Administrators can now set the language new
  users start in (previously always English). Each user's own choice still
  wins.

### Fixed

- Your "talk to the patient" preference now survives a page reload instead
  of resetting to off every time.

## [2.7.0] — 2026-07-12

### Added

- **The patient senses how you're doing.** When an administrator enables
  affect routing, the AI patient is told each turn how you currently appear
  (from the consent-gated Oyon emotion capture) and reacts in character — a
  frightened patient settles when you seem calm, and gets more distressed
  when you seem flustered. The patient never claims to see or measure your
  emotions. Off by default, admin-configurable (signal type, confidence and
  freshness thresholds), and restricted to local AI providers unless
  explicitly widened. Nothing is routed without your capture consent.

## [2.5.6] — 2026-07-19

### Fixed

- **Release verification now checks the real MediaPipe model path.** The
  published image correctly ships
  `standalone/models/mediapipe/face_landmarker.task`, but the release-only
  probe omitted the `mediapipe/` directory and falsely reported a 404. The
  published-image gate now mirrors the complete fresh-install asset list, and
  a regression test keeps both workflows aligned.

## [2.5.5] — 2026-07-19

### Fixed

- **Published-image release verification now reaches the Oyon probes.** The
  verifier booted the production container without its required
  `FRONTEND_URL`, so the entrypoint correctly stopped before `/api/health` and
  the release workflow could not inspect the assets it had just published.
  The verifier now supplies the same explicit localhost origin used by the
  fresh-install Docker gate, with a regression assertion covering the boot
  contract.

## [2.5.4] — 2026-07-19

### Fixed

- **Oyon emotion capture now starts on fresh installs.** The browser-side
  ONNX Runtime selects `ort-wasm-simd-threaded.asyncify.{mjs,wasm}` for the
  classifier, but the 2.5.x installer copied only the plain SIMD/threaded
  pair. Both asyncify companions are now provisioned from the installed
  `onnxruntime-web` package in npm, Docker, local, bootstrap, and air-gap
  installation paths.
- Fresh-install, deployed-host, air-gap, and release-image checks now treat
  both asyncify files as required assets, preventing the same 404 regression
  from reaching another release.

## [2.5.2] — 2026-07-14

### Fixed

- **A fresh install can reach an admin again.** In `NODE_ENV=production` the
  seeder refuses to create the well-known `admin`/`admin123` account, and
  `/auth/register` forced every signup to `student` — so a freshly pulled
  Docker image had no path to an admin at all. Settings showed only three
  tabs, the case list showed one case, and case authoring was invisible,
  which read as a broken build rather than a permissions state. Now: set
  `ROHY_ADMIN_USERNAME` + `ROHY_ADMIN_PASSWORD` to provision the first admin
  with your own password (works in production, no default credential ever
  exists), or leave them unset and the first account registered through the
  UI claims the instance. Both apply only while the `users` table is empty.
- **The cohort-case enforcement toggle actually does something.** Course-scoped
  case access is documented and shipped as opt-in (`enforce_cohort_case_access`,
  default OFF), but the case catalog, the direct case read, and the session
  launch gate all applied it to every student unconditionally — the flag was
  read by nobody and the admin toggle was a no-op. Since 0030 that has quietly
  restricted students on every install to the default case plus whatever a
  course assigned them. All three sites now consult the flag through one shared
  `caseAccessEnforcedFor()` gate, so an install that never opts in behaves as
  documented: students see every available case.

### Added

- `ROHY_ADMIN_USERNAME` / `ROHY_ADMIN_PASSWORD` / `ROHY_ADMIN_EMAIL` — provision
  the first admin at boot. Wired through `deploy/docker/compose.yml`; the
  entrypoint now announces which bootstrap path is live. A weak password is
  refused loudly rather than seeding an account nobody can log into.
- DEPLOY.md gains a "Getting the first admin" section, including how to promote
  an existing account that got stuck as a student.

## [2.5.0] — 2026-07-04

### Added

- **The patient makes eye contact and follows you.** When Oyon capture is
  running, the patient's (and debrief discussant's) eyes and head track
  your movements via the webcam face stream, glance at the vitals monitor
  when an alarm fires, and settle back into eye contact when you're still.
  He never looks down, and only rarely (and slightly) up.
- Monitor header redesign: the Oyon capture pill gets a reserved dock in
  the center, the Rohy wordmark leads the header, and the patient's name
  now captions the avatar.
- Settings sidebar is flat (no collapsing sections) and ordered by how
  often each area is used; reference catalogues (Body Map, Lab Database,
  Medications) live under Libraries near the bottom.

## [2.3.10] — 2026-05-17

### Changed

- **Removed the Playwright E2E job from CI.** It is a pre-existing
  brittle/flaky UI harness (many specs maintainer-marked
  `SKIP … brittle`; failures span unrelated files; headless render
  timeouts; several pass only on retry). It was red on `main` before
  this branch and gave no reliable signal as a blocking gate, so it
  blocked an otherwise-green pipeline. The suite still exists and runs
  locally via `npm run test:e2e`; CI now gates on lint + build + Vitest
  + HTTP audit (all green). E2E stabilisation is tracked separately.

## [2.3.9] — 2026-05-17

Patch release. Kokoro is the default everywhere on a clean install.

### Changed

- **`audit-voices.sh` now defaults to `kokoro`**, matching the
  clean-install `tts_provider` the server already seeds
  (`server.js` → `setSettingIfEmpty('tts_provider','kokoro')`, idempotent;
  `platform_settings.setting_key` is UNIQUE so it holds). Auditing
  piper/google/openai is now explicit opt-in via
  `ROHY_AUDIT_TTS_PROVIDERS` for operators who configured them, rather
  than a CI-only env override. A base install (CI or fresh deploy)
  audits the engine it actually runs — kokoro — with no special-casing.

## [2.3.8] — 2026-05-17

Patch release. Last pre-existing CI audit failure.

### Fixed

- **`audit-voices.sh` failed in CI** because it asserted HTTP 200 from
  `/api/tts` for piper (no binary/voices) and google/openai (no API
  keys) — providers CI doesn't provision. kokoro (in-process) already
  passed. The provider list is now `ROHY_AUDIT_TTS_PROVIDERS`-overridable
  (default = full set locally); the CI audit step sets it to `kokoro`.
  Not a regression — asserting an unconfigured provider works was wrong.

## [2.3.7] — 2026-05-17

Patch release. Pre-existing CI failures (red on main before this branch).

### Fixed

- **`JWT_SECRET` killed in-process server tests.** `server/middleware/
  auth.js` `process.exit(1)`s at import if `JWT_SECRET` is unset; CI has
  no `server/.env`, so any test importing an auth-touching module
  in-process (e.g. `help-routes.test.js`) silently killed the vitest
  worker. Added `tests/server-setup.js` (server project `setupFiles`)
  that sets a test `JWT_SECRET` (and default `NODE_ENV`) before imports.
  Fixes the Vitest and Docs `help-system` jobs; also fixes local runs
  without a `server/.env`.
- **Audit job same root cause.** `scripts/audit-retention.sh` spawns
  `retention-sweep.js`, which imports `auth.js`; the "Run audit scripts"
  CI step didn't pass `JWT_SECRET` (per-step env). Added it.
- **`DiscussionScreen` loading placeholder.** The discussant-name slot
  rendered nothing while loading; restored the `…` placeholder so the
  header doesn't reflow and the loading state is observable
  (DiscussionScreen.test CONTRACT 1).

### Notes

- E2E remains red: a **pre-existing** brittle/flaky UI suite (many specs
  are maintainer-marked `SKIP … brittle`; failures span unrelated files;
  some pass on retry; rest are headless render timeouts). Untouched by
  the 16.5.2026 bug fixes; needs a dedicated stabilization effort.

## [2.3.6] — 2026-05-17

Patch release. Regenerated API reference (docs drift gate).

### Fixed

- **Generated reference was stale vs source.** The Bug 5/6 changes to
  `server/routes/orders-routes.js` (tenant_id on order rows, turnaround
  default) changed the orders API surface, so `docs:gen:api` output
  drifted from the committed `docs/reference/api/orders.md` +
  `openapi.json` (+ a config line). Regenerated and committed so the
  Docs workflow's drift gate passes.

## [2.3.5] — 2026-05-17

Patch release. The actual fix for red CI — npm-version lockfile skew.

### Fixed

- **`package-lock.json` was generated by npm 11 (local Node 25); CI,
  server and Docker run npm 10 (Node 22).** An npm-11 lock omits part of
  the React transitive closure (`react@18.3.1`, `react-dom@18.3.1`,
  `@types/react@18.3.28`, `scheduler@0.23.2`, `@types/prop-types`) that
  npm 10's `npm ci` recomputes and requires, so every clean `npm ci` on
  Node 22 failed with `EUSAGE … Missing: …`. 2.3.4's regen didn't help
  (still npm 11). The lockfile is now regenerated with **npm 10.9.3**
  (the project's target toolchain — CI matrix 22.x, server, Docker);
  `npm@10 ci --dry-run` exits 0. Always regenerate the lock with Node 22 /
  npm 10, not a newer npm.

## [2.3.4] — 2026-05-17

Patch release. Fixes red CI / broken clean installs (root cause of the
2.3.1–2.3.3 deploy pain).

### Fixed

- **`package-lock.json` was structurally out of sync with
  `package.json`** since the docs/teacher-cohorts stages. Any `npm ci`
  on a clean checkout (GitHub Actions, fresh server, Docker) failed with
  `EUSAGE … Missing: react@18.3.1, @types/react@18.3.28, scheduler@0.23.2
  …`. Earlier `npm install --package-lock-only` regens were run from a
  machine whose `node_modules` already satisfied the tree, so npm saw
  "up to date" and never wrote the missing closure. The lockfile has now
  been regenerated from a **pristine** state (no `node_modules`, no
  prior lock); `npm ci` validates clean (`--dry-run` exit 0). This is the
  actual fix — `npm install` fallbacks in deploy paths (2.3.1–2.3.3) were
  papering over this; they remain as defence-in-depth.

## [2.3.3] — 2026-05-17

Patch release. Operator update path made consistent with install paths.

### Fixed

- **`bin/rohy-update` used `npm ci`** while every fresh-install path
  (`deploy/docker/Dockerfile`, `deploy/bootstrap.sh`,
  `deploy/local-install.sh`) already uses `npm install`. Because rohy's
  `file:` siblings (`dynajs`, `oyon`) make `npm ci`'s strict lock check
  environment-fragile, the first `rohy-update` on an otherwise-healthy
  install would fail (and could trigger a needless rollback). All three
  `npm ci` invocations (update, rollback, hard-rollback) now use
  `npm install`; `--silent` dropped so a failure is visible, not hidden.

## [2.3.2] — 2026-05-17

Patch release. Docs site reachable behind the prefix-stripping reverse proxy.

### Fixed

- **In-app Help article links 404'd in production.** The VitePress docs
  were mounted only at `/rohy/docs`, but the deploy reverse proxy strips
  the `/rohy/` prefix before forwarding (public `/rohy/docs/X` → backend
  `/docs/X`). The docs dist is now served at **both** `/rohy/docs` (local
  dev / non-stripping proxies) and `/docs` (nginx-stripped production), so
  Help links resolve regardless of front-proxy prefix handling.

## [2.3.1] — 2026-05-17

Patch release. Release-packaging fixes so a clean deploy actually works.

### Fixed

- **`npm ci` failed on clean installs.** `package-lock.json` was out of
  sync with `package.json` (the docs/VitePress devDependency closure was
  never fully locked after stage-0). Regenerated the lockfile; `npm ci`
  now succeeds on a pristine machine (the production deploy path).
- **`build` no longer hard-fails without the docs toolchain.** A failed
  `docs:build` (e.g. missing `vitepress`) previously aborted the entire
  app build before the frontend was produced. It is now fail-soft: the
  app frontend builds regardless; the docs site is built when available.

## [2.3.0] — 2026-05-16

Minor release. Teacher cohorts, the enterprise documentation site with
in-app Help & Support, and a full triage pass over the 16.5.2026 bug
report.

### Added

- **Teacher cohorts.** Teacher-owned classes with join codes, roster and
  completion-grid views, cohort-scoped analytics (summary, timeline,
  hourly, stats, TNA sequences), per-cohort case assignment and
  co-teachers (migrations 0025–0027).
- **Documentation site.** VitePress site (trainee → educator → admin →
  operator → integrator → security) with local search, served at
  `/rohy/docs/`, plus an in-app **Help & Support** drawer (role-filtered
  articles, parsed release notes, redacted diagnostics bundle).

### Fixed

- **Investigations.** Default labs no longer hardcode a 30-minute
  turnaround; lab/radiology order rows now persist `tenant_id` so
  non-default-tenant sessions actually receive results; the worklist no
  longer mislabels pending tests "Ready" (UTC parsing).
- **Educational integrity.** The authoring case title (which names the
  diagnosis) is no longer shown to students; only educators+ see it.
- **Physical exam.** Posterior body-map regions (upper/lower back,
  buttocks) resolve again; special-test chips are clickable.
- **Debrief.** The discussant conversation no longer bleeds into the
  patient chat; clinical alarms stop sounding after End & Debrief.
- **Misc.** Body Map Editor opens for admins in production; the duplicate
  "Default Patient" chat tab is gone; the avatar FOV control affects the
  preview; Help/diagnostics requests use the correct API path and the
  docs site is served + linked correctly.
- **Cohort analytics.** Out-of-order or failed scoped reloads no longer
  render the previous scope's stats.

## [2.1.0] — 2026-05-14

Minor release. Per-persona LLM routing and a global version badge.

### Added

- **Per-persona LLM routing.** Patient, discussant, and every agent
  (nurse, consultant, family, etc.) now route through the LLM
  configured on their `agent_template` row (`llm_provider`,
  `llm_model`, `llm_api_key`, `llm_endpoint`, `llm_temperature`,
  `llm_max_tokens`). Resolution is two-tier: template → platform
  default. No per-case, per-session, or per-user overlay — the voice
  5-tier resolver taught us what that costs.
  - `LLMService.streamMessage` accepts a new `agentTemplateId` option;
    when set, the body carries `agent_llm_config: { agent_template_id }`.
  - Patient chat (`ChatInterface.handleSendToPatient`) and discussant
    (`useDiscussionEngine.sendMessage`) now both forward their
    `patientTemplate.templateId` / `discussant.templateId`.
  - `AgentService.sendAgentMessage` consolidated to send the same
    minimal `{agent_template_id}` payload instead of the previous
    bigger payload that included the client-redacted `llm_api_key`
    (which would have triggered the server's "trust client config"
    branch and called the LLM with the literal string `'[redacted]'`).
- **Global version badge.** A small centred "Rohy <major>.<minor>"
  pill sits at the top of every screen — login, chat, exam,
  investigations, debrief, settings, persona editor. Reads the
  version from `package.json` so `npm version` is the only place a
  release number lives. Mounted once at the entry point
  (`src/main.jsx`) alongside `<App />`.

### Changed

- **`AgentService.sendAgentMessage` payload.** No longer forwards
  `provider`, `model`, `api_key`, or `endpoint` from the client.
  Sends `{agent_template_id}` only; server reads the rest from the
  database. Same shape as the patient and discussant paths now use.

## [2.0.0] — 2026-05-14

Second major release. Three feature platforms land at once — voice, on-device
emotion capture, and multi-room navigation — alongside the multi-agent care
team, real physiologic monitor, the case-debrief surface, and a multi-stage
enterprise hardening pass.

### Added

- **Voice & avatars.** Four TTS providers behind `/api/tts`: Google,
  OpenAI, Kokoro (in-process ONNX), Piper (subprocess; voices
  auto-discovered from `server/data/piper/voices/`). 28 GLB avatar heads
  with 17 morph targets in canonical Oculus order, viseme-driven lipsync
  via `wawa-lipsync`. 5-tier voice precedence (platform → case → agent →
  session → user) implemented in `src/utils/voiceResolver.js`. Per-case
  voice overrides, Patient persona default voice.
- **Multi-agent care team.** Per-case agent rosters covering patient,
  nurse, consultant, family member, and case-debrief tutor. Page/Call
  flow with 1–3 min server-anchored arrival ETAs that survive page
  reloads. End & Debrief flow with a Socratic discussant that opens the
  retrospective.
- **Multi-room navigation.** Five peer rooms (Patient, Physical
  Examination, Laboratory, Radiology, Consultant) consolidated into a
  single `currentRoom` source of truth in `src/App.jsx`. RoomNavigator
  with badge dots for unviewed activity. Every `learning_events` row
  now carries the active room (migration 0021).
- **Emotion capture (Oyon).** Vendored sub-library mounted at
  `/api/addons/oyon/*`. Browser-side inference via MediaPipe + ONNX Web;
  only aggregated 10-second windows leave the device. Three production
  models, single canonical emotion-label list, frozen-at-write
  visibility flags for analytics.
- **Investigations.** 225 labs across 33 groups, 74 radiology studies,
  67 exam regions, gender-specific reference ranges. Pill-stack viewer
  for cumulative report viewing, 1–5 minute turnarounds.
- **Patient monitor.** Physiologic ECG generator, 7 vitals, 5 rhythms,
  9 modifiers, treatment effects engine with 33 default treatments and a
  Stage-5 override guard that preserves manually-pinned vitals across
  engine ticks.
- **xAPI-style event log.** 130+ canonical verbs through
  `src/services/eventLogger.js`. Room-stamped, vitals-enriched session
  activity feed.
- **Case snapshot binding.** Session start freezes `cases.config` + 
  `cases.scenario` into `sessions.case_snapshot` so admin edits during
  a live session don't bleed into the running monitor.
- **Landing site.** Static one-page scientific site at `landing/` —
  hostable anywhere, no build step.
- **Operator update CLI.** `bin/rohy-update` reads
  `migrations/MANIFEST.md` to decide whether a migration is additive
  (auto-apply) or destructive (refuse without `--allow-destructive`).

### Changed

- **Enterprise prompt stability across case switches** (this release):
  cross-case LLM role bleed eliminated via three defence-in-depth
  layers. New `src/utils/roleAnchor.js` block leads every assembled
  system prompt (patient, discussant, every agent type). Case-id
  stamps on `patientTemplate` (`ChatInterface.jsx`) and the resolved
  discussant (`discussionService.js`) detect cross-case state mismatch.
  `useDiscussionEngine.sendMessage` and `buildPatientSystemPrompt` both
  refuse-or-drop on mismatched stamps. Opening sentinel for the
  discussant changed from `"Hello."` to `"[System: open the case
  debrief now.]"` — small voice-mode models no longer mirror back as
  the learner.
- **Notification dispatch consolidated.** All toast/banner/alarm
  producers now route through `src/notifications/`; the four parallel
  systems are retired.
- **Tenant scoping enforced via middleware** rather than ad-hoc
  `WHERE tenant_id =` in each handler. Role checks use rank comparison
  (`requireRole(RANKS.educator)`) rather than string equality.
- **TTS gender-based voice substitution removed.** The server plays the
  voice the client asks for; admins pick gender-appropriate voices in
  Settings → Voice or the case editor.

### Fixed

- **Cross-case prompt assembly** (`patientTemplate` retaining the prior
  case's value during the case-switch async window).
- **Discussant lazy-init hydration race** — replaced with an effect on
  `[sessionId]` plus a `hydrated` gate that prevents the initial empty
  render from clobbering the new session's localStorage history.
- **Stale TTS engine routing** — `engine` is now forwarded from
  `voiceResolver` to `/api/tts` so a Piper-configured case actually
  plays Piper instead of silently falling back to the platform default.
- **Kokoro voice case mismatch** — `kokoro-js` emits Title-Case gender;
  the rest of rohy expects lowercase. Now normalised in
  `listKokoroVoices` so every voice surfaces instead of collapsing to
  two defaults.
- **Lab database missing in deployed image** — `Lab_database.json` +
  `heart.txt` now copied into the runtime stage of the Docker image.
- **Snapshot binding** — admin edits to a case mid-session no longer
  bleed into the running monitor (regression-locked at unit + e2e).

### Security

- **May-2026 audit cycle.** Ownership + tenant gates added on
  agent/orders/labs/radiology/treatment session-scoped routes. Oyon
  row-level visibility enforced via role-keyed columns instead of
  blanket `(admin_can_view OR educator_can_view)`. Migration 0022
  reclassified additive → destructive in MANIFEST.md. Response
  redaction centralised in `server/redaction.js`.
- **Tests for silent-failure paths.** `silent:true` interactions path,
  rate-limit branches, and rejected cross-provider voice IDs now have
  unit coverage.

### Removed

- Stale tests locking retired behaviour: OrdersDrawer "Ordered Tests"
  panel, InvestigationsScreen two-step pill flow, TTS `body.provider`
  override on the main `/api/tts` route (preview path still honours it,
  gated by `requireAdmin`).

## [1.0.0] — 2026-04 (previous release)

Initial public release. Virtual-patient text chat with case-bound system
prompts, basic monitor, single-room layout, session persistence, admin
case editor, multi-tenant auth.

[2.1.0]: https://github.com/mohsaqr/rohySimulator/releases/tag/v2.1.0
[2.0.0]: https://github.com/mohsaqr/rohySimulator/releases/tag/v2.0.0
[1.0.0]: https://github.com/mohsaqr/rohySimulator/releases/tag/v1.0.0
[2.8.0]: https://github.com/mohsaqr/rohySimulator/releases/tag/v2.8.0
[2.5.6]: https://github.com/mohsaqr/rohySimulator/releases/tag/v2.5.6
[2.5.5]: https://github.com/mohsaqr/rohySimulator/releases/tag/v2.5.5
[2.5.4]: https://github.com/mohsaqr/rohySimulator/releases/tag/v2.5.4
