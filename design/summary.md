# Snow Drift — the plain-English version

*A 5-minute read of what we decided today. If anything here reads wrong, tell me — that's what we'll fix.*

---

## What it is

Snow Drift is a shared-world winter survival game for Decentraland. Everyone in the scene is in the same frozen world at the same time, on the same in-game day. Twice per real 24 hours, at fixed times, a storm called the equinox rolls in and tries to kill the fire that keeps everyone alive. The whole game hangs on a single central hearth: keep it fed, or the world resets to day one.

The one-line pitch we locked:

> **Melt the snow to find wood. Feed the fire to survive the night. Twice a real day the equinox tests whether "together" was enough.**

---

## How a session actually plays

You spawn cold, next to a lit central fire. Other people (if any are online) are standing around it. Above your view: a day counter, a countdown to the next night, and a shared wood-quota bar.

You grab a torch from a pile at the hearth and step out. The torch's warmth **melts the snow beneath you as you walk** — and under the snow, you can see wood chunks starting to glow. You pick up a log. You bring it back to the fire. The quota bar ticks. The fire brightens.

That's the whole verb: **warm the ground to see what's there, bring it back, feed the fire.**

When night falls, cold accelerates. Everyone huddles at the hearth, feeding logs to keep the flame alive until dawn. If enough wood was banked, the fire holds; the day counter ticks up; the sun rises. If not, the fire dies. If the fire dies and no one's around to save it, the world sits **dead** until the next player logs in — that player sees a splash saying *"the world was lost on Day 47"* and spawns into a fresh Day 1.

Every real 24 hours, twice, the equinox hits at scheduled real-world times (target 08:00 and 20:00 UTC). The storm is much longer, much colder, and much harder to survive. Survive it and the world enters a brief "grace" state where nights get easier for a couple of days, before the cold ramp resumes.

---

## Why you'd come back

Two reasons, and they layer:

1. **The equinox is on a clock.** You know the storm hits at 20:00 UTC. You want to be there when it does — for the defense, and for the story of whether the world lived through it.

2. **The world has a high score.** The hearth shows *"Best: Day 62 · Current: Day 34"*. Every day the community keeps the fire alive climbs the number. Beat the record and things unlock — new territory, better torches. When the world dies, everything unlocked is lost with it. The number is a **coordination artifact**: it climbs because someone was tending during your night, and you were tending during theirs.

The emergent behavior we're designing for: **players naturally forming shifts**. You log off with the fire well-fed and a Discord message: *"fire has 8 minutes, anyone coming online?"* Someone logs in as you leave. The record climbs not because any one player was there for it — but because the community rotated through it.

---

## What's actually shipping in v1 (4 weeks)

- The full survival quota loop: gather wood by day, feed the fire, survive the night, day-count ticks up.
- Two equinox events per real day at scheduled times.
- Persistent world day-count and high-score record, both visible on the hearth.
- World reset triggered by the next player to return after the fire dies with the server empty.
- **One territory unlock at Day 10** — a satellite pit NE of the hearth thaws, opening new ground for wood.
- **One tool unlock at Day 30** — torch fuel duration +30%.
- **Block redesign + level visual development** — an art pass on the core props (hearth, torch, wood, satellite pit) and an environment-layout tuning pass, lifting the world from greybox to a cohesive winter-survival look.
- Discord integration for equinox announcements, milestone posts, and world-reset notices.

Live at `snowdrift.dcl.eth` by Week 6.

---

## What we deliberately cut from v1

To keep the loop tight and give ourselves real time to *make sure it's fun*, we cut three things:

1. **The lore / story fragment system.** The world's backstory (astral premise — the planet knocked from its orbit) is written into the design as context, but v1 has no findable journal pages, no story reveals as you climb the day count. That's the v1.5 headline feature.

2. **Named survivor plaques on the hearth.** No engraved names for players who were present when the record was set. The shift-recognition happens through Discord instead.

3. **All unlocks past Day 30.** No Day 20 SW pit, no Day 75 melt-radius torch upgrade, no Day 100 aurora. If the game hits its numbers, these come back in v1.5.

The v2 aspiration — the *"melt"* win condition where the community activates ancient tech and the planet's orbit corrects, snow melts, grass and flowers bloom — is set up in v1's premise but not playable. The doc names it as the v2 headline.

---

## What I need you to sanity-check while reading

Two specific things I wrote where I inferred more than you told me. If anything's off, this is where to catch it:

- **The world's 2-sentence backstory in §7 of the GDD.** The premise content (astral, wrong orbit, tech under snow) is yours. My sentence-shape is a guess. Rewrite it in your own voice if the tone's off.
- **The two "what didn't fit" cells in §8's comparables table (GONE Fishing and Snowpunks).** I inferred what wouldn't work about each game based on your one-line descriptions. If I got the wrong thing, tell me.

Everything else in the GDD is either yours or something we walked through together and you signed off on.

---

## What I'm still unsure about (worth talking through)

- **Solo equinox difficulty.** We said it's "very hard, not impossible" solo. In practice this needs playtest — if 1 player at Day 10 during an equinox is straight-up unwinnable, the retention math breaks. Might need a solo-scale mercy on the first equinox.
- **Real-world equinox timestamps.** 08:00 + 20:00 UTC is my recommendation — it hits Europe/Africa well and gives the US a late-evening slot. But you might want to shift them to match when you and your Discord actually play.
- **The Day 10 unlock timing.** It's aggressive — at 1-2 concurrent players, day 10 is a real climb. If Week 2 playtest says people never see the unlock in a session, we push it down to Day 5 or 7.

---

That's the whole game in five minutes. The GDD has the reviewer-formatted version with all the tables and the audit. This doc is the version I'd tell a friend at a bar.

Sleep on it. Tomorrow we clean it up and get it submission-ready.
