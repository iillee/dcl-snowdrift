# Mobile-First

Mobile is **not a port target — it is the primary design target.** Build for touch first and scale the
UI up to desktop, not the other way round. A mechanic that only works with a mouse is a design failure
here, not a porting task for later.

The two runtimes are different programs: Desktop Explorer is Unity-based, Mobile Explorer is
Godot-based. Feature parity is still closing, which produces the tension below.

## The tension, stated plainly

Mobile is the **primary design target**, and checking on it is no longer expensive — the QR pass in
Creator Hub costs minutes (see `dcl-prototype`'s ladder). The program resolves the remaining
tension, and so must the document:

- Mobile feature parity is **not a blocker**. An experience can sign off working fully on desktop *if
  it is designed to work on mobile* once parity lands.
- So every verdict in the Hypothesis Log carries `tested on: desktop / mobile`. A
  **mobile-sensitive** hypothesis still closes with a terminal suffix at its verdict; the index
  renders *… — mobile pending* from `Mobile-sensitive: yes` + `Tested on: desktop` while that is
  true, and the QR pass is offered at core-loop stage close — an honest state, and the one the
  program allows.

For a hobbyist core loop, assume **most input and performance claims are mobile-sensitive** unless
there is a reason they are not.

## Mapping every verb to touch

One row per verb from §3, no exceptions — a verb with no touch row is an unfinished design, and a
missing row fails the mobile-path preflight (P5).

**What dies on a phone:**

- precision aiming, small hit targets, anything needing pixel accuracy;
- hover states, right-click, and any affordance revealed only by pointing at it;
- keyboard combinations, modifier keys, and more than one simultaneous input beyond move + one action;
- moving the camera and acting at the same time;
- reading anything small, and any UI that assumes a wide screen.

**What survives, and what to design toward:**

- large tap targets, generous forgiveness windows, and snapping or assist instead of accuracy;
- one primary action button, contextual rather than modal;
- gestures the platform's own UI already teaches, not invented ones;
- timing over precision — a rhythm window is touch-friendly, a headshot is not;
- state readable at arm's length on a small screen, in one glance.

If a verb's fun *is* the precision, the honest answers are to redesign the verb or to change the
target platform — not to promise an adaptation later. Say that out loud rather than writing "we'll
adapt it".

## Performance

Template targets: **60 fps on recommended desktop hardware and 30 fps on a *named* mobile device and
client, both at the v1 tested maximum from §5** (the program baseline covers up to 20 players). "A
named device" is the honest part — "runs on mobile" with no device named is not a target, it is a
hope. Take the player count from §5's quiet-hours row; if it is still `TBD:`, the performance answer
is too.

The section asks for **one** biggest risk and its plan, not an audit. The usual candidates, roughly in
order of how often they are the actual cause: asset weight (texture and mesh budget, draw calls),
per-frame physics, particle and post effects, and the number of simultaneously animated entities. Pick
the one this design will actually hit — a scene with 200 physics objects and a scene with 4K textures
have completely different plans.

> **Do not quote numeric scene budgets from memory.** Triangle, entity, texture and file-size limits
> are not in this reference on purpose — look them up in the current SDK7 documentation before putting
> a number in the document, and cite where it came from. A wrong budget in a GDD is worse than a
> `TBD:` with a plan to check.

## Desktop-only dependencies

If the design leans on something not yet on mobile, the question is not "does it work" but **"can the
feature switch on later without a redesign?"** A good answer names the feature, the fallback that ships
meanwhile, and the seam where the real version drops in. Check the **Desktop vs Mobile Feature Gap
tracker** — [decentraland/godot-explorer issue 2402](https://github.com/decentraland/godot-explorer/issues/2402),
the same link the template hands the owner in §6 — and the official docs inventory of desktop
features absent on mobile,
<https://docs.decentraland.org/creator/build-for-mobile/mobile-client/missing-features> — rather
than guessing what is missing this month.
If it will not open, the honest output is a `TBD:` with the check as its plan, never a guess dressed
as a fact. Same for the SDK7 budgets above. (The mobile client itself is
[decentraland/godot-explorer](https://github.com/decentraland/godot-explorer); the desktop client is
Unity-based — a feature confirmed on one client says nothing about the other.)

A design whose *core loop* depends on a desktop-only feature with no fallback is not mobile-ready in
any useful sense, whatever the section says.

## UI, small screen first

One or two sentences in the document, but ask for the real thing: what is on screen during the loop,
how much of the screen does it cover, and what happens to the thumb that is holding the phone. Thumb
reach is a layout constraint. Anything essential in a top corner is unreachable one-handed.

## What this section always parks

- "The core verb feels good on touch" — the archetypal mobile-sensitive hypothesis; cannot be settled
  on desktop, and settling it late is how a design gets redone in week 5.
- "The scene holds 30 fps on minimum hardware with 20 players" — expensive, and worth an early cheap
  proxy (asset budget arithmetic) before the real measurement.
- "UI is readable at arm's length" — testable with one screenshot on one phone, so it should never sit
  parked.
