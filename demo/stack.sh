#!/usr/bin/env bash
# Demo: main moves under three stacked branches, and one regen rebase fixes all of them.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

step "Three stacked branches, each rebuilding locales.lock"
git checkout -qb stack-1
commit_locale checkout '{ "checkout.pay": "Pay now", "checkout.total": "Total" }' "add checkout.total"
git checkout -qb stack-2
commit_locale search '{ "search.go": "Search", "search.empty": "No results" }' "add search.empty"
git checkout -qb stack-3
commit_locale profile '{ "profile.name": "Name" }' "add profile.name"
cat locales.lock

step "main moves, and it touches locales.lock too"
git checkout -q main
commit_locale home '{ "home.title": "Welcome" }' "add home.title"
cat locales.lock

step "regen rebase from the top of the stack"
git checkout -q stack-3
run 0 regen rebase main --update-refs
check "rebase finished" test ! -d "$(git rev-parse --git-path rebase-merge)"

step "Every branch moved onto main, with a fresh locales.lock"
below=main
for branch in stack-1 stack-2 stack-3; do
  git checkout -q "$branch"
  echo "--- $branch"
  cat locales.lock
  check "$branch is on top of $below" git merge-base --is-ancestor "$below" "$branch"
  check "$branch has main's string" grep -q 'home.title' locales.lock
  check "$branch locales.lock matches a fresh build" lock_fresh
  check "$branch working tree clean" clean
  below=$branch
done

step "Done: every step behaved"
