# The Greybox — Building the Least That Could Kill It

Greybox here means: primitives and text, one colour per meaning, no models, no menus, no persistence,
no polish. The build is an instrument, not a deliverable. It is finished when the criterion can be
measured — not when it looks like the game.

## Order of work

1. **Instrument the metric first.** Before the mechanic, make the number visible. A build that works
   but cannot be measured has to be rebuilt anyway, and always under time pressure.
2. **The verb under test, real.** Input path, timing, collision, camera, feedback on the action.
3. **Everything else, faked.** In the crudest form that lets a tester keep playing.
4. **Dry-run the criterion yourself.** Reach both verdicts on paper with what exists. If you cannot
   fail, you cannot test.

## Instrumentation, cheapest first

At playtest scale — an owner self-test at v0, a handful of testers at v1 — **a human with a
stopwatch beats telemetry**. Do not build analytics for a sample this size.

- an observer with a timer and the session block open;
- on-screen debug text: the counter, the current state, elapsed time;
- console log lines with timestamps, read afterwards;
- screenshots at the moment of interest, especially for mobile legibility questions;
- a screen recording when the metric is "where did they get stuck".

Whatever the instrument, it must produce the number named in the Brief, in a form you can paste into a
session block the same minute.

## Where the mechanics come from

**Never write SDK7 API from memory.** Two sources, in this order:

- **`sdk-skills`** — the official skill set, `npx skills add decentraland/sdk-skills --all` (add `-g`
  for user level). Composite-first rules and the component reference live there, and parts of the API
  are newer than any model's training data.
- **[`sdk7-test-scenes`](https://github.com/decentraland/sdk7-test-scenes)** — the greybox mechanics
  catalog. Small single-mechanic scenes named by parcel coordinate: trigger areas,
  tweens and moving platforms, proximity interactions, pointer-event feedback, modifier areas, input
  modifiers, move-player-to, particles, UI, avatar emotes, an authoritative-server leaderboard. **Grep
  the folder before writing a mechanic from scratch** — an experiment that starts from a working
  reference scene starts a day earlier.

[`sdk7-goerli-plaza`](https://github.com/decentraland/sdk7-goerli-plaza) is the quality bar *above*
greybox. It is the right reference when the prototype graduates toward a slice, and the wrong one for
an experiment — reaching for it in phase 2 is how a two-day test becomes a two-week build.

Background, when the owner is new to the SDK:
[SDK 101](https://docs.decentraland.org/creator/scenes-sdk7/getting-started/sdk-101) ·
[vibe-coding docs](https://docs.decentraland.org/creator/scenes-sdk7/getting-started/vibe-coding).

## What gets faked, concretely

| Thing | Fake |
|---|---|
| progression, unlocks | a number printed on screen, set by hand |
| economy, rewards | arithmetic in the brief; a debug button that grants |
| other players | a second client window, or a scripted entity that moves |
| art, characters, environment | primitives; colour carries meaning |
| audio | one sound on the verb under test if the feel depends on it, otherwise silence |
| onboarding, menus, settings | the task read aloud to the tester |
| persistence, save state | none — restart between sessions is fine and often better |

Audio is the frequent exception worth naming: if the hypothesis is about *feel*, the feedback sound is
part of the verb, not decoration.

## Timebox

The brief said what would be built. When hour four starts producing things the brief never named,
stop and cut — never widen the experiment. If the scope was genuinely wrong, that is a return to the
Brief with the reason written down, not a quiet extension.

Signs the build is drifting: adding a second mechanic "while we're here", replacing a primitive with a
model, building a menu to reach the test, tuning something the criterion does not measure.

## The scene is evidence

Keep it in the scene repo, named after the experiment ID (`H1-02-pop-feel/` or a branch of the same
name), so a verdict can be re-checked and a re-test on a higher rung starts from the same build. Note
where it lives in `## Sessions`. Screenshots, recordings and raw notes go in the stage folder next to
the experiment file — the contract says intermediate files park there.
