# regen

Stop hand-resolving merge conflicts in files nobody wrote by hand.

> **Status:** early development. Nothing is published to npm yet. Everything below works from a local build.

Lockfiles, translation output, and generated clients conflict all the time, especially across parallel or stacked PRs. The fix is almost always the same: pick either side, rerun the generator, commit the result.

`regen` does that for you, and stops the moment a real source file conflicts.

## How it works

Tell `regen` which files are generated and what produces them:

```yaml
# regen.yml
generated:
  - files: [pnpm-lock.yaml]
    run: pnpm install --lockfile-only
  - files: [i18n.lock, locales/**/*.json]
    run: pnpm i18n:build
```

Then merge or rebase through it:

```bash
regen merge main
regen rebase main
regen rebase main --update-refs
```

`--update-refs` moves every branch in a stack along with the one you're on, except branches checked out in another worktree, and rebase reruns the generators at each conflicting commit, so no commit in the stack keeps a broken file.

| What conflicts | What `regen` does |
|---|---|
| Only generated files | Reruns their commands, stages the output, and continues |
| Any source file | Stops and leaves that conflict for you to resolve |
| A command fails | Stops and shows you the error |
| A command changes files outside the rules | Stops and lists them |

When `regen` stops, the merge or rebase stays in progress. Fix the problem, then run `regen merge --continue` or `regen rebase --continue`. That reruns every rule, because your fix may have made any generated file stale.

Generated files must be fully rebuildable from source. `regen` starts from one side's copy, so a command that doesn't rewrite the file will silently keep that side.

`regen` only runs commands when something conflicts. If a merge has no conflicts, Git's result stands, even if the generated file is out of date, so keep your CI check for that.

`regen` refuses to start with uncommitted changes to tracked files, because generators would build them into the commit. Untracked files aren't checked, so a generator that globs a folder will pick up an untracked file in it.

Exit codes: `0` done, `1` stopped and needs you, `2` usage or Git error.

## Why not a Git merge driver?

A merge driver runs one file at a time, before the merge has finished. A generator running at that point can see a half-merged repo. `regen` wraps the whole operation instead, so generators run once the source files are settled.

## Why not let an agent do it?

An agent can do this, but it may do it differently each time. `regen` follows the same rules every run, needs no model, and works the same on your machine and in CI.

## Safety

`regen` runs commands from a config file, so treat `regen.yml` like any other script in your repo. It reads the committed version from the branch you started on, so a branch you're merging or rebasing onto can't change which commands run. Those commands can still execute code from that branch, such as an updated `package.json` script, so only use `regen` on branches you trust.

## Roadmap

- [x] Config, file matching, and conflict classification
- [x] `regen merge`
- [x] `regen rebase`, including conflicts that repeat through a stack
- [ ] GitHub Action
- [ ] Demo repo and tests

## License

[MIT](LICENSE)
