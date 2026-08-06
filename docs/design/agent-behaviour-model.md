# Supporting-agent behaviour model

**Status:** design proposal. Sections 1–3 describe what rohy does today;
sections 4 onward are unbuilt and specified here so they can be argued
with before they are written.

A rohy case has one main virtual agent — the patient — and may have any
number of *supporting* agents: a bedside nurse, an on-call consultant, a
family member, a debrief tutor. This document is about the supporting
ones: what makes them pedagogically different from each other, which of
those differences rohy can currently express, and what has to be built
for the rest.

---

## 1. Four axes, not three patterns

The scenarios people propose ("an unaware nurse who arrives late", "a
helpful nurse who is already there", "an anxious relative who gets in
the way") read like three kinds of agent. They are not. They are points
in a space with four independent axes, and treating them as named
presets is what makes the space feel small.

| Axis | The question it answers | Today |
|---|---|---|
| **Availability** | *When* can the learner reach them? | ✅ built |
| **Knowledge** | *What* do they know? | ⚠️ static tier only |
| **Stance** | What do they *do* with what they know? | ❌ absent |
| **Initiative** | Do they speak *unprompted*? | ❌ absent |

The axes are worth naming because they compose. A delayed agent who
arrives holding a *wrong* preconception is availability + stance, and it
is arguably a sharper instrument than any of the three named scenarios:
the learner must both hand off well *and* hold their ground against a
confident colleague who is wrong. Nobody proposes that scenario when
thinking in presets. It falls out of the grid for free.

---

## 2. What is already built

### Availability — complete

`case_agents` carries the whole vocabulary, and
`AgentService.isAgentAvailable()` / `getAgentDisplayStatus()` enforce it:

| Column | Meaning |
|---|---|
| `availability_type` | `present` (in the room) · `on-call` (must be paged) · `absent` (not in this case) |
| `available_from_minute` | Not reachable until N minutes into the session |
| `depart_at_minute` | Leaves at minute N |
| `response_time_min`/`max` | Minutes between paging and arrival (0 = instant) |

Paging goes through `POST /sessions/:id/agents/:type/page`, which stamps
a server-anchored `arrives_at` so a refresh or a room switch cannot
strand the countdown.

**Arrival is instant by default** as of migration 0042. Every seeded
persona ships `response_time 0/0`, and a delay is something a case
author opts into. See §7 for the history — the previous default made
"instant" literally unreachable, and it is worth reading before anyone
proposes reintroducing a floor.

### Knowledge — half built

`agent_templates.context_filter` picks how much of the case file the
agent is given: `full` · `history` · `vitals` · `minimal`. A second
control, `memory_access`, gates the patient-record narrative by verb
(`OBTAINED`, `EXAMINED`, `ELICITED`, `ORDERED`, …).

Both are chosen by the **author**, and both read from the **case
record**. That distinction is the whole of §4.

### Stance and initiative — absent

No agent has a disposition beyond whatever its `system_prompt` says in
prose, and no agent ever speaks without being spoken to. Every turn is
reactive.

---

## 3. Scenario 2 (helpful nurse) is already authorable

Set the nurse to `availability_type: 'present'`, `context_filter:
'full'`, `response_time 0/0`. That is the seeded Sarah Mitchell, today,
with no code change. If the goal is an entry-level case where an
experienced nurse orients the learner, that is an authoring exercise —
write the persona, attach it, publish.

Worth stating plainly so nobody budgets engineering for it.

---

## 4. The missing primitive: `briefed` knowledge

Everything interesting about a *delayed, unaware* agent depends on one
thing that does not exist.

Today an agent's situational knowledge comes from
`buildDebriefingContext()`, which assembles the case record filtered by
the author's `context_filter` tier. So a nurse configured as "arrives at
minute 5, knows nothing" still arrives knowing whatever the author let
her know. The handoff the learner performs is theatre: they can say
"she's crashing, help" and receive a fully briefed, competent colleague.
Nothing reads what they said. Nothing can be wrong because of what they
left out.

### Proposal

Add a **knowledge source** alongside the existing tier:

```
knowledge_source:  'case'      -- today's behaviour: read the record
                 | 'briefed'   -- read ONLY the learner's handoff
                 | 'hybrid'    -- role-plausible baseline + handoff
```

- **`case`** — unchanged. The default. Existing agents keep working.
- **`briefed`** — the agent's context block is assembled from the
  learner's own turns in this conversation, plus a role-plausible
  baseline of what anyone in that role would know on walking in (the
  patient exists, they are in a bed, their name and age). Nothing else.
  Vitals, history, orders, results: absent unless the learner said them.
- **`hybrid`** — for the doctor called to a ward: knows the ward and
  that a patient deteriorated, not the specifics.

`context_filter` keeps its current meaning and applies *after* the
source: it bounds what a `case`-sourced agent may see, and is inert for
a `briefed` one.

### Why this is the load-bearing item

It is where the pedagogy lives. An agent acting on an incomplete handoff
and **visibly getting it wrong** — asking for the allergy the learner
never mentioned, drawing the wrong conclusion from a vital they were not
given — teaches more than any post-hoc rubric, and it does so in the
moment, from the learner's own omission. It is also the natural input to
a handoff-quality measure in the debrief, which is the assessment payload
the "unaware agent" scenario is really after.

### Shape

- Migration: `agent_templates.knowledge_source TEXT DEFAULT 'case'`
  (nullable, additive; NULL reads as `'case'`).
- `buildDebriefingContext()` branches on the source before it touches
  the record.
- A new prompt block making the ignorance explicit and non-negotiable,
  because a model handed a thin context will cheerfully invent a rich
  one. It must sit next to `roleAnchor()` and be as blunt: *you know
  only what appears below; if you were not told something, you do not
  know it; ask rather than assume.*
- The handoff transcript needs marking as such, so the assembler can
  tell "what the learner told this agent" from the whole conversation.

**Estimated effort:** medium. The migration and branch are small; the
prompt engineering to stop a model back-filling plausible clinical
detail is the real work, and it needs evaluation against a small model
(voice mode uses one) before it can be trusted.

---

## 5. Stance

Once knowledge is separable from behaviour, stance is a small addition:

```
stance:  'supportive'   -- helps, defers, answers straight
       | 'neutral'      -- answers what is asked, volunteers nothing
       | 'obstructive'  -- emotionally demanding, derails, needs managing
       | 'misleading'   -- confidently offers a WRONG reading
```

`misleading` earns its own value rather than being left to prose,
because it needs a structured input — *which* wrong interpretation, so
the case author controls the error rather than the model improvising
one. Something like `config.misleading_claim`, seeded per case.

Two guardrails, both non-optional:

1. A misleading agent must be **visibly labelled to the educator** in
   the case editor and in analytics. A learner who is graded down for
   following bad advice they had no way to identify as bad is being
   punished for the simulation's design.
2. The debrief must know. `misleading` agents belong in the debrief
   context unconditionally, so the tutor can name what happened.

**Estimated effort:** small, *after* §4. On its own it is prose in a
system prompt and not worth a schema change.

---

## 6. Initiative — and why the distractor does not work without it

Every agent is strictly turn-based. There is no path by which an agent
emits a message the learner did not solicit. A family member who only
speaks when spoken to cannot distract anybody; ignoring them is free,
which is the opposite of the intended lesson.

Related: `case_agents.auto_arrive_minute` is stored, is editable through
the API, and **is read by no runtime code**. It is the natural hook for
this and is currently dead.

Making it real needs three things rohy does not have:

- A scheduler that can decide an agent should speak now (timer-based to
  start: "interject every N minutes while present").
- A delivery path for unsolicited agent messages into a room the learner
  may not be looking at — this is a notification-router question, not a
  chat question, and the existing six-surface notification centre is the
  right owner.
- Cross-agent state effects, for "each intervention raises the patient's
  anxiety". Nothing today lets one agent's turn alter another agent's
  state.

**Estimated effort:** large, and the largest genuine unknown is not the
scheduler but the interruption UX. An agent that talks over a learner
mid-consultation is a very easy thing to make infuriating rather than
instructive. Prototype the interruption before building the scheduler.

---

## 7. The learner-role gap

One proposed scenario — *nurse student pages a doctor, and cannot order
labs or perform exams themselves* — needs something that does not exist
anywhere in rohy: **the learner's in-simulation role**.

`users.role` is a platform permission (`guest` 0, `student` 1,
`reviewer` 2, `educator` 3, `admin` 4). It governs who may edit a case,
not who the learner is playing. Nothing gates the lab, radiology, or
examination rooms on a clinical role, because until now every learner
has been the physician.

This is the largest item in the whole set, and it is the one that
changes what rohy *is* — from a physician simulator to a
multi-professional one. Sketch:

- `cases.learner_role TEXT DEFAULT 'physician'` (`physician` · `nurse` ·
  `paramedic` · `student_observer`).
- A capability map per role — who may order, examine, prescribe,
  discharge — enforced **server-side** on the order/exam/radiology
  routes, not merely hidden in the UI.
- The affected rooms render a scoped state, not a 403. "You need a
  doctor's order for this" is the teaching moment; a permission error is
  a bug report.
- `roleAnchor()` already tells the agent who *it* is; it must also learn
  who the *learner* is, or a nurse-student case has consultants
  addressing them as "doctor".

**Estimated effort:** large. Budget it as its own project. It should not
ride along as a rider on a nurse persona, and it is worth doing on its
own merits regardless of which agent scenarios ship.

---

## 8. Scenarios mapped onto the axes

| Scenario | Availability | Knowledge | Stance | Initiative | Blocked on |
|---|---|---|---|---|---|
| 1A · unaware nurse called in | `on-call`, delay N | **`briefed`** | supportive | — | §4 |
| 1B · unaware doctor, nurse learner | `on-call`, delay N | **`briefed`** | supportive | — | §4 + §7 |
| 2 · helpful bedside nurse | `present`, instant | `case`/`full` | supportive | — | **nothing — authorable today** |
| 3 · anxious family member | `present`, instant | `case`/`history` | **obstructive** | **proactive** | §5 + §6 |
| — · wrong-headed colleague | any | `case` | **misleading** | — | §5 |

Suggested order: **§4 first** — it unblocks both 1A and 1B, it is the
one with real pedagogical content, and it is medium rather than large.
§5 is cheap once §4 lands. §7 is a project. §6 is a project with a UX
risk that should be prototyped before it is scheduled.

---

## 9. Appendix: the arrival-delay incident

Recorded because it is the reason §2 says "instant by default", and
because the failure mode is a general one worth recognising again.

Before v2.9.19 the page handler computed:

```js
minSec = Math.max(60, Math.min(180, configuredMinSec || 60));
maxSec = Math.max(minSec, Math.min(180, configuredMaxSec || 180));
```

Both lines are wrong in the same way. `configuredMinSec || 60` treats a
configured **0 as absent**, because 0 is falsy — so an author asking for
"instant" was silently given one minute; and `Math.max(60, …)` floors it
there again even if the first defect were repaired. The ceiling line
turns a configured max of 0 into 180 by the same mechanism.

The net effect is worth stating precisely, because it is funnier and
worse than a plain "the delay was too long": **`0/0` — the setting that
asks for no wait at all — produced a uniform random 60–180 second wait,
the widest band the system could generate.** Configuring instant was
strictly worse than configuring 1–2 minutes. The seeded consultant's
`2/5` produced 120–180s, so every default case spent up to three minutes
of a training session on a progress bar.

Compounding it, on the client `currentAgent` was read from the `agents`
array — fetched once per session, never written again — while the paging
flow updated a separate `agentStates` map. So `agentStatus`, which gates
the countdown, the Call button *and* the composer's `disabled`, never
moved. Pressing "Call Dr. Chen" changed nothing on screen; pressing it
again re-stamped the ETA and pushed the arrival further away; and when
the agent did arrive the tab dot went green next to a chat box that
still refused input. The only escape was leaving the room and returning,
which remounted the component and refetched the list.

Three things generalise:

- **`||` is not a default operator for numeric settings.** It is a
  falsy-check, and `0` is the value most likely to be meaningful and
  most likely to be swallowed. Use `??`, or an explicit `=== undefined`.
- **A clamp that cannot be configured away is not a clamp, it is a
  policy** — and it should be justified where it is written. The comment
  above this code claimed a nurse configured for "instant" would be
  honoured. It never was. Nobody checked the comment against the code.
- **Two copies of the same state will diverge.** The fix was not to keep
  `agents` fresh but to stop reading status from it at all: one live
  overlay, one source of truth. There had also been a second, unused
  client-side `calculateWaitTime()` returning *minutes* where the server
  returns *seconds*, with its own passing unit tests — green tests
  around dead code, while the live path was broken.

The endpoint now has coverage in `tests/server/agent-page-wait.test.js`
and the client contract in
`src/components/chat/ChatInterface.paging.test.jsx`. Both were confirmed
to fail against the pre-fix code before being committed.
