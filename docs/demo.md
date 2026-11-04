# Demo

`npm run demo` runs the real built CLI against a throwaway repo. The fake project builds `locales.lock` from `locales/*.json`. The lock starts with a hash of its contents, so any two branches that add a string conflict there, and neither side's copy is correct after a merge.

This is real output of `demo/run.sh`, with its `ok:` check lines removed:

```text
=== Two parallel branches each add a string, so both rebuild locales.lock
hash 69ca0d38
checkout.pay = Pay now
search.empty = No results
search.go = Search

=== Plain git merge: conflict in a file nobody wrote by hand
$ git merge add-checkout-total
Auto-merging locales.lock
CONFLICT (content): Merge conflict in locales.lock
Automatic merge failed; fix conflicts and then commit the result.
$ git merge --abort

=== regen merge: rebuilds the file and finishes the merge
$ regen merge add-checkout-total
regen: running node build-locales.js
regen: merge complete
hash afc1bd6c
checkout.pay = Pay now
checkout.total = Total
search.empty = No results
search.go = Search

=== Source conflict: both branches reword the same string
$ regen merge reword-short
Source conflicts need you:
  locales/checkout.json

Fix and `git add` them, then run `regen merge --continue`.
$ regen status
generated  locales.lock
source     locales/checkout.json

=== A human picks the wording, then regen finishes
$ git add locales/checkout.json
$ regen merge --continue
regen: running node build-locales.js
regen: merge complete
hash 00ab69d0
checkout.pay = Buy
search.go = Search

=== Done: every step behaved
```

The script exits nonzero if any step misbehaves, and deletes its temp dir on exit.

`demo/stack.sh` tells the same story for three stacked branches, using `regen rebase main --update-refs`.
