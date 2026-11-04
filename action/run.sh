#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "::error::$1"
  exit 1
}

needs_human() {
  echo "result=needs-human" >>"$GITHUB_OUTPUT"
  fail "$1"
}

if [ "$GITHUB_EVENT_NAME" != push ] && [ "$GITHUB_EVENT_NAME" != workflow_dispatch ]; then
  fail "regen must run on push or workflow_dispatch, not $GITHUB_EVENT_NAME."
fi

if [ "$(git symbolic-ref -q HEAD)" != "refs/heads/$BRANCH" ] ||
  [ "$(git rev-parse --is-shallow-repository)" = true ]; then
  fail "regen needs the branch checked out with full history. Set ref to the branch and fetch-depth: 0 on actions/checkout."
fi

(cd "$GITHUB_ACTION_PATH" && npm ci && npm run build)

git config user.name >/dev/null || git config user.name "github-actions[bot]"
git config user.email >/dev/null ||
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

before=$(git rev-parse HEAD)
status=0
node "$GITHUB_ACTION_PATH/dist/cli.js" merge "origin/$BASE" || status=$?

if [ "$status" -ne 0 ]; then
  if git rev-parse -q --verify MERGE_HEAD >/dev/null; then
    git merge --abort
  fi
  if [ "$status" -eq 1 ]; then
    needs_human "regen stopped on a source conflict or a failed command. The merge was aborted and nothing was pushed. See the log above, then run regen merge origin/$BASE locally."
  fi
  needs_human "regen could not merge origin/$BASE (usage, config or Git error). Nothing was pushed. See the log above."
fi

if [ "$(git rev-parse HEAD)" = "$before" ]; then
  echo "result=up-to-date" >>"$GITHUB_OUTPUT"
  exit 0
fi

if ! git push origin "HEAD:refs/heads/$BRANCH"; then
  needs_human "regen merged origin/$BASE but the push was rejected. The branch may have moved or the token may lack contents: write. See the log above."
fi
echo "result=resolved" >>"$GITHUB_OUTPUT"
