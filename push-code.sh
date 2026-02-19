#!/usr/bin/env bash
# Push only code branches to both repos (leaves cache/pages branches to each repo's own Actions).

set -euo pipefail

REMOTE_A="${1:-origin}"
REMOTE_B="${2:-podcasts}"

die() {
  echo "error: $*" >&2
  exit 1
}

have_remote() {
  git remote get-url "$1" >/dev/null 2>&1
}

branch_exists_local() {
  git show-ref --verify --quiet "refs/heads/$1"
}

current_branch() {
  git symbolic-ref --quiet --short HEAD 2>/dev/null || true
}

pick_main_branch() {
  if branch_exists_local "main"; then
    echo "main"
    return
  fi
  echo ""
}

is_forbidden_branch() {
  case "$1" in
    "" | "gh-pages" | "pages" | cache | cache-* | cache/* | "cache.branch" | "cache-branch")
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

confirm() {
  local prompt="$1"
  read -r -p "$prompt [y/N] " ans
  case "${ans:-}" in
    y|Y|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

print_plan() {
  echo
  echo "Plan:"
  for cmd in "$@"; do
    echo "  $cmd"
  done
  echo
}

run_plan() {
  local -a cmds=("$@")
  print_plan "${cmds[@]}"
  if ! confirm "Run these git pushes?"; then
    echo "Canceled."
    return 0
  fi
  for cmd in "${cmds[@]}"; do
    echo "+ $cmd"
    eval "$cmd"
  done
}

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  die "not in a git repo"
fi
have_remote "$REMOTE_A" || die "remote '$REMOTE_A' not found"
have_remote "$REMOTE_B" || die "remote '$REMOTE_B' not found (expected your second repo remote)"

MAIN_BRANCH="$(pick_main_branch)"
CUR_BRANCH="$(current_branch)"

if [[ -z "$MAIN_BRANCH" ]]; then
  die "couldn't find a local 'main' branch"
fi

echo "Repo: $(basename "$(git rev-parse --show-toplevel)")"
echo "Remotes: $REMOTE_A, $REMOTE_B"
echo "Main branch: $MAIN_BRANCH"
echo "Current branch: ${CUR_BRANCH:-<detached>}"

echo
echo "Choose:"
echo "  1) Push $MAIN_BRANCH to both remotes (recommended)"
echo "     - Keeps code in sync; leaves cache/pages branches alone."
echo "  2) Push current branch to both remotes"
echo "     - Useful for a feature branch you want on both repos."
echo "  3) Push $MAIN_BRANCH + current branch to both remotes"
echo "  4) Push tags to both remotes"
echo "  5) Push a specific branch to both remotes"
echo "  q) Quit"
echo

read -r -p "> " choice

case "${choice:-}" in
  1)
    run_plan \
      "git push \"$REMOTE_A\" \"$MAIN_BRANCH\"" \
      "git push \"$REMOTE_B\" \"$MAIN_BRANCH\""
    ;;
  2)
    [[ -n "$CUR_BRANCH" ]] || die "detached HEAD; no current branch to push"
    is_forbidden_branch "$CUR_BRANCH" && die "refusing to push forbidden branch '$CUR_BRANCH'"
    run_plan \
      "git push \"$REMOTE_A\" \"$CUR_BRANCH\"" \
      "git push \"$REMOTE_B\" \"$CUR_BRANCH\""
    ;;
  3)
    [[ -n "$CUR_BRANCH" ]] || die "detached HEAD; no current branch to push"
    is_forbidden_branch "$CUR_BRANCH" && die "refusing to push forbidden branch '$CUR_BRANCH'"
    if [[ "$CUR_BRANCH" == "$MAIN_BRANCH" ]]; then
      run_plan \
        "git push \"$REMOTE_A\" \"$MAIN_BRANCH\"" \
        "git push \"$REMOTE_B\" \"$MAIN_BRANCH\""
    else
      run_plan \
        "git push \"$REMOTE_A\" \"$MAIN_BRANCH\"" \
        "git push \"$REMOTE_B\" \"$MAIN_BRANCH\"" \
        "git push \"$REMOTE_A\" \"$CUR_BRANCH\"" \
        "git push \"$REMOTE_B\" \"$CUR_BRANCH\""
    fi
    ;;
  4)
    run_plan \
      "git push \"$REMOTE_A\" --tags" \
      "git push \"$REMOTE_B\" --tags"
    ;;
  5)
    read -r -p "Branch name to push: " b
    b="$(echo "${b:-}" | tr -d '[:space:]')"
    [[ -n "$b" ]] || die "no branch provided"
    is_forbidden_branch "$b" && die "refusing to push forbidden branch '$b'"
    branch_exists_local "$b" || die "no local branch named '$b'"
    run_plan \
      "git push \"$REMOTE_A\" \"$b\"" \
      "git push \"$REMOTE_B\" \"$b\""
    ;;
  q|Q)
    echo "Bye."
    ;;
  *)
    die "unknown choice"
    ;;
esac

