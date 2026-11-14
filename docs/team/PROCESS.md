# Sonora — process of rounds

Source of truth for the goal and the bars: `docs/team/KICKOFF.md` (Denis). Working rules for every
agent: `docs/team/AGENT-GUIDE.md`. Role definitions: `.claude/agents/*.md`.
Up to 50 rounds; every round the site and the app must be visibly fresher, better and more interesting.

## One round (NN = two digits)
1. **Ideas** — idea-generator, competitor-researcher, ux-researcher, recs-scientist start from
   `REVIEW-(NN-1).md` → `IDEAS-NN.md` (+ `RECS.md`). The lead picks the scope.
2. **Plan** — architect → `PLAN-NN.md`: contracts, migrations, file zone per role, merge order.
3. **Build** — each role in its own worktree `../wt/rNN-<role>` on branch `round-NN/<role>`
   (`tools/dev/worktree.sh add NN <role>`), with a private stack slot (`tools/dev/stack.sh`).
   Every agent runs the tests and linters of its zone and commits. Nobody pushes.
4. **Merge** — the lead merges the role branches into `team/v2` in the plan's order, regenerates
   OpenAPI + the TS client, runs `make check`, the e2e flows and the Android build.
5. **Handoff** — `HANDOFF-NN.md`: what changed and how to verify every feature.
6. **Review** — fresh agents (qa-web, qa-android, qa-api, design-critic, motion-critic, tech-reviewer,
   security-auditor, perf-auditor, recs-evaluator, product-critic) check ALL features, write
   `review-NN/<role>.md`; the lead assembles `REVIEW-NN.md` (bugs critical/important/minor, design
   and motion roughness, tech debt, new ideas).
7. **Fix** — all critical and important items are fixed and re-checked by a reviewer.
8. **Gate** — the round closes only when: GitHub CI is green (tests, types, linters, APK, renders);
   recommendation metrics are not worse than last round (`docs/team/metrics/recs-NN.json`);
   the product critic confirms on before/after screenshots that it got fresher and better.
9. **Close** — `ROUNDS.md` entry, `CHANGELOG.md`, commit, push, tag `round-NN`, report to Denis.

The lead scales the team to the round: every role exists, but only the roles the round's scope
needs are started, and independent ones run in parallel.

## Rules
- A round lands only with CI green; progress is never lost between rounds.
- Lines of code are not a goal; quality, depth and polish are.
- Ask Denis only before the irreversible: deleting data, force-push, deploying to his server, spending money.
- Mandatory backlog: «Мэтч» swipe feed and best-in-class recommendations (`RECS.md`).
