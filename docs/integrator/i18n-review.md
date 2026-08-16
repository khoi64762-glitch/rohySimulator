# Translation review (XLIFF)

How UI strings travel from the English catalogues to a native reviewer and
back — without touching the shape of `src/locales/<lang>/*.json` and without
a spreadsheet. This is the maintainer + reviewer companion to
[Languages & multilingual cases](/educator/languages).

## The pieces

| Path | Role | Committed? |
|---|---|---|
| `src/locales/en/<ns>.json` | Canonical English, one flat `key → string` per namespace | yes |
| `src/locales/<lang>/<ns>.json` | Target catalogues, same shape (unchanged by this pipeline's data model) | yes |
| `src/locales/.status/<lang>.json` | Per-string review status (see below) | **yes** |
| `src/locales/.en-hashes.json` | Delta sidecar of `npm run i18n:translate` (machine translation) | no (gitignored) |
| `i18n/xliff/<lang>/rohy-<lang>-<YYYYMMDD>.xlf` | Hand-off files for reviewers | no (gitignored — transient) |
| `scripts/i18n-glossary.json` | Pinned clinical renderings per language | yes |

### The status model

`src/locales/.status/<lang>.json` is a sorted, 2-space JSON object keyed by
`<namespace>.<key>`:

```json
"orders.give_dose": {
  "src": "f914c04d377f",
  "state": "reviewed",
  "reviewed_at": "2026-08-16T09:12:00.000Z",
  "reviewer": "M. Rossi",
  "risk": "clinical"
}
```

- `src` — `sha256(english value)[:12]`, the same hash `translate-locales.mjs`
  records. When English changes, the stored hash no longer matches and the
  string is **stale** regardless of its state.
- `state` — `machine` (LLM-translated, never seen by a human), `reviewed`
  (a native reviewer accepted or rewrote it), `approved` (signed off), `new`
  (reserved; not written by the tools today).
- `risk` — `clinical` for the namespaces where a wrong word can change a
  dose or a diagnosis (`orders`, `treatments`, `monitor`, `investigations`,
  `examination`, `patient`, `chat`, `authoring_meds`, `authoring_labs`,
  `authoring_exam`, `authoring_radiology`, `authoring_scenarios`), `low` for
  the rest. Per-key overrides in the file survive regeneration.

The initial bootstrap marked every existing translation `machine` — that is
honest: they were produced by `i18n:translate` and no human has signed them.

Every script accepts `--root=<dir>` (or `ROHY_LOCALES_ROOT`) to operate on
another locale tree; the tests use it so they never write the real
catalogues.

## The four steps

### 1. English changes (developer)

Add or edit strings in code, then `npm run i18n:extract` / `npm run
i18n:pseudo` / `npm run i18n:translate` as usual. Machine translations land
in the target JSON; nothing else changes.

### 2. See what needs a human — `npm run i18n:status`

```bash
npm run i18n:status                # every language, one table each
npm run i18n:status -- it de       # subset
npm run i18n:status -- --json      # machine-readable
npm run i18n:status -- --check     # exit 1 if any CLINICAL key is new or stale
npm run i18n:status -- --bootstrap # add missing status entries as `machine` (idempotent)
```

Per key the report says:

| Class | Meaning |
|---|---|
| `new` | In English, missing from the target |
| `stale` | Target exists but English changed since it was last translated/reviewed (`src` mismatch) |
| `machine` | Up to date, machine-translated, not yet reviewed (also: a key with no status entry yet) |
| `reviewed` / `approved` | Up to date and signed by a human |
| `removed` | A status entry whose key no longer exists in English — reported here, pruned by the next export/import |

`--check` is an **opt-in release gate**: it fails while any clinical string
is `new` or `stale`. It is deliberately not part of `npm run i18n:check`
(which stays the "every `t()` has a catalogue entry" gate); wire it into a
release checklist or CI job when a language is declared clinically
reviewed.

### 3. Export an XLIFF for the reviewer — `npm run i18n:xliff:export`

```bash
npm run i18n:xliff:export -- it                          # everything not yet reviewed/approved
npm run i18n:xliff:export -- it --only=new,stale         # narrower
npm run i18n:xliff:export -- it --ns=orders,treatments   # some namespaces
npm run i18n:xliff:export -- it --out=/tmp/it.xlf --date=20260816
```

Writes `i18n/xliff/<lang>/rohy-<lang>-<YYYYMMDD>.xlf` — XLIFF 1.2, one
`<file original="<ns>.json">` per namespace, one `<trans-unit>` per key.
`--only` defaults to `new,stale,machine`, so an export is **incremental by
construction**: reviewers only see what nobody has signed. Every unit carries
`<note from="rohy">risk=…; icu=…; src=…</note>` and, for ICU messages, an
`icu-args=` note listing the placeholders that must survive. The
`<header>` repeats the pinned glossary for the language.

Status → XLIFF target state:

| Status class | `<target state>` | `approved` |
|---|---|---|
| `new` | `new` (empty target) | `no` |
| `stale` | `needs-review-translation` (existing target shown) | `no` |
| `machine` | `needs-review-translation` | `no` |
| `reviewed` | `translated` | `no` |
| `approved` | `signed-off` | `yes` |

**For the reviewer:** open the `.xlf` in any CAT tool (or an editor). Fill
empty targets, correct the ones marked `needs-review-translation`, and set
the state to `translated` when you are satisfied or `signed-off` when it is
final. Do not touch `<source>`, the `id`/`resname`, or the `<note from="rohy">`
lines. Keep every `{placeholder}` and every ICU keyword (`plural`, `one`,
`other`, `#`, `select`) exactly as in the source — the importer rejects a
unit that drops or renames one.

### 4. Import the reviewed file — `npm run i18n:xliff:import`

```bash
npm run i18n:xliff:import -- i18n/xliff/it/rohy-it-20260816.xlf --reviewer="M. Rossi"
npm run i18n:xliff:import -- file.xlf --dry-run   # validate + report, write nothing
```

For every unit the importer:

1. Locates `<ns>.<key>`; skips (with a message) keys that left English or
   whose `src=` hash no longer matches — the English moved on, re-export.
2. Validates: target non-empty (unless still `new`), `{braces}` balanced,
   ICU compiles, ICU argument set equals the English one, and every glossary
   term present in the English is rendered as pinned — a **failure** on
   `clinical` keys, a warning on `low` ones. Rendering checks tolerate
   inflection at the end of a word (paziente/pazienti,
   somministrare/somministrato).
3. Writes the value into `src/locales/<lang>/<ns>.json` (sorted keys,
   2-space, trailing newline — the file's existing convention) and updates
   the status entry (`translated → reviewed`, `signed-off`/`approved="yes"
   → approved`, `needs-review-translation` with changed text → `reviewed`,
   unchanged → keep), `reviewed_at`, `reviewer`, `src`.

It prints a per-namespace table (imported / updated / skipped / violations /
warnings) and **exits 1 on any hard violation without writing anything** —
fix the XLIFF and re-run. Then run `npm test` (the locale-integrity suite
re-checks ICU/key parity) and commit the JSON + `.status` diff together.

## Phase 2 (not built)

ICU messages are exported as plain text: reviewers see
`{count, plural, one {# patient} other {# patients}}` verbatim and the
importer only guards it. A later phase can split plural/select branches into
XLIFF `<group>`s or use XLIFF 2.0 inline markup so tools present them as
segments; the status model already carries what that needs (`src`, `risk`,
per-key state), and `review/approval` workflows, a `stale` flag persisted
in the file, and per-key clinical risk classification are the intended
next fields.
