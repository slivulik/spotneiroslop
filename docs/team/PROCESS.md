# Sonora — process of rounds (Denis, 12 Nov 2026)

Goal: up to 50 rounds; every round the site and the app must be fresher, better and more interesting.
The project is not "done" while any detail (design, animation, tech, recommendations) is unpolished.

## One round
1. **Ideas**: the idea generator + recommendation scientist update IDEAS.md / RECS.md from the previous review.
2. **Build team** (5–8 agents, strict file ownership, own worktrees): backend, recs, web (2–3 by area), Android (1–2), design polish.
3. **Handover to the review team** (fresh agents that did not write the code): QA of every feature against
   the code and CI, design critic (Android renders, web screens), tech reviewer (security, performance, types),
   product critic. Output: REVIEW-NN.md with bugs (must-fix), polish items, and new ideas.
4. **Fix pass** for must-fix items, then CI green on GitHub (tests, typecheck, lint, APK, screenshots).
5. Commit round to `team/v2`, update ROUNDS.md log. The next round starts from REVIEW-NN.md.

## Rules
- A round lands only with CI green; progress is never lost between rounds.
- Lines of code are not a goal; quality, depth and polish are.
- Mandatory backlog: «Мэтч» swipe feed (right = like, left = not interested), best-in-class recommendations.
