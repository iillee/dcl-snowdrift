# The Hypothesis Log — Interface Contract

This file is the **contract between `dcl-gdd` and `dcl-prototype`**. Both skills read it;
neither may diverge from it unilaterally. `dcl-prototype` references it at
`../dcl-gdd/references/hypothesis-log.md` rather than keeping a second copy.

**The log is not part of the GDD.** The template has no Hypothesis Log section: the log lives as a
separate generated file, `design/hypothesis-log.md`, next to the document. It is **agent
infrastructure** — the owner is never asked to fill it, read it, or submit it, and it never goes
into the submitted GDD (the working markers in `design/gdd.md` are cleaned at submission). It does
travel with the repo the owner submits, but it is **not an application requirement and never a bar
to quote at a creator**: it is how the programme guides a studio it has decided to back, after the
yes. The GDD sells a promise; the log is where that promise becomes checkable later.

## One owner per fact

The single hardest rule here. Every fact lives in exactly one place:

| Fact | Owner |
|---|---|
| Status | the **filename suffix** |
| IF/THEN, source section, cheapest killing test, verdict, dates, `tested on` | the **experiment file** |
| The assembled table | **`design/hypothesis-log.md` — generated, never hand-edited** |

The log file is a *view*. You rebuild it by globbing the stage folders and reading the experiment
files. If you ever find yourself editing a status inside `hypothesis-log.md`, stop — rename the
experiment file instead and regenerate.

## Layout on disk

```
<project folder>/design/            ← the scene repo when there is one; any folder will do
  gdd.md                                  ← source of truth: the document the owner submits
  gdd.html                                ← free-form render, regenerated at gates only
  hypothesis-log.md                       ← generated log index — agent interface, never hand-edited, never submitted
  ideas.md                                ← append-only idea parking lot — dated, attributed, never judged on entry
  decisions.md                            ← append-only decision history: date · decision · why (incl. standing non-goals)
  01-find-the-fun/
    H1-01-core-drop-fun_validated.md
    H1-02-pop-feel_active.md
    playtest-2026-08-12-notes.md          ← intermediate files park here too
  02-core-loop/
    H2-01-session-length_parked.md
  03-vertical-slice/
```

Stage folders **are** the process — there is no `experiments/` level, and folders carry no status
suffix (stage state is derivable from contents, and renaming folders churns git history and links).
Stage folders may hold any intermediate file that acts as memory: playtest notes, screenshots, raw
data.

The `design/` path is agreed with the owner in phase 0 and lives in the **game scene's repo**. Never
hardcode it.

## IDs and filenames

`H<stage>-<nn>-<slug>_<status>.md`

- Numbering is **per stage**, not global — a late find-the-fun experiment inserts as `H1-07` without
  renumbering anything.
- References anywhere (the log table, `design/gdd.md` prose, a handoff message) use the **stable ID**
  `H1-03`, resolved by glob. Renames never break a link.
- **Slugs use hyphens only, never underscores** — the underscore is reserved as the status separator
  and must parse unambiguously.
- **Statuses are resting states only:**

| Status | Meaning |
|---|---|
| `parked` | written down, not started. The state `dcl-gdd` creates. |
| `active` | an experiment is in flight |
| `validated` | the THEN held, **measured** — arithmetic in the doc or agent-instrumented mechanical evidence, at the rung named in `tested on`. Never awarded on an owner-feel self-test. |
| `survived` | terminal for v0: the **kill-check held under an owner self-test**; the criterion was not measured. This is the owner-*feel* outcome — the expected evidence state for a v0 feel claim. `survived` and `failed` are claims of different sizes, not two thresholds of one scale. |
| `failed` | the THEN did not hold. A failure is a result, not a mistake — it stays in the log. |
| `deferred` | consciously skipped. Skipped experiments do **not** vanish. |

Transient states — briefed, built, tested-but-unjudged — live *inside* the file, not in its name.

- Re-testing on a higher rung **appends to the same file**; the ID and folder never move, and
  `tested on` records the new rung.

## Writing a hypothesis worth parking

`dcl-gdd` creates the file at park time. A row is only worth a file if all four exist:

1. **A falsifiable IF/THEN.** *"IF the drop cycle is 45 s, THEN 4 of 5 first-time players complete
   three cycles without being told what to do."* If you cannot describe what failure looks like, it is
   still an assumption, not a hypothesis — keep working on it or write it as `TBD:` instead.
2. **The source section**, so a verdict knows what to go back and rewrite.
3. **The cheapest test that could kill it.** This is the ordering key for the whole log: arithmetic
   in the doc → desktop Explorer (the Creator Hub default; launch ≈ a minute, greybox ≈ 15–30 min) →
   mobile. A hypothesis testable by arithmetic must never survive untested to a vertical slice —
   each rung costs more, so it must answer costlier questions.
4. **One key metric.** One experiment, one number. Two numbers means two hypotheses.

**Not everything parks as a hypothesis.** A raw idea — a mechanic to try someday, a visual style to
see, a mode that might be fun — goes to **`design/ideas.md`**: an append-only bullet list, one line
per idea, never judged on entry, writable by either skill at any moment. The line carries its
provenance — date and author required, a tag only when it is obvious:

```markdown
- 2026-08-26 · <the idea, one line> · (owner|agent) [· tag: §4 / economy / look]
```

