# Oyon Text and Audio Analytics Plan

**Planned releases:** Oyon 3.1 (typing) and Oyon 3.2 (voice)
**Status:** Design and research plan — revised 2026-07-24
**Target platforms:** Desktop Chrome, Firefox, and Safari
**Explicitly out of scope:** iPhone and other mobile-browser certification

## 0. Revision note (2026-07-24)

This revision resolves the conflict between the previous draft and the
authoritative data policy in `CLAUDE.md`, and corrects two technical errors.

**Decided by the project owner:**

1. **Oyon records the signal it produces.** Typing emits raw inter-event
   timing, not only a coarsened histogram. The previous draft's
   "content-free" framing and its data-minimization section are removed.
2. **Consent is the researcher's responsibility and is obtained outside the
   app.** No data is collected without it. Oyon does not re-implement consent,
   does not gate signal for privacy reasons, and its validator is a
   transport-shape check, never a censor.
3. **The microphone ships off and stays off behind a strong gate.** Voice is
   disabled by default, requires explicit host enablement, and requires a
   deliberate per-turn user action. This is an *activation* gate on hardware
   access — not a gate on what is recorded once a turn is active.

**Corrected on technical grounds:**

4. ONNX Runtime cannot execute inside an AudioWorklet. The voice pipeline uses
   a Worker (§5.2).
5. Typing and voice reuse Oyon's existing window envelope, validator, store,
   and transport rather than building a parallel pipeline (§3).
6. Effort estimates re-baselined against this repository's actual delivery
   history (§9).

**Added in the second pass (same day):**

7. **Complete per-event logs ship alongside aggregate windows** (§3.6). Windows
   cannot support TNA, process mining, or lag-sequential analysis; every event
   is retained, ordered, and carries a discrete `state` label.
8. **Two further modalities.** `interaction` — pointer, click, scroll, selection
   (§4.9). `ai_assist` — the host-fed suggestion cycle (§4.10), without which
   AI-inserted text is indistinguishable from fast typing.
