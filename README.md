# regen

Stop hand-resolving merge conflicts in files nobody wrote by hand.

> **Status:** early development. Nothing is published yet, so the commands below show the planned interface.

Lockfiles, translation output, and generated clients conflict all the time, especially across parallel or stacked PRs. The fix is almost always the same: pick either side, rerun the generator, commit the result.

`regen` does that for you, and stops the moment a real source file conflicts.

## How it will work

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
```

| What conflicts | What `regen` does |
|---|---|
| Only generated files | Reruns their commands, stages the output, and continues |
| Any source file | Stops and leaves that conflict for you to resolve |
| A command fails | Stops and shows you the error |

## Why not a Git merge driver?

A merge driver runs one file at a time, before the merge has finished. A generator running at that point can see a half-merged repo. `regen` wraps the whole operation instead, so generators run once the source files are settled.

## Why not let an agent do it?

An agent can do this, but it may do it differently each time. `regen` follows the same rules every run, needs no model, and works the same on your machine and in CI.

## Safety

`regen` runs commands from a config file, so treat `regen.yml` like any other script in your repo. It will only run what's configured there, and only in repos where you've set it up.

## Roadmap

- [ ] Config, file matching, and conflict classification
- [ ] `regen merge`
- [ ] `regen rebase`, including conflicts that repeat through a stack
- [ ] GitHub Action
- [ ] Demo repo and tests

## License

[MIT](LICENSE)