Ideas cut for scope — good, but not in this version — park here too, marked as such (`· cut from §9
scope`): a cut idea is future material or a hypothesis candidate, and losing it costs more than one
line. An idea graduates when it earns it: into a **taste decision** written into a section; into a
**look-see** build ("make it visible, the owner judges by eye" — no metric, no criterion, not an
experiment); or into a **hypothesis file**, once it makes a falsifiable claim about players —
annotate the line (`→ H1-04` / `→ §7 decision`). Forcing IF/THEN onto every passing idea is how
owners stop offering ideas.

**Decisions get a history too.** When the owner decides something by taste — a style kept, a
mechanic ruled out — the section holds the *current truth* and **`design/decisions.md`** holds the
one-line history: `date · decision · why`, append-only, newest first. Standing **non-goals**
("never X, because Y") live here as well — they are decisions with no expiry, and they earn their
keep at the comparables and scope steps. Verdict-driven rewrites do *not* duplicate here — their
trail is the Hypothesis Log. Routing when something surfaces mid-work, in either skill: the owner
decided it → `decisions.md` · a maybe → `ideas.md` · unsure → `ideas.md`, and `dcl-gdd`
re-sorts on its next pass.

Mark **mobile-sensitive** hypotheses explicitly — for hobbyist core loops that is most input and
performance claims. The suffix still goes **terminal at the verdict** (`_validated` / `_survived` /
`_failed`) — there is no special filename state for the open mobile rung. Instead the generated
index renders *… — mobile pending* for any file with `Mobile-sensitive: yes` whose `Tested on` says
only `desktop`, for as long as that is true. The mobile check itself costs minutes (the QR pass —
see the ladder) and is offered at core-loop stage close, never forced. The old hard rule — "a
mobile-sensitive hypothesis never reaches `validated` on desktop evidence alone" — is v1+ material,
staged for the future prod family in `Games/prod-staging/`.

## The experiment file

`dcl-gdd` writes only the header block and leaves the rest to `dcl-prototype`:

```markdown
# H1-02 · Pop feel

- **IF/THEN:** IF <the change> THEN <the observable, falsifiable outcome>
- **Source section:** §3 Core Loop — "why repetition 10 differs from repetition 1"
- **Cheapest killing test:** greybox in desktop Explorer, owner self-test, 5 min
- **Key metric:** <one number, with the threshold that counts as failure>
- **Mobile-sensitive:** yes / no
- **Tested on:** —
- **Parked:** 2026-08-07

## Brief
<!-- owned by dcl-prototype -->

## Sessions
<!-- owned by dcl-prototype -->

## Verdict
<!-- owned by dcl-prototype -->
```

Do not pre-fill the `dcl-prototype` sections, not even with placeholders beyond these comments — a
brief written before the experiment is chosen is the "built a toy, not an experiment" failure in its
earliest form.

When `dcl-prototype` closes an experiment, the **first line of `## Verdict` must be
machine-readable**:

```markdown
**Verdict:** validated — 5/6 testers completed 3 cycles unprompted · 2026-08-14 · tested on: desktop
```

(`validated`, `survived` or `failed`, one sentence of why, the date, the rung.) A `survived` verdict
must name **which claim survived** — the kill-check, never the criterion:

```markdown
**Verdict:** survived — kill-check held: <what> (owner self-test) · criterion not measured · <date> · tested on: <rung>
```

The index pulls `verdict / date` from this line; free-form detail goes below it.

### Ownership clarifications (agreed 2026-08-07)

- **`Tested on`** is created by `dcl-gdd` as `—` and **updated by `dcl-prototype`** — the
  rung is only known once testing happens.
- **The source-section rewrite** after a `validated`/`survived`/`failed` verdict is **performed by
  `dcl-prototype`** (it holds the evidence), reporting what changed and where. If the rewrite
  would *contradict* the design rather than refine it, raise the conflict — never rewrite silently.
- **Index regeneration also runs after each verdict write-back**, by `dcl-prototype` — a renamed
  file must not leave the table stale. The Verify-entry rebuild stays as the safety net. This
  applies to the table only: `design/gdd.html` is still re-rendered at gates only.
- **Bare-idea entry:** when nothing is parked, `dcl-prototype` may create **one** experiment file
  per invocation, held to the same four requirements above, and must say aloud that it did. If
  `design/gdd.md` does not exist yet, `Source section` reads `— (backfill via dcl-gdd)` and the
  handoff must point there — the verdict's section-rewrite duty converts into writing the section.

## Regenerating the index

Regeneration is mechanical and cheap, so it runs at every event that changes the table: at gates, on
entry in Verify mode (rebuild before choosing what to test), after each `dcl-prototype` verdict
write-back — and **whenever a hypothesis is parked**, because a new experiment file must appear in
the table immediately (a stale index breaks the honesty rule). It is the `.html`
render, not the table, that stays gates-only. Glob
`design/*/H*_*.md`, read each header block plus the verdict, sort by **cheapest killing test** (the
ladder arithmetic → desktop → mobile; tie-break by stage then number), and rewrite the table in
`design/hypothesis-log.md`:

| Columns |
|---|
| `ID` · `IF/THEN (falsifiable)` · `source section` · `cheapest killing test` · `status` · `verdict / date` · `tested on` |

Then check the two invariants and report any break:

- every `[HYPOTHESIS]` marker in `design/gdd.md` resolves to a row;
- every row's source section still exists and still makes the claim.

A `validated`, `survived` or `failed` verdict is not finished until the **source section in
`design/gdd.md` has been rewritten to state what is now known**. For `survived` the rewrite is scoped
exactly to the kill-check — state it in the indicative mood, and leave the unmeasured criterion in
the section as `[HYPOTHESIS]` with its H-link. That rewrite is the point of the whole loop; the log
is only the bookkeeping.
