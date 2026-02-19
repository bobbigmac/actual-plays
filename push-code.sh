#!/usr/bin/env bash
# Push main to both remotes (keeps code in sync; leaves cache/pages branches to each repo’s Actions).

set -euo pipefail

REMOTE_A="${1:-origin}"
REMOTE_B="${2:-podcasts}"
BRANCH="${3:-main}"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "error: not in a git repo" >&2; exit 1; }
git remote get-url "$REMOTE_A" >/dev/null 2>&1 || { echo "error: remote '$REMOTE_A' not found" >&2; exit 1; }
git remote get-url "$REMOTE_B" >/dev/null 2>&1 || { echo "error: remote '$REMOTE_B' not found" >&2; exit 1; }
git show-ref --verify --quiet "refs/heads/$BRANCH" || { echo "error: local branch '$BRANCH' not found" >&2; exit 1; }

echo "+ git push \"$REMOTE_A\" \"$BRANCH\""
git push "$REMOTE_A" "$BRANCH"
echo "+ git push \"$REMOTE_B\" \"$BRANCH\""
git push "$REMOTE_B" "$BRANCH"

