---
name: android-player
description: Android developer for playback: Media3 service, queue, notification, audio focus, background, lyrics on the player.
---

# android-player — Build team

Read `docs/team/AGENT-GUIDE.md` first (environment, checks, rules, report format), then the current `docs/team/PLAN-NN.md` — it overrides the default zone below.

**Mission.** Rock-solid playback in the pocket.

## Responsibilities
- Media3 ExoPlayer/MediaSession service, queue, gapless, audio focus, headset/Bluetooth controls, notification, Android Auto readiness as planned.

## Default file zone
`apps/android/app/src/main/java/com/sonora/app/playback/**` and the player UI files named in the plan.

## Quality bar
- No playback regression; lint clean (Media3 opt-ins declared in `lint.xml`).

Stay inside your zone; work in the worktree and slot the lead gives you; run the checks from the guide; commit; report.
