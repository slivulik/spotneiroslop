#!/usr/bin/env bash
# One git worktree per role and round, next to the repository: ../wt/rNN-<role> on branch round-NN/<role>.
#
#   tools/dev/worktree.sh add <round> <role> [base-branch]   create it (dependencies installed from caches)
#   tools/dev/worktree.sh rm  <round> <role>                 remove the worktree (the branch stays)
#   tools/dev/worktree.sh list
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
MAIN="$(git -C "$ROOT" worktree list --porcelain | sed -n '1s/^worktree //p')"
CMD="${1:-list}"
case "$CMD" in
  add)
    NN="$(printf '%02d' "$((10#$2))")"; ROLE="$3"; BASE="${4:-team/v2}"
    DIR="$(dirname "$MAIN")/wt/r$NN-$ROLE"
    BRANCH="round-$NN/$ROLE"
    if [[ ! -d "$DIR" ]]; then
      mkdir -p "$(dirname "$DIR")"
      if git -C "$MAIN" show-ref --verify --quiet "refs/heads/$BRANCH"; then git -C "$MAIN" worktree add -q "$DIR" "$BRANCH"
      else git -C "$MAIN" worktree add -q -b "$BRANCH" "$DIR" "$BASE"; fi
    fi
    export UV_SYSTEM_CERTS=1; unset UV_NATIVE_TLS
    (cd "$DIR" && pnpm install --frozen-lockfile --prefer-offline >/dev/null 2>&1) || echo "pnpm install failed in $DIR" >&2
    for svc in services/api services/media-worker tools/uploader-cli; do
      (cd "$DIR/$svc" && uv sync --frozen -q 2>/dev/null) || echo "uv sync failed in $DIR/$svc" >&2
    done
    echo "$DIR ($BRANCH)" ;;
  rm)
    NN="$(printf '%02d' "$((10#$2))")"; ROLE="$3"
    git -C "$MAIN" worktree remove --force "$(dirname "$MAIN")/wt/r$NN-$ROLE" ;;
  list) git -C "$MAIN" worktree list ;;
  *) sed -n 2,7p "$0"; exit 2 ;;
esac
