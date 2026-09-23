# Hypothesis Log — Cryocene

Generated index. Owner is never asked to hand-maintain this.

**Legend:** *(active)* = current design depends on this claim; *(retired)* = the claim's context no longer applies (design evolved past it); *(historical)* = kept for archaeology, not blocking.

---

## H1 — active hypotheses (current design)

| ID | Claim | Source | IF / THEN | Cheapest killing test | Status | Mobile-sensitive |
|---|---|---|---|---|---|---|
| H1-01 | The melt-to-reveal-wood verb stays fun at repetition 10 — variability from other players, shifting seasonal pressure, procgen geography, and territory decisions keeps the same verbs feeling different. | §3 Core Loop, Pillars 2 + 4 | IF three players play ten full day-cycles in a row on a single seed THEN each cycle produces a story they can name (a rescue, a close call, a redistribution), not "same again" | 45-min greybox session with three testers, ask each to describe cycles 1, 5 and 10 unprompted | untested | yes |
| H1-02 | Program 5/10 rule holds: 80% of first-time players perform the first useful action within 5 sec and can state the immediate goal within 10 sec. | §2 First Minutes | IF five first-time testers spawn cold into the scene THEN 4 of 5 pick up a torch or step out of the ring within 5s AND 4 of 5 can say "I need to find wood" within 10s | 15-min greybox test with 5 people who have never seen the scene | untested | yes |
| H1-06 | 8 concurrent players hold 30 fps on mid-tier Android during a nighttime scene with heavy snowfall and active hearth particles across the 100×100 parcel scene envelope. | §5 population / §6 mobile / §3 Scale | IF 8 test devices connect to the live scene at night with HEAVY weather THEN each device reports ≥ 30 fps median over a 3-minute sample | Phase 2 playtest with 8 devices, DCL mobile client, Pixel 6a or equivalent reference device | untested | yes |

## H2 — active hypotheses (persistent-civ model, added 2026-09-22)

| ID | Claim | Source | IF / THEN | Cheapest killing test | Status | Mobile-sensitive |
|---|---|---|---|---|---|---|
| H2-01 | Personal *"while you were gone"* return-screens produce D1 pull. Returning players open the game specifically to see what changed while they were offline. | §0.1 Decision A, §4 Hook 1 | IF returning players are asked *"what did you want to see when you logged in?"* THEN a plurality name the return-screen or civilization state, not a scheduled event | Post-session interview with 5 returning testers after Phase 2 build, once return-screen ships | untested | no |
| H2-02 | Procgen recombination of biomes + discoveries produces meaningfully different player strategies across seeds. Three different seeds do not play the same. | §3 Scale, Pillars 4 + 9 | IF three testers each play a fresh session on three different seeds THEN their session-recap answers to *"what were you doing?"* describe distinct plans (different first target, different corridor, different capability priority) | 30-min sessions with the same tester on 3 seeds back-to-back, Phase 2 playtest | untested | no |
| H2-03 | The charcoal-portability loop creates real expedition play. Players deliberately convert deadwood to charcoal for long trips, not just because it exists. | §0.1 Decision C, §4 Kiln | IF a tester with Kiln access is asked *"why did you bring charcoal on that trip?"* THEN they answer in terms of reach/fuel-budget, not tutorial prompting | Post-expedition interview, Phase 2 playtest with charcoal live | untested | no |
| H2-04 | The fire-survives model produces memorable exile/migration/reclaim stories at least once per multi-session civilization. | §0.1 Decision B, Pillar 6 | IF ten multi-session civilizations are observed THEN at least three of them produce a hearth-death-with-satellite-survival event that players describe as a distinct beat in their recap | Live-scene analytics + Discord scraping after ~2 weeks of open play | untested | no |
| H2-05 | Ancient Station foreshadow discoveries produce curiosity behavior. Players who find one investigate it and mention it to others without prompting. | §3 Reveal table, §7 v2 hook | IF a tester encounters an Ancient Station during a session THEN they (a) approach and try to interact and (b) mention it unprompted to another player or in a session recap | Phase 3 playtest, seed-forced Ancient Station spawn | untested | no |
| H2-06 | The harsh-lifespan model rewards dedicated communities without punishing casual players. Casual dropins can enjoy a single-session experience even if the civilization dies overnight before their next login. | §0.1 Decision A, Pillar 7 | IF returning players are surveyed after a mid-run civilization death THEN a majority describe the return as "curious about the new world" rather than "annoyed the old one is gone" | Discord survey after ~1 month of open play with multiple civilization death cycles | untested | no |
| H2-07 | Data-driven content pools let a new biome or discovery be added in ≤ 1 day of authoring work, not code work. | §9 Phase 1, Pillar 10 | IF the design team adds a new discovery type post-v1 by writing a data entry + an asset THEN the entry appears in generated seeds without core-system changes | Internal v1.1 spike: add a stub 3rd discovery, measure lines of code changed | untested | no |
| H2-08 | Solo (1 player) can meet baseline survival (hearth alive through normal nights) with the current wood-scatter density, tree-mining mechanic, and torch fuel budget. | §5 quiet-hours / §3 core loop | IF a solo tester plays 3 consecutive in-game days on a fresh seed THEN they keep the hearth alive on at least 2 of 3 nights without emergency wood-runs after dusk | Phase 2 playtest, single tester, 30-min session | untested | yes |

---

## Retired hypotheses

Retained for archaeology. Not blocking. Superseded by the persistent-civ + fire-survives + geography-as-tech-tree design.

| ID | Original claim | Retired because |
|---|---|---|
| H1-03 | Progressive community unlocks + persistent high-score day count drive D1+ retention. Players return because there's a record to beat and unseen territory beyond it. | §4.2 day-count-unlock table superseded 2026-09-22 by geography-as-tech-tree. Capabilities come from *reaching biomes/discoveries*, not from surviving X days. Day-count records remain as history, not as unlock gates. D1 pull is now carried by the persistent-civ return-screen (H2-01) and the scheduled solstice within the current civilization. |
| H1-04 | The scheduled real-world solstice produces measurable log-in spikes at those timestamps. | §0.1 Decision A resolved 2026-09-22 to persistent shared-world roguelike. Solstice is now scheduled by *in-game day number* within the current civilization, not by real-world timestamp. The real-world-solstice retention mechanic is retired. |
| H1-05 | Lore drip-fed via day-count unlocks creates a "read more" pull that survives fatigue with the mechanical loop. | Same reason as H1-03. Lore in v1 is scoped to the Ancient Station foreshadow discovery + Day 100 fragment; drip-feed via day-count is retired. Curiosity pull is now the Ancient Station itself (H2-05) and the deeper v1.5 lore layer. |
| H1-07 | Solo player can hit the daily wood quota during normal days with current wood-scatter density and torch fuel budget. | Quota mechanic retired 2026-09-11 in favor of multi-fire territory. Solo-survivability hypothesis reframed as H2-08 (baseline hearth-tending on a fresh seed) — same intent, current mechanics. |

---

*One line about the marker you'll see next in your document: `[HYPOTHESIS]` = a claim about how it will feel or play that only a playtest can settle. Every one gets a row here. It's a bookmark, not a black mark — a reviewer never sees `[HYPOTHESIS]` in the submitted doc; before submission it either becomes design-intent voice ("the intended payoff") or an honest `TBD:` if it was asserting evidence.*
