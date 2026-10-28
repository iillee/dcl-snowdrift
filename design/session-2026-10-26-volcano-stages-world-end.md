# Session 2026-10-26 - staged volcano, world end, overview, first-load fix

> **Status 2026-10-28:** snapshot of the classic volcano ruleset (3 monuments, volcano beams / thaw wave, hidden campfires). The current build runs `RULESET = 'floating-crystals'` (6 monuments charged by player-built fires, oasis, World Thaws ending); see [`../docs/HANDOFF.md`](../docs/HANDOFF.md). Where this note and the code disagree, the code wins.


Branch `cinematic`, on top of e608161.

- **Cinematic camera:** one continuous crane move with precomputed terrain clearance (CINE_CRANE_SAMPLES 160, CINE_CRANE_LIFT_WIN 10) and a spring-smoothed look target that ignores the obelisk bob (CINE_LOOK_OMEGA 5, CINE_LOOK_SKY_LIFT_M / CINE_LOOK_LAND_LIFT_M). beam.wav softened: BEAM_SFX_VOLUME 0.45, BEAM_SFX_FADE_IN_S 0.8.
- **Staged volcano** (`src/shared/volcanoStages.ts`): stations 1/2/3 give thaw + heat radius 40 / 80 / 260 m; each wave starts THAW_STAGE_START_DELAY_S = 12.5 s after activation. Lava covers 40% / 72% / 100% of the lake and brightens; smoke ramps per stage. Debug: DEBUG_THAW_BUTTON, DEBUG_VOLCANO_STAGE_OVERRIDE (both off).
- **Lava torch relight:** from stage 1 a torch can be relit at the lava (LAVA_RELIGHT_REACH_M); lava is also a wake point for frozen players.
- **World end** (`src/server/worldFlame.ts`): the world ends when no campfire and no torch is lit for 4 s. Lava does NOT count (Luke). Disabled after victory (stage 3) and post-win days; frozen players no longer drive it.
- **Isometric overview:** cliff auto-rotate (occlusion ray vs 16 m cells every 0.25 s, turn 90 deg to a clear yaw after 0.4 s blocked, 2 s hold), flag ISO_AUTO_ROTATE_ENABLED; key 4 rotates by hand. Zoom now uses pixelwars' steps: desktop 7 / 29 / 60 (opens at 29), mobile 5 / 15 / 25 (opens at closest), lens widens up to 80 deg past the bounds/ceiling clamp. Pan, snap-back and the off-screen avatar hint kept.
- **Monument gem look** built but disabled (GEM_ENABLED = false); obelisks stay matte black.
- **First-load fix:** the cold-open min hold started at module load, so it often elapsed behind the explorer loading screen and the hearth card + Day 1 card were never seen. Now the hold starts at first UI render, also waits for the avatar, then holds COLD_OPEN_READY_HOLD_MS 1.5 s; the day card waits SPLASH_AFTER_COVER_MS 0.6 s after uncover.
