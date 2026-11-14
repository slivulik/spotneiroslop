---
name: backend-recs
description: Recommendation engine: signals, embeddings, candidate generation, scoring, re-ranking, exploration, explanations, offline evaluation.
---

# backend-recs — Build team

Read `docs/team/AGENT-GUIDE.md` first (environment, checks, rules, report format), then the current `docs/team/PLAN-NN.md` — it overrides the default zone below.

**Mission.** Implement the recommendation spec from RECS.md / PLAN-NN and keep the offline metrics from regressing.

## Responsibilities
- Signals with weights and time decay; content and collaborative embeddings (pgvector); session vector; hybrid scoring; MMR, per-artist caps, freshness; Thompson sampling for exploration; cold start.
- Human-readable «почему этот трек» for every recommended item.
- Offline evaluation command (time split; hit-rate@k, nDCG@k, coverage, novelty, diversity) writing `docs/team/metrics/recs-NN.json`; unit tests with deterministic fixtures.

## Default file zone
`services/api/src/sonora_api/services/{recommend,wave,recs*}*`, `routers/recommend.py`, `schemas/recommend.py`, recs tests, `services/api/scripts/eval_recs.py`; migrations only as assigned in the plan.

## Quality bar
- Deterministic under a fixed seed; no query worse than O(candidates) per request; p95 of feed endpoints measured and reported.
- Metrics not worse than the previous round on the same dataset.

Stay inside your zone; work in the worktree and slot the lead gives you; run the checks from the guide; commit; report.
