#!/usr/bin/env bash
# Demo: regen resolves conflicts in a generated file and stops on a real source conflict.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

step "Two parallel branches each add a string, so both rebuild locales.lock"
git checkout -qb add-checkout-total
commit_locale checkout '{ "checkout.pay": "Pay now", "checkout.total": "Total" }' "add checkout.total"
git checkout -qb add-search-empty main
commit_locale search '{ "search.go": "Search", "search.empty": "No results" }' "add search.empty"
cat locales.lock

step "Plain git merge: conflict in a file nobody wrote by hand"
run 1 git merge add-checkout-total
check "plain git left conflict markers in locales.lock" grep -q '<<<<<<<' locales.lock
run 0 git merge --abort

step "regen merge: rebuilds the file and finishes the merge"
run 0 regen merge add-checkout-total
cat locales.lock
check "merge commit created" git rev-parse -q --verify HEAD^2
check "locales.lock has the first string" grep -q "checkout.total" locales.lock
check "locales.lock has the second string" grep -q "search.empty" locales.lock
check "locales.lock matches a fresh build" lock_fresh
check "working tree clean" clean

step "Source conflict: both branches reword the same string"
git checkout -qb reword-short main
commit_locale checkout '{ "checkout.pay": "Pay" }' "shorten checkout.pay"
git checkout -qb reword-buy main
commit_locale checkout '{ "checkout.pay": "Buy now" }' "reword checkout.pay"
run 1 regen merge reword-short
run 0 regen status
check "merge left in progress" git rev-parse -q --verify MERGE_HEAD
check "the source conflict is left for you" grep -q '<<<<<<<' locales/checkout.json

step "A human picks the wording, then regen finishes"
printf '%s\n' '{ "checkout.pay": "Buy" }' >locales/checkout.json
run 0 git add locales/checkout.json
run 0 regen merge --continue
cat locales.lock
check "merge commit created" git rev-parse -q --verify HEAD^2
check "locales.lock has the chosen wording" grep -q 'checkout.pay = Buy$' locales.lock
check "locales.lock matches a fresh build" lock_fresh
check "working tree clean" clean

step "Done: every step behaved"