9. **[CoAuthor](https://coauthor.stanford.edu/) is the parity target** for
   writing-process capture. Oyon matches its event granularity and its
   human/AI `source` distinction; it does not carry text deltas, so replay is
   positional rather than verbatim.

**Not yet decided — see §12.1.**

---

## 1. Executive decision

Oyon will add two behavioral signal modalities:

- **Oyon 3.1 — typing analytics:** composition activity, editing, pauses,
  bursts, and production timing while a learner writes in an explicitly
  registered Rohy or ChatOyon composer.
- **Oyon 3.2 — voice analytics:** speech activity, pauses, pitch, loudness,
  spectral characteristics, signal quality, and within-turn dynamics while a
  learner intentionally speaks to the AI.

The modalities follow three permanent boundaries:

1. **Oyon measures the individual participant's observable signals.**
2. **Rohy and ChatOyon own authentication, conversation/task context, group
   membership, educator permissions, and cross-student comparison.**
3. **Oyon reports measurements, not psychological interpretations.**

### 1.1 Vocabulary

The intended vocabulary is:

- typing activity;
- editing activity;
- production and pause timing;
- speech activity;
- acoustic and prosodic characteristics;
- signal quality;
- within-person change;
- group turn distribution.

Oyon should not present these measurements *as* labels such as stress,
anxiety, confidence, hesitation, confusion, or cognitive load. This is a
reporting-language rule about how the numbers are presented — it is not a rule
about which numbers are collected. Researchers using Oyon's outputs may model
whatever their study design calls for.

> **Note on consistency.** Oyon already ships an `EngagementAggregator`, a
> `focus_score`, and an Attention analytics screen. If the vocabulary rule
> above is meant to bind the whole product rather than only these two
> modalities, that is a separate v3.x decision about the existing pipelines —
> see §12.1.

## 2. Product boundary

### 2.1 Oyon owns

- Browser-side signal acquisition during an explicitly active interaction.
- Signal aggregation and derived-feature computation.
- Modality-specific quality and uncertainty measurements.
- Transport-shape validation so batches stay well-formed in transit.
- Local storage and transport of signal windows.
- Current-capture and current-session visualization.
- Versioned public signal contracts.
- Clean shutdown and resource release.

### 2.2 Rohy and ChatOyon own

- Authentication and the authoritative user identity.
- Course, class, group, role, tenant, activity, case, thread, and message
  context.
- The current session and capture authorization.
- The composer or voice control to which Oyon may attach.
- AI playback intervals.
- Speech-to-text and conversational content.
- Educator authorization and cross-student dashboards.
- **Informed consent, ethics approval, data-retention policy, and
  institutional governance.**

### 2.3 Server authority

The browser payload must never be trusted to select a student, role, tenant,
or group. Rohy or ChatOyon should:

1. authenticate the user;
2. create or authorize a session/capture;
3. give Oyon a short-lived capture token or authenticated host transport;
4. attach authoritative user and group identity on the server;
5. reject payload context that conflicts with the authenticated session.

Opening Oyon inside Rohy or ChatOyon must continue to show only the current
session. Historical sessions and other students are available only through
separately authorized host analytics.

## 3. Signal architecture — extend, don't duplicate

The previous draft proposed a parallel pipeline (new envelope, new validator,
new transport, new store, four new events) on the premise that
`emotion_windows` and `/emotions/batch` are camera-specific.

**They are not.** `EmotionRuntime` already emits modality-scoped windows with
independent cadences over the same envelope:

```js
// src/core/EmotionRuntime.js:473-482
events.push({ posture_only: true, posture: finalPosture,
              window_start: …, window_end: … });
events.push({ heart_rate_only: true, heart_rate: finalHeartRate, … });
events.push({ gaze_only: true, gaze: finalGaze, … });
```

Posture, heart rate, facial signals, and gaze all ride this path today. The
route name `/emotions/batch` is a legacy misnomer; the fix for a misnamed
route is an alias, not a second wire contract. A parallel pipeline would
require every host to integrate two endpoints, two schemas, two event
listeners, and two retention policies.

### 3.1 What actually changes

| Change | File | Size |
|---|---|---|
| Add explicit `modality` discriminator, superseding the ad-hoc `*_only` booleans | `src/version.js`, validator | small |
| Bump batch schema to `oyon-window-batch-v4`, keep v3 in the supported list | `src/version.js` | 2 lines |
| Add `validateTypingBlock` / `validateVoiceBlock` beside the existing `validateEngagementBlock` / `validateGazeBlock` | `src/validation/validateEmotionPayload.js` | ~120 lines |
| Add `'signal_windows'` to `STORES`, bump `DEFAULT_DB_VERSION` | `src/storage/IndexedDbOyonStore.js:2,4` | 2 lines |
| Reuse `oyon:window`; hosts filter on `modality` | — | none |

`OYON_SUPPORTED_WINDOW_BATCH_SCHEMA_VERSIONS` already exists as an array for
exactly this kind of additive migration.

### 3.2 The `*_only` validator gap — fixed 2026-07-24

`validateEmotionEvent` special-cased only `engagement_only`, so `facial_only`,
`gaze_only`, `heart_rate_only`, and `posture_only` windows failed validation:

```
posture_only event →
  events[0].confidence must be a finite number
  events[0].valid_frames must be an integer
  events[0].missing_face_ratio must be a finite number
```

Invisible in standalone (`LocalEmotionTransport` does not validate) but
`HttpEmotionTransport` does, so HTTP host integrations were rejecting four of
the five modality window types.

Fixed independently of this plan: `MODALITY_ONLY_FLAGS` +
`isModalityOnlyEvent()` in `src/validation/validateEmotionPayload.js` now
exempt the emotion scalars for any modality-scoped window, while still
range-checking them when present. Regression cases added to
`tests/validation.test.js`.

The `modality` discriminator in §3.1 supersedes this flag list and removes the
class of bug entirely — `MODALITY_ONLY_FLAGS` is the migration seam.

### 3.3 Versioning

Package, host, and payload versions stay independent:

- package release: `3.1.x` or `3.2.x`;
- host contract: independently versioned (currently
  `OYON_HOST_CONTRACT_VERSION = '3.1'` — note the numeric collision with the
  planned package version and do not conflate them);
- window batch schema: `oyon-window-batch-v4`;
- modality feature profile: separately identified — `typing-v1`, `voice-v1`.

### 3.4 Window shape

```json
{
  "modality": "typing",
  "feature_profile": "typing-v1",
  "window_kind": "episode",
  "window_id": "uuid",
  "capture_id": "host-authorized-capture",
  "session_id": "current-session",
  "window_start": "2026-07-24T09:00:00.000Z",
  "window_end": "2026-07-24T09:00:35.000Z",
  "target": { "kind": "chat_composer", "id": "host-safe-target-id" },
  "typing": {},
  "quality": {},
  "settings_hash": "sha256"
}
```

Rules:

- The client does not provide an authoritative `user_id`.
- `target` is an allowlisted host reference.
- The modality block is validated for shape and numeric range according to
  `modality` and `feature_profile`.
- All numeric fields have explicit ranges and units.
- Validation is a **transport-shape check**. It exists so batches stay
  well-formed and bounded in transit. It is not a privacy mechanism and must
  never be the reason a researcher cannot get a signal.

### 3.5 Storage

Two stores, two granularities. **Both ship. The window is a convenience over
the event log, never a replacement for it** — per the `CLAUDE.md` data policy,
the per-event stream stays available.

`signal_windows` — aggregates:

- key: `window_id`;
- indexes: `capture_id`, `session_id`, `modality`, `window_start`;
- retention controlled by host policy;
- deletion by session, capture, modality, or full local reset.

`signal_events` — the complete per-event log (§3.6):

- key: `event_id`;
- indexes: `capture_id`, `session_id`, `modality`, `timestamp`, `sequence_index`;
- same retention and deletion controls.

### 3.6 The event log — complete, ordered, TNA-ready

Aggregate windows cannot support sequence analysis. TNA, process mining,
lag-sequential analysis, and n-gram work all need **one row per event, in order,
each carrying a discrete state label**. A window of counts has already thrown
that away.

Prior art is [CoAuthor](https://coauthor.stanford.edu/) (Stanford): 1,445
human-AI writing sessions, 63 writers, logged at keystroke level across ~13
event types and 17 fields per event — text insertion/deletion, cursor movement,
selection, and the AI-suggestion cycle — fine-grained enough for exact session
replay. That is the bar for this layer, and Oyon already has TNA machinery
(`tests/transition-network.test.js`, the app's TNA pooling) that currently only
ever sees emotion windows.

Every modality emits into one shared event shape:

```json
{
  "event_id": "uuid",
  "capture_id": "host-authorized-capture",
  "session_id": "current-session",
  "modality": "typing",
  "sequence_index": 412,
  "timestamp": 1784892031482,
  "monotonic_ms": 30581,
  "state": "delete",
  "source": "user",
  "target": { "kind": "chat_composer", "id": "host-safe-target-id" },
  "detail": { "offset": 812, "length": 14 }
}
```

Contract:

- `state` is the **discrete label the sequence models consume** — drawn from a
  closed, versioned per-modality vocabulary (§4.8, §4.9, §4.10) so transition
  matrices are comparable across sessions and studies.
- `sequence_index` is a monotonic per-capture counter. Ordering never depends on
  wall-clock timestamps, which are not monotonic across a tab suspend.
- `monotonic_ms` is `performance.now()`-based and is what timing analysis uses;
  `timestamp` exists to join against host records.
- `source` is `user` | `ai` | `system` — the distinction CoAuthor makes and the
  one that makes human-AI co-writing analyzable at all.
- `detail` is modality-specific and free-form within a size bound.

**Export.** A `toLongFormat()` accessor returns one row per event with
`session_id, actor, sequence_index, timestamp, state, modality` — the long
format TNA and `TraMineR`-style sequence tooling expect, so a researcher goes
from capture to transition matrix without writing a reshape step. Windows remain
available via the existing accessors.

**Volume.** A 20-minute writing session is on the order of 10⁴ events at a few
hundred bytes each — single-digit MB, comfortable in IndexedDB. Transport
batches the log separately from windows so a slow upload never stalls the
aggregate path.

## 4. Oyon 3.1 — typing analytics

### 4.1 Interaction contract

Oyon attaches only to a host-designated text input or textarea used for an
active learning interaction. It must not install a page-wide keyboard
listener — not for privacy reasons, but because a page-wide listener captures
input from unrelated fields and produces meaningless data.

Host lifecycle:

1. register the composer and a safe target identifier;
2. start the composition episode when the composer becomes active;
3. finalize on submit;
4. finalize as abandoned on explicit cancellation, navigation, session change,
   or host teardown;
5. detach all listeners immediately.

`contenteditable` support is deferred to a later release — DOM mutation and
formatting semantics are substantially more complex than textarea/input
semantics.

### 4.2 Browser event strategy

- Treat `input` as the source of truth.
- Treat `beforeinput.inputType` as a semantic hint.
- Handle `compositionstart`, `compositionupdate`, `compositionend`.
- Do not count intermediate IME states as ordinary committed typing.
- Do not rely on `keydown`/`keyup` — virtual keyboards, dictation,
  autocomplete, accessibility input, and IME bypass or alter them.
- Use `performance.now()` for monotonic intervals.
- Pause or finalize on `visibilitychange`, navigation, host teardown, or loss
  of the authorized session.
- Count Unicode grapheme clusters with `Intl.Segmenter`, not UTF-16 code units.

**Performance note.** Re-segmenting the entire field value on every `input`
event is O(n) per keystroke and O(n²) across a long composition. Irrelevant
for a chat composer; measurable for a long-form essay. Cache the previous
count and segment only the changed slice, widened by a few code units so
grapheme clusters are not split at the boundary.

### 4.3 What Oyon collects

The host adapter supplies, per event:

- event timestamp (`performance.now()`);
- input type;
- previous grapheme count;
- current grapheme count;
- selection-replacement indication;
- composition state;
- caret offset and selection extent (`typing-v2`, §4.8);
- submit/cancel state.

A convenience DOM adapter may read the input value to compute grapheme-count
deltas.

**Every event is retained** in the `signal_events` log (§3.6), not only folded
into a window. The window is a convenience over the log.

**Oyon does not store the text itself** — not as a privacy measure, but
because Rohy and ChatOyon already store the submitted message. Duplicating it
in a signal window adds storage and a second copy to keep consistent, with no
analytic gain. The cost of this choice is stated openly in §4.8: it buys
positional replay, not verbatim replay.

**Oyon does store raw inter-event timing.** The pause histogram in §4.4 is
derived from the interval array, not a replacement for it: the histogram can
be recomputed from the intervals at any time, but the intervals cannot be
recovered from the histogram. Discarding them would destroy analytic
capability for no benefit — participants are authenticated, so the intervals
identify no one who is not already identified, and consent for collection is
obtained by the researcher before capture begins.

### 4.4 `typing-v1` feature profile

```json
{
  "elapsed_ms": 35000,
  "active_input_ms": 18400,
  "first_input_latency_ms": 2100,
  "committed_graphemes": 126,
  "inserted_graphemes": 151,
  "deleted_graphemes": 19,
  "replacement_graphemes": 6,
  "pasted_graphemes": 0,
  "edit_event_count": 14,
  "composition_count": 0,
  "revision_ratio": 0.165,
  "production_rate_per_active_min": 410.9,
  "inter_event_intervals_ms": [412, 188, 205, 1730, 96, "…"],
  "pause_histogram": {
    "lt_500_ms": 38,
    "500_to_1000_ms": 9,
    "1000_to_2000_ms": 5,
    "2000_to_5000_ms": 3,
    "gte_5000_ms": 1
  },
  "burst_count": 7,
  "submitted": true,
  "abandoned": false
}
```

`production_rate` is preferred over `typing_speed` because input can originate
from a physical keyboard, virtual keyboard, IME, dictation, autocomplete, or
accessibility technology.

Pause buckets and burst thresholds are operational definitions, not
psychological states. The threshold is deliberately **not** baked into the field
name (`burst_count`, not `burst_count_2000_ms`): the values live in the sibling
`quality.thresholds` block — `{ pause_buckets, burst_threshold_ms }` — and in
`settings_hash`, so a window is self-describing and a retuned threshold does not
rename a field.

`inter_event_intervals_ms` is bounded by the transport-shape validator only
(a maximum array length, so a single window cannot become unbounded). Long
compositions that exceed the bound finalize into multiple episode windows
rather than being truncated.

### 4.5 Typing quality profile

**Shipped** in `window.quality`:

- `thresholds` — `{ pause_buckets, burst_threshold_ms }`, so every window carries
  the operational definitions it was computed under;
- `intervals_truncated` — the episode hit `MAX_TYPING_INTERVALS`.

**Not yet implemented.** The adapter knows `graphemeMode`
(`injected` | `intl-segmenter` | `code-point-fallback`) but does not yet feed it
into the window, and none of the following exist in code:

- supported input kind;
- grapheme segmentation availability (available at the adapter, not plumbed);
- composition/IME observed;
- autocomplete or dictation indication where the browser exposes it;
- active/hidden coverage;
- interruption count;
- measurement completeness;
- host lifecycle correctness;
- excluded interval duration.

Plumbing `graphemeMode` and composition-observed through is the cheapest next
increment — both are already known at the point the window is built.

### 4.6 Oyon 3.1 deliverables

- `modality` discriminator, `*_only` validator fix, `signal_windows` store,
  `typing-v1` validation block (§3).
- Pure `TypingAggregator` with deterministic unit tests.
- DOM composer adapter.
- Rohy and ChatOyon host adapters, including the `oyon/app-element` web
  component path (`docs/EMBEDDING.md`) — this is the live integration surface
  and the previous draft omitted it.
- Current-session typing timeline and summary in `standalone/app`.
- Desktop Chrome, Firefox, and Safari end-to-end coverage.
- `docs/TYPING.md` matching the existing per-modality doc pattern
  (`docs/BODY_POSTURE.md`, `docs/HEART_RATE.md`, `docs/RESPIRATION.md`).

### 4.7 Typing validation matrix

- ordinary insertion and deletion;
- selection replacement;
- paste;
- undo and redo;
- autocomplete and autocorrect;
- speech dictation;
- emoji and combined graphemes;
- English, Finnish, and Arabic/IME;
- submit and abandon;
- focus changes;
- tab hiding and restoration;
- session replacement;
- host unmount/remount;
- accessibility input where available.

Correctness gate: grapheme counts match reference inputs, IME composition is
not double-counted, and episode boundaries are correct across submit, abandon,
and session replacement.

### 4.8 `typing-v2` — event states and positional deltas

`typing-v1` (shipped) counts edits. `typing-v2` adds the two things sequence
analysis needs: a **state label per event** and the **position** of each edit.

State vocabulary (`typing-states-v1`):

| State | Emitted when |
|---|---|
| `insert` | net grapheme delta > 0 |
| `delete` | net grapheme delta < 0 |
| `replace` | an edit replaced a non-empty selection |
| `paste` | `inputType` indicates paste |
| `undo` / `redo` | `historyUndo` / `historyRedo` |
| `compose` / `composing` / `commit` | composition lifecycle |
| `move` | caret repositioned without an edit |
| `select` / `deselect` | selection extended / collapsed |
| `pause` | synthesized when a gap exceeds `burst_threshold_ms` |
| `start` / `submit` / `abandon` | lifecycle boundaries |

`pause` as an explicit state matters: without it, a transition matrix cannot
distinguish "deleted immediately after inserting" from "deleted after staring at
the screen for nine seconds". Those are different processes.

**Positional deltas.** Each edit event carries
`detail: { offset, length, op }` — where in the document it happened, not what
was written. This gives revision *location*, which is what separates local
repair from global restructuring in the writing-process literature, and it is
the field `typing-v1` most conspicuously lacks.

Content is still not carried (§4.3). The consequence is stated plainly: this
reconstructs the *structure* of the document's evolution, not its words, so a
CoAuthor-style verbatim replay requires joining Oyon's positional stream against
the host's stored text. See §12.1.

### 4.9 `modality: 'interaction'` — pointer, click, scroll, selection

Typing captures the composer. It says nothing about what the learner did
between edits — and "between edits" is where reading, re-reading, navigating,
and deliberating live.

State vocabulary (`interaction-states-v1`): `pointer_move`, `pointer_idle`,
`click`, `double_click`, `scroll_down`, `scroll_up`, `select_text`,
`focus_gain`, `focus_loss`, `tab_hidden`, `tab_visible`.

- **Scope is page-wide** (document-level pointer, scroll, click) plus
  composer-scoped caret and selection. Page-wide is the useful scope because it
  pairs with the AOI machinery that already exists in `src/gaze/domAoi.js` —
  clicks and pointer dwell resolve to the same AOIs as gaze, so mouse and gaze
  become directly comparable streams.
- **Pointer movement is sampled**, not per-`mousemove` (which fires at display
  refresh and would dominate the log). Sample at a configurable rate with
  `(x, y, t)` retained per sample; path length, dwell clusters, and idle time
  derive from it. The sampling rate is a performance parameter recorded in the
  quality block — it is not a privacy throttle.
- **Mouse position is a cheap gaze proxy.** Where calibrated gaze is
  unavailable — which is most of the time — pointer dwell over AOIs is the
  fallback attention signal, and having both lets one validate the other.

### 4.10 `modality: 'ai_assist'` — the AI side of co-writing

This is the part with no substitute, and the part Oyon cannot derive on its own:
**the host must emit it.** Rohy and ChatOyon already know when a suggestion was
offered, what was shown, and what happened to it.

State vocabulary (`ai-assist-states-v1`), mirroring CoAuthor's suggestion cycle:
`suggestion_request`, `suggestion_shown`, `suggestion_accept`,
`suggestion_reject`, `suggestion_dismiss`, `ai_turn_start`, `ai_turn_end`.

Each carries `source: 'ai'`, latency, the number of options shown, which index
was taken, and the accepted length in graphemes — **not the suggestion text**,
which the host stores.

Without this stream the typing log is misleading: an insertion of 200 graphemes
in 40 ms is an accepted AI suggestion, not fast typing, and a model built on
undifferentiated `insert` events will silently treat it as the latter.
CoAuthor reports a 72.3% suggestion acceptance rate and 72.6% human-authored
text — the gap between those two numbers is exactly the signal that vanishes if
`source` is not recorded.

## 5. Oyon 3.2 — voice analytics

### 5.1 Activation gate

**The microphone ships off.** Three independent conditions must all hold
before a single audio frame reaches Oyon:

1. **Off by default.** `voice_enabled` defaults to `false` in
   `OYON_DEFAULT_SETTINGS`, matching `heart_rate_enabled`,
   `posture_tracking_enabled`, and `gaze_tracking_enabled`.
2. **Host enablement.** Rohy or ChatOyon must explicitly enable voice for an
   authorized activity. A learner cannot turn it on alone.
3. **Deliberate per-turn user action.** The learner clicks or holds the
   microphone control. There is no ambient listening, no hot-word, no
   automatic re-arm.

Turn lifecycle:

1. the user activates the microphone control;
2. on first use, the browser requests microphone permission;
3. the host starts an authorized voice turn;
4. Oyon analyzes frames only during that turn;
5. capture stops on release, explicit stop, host cancellation, or the
   configured end-of-turn behavior;
6. **the microphone track is stopped and released immediately**;
7. Oyon remains inactive while the AI speaks and between user turns.

Browser microphone permission may persist across turns — that is the
browser's model and Oyon cannot change it. Oyon remains inactive regardless:
permission granted is not capture active. The UI must show microphone state
unambiguously at all times.

Just-in-time notice:

> Microphone active only during your voice turn.

Rohy or ChatOyon may separately transmit audio for speech-to-text and the AI
conversation under host policy. Oyon does not receive the transcript unless
the host supplies a derived field (§5.8).

### 5.2 Audio data flow — corrected

The previous draft placed Silero VAD and ONNX Runtime inside the AudioWorklet.
**That cannot run.** `AudioWorkletGlobalScope` has no `fetch`, no
`XMLHttpRequest`, no `Worker`, and no module loading beyond `addModule` — ORT
cannot fetch its WASM binaries there. A 32 ms-cadence neural VAD on the audio
render thread would also be the wrong place for it: a missed deadline is an
audio glitch.

```text
User activates voice turn
          |
          v
Host obtains microphone stream
          |
          +----> host AI/STT path, governed by host policy
          |
          v
AudioWorklet  — ring buffer, framing, cheap time-domain features
                (RMS, peak, clipping count, zero-crossing rate)
          |
          | postMessage(Float32Array frames)
          v
Worker        — ONNX Runtime + Silero VAD
                pitch (pitchy)
                spectral (existing src/analytics/fft.js + Hann window)
          |
          | postMessage(per-frame features)
          v
Main thread   — VoiceTurnAggregator
          |
          v
Turn summary + per-frame feature series + quality + uncertainty
```

**Main-thread contention is the real performance risk**, and the previous
draft did not name it. There are currently **no Workers anywhere in `src/`** —
MediaPipe face, MediaPipe pose, and ONNX emotion all run on the main thread at
16 fps. The ChatOyon scenario is speaking to the AI *while the camera pipeline
runs*. Voice must be in a Worker from day one; this is what makes concurrent
operation viable, not gold-plating.

The host turn boundary is authoritative. VAD identifies speech, silence, and
pauses inside the authorized turn.

### 5.3 Runtime stack

| Component | Purpose | License | New dependency? |
|---|---|---|---|
| `src/analytics/fft.js` | Spectral computation | Oyon (in-house) | **No — already exists** |
| `pitchy` 4.1.0 | F0 and pitch confidence (McLeod/NSDF) | MIT per npm | Yes — small |
| Silero VAD ONNX | Speech/silence segmentation | MIT | Model asset |
| `onnxruntime-web` | Execute Silero locally | MIT | No — already present |
| AudioWorklet + Worker | Off-main-thread processing | Browser API | No |
| `VoiceTurnAggregator` | Feature trajectories, statistics, quality, teardown | Oyon | New code |

**`fft.js` from npm is not needed.** `src/analytics/fft.js` is an 80-line
zero-dependency radix-2 Cooley–Tukey FFT with `powerSpectrum()`, written
specifically to avoid pulling an npm FFT — its header says so. Audio needs a
Hann window added (~15 lines), not a dependency.

Also already present and directly reusable from
`src/analytics/HeartRateEstimator.js`: `resampleUniform` (line 274),
`detrend` (296), `movingAverageHighPass` (328). The buffer → detrend →
spectrum → confidence-gated-estimate shape in `HeartRateEstimator` is the same
shape `VoiceTurnAggregator` needs.

**Silero integration specifics** to pin in `docs/VOICE.md`:

- v5 requires exactly 512 samples at 16 kHz per call;
- an LSTM state tensor must be carried across calls, plus an `sr` input;
- state threading is the classic integration bug and is invisible to unit
  tests that feed a single chunk — test across chunk boundaries.

**Sample rate.** Request `new AudioContext({ sampleRate: 16000 })` and let the
browser resample; this is supported in all three target browsers and yields
Silero's required rate directly. Keep a linear-interpolation fallback for
platforms that refuse the constructor. Hand-written resampling is a fallback,
not a work item.

**Asset pipeline.** The Silero `.onnx` must be wired into the machinery that
already exists: `src/config/cdnDefaults.js` (single source of truth for URLs),
`scripts/download-models.sh`, `npx oyon download-models`,
`npx oyon install-assets`, and the `SELF_HOSTED_*` constants. Pin by upstream
commit, model version, SHA-256 checksum, source URL, and copied license.

### 5.4 Why this stack

- Runs locally; no per-minute API or server inference charge.
- Permissive licensing.
- Reuses Oyon's existing ONNX Runtime and DSP machinery.
- Each component has a narrow, replaceable responsibility.
- Oyon controls feature definitions and can validate every output.
- Smaller and easier to audit than an all-in-one engine.

### 5.5 Rejected or deferred alternatives

**Essentia.js** — technically capable of replacing the spectral and pitch
layer. Does not replace neural VAD or the conversational aggregator. Large
package, old npm release, AGPL-3.0. For browser-delivered code, AGPL §13's
network-interaction clause is a materially harder problem than GPL.

> **Consistency note.** Oyon already ships `webgazer@^3.5.3` under
> **GPL-3.0-or-later** as a selectable gaze engine, with the combined-bundle
> implications documented in `NOTICE.md` and `docs/COMPATIBILITY.md`. The
> Essentia rejection should be stated in the same terms — a combined-work
> analysis with a documented escape hatch — rather than as a blanket copyleft
> objection, which the existing dependency set would contradict.

**openSMILE** — strong eGeMAPS reference implementation, but the free
distribution is research-only. Use it for offline validation; a commercial
license would be required to ship it.

**devAIce** — strongest buy-instead-of-build candidate (VAD, prosody,
GeMAPS+, audio quality, ASR) but requires a commercial agreement and either
cloud audio processing or a native/server SDK. Remains a contingency if
custom validation costs exceed the commercial offering.

**sherpa-onnx** — Apache-2.0, capable, but does not replace detailed prosodic
and voice-quality extraction and would duplicate substantial runtime
machinery. Reconsider only if Oyon later owns ASR or denoising.

**Paralinguistic encoders** — deferred. Without a defined downstream task they
produce opaque vectors that are hard to validate or interpret, and they are
not required for Oyon 3.2 analytics.

### 5.6 `voice-v1` feature profile

Trimmed from ~45 measurements to ~15 so that §5.10's frozen-threshold
validation gate is affordable on a first corpus. The remainder joins 3.2.1
alongside the §5.7 deferrals.

**Turn and speech structure**

- authorized turn duration;
- speech duration and speech ratio;
- initial and trailing silence;
- internal pause count, duration, and histogram;
- speech-segment and burst counts with duration summaries;
- excluded AI-playback duration; interruption and muted duration.

**Pitch and voicing**

- voiced-frame ratio;
- pitch median and interquartile range;
- pitch contour slope;
- pitch-confidence distribution and percentage of frames excluded for low
  confidence.

**Loudness and energy**

- RMS mean and variability;
- peak-to-average ratio;
- clipping count and ratio;
- near-silence ratio.

**Spectrum**

- spectral centroid;
- spectral roll-off.

**Per-frame series.** Consistent with §4.3, the per-frame F0, RMS, and VAD
probability series are retained and exposed alongside the turn summary. The
summary is derived from the series, not a replacement for it.

**The raw audio waveform is not stored.** Oyon stores analytics — the
per-frame feature series and the turn summary derived from it. Audio itself
belongs to the host, which already transmits it for STT; a waveform is
megabytes where a feature series is kilobytes, and Oyon's product is the
measurement, not the recording.

**Quality and uncertainty**

- effective sample rate and channel count;
- echo-cancellation, noise-suppression, and automatic-gain-control settings,
  read from `track.getSettings()`;
- clipped, muted, hidden, and interrupted coverage;
- VAD confidence/coverage; pitch confidence/coverage;
- analyzable speech duration;
- insufficient-data flags;
- microphone/processing-condition change indication.

**AGC policy — decide, don't just report.** Absolute loudness is not
comparable across students unless capture conditions are controlled, and
browser AGC actively normalizes loudness. If the host owns the microphone
stream and enables AGC for STT quality, every absolute loudness measurement
becomes an artifact of the gain controller. Therefore:

- if Oyon owns the stream, request `autoGainControl: false`;
- if the host owns it and AGC is on, mark loudness measurements contaminated
  rather than reporting them as comparable;
- prefer within-turn and within-person relative measurements in all cases.

### 5.7 Deferred advanced voice profile

Deferred to 3.2.1 or a separately enabled research profile: jitter; shimmer;
harmonics-to-noise ratio; formants; cepstral peak prominence; detailed
voice-quality indices; spectral flatness, slope, and band-energy ratios;
beginning/middle/end thirds for pitch and loudness; noise-floor and SNR
indicators; transcript-derived disfluencies and repairs; language-specific
pronunciation analysis.

These are sensitive to microphones, browser processing, room noise, voice
physiology, and algorithm choice. They require reference-tool parity and a
dedicated validation corpus before production use.

### 5.8 Speech-to-text cooperation

If Rohy or ChatOyon already performs speech-to-text, the host may provide
derived timing: word count; word start/end timestamps; syllable count;
filled-pause timestamps; repetition or repair counts. This enables better
production rate, articulation rate, pause placement, and repair analytics.
The transcript remains in the host.

### 5.9 AI playback exclusion

Rohy and ChatOyon must emit authoritative playback intervals —
`ai_playback_start`, `ai_playback_end`, and interruption/cancellation events.
Oyon excludes those intervals even when echo cancellation is enabled. If the
microphone receives strong playback leakage, the voice window is marked
contaminated rather than silently treated as learner speech.

### 5.10 Voice validation matrix

- silence; clean headset speech; laptop microphone speech;
- quiet and noisy rooms;
- AI playback through speakers; AI playback interrupted by the user;
- low and high microphone gain; clipping;
- microphone mute/unmute; denied and revoked permission;
- short and long turns; long internal pauses;
- tab hiding; host cancellation; session replacement; unmount/remount;
- **voice and camera pipelines running concurrently** (the ChatOyon case);
- Chrome, Firefox, and Safari on desktop.

Create a manually labeled Rohy/ChatOyon evaluation corpus with speech and
pause boundaries. Measure: VAD precision/recall/F1; boundary timing error;
false speech during AI playback; pitch coverage and octave-error rate on a
reference subset; parity of spectral measurements with a trusted offline
implementation; CPU, memory, startup latency, and dropped audio frames —
**measured with the camera pipelines active**; deterministic teardown.

Thresholds are chosen on the development corpus and frozen before evaluation
on a held-out test corpus. Do not invent acceptance numbers before the
prototype benchmark.

**Degraded mode.** If VAD F1 is inadequate in realistic classroom noise,
fall back to energy-based VAD bounded by the host's push-to-talk turn
boundary, and mark the profile accordingly. The previous draft specified the
measurement but had no branch for a poor result.

## 6. Analytics and comparison

### 6.1 Individual analytics

Oyon may show the current learner: current-session typing and voice
timelines; their own turn summaries; within-turn trajectories; change from
their own prior turns in the current activity; explicit quality and
insufficient-data indicators.

Within-person comparison is preferred for pitch, loudness, spectral
characteristics, and production timing.

**Open design question.** The app's TNA, dynamics, and timeline views operate
on fixed-cadence ~10 s emotion windows. Typing episodes and voice turns are
variable-length and event-triggered. How episode-shaped windows join a
fixed-cadence timeline is unresolved and is where most of the UI work
actually sits. Resolve before Phase 2 UI work begins.

### 6.2 Group analytics

Rohy or ChatOyon may aggregate authorized signal windows across participants
to show: distribution of speaking and typing time; turn frequency and
duration; response latency; pause and silence distributions; edit/revision
activity; modality shifts; balance of participation; overlap only when
participant audio streams are isolated.

Cross-student comparisons must be stratified or adjusted for: task and
activity; language and IME; physical versus alternative input; microphone and
processing settings; room conditions; analyzable coverage; accessibility
technology; session duration.

The dashboard should not reduce these signals to a single engagement, effort,
participation-quality, confidence, or performance score.

## 7. Consent, governance, and educational use

**Consent is obtained by the researcher, outside the application.** No data is
collected without it. Oyon does not re-implement consent, does not gate or
coarsen signal for privacy reasons, and its validator is a transport-shape
check rather than a censor. This matches the authoritative data policy in
`CLAUDE.md` and the correction already applied to the app's settings UI, where
the "Privacy" section was renamed "Transport contract" precisely because the
old wording claimed the validator protects privacy.

### 7.1 Default state

- Typing and voice are disabled unless the host explicitly enables them for an
  authorized activity.
- Typing begins only inside an authorized composer.
- **Voice begins only after the learner intentionally activates the
  microphone, and only when the host has enabled voice for that activity
  (§5.1).**
- Browser microphone permission may persist; Oyon remains inactive outside an
  authorized voice turn.

These are activation gates on hardware and lifecycle. They are not gates on
what is recorded once a modality is legitimately active.

### 7.2 User controls

- visible typing/voice instrumentation status;
- visible microphone-active state;
- stop control;
- local data deletion;
- server-side deletion/export through the host;
- retention-policy visibility.

### 7.3 Governance gate

Before a real student deployment, the *researcher or institution* completes:

- a DPIA or equivalent institutional privacy assessment;
- ethics/governance review;
- documentation of purpose, retention, access, and deletion;
- a prohibition on grading, admission, discipline, surveillance, and
  proctoring use;
- documentation of feature definitions and limitations.

These are host and institutional responsibilities. Oyon's obligation is to
document precisely what each measurement is, how it is computed, and where it
is unreliable — so that the assessment can be done accurately.

**EU AI Act Article 5(1)(f)** prohibits AI systems used to infer emotions in
educational institutions except for narrow medical or safety reasons. Note
that this bears far more directly on Oyon's **existing emotion pipeline** than
on counting typing pauses or measuring speech ratio. If it is a live concern,
it is a v3.x question about the core product, not a v3.1 question about
typing — see §12.1.

## 8. Implementation sequence

### Phase 0 — contract

- Approve the measurement vocabulary and the reporting-language rule.
- Approve the `modality` discriminator and server-authority model.
- Define Rohy and ChatOyon integration responsibilities.
- Record licenses and model provenance.

**Exit gate:** signed-off schema.

### Phase 1 — schema extension — **DONE 2026-07-24**

- ~~Fix the `*_only` validator gap (§3.2)~~ — `MODALITY_ONLY_FLAGS`.
- ~~Add the `modality` discriminator; bump to `oyon-window-batch-v4`~~ — v3 still
  accepted; `OYON_MODALITIES` / `OYON_WINDOW_KINDS` added to `src/version.js`.
- ~~Add `signal_windows` to the store; bump the DB version~~ — DB v2, indexed on
  `capture_id`, `session_id`, `modality`, `window_start`.
- ~~`validateTypingBlock` + `validateTargetBlock`~~.
- ~~TypeScript declarations~~ — `types/typing.d.ts`, `types/version.d.ts`.
- Still open: current-session filtering, deletion, and export behavior.

**Exit gate met:** a typing window round-trips through the aggregator and the
validator (`validateEmotionEvent(window) === []`); all suites green; emotion
pipeline untouched.

### Phase 2 — typing analytics in 3.1 — **partly done**

- ~~Implement the pure typing aggregator~~ — `src/aggregation/TypingAggregator.js`
  + `tests/typing-aggregator.test.js`.
- ~~Implement the DOM composer adapter~~ — `src/capture/TypingComposerAdapter.js`
  + `tests/typing-adapter.test.js`.
- ~~Handle IME, grapheme segmentation, submit, abandon, teardown~~. Visibility is
  handled as a deliberate no-op (the pause buckets already represent it;
  finalizing is the host's call).
- ~~Settings, subpath exports, types, `docs/TYPING.md`~~ — `typing_enabled`
  defaults off, same as every other modality, for cost/opt-in reasons.
- **Open:** wire into `EmotionRuntime` (no runtime auto-wiring yet — the host
  drives the adapter directly); Rohy / ChatOyon / `oyon/app-element` integration;
  current-session typing analytics and the §6.1 alignment question; browser
  matrix (§4.7) — only Node-level tests exist so far.

**Exit gate:** correct reference cases, clean session transitions,
desktop-browser parity. *Reference cases done; session transitions and browser
parity outstanding.*

### Phase 3 — voice prototype in 3.2

- Implement the voice-turn lifecycle and the activation gate (§5.1).
- Implement the AudioWorklet + Worker split (§5.2).
- Integrate pinned Silero VAD, including state threading across chunks.
- Integrate pitchy and the existing FFT with a Hann window.
- Implement the initial aggregator and quality profile.
- Exclude AI playback; tear down microphone tracks deterministically.

**Exit gate:** prototype benchmark report, including performance with the
camera pipelines running concurrently.

### Phase 4 — voice production hardening

- Tune VAD and quality thresholds; implement the degraded mode.
- Validate pitch and spectral output.
- Add insufficient-data and contamination handling.
- Complete desktop-browser tests and current-session voice analytics.
- Complete host integration, `docs/VOICE.md`, migration, and release
  packaging.

**Exit gate:** held-out benchmark, performance report, licenses, and an
operational runbook.

### Phase 5 — group analytics in hosts

- Build educator-authorized aggregation in Rohy/ChatOyon.
- Add task/device/language/quality stratification.
- Add small-group distributions and timelines.
- Add export with provenance and uncertainty.
- Conduct usability and interpretation testing.

**Exit gate:** users interpret measurements as descriptive behavior rather
than cognitive or emotional truth.

## 9. Effort and cost

### 9.1 Dependency and operating cost

| Item | License/API cost | Runtime cost |
|---|---:|---:|
| `src/analytics/fft.js` | €0 | Client CPU — already in tree |
| `pitchy` | €0 | Client CPU |
| Silero VAD | €0 | Client CPU |
| `onnxruntime-web` | €0 | Already used by Oyon |
| AudioWorklet + Worker | €0 | Browser-native |
| Server API calls | €0 third-party fees | Existing host infrastructure |

No per-minute vendor charges. Model delivery is a few megabytes and
browser-cacheable. Signal windows are a few kilobytes each; typing windows
carrying an interval array are somewhat larger and still small.

### 9.2 Baseline

Estimates below are calibrated to this repository's demonstrated delivery,
not to a generic team:

| Commit | Content | Result |
|---|---|---|
| `b57849a` | facial signals + body posture + rPPG heart rate | 27 files, +3,625 lines incl. 5 test suites and 3 docs |
| `20c77f1` | respiration + illumination | 18 files, +1,462 lines |
| `51a12b4` | gaze aggregator + runtime + docs | 16 files, +1,892 lines |

Five sensing pipelines landed across two days. The full v3 platform — 68
source modules, 61 test suites, a 16k-line React app — was built between
2026-05-08 and 2026-07-24.

Typing is *easier* than any camera modality already shipped: no model, no
frames, no inference, no resampling.

### 9.3 Typing — 6–10 days

| Work | Days | Status |
|---|---:|---|
| Schema extension + `*_only` fix (§3) | 1–2 | done |
| `TypingAggregator` + DOM adapter + IME/visibility/teardown | 2–3 | done |
| Host adapters + embed surface + app UI | 1–2 | open |
| Tests + `docs/TYPING.md` | 2–3 | Node done; browser matrix open |

### 9.3b Event log + interaction + AI-assist — 7–11 days

Added 2026-07-24. This is the layer that makes the capture usable for TNA and
sequence analysis; it is genuinely new scope, not a refinement of the above.

| Work | Days |
|---|---:|
| `signal_events` store, event envelope, `sequence_index`, batching transport | 2–3 |
| `typing-v2` — state labels + positional deltas + caret/selection | 1–2 |
| `interaction` modality — sampled pointer, click, scroll, selection, AOI join | 2–3 |
| `ai_assist` modality + host emission contract | 1 |
| `toLongFormat()` export + TNA round-trip test against the existing machinery | 1–2 |

### 9.4 Voice — 12–18 days

| Work | Days |
|---|---:|
| Worker + AudioWorklet plumbing (first of its kind in this repo) | 2–3 |
| Silero integration incl. state threading + asset pipeline wiring | 2–3 |
| Pitch + spectral features (reusing `src/analytics/`) | 2–3 |
| `VoiceTurnAggregator` + quality/uncertainty | 2–3 |
| AI-playback exclusion + contamination detection | 1–2 |
| Browser matrix, concurrent-camera performance, docs | 3–4 |

### 9.5 Validation corpus — 5–15 days

Annotation labor, not engineering: labeled speech/pause boundaries, VAD F1,
boundary error, octave-error rate. This dominates the voice programme and is
the one line item that should not be compressed.

### 9.6 External-quote benchmark

Retained for the case where this work is ever contracted out. It describes a
different delivery model from the one in use and should not be read as an
internal plan.

| Scope | Hours | At €80/hour | At €120/hour |
|---|---:|---:|---:|
| 3.1 typing | 48–80 | €3,840–€6,400 | €5,760–€9,600 |
| 3.2 voice | 96–144 | €7,680–€11,520 | €11,520–€17,280 |
| Validation corpus | 40–120 | €3,200–€9,600 | €4,800–€14,400 |

### 9.7 Maintenance

- First three months: ~1–2 engineer days per month.
- Stable: ~0.5–1 engineer day per month.
- Annual or major-browser/model review: ~one week.
- Recalibrate after significant host audio-path, microphone-processing, or
  interaction changes.

The major cost is validation and quality control, not dependency weight.

## 10. Release acceptance criteria

### 10.1 Shared

- Current session only in embedded Oyon.
- Server-authoritative identity and role.
- Transport-shape validation with explicit bounds, units, and ranges.
- Clean teardown on stop, unmount, navigation, and session replacement.
- Documented schemas, units, settings, and provenance.
- Desktop Chrome, Firefox, and Safari support.
- All 61 existing test suites green; emotion pipeline untouched.

### 10.2 Oyon 3.1

- Correct grapheme counts for reference inputs.
- Correct IME and composition handling.
- Correct submit and abandon behavior.
- No page-wide keyboard listeners.
- Pause/burst definitions explicit, reproducible, and recomputable from the
  retained interval series.

### 10.3 Oyon 3.2

- **No microphone access before host enablement *and* a user voice action.**
- No analysis outside an authorized voice turn.
- Microphone track stops immediately at turn end; verified by teardown test.
- AI playback excluded or explicitly marked contaminated.
- VAD, pitch, and spectrum meet the frozen benchmark criteria.
- Low-quality input produces uncertainty/insufficient-data states rather than
  confident values.
- **CPU, memory, and dropped-frame behavior documented and acceptable with the
  camera pipelines running concurrently** on target desktop hardware.

## 11. Primary risks and mitigations

| Risk | Mitigation |
|---|---|
| **Main-thread contention with camera pipelines** | Voice runs in a Worker; concurrent-load benchmark is a release gate |
| ONNX cannot load in AudioWorklet | AudioWorklet does framing only (§5.2) |
| Silero LSTM state mishandled across chunks | Cross-chunk-boundary tests, not single-chunk tests |
| AI audio counted as learner speech | Host playback intervals, echo cancellation, contamination detection |
| AGC destroys loudness comparability | Request AGC off when Oyon owns the stream; otherwise mark contaminated |
| Microphone continues listening | Off by default, host enablement, explicit turn state, stop tracks, teardown tests |
| VAD underperforms in classroom noise | Energy-based degraded mode bounded by push-to-talk (§5.10) |
| Cross-device comparisons misleading | Quality metadata, stratification, within-person emphasis |
| Pitch errors under noise | Confidence filtering, minimum coverage, held-out validation |
| Signal schema breaks emotion clients | Additive `modality` field; v3 stays in the supported list |
| `*_only` validator gap breaks HTTP hosts | **Fixed 2026-07-24** (§3.2); `modality` field removes the class |
| Model/license drift | Pin versions, checksums, licenses, source commits |
| Episode windows don't fit fixed-cadence timelines | Resolve §6.1 before Phase 2 UI work |
| **AI-inserted text counted as human typing** | `source: 'user'\|'ai'` on every event; `ai_assist` stream is a host obligation (§4.10) |
| **State vocabulary drifts, breaking cross-study comparability** | Closed, versioned vocabularies (`typing-states-v1` etc.); adding a state bumps the version |
| **Event log volume degrades the session** | Pointer movement sampled not per-`mousemove`; log batched separately from windows (§3.6) |
| Sequence order corrupted by clock skew | `sequence_index`, not wall-clock, defines order; `monotonic_ms` for timing (§3.6) |
| "SOTA" asserted without evidence | Publish benchmarks, definitions, limitations, uncertainty |

## 12. Decision log

- Typing is assigned to Oyon 3.1; voice to Oyon 3.2.
- iPhone/mobile validation is deferred.
- **Oyon records the signal it produces. Typing retains raw inter-event
  timing; voice retains per-frame feature series. Summaries are derived from
  the series, not replacements for them.**
- **Consent is obtained by the researcher outside the application. Oyon does
  not implement consent, does not gate signal for privacy reasons, and its
  validator is a transport-shape check.**
- **The microphone ships off, requires host enablement, and requires a
  deliberate per-turn user action. This is an activation gate on hardware
  access, not a gate on recorded data.**
- Oyon does not duplicate the message text — the host already stores it.
- **Raw audio is not stored. Oyon stores analytics: the per-frame feature
  series and the derived turn summary. Audio belongs to the host.**
- Typing and voice extend the existing window envelope via a `modality`
  discriminator; no parallel pipeline.
- **Complete per-event logs ship alongside windows** (`signal_events`, §3.6).
  Aggregate windows cannot support TNA, process mining, or lag-sequential
  analysis; the window is a convenience over the log, never a replacement.
- **Every event carries a discrete `state` from a closed, versioned per-modality
  vocabulary**, plus `sequence_index` and `source` — so transition matrices are
  comparable across sessions and human vs. AI authorship is separable.
- **CoAuthor is the parity target** for writing-process capture (§3.6).
  Oyon matches its event granularity and its human/AI distinction; it does not
  carry text deltas, so replay is positional rather than verbatim (§12.1).
- **Three modalities, not one.** `typing` (composer), `interaction` (pointer,
  click, scroll, selection — page-wide, AOI-resolved), `ai_assist` (host-fed
  suggestion cycle).
- The voice runtime is Silero ONNX + `pitchy` + the in-house
  `src/analytics/fft.js`, executed in a Worker, reusing `onnxruntime-web`.
- npm `fft.js` is not added; the in-tree FFT is used.
- Essentia.js is not included under its current AGPL license.
- Advanced voice-quality measurements are deferred until separately validated.
- Authentication, grouping, and cross-student comparison remain in
  Rohy/ChatOyon.
- Embedded Oyon remains current-session-only.

### 12.1 Open decisions

1. **Vocabulary scope.** Does §1.1's reporting-language rule bind only typing
   and voice, or the whole product — including the existing `focus_score`,
   `EngagementAggregator`, and Attention screen?
2. **EU AI Act Art. 5(1)(f).** If this is a live concern, it bears on the
   existing emotion pipeline more than on these two modalities. Decide
   whether it is in scope for v3.x.
3. **Interval-array bound.** What maximum array length triggers an episode
   split (§4.4)?
4. **Verbatim replay.** §4.8 gives positional replay — where and when every
   edit happened, not what was written. CoAuthor parity would require carrying
   text deltas, duplicating what Rohy already stores. Decide whether replay of
   the words themselves is a requirement, or whether a host-side join against
   the stored text is sufficient.
5. **Pointer sampling rate.** §4.9 samples rather than logging every
   `mousemove`. What rate — and is it fixed, or adaptive to movement speed?

## 13. Research references

### Browser input and timing

- [Input Events Level 2](https://www.w3.org/TR/input-events-2/)
- [UI Events](https://www.w3.org/TR/uievents/)
- [MDN: beforeinput](https://developer.mozilla.org/en-US/docs/Web/API/Element/beforeinput_event)
- [MDN: performance.now](https://developer.mozilla.org/en-US/docs/Web/API/Performance/now)
- [MDN: Intl.Segmenter](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter)
- [Unicode Text Segmentation](https://unicode.org/reports/tr29/)

### Typing-process validity

- [Understanding the keystroke log: effect of writing task](https://link.springer.com/article/10.1007/s11145-019-09953-8)
- [Writing-process measurement scoping review](https://www.jowr.org/jowr/article/view/1318)
- [ETS research on pause distributions](https://www.ets.org/research/policy_research_reports/publications/report/2012/jgrd.html)

### Human-AI co-writing capture (the §3.6 parity target)

- [CoAuthor — Stanford HCI](https://coauthor.stanford.edu/) — 1,445 sessions,
  63 writers, keystroke-level logs across ~13 event types / 17 fields,
  fine-grained enough for exact replay
- [Visual representation of co-authorship with GPT-3 (EDM 2023)](https://educationaldatamining.org/EDM2023/proceedings/2023.EDM-long-papers.16/)
  — learning-analytics work built on CoAuthor
- [Ink and Algorithm: Temporal Dynamics in Human-AI Collaborative Writing](https://arxiv.org/pdf/2406.14885)

### Voice processing

- [Silero VAD](https://github.com/snakers4/silero-vad)
- [ONNX Runtime Web](https://onnxruntime.ai/docs/get-started/with-javascript/web.html)
- [MDN: AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet)
- [MDN: AudioWorkletGlobalScope](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletGlobalScope)
- [Media Capture and Streams](https://w3c.github.io/mediacapture-main/getusermedia.html)
- [eGeMAPS paper](https://doi.org/10.1109/TAFFC.2015.2457417)
- [Essentia licensing](https://essentia.upf.edu/licensing_information.html)
- [openSMILE licensing](https://audeering.github.io/opensmile/about.html)
- [devAIce modules](https://www.audeering.com/products/devaice/)
- [sherpa-onnx capabilities](https://k2-fsa.github.io/sherpa/onnx/c-api/html/index.html)

### Internal references

- `CLAUDE.md` — authoritative data policy
- `docs/EMBEDDING.md` — the live host integration surface
- `docs/HEART_RATE.md`, `docs/RESPIRATION.md` — per-modality doc pattern
- `NOTICE.md`, `docs/COMPATIBILITY.md` — third-party license posture
- `src/analytics/HeartRateEstimator.js` — reusable DSP helpers
