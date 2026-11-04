# GitHub Action

When a branch such as `main` moves, this merges it into every open PR from your repo with `regen merge` and pushes the result. Conflicts in generated files are resolved by rerunning their commands.

## Why it runs on push, not pull_request

GitHub doesn't start `pull_request` workflows while a PR has a merge conflict, so the action would never run on the PRs that need it. A base branch moving doesn't trigger them either, and that's usually what causes the conflict. A `push` to the base branch runs in both cases, so the workflow finds the open PRs itself.

The action only runs on `push` and `workflow_dispatch`. It refuses every other event, including `pull_request` and `pull_request_target`.

## Example

Add `.github/workflows/regen.yml`:

```yaml
name: regen

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: read

jobs:
  list:
    runs-on: ubuntu-latest
    outputs:
      branches: ${{ steps.prs.outputs.branches }}
    steps:
      - id: prs
        shell: bash
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          branches=$(gh pr list --repo "$GITHUB_REPOSITORY" --base "$GITHUB_REF_NAME" \
            --state open --limit 100 --json headRefName,isCrossRepository |
            jq -c '[.[] | select(.isCrossRepository | not) | .headRefName]')
          echo "branches=$branches" >> "$GITHUB_OUTPUT"

  regen:
    needs: list
    if: needs.list.outputs.branches != '[]'
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        branch: ${{ fromJSON(needs.list.outputs.branches) }}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ matrix.branch }}
          fetch-depth: 0
      # Install whatever your regen.yml commands need here.
      - uses: fffreire/regen@main
        with:
          branch: ${{ matrix.branch }}
          base: ${{ github.ref_name }}
```

The action needs Git and Node 20 or newer on the runner. GitHub-hosted runners have both. It doesn't install anything your commands use, such as pnpm.

## Inputs

| Input | Meaning |
|---|---|
| `branch` | The branch that's checked out, and the one to push to |
| `base` | Branch to merge from `origin` |

Both are required. There's no `token` input. The push uses the credentials `actions/checkout` leaves in the repo.

## Outputs

When the action gets as far as merging, `result` is one of the values below. It's empty if the run is refused first, for example on the wrong event or a detached or shallow checkout.

| Value | Meaning | Step |
|---|---|---|
| `up-to-date` | The base was already merged. Nothing was pushed. | Passes |
| `resolved` | A merge was pushed, whether or not it had conflicts. | Passes |
| `needs-human` | Nothing was pushed. See below. | Fails |

## When it needs a human

The step fails with an `::error` annotation. This happens when:

- A source file conflicts, or a command fails or changes files outside the rules. The merge is aborted.
- Regen hits a usage, config or Git error. Any merge in progress is aborted.
- The push is rejected, for example because the branch moved during the run.

The failure appears on the workflow run and on the commit pushed to the base branch, not on the PR. Nothing tells the PR author, and the job fails again on every push until the PR is fixed. `fail-fast: false` keeps one PR's failure from cancelling the others.

The action never force pushes.

## Security

Commands in `regen.yml` can run code from the branch, and they come from that branch's own `regen.yml`, so a PR can change what runs.

- **The fork filter lives in the workflow.** The action has no fork check of its own. `actions/checkout` only reads branches from your repo, and the `isCrossRepository` filter drops fork PRs. Keep that filter, and don't change the checkout to fetch from a fork.
- **Every same-repo PR's code runs with a write token on each push to `main`.** That includes the push token `actions/checkout` leaves in `.git/config`, which any command can read. Don't add secrets to the `regen` job.
- **Keep `permissions` to what the example shows:** `contents: write` and `pull-requests: read`.

## Limits

- **Every open PR gets a merge commit.** Each push to `main` adds one to every same-repo PR that's behind, conflicted or not. A busy `main` means a lot of commits on PR branches, a lot of runner time, and `resolved` runs where nothing conflicted.
- **Only PRs targeting the pushed branch are covered.** A stacked PR based on another PR isn't covered unless that branch is also in `on.push`. Even then, the action's own push to that branch won't start the workflow, so the stack only updates when someone else pushes to it.
- **Every PR branch needs a committed `regen.yml`.** A branch that predates it gets `needs-human`, even if it would merge cleanly.
- **Steps before the action can't change tracked files.** If an install step rewrites one, `regen` refuses to start and you get `needs-human`.
- **Only the first 100 PRs are covered.** `--limit 100` caps the list.
- **Pushes don't trigger workflows.** A push made with `GITHUB_TOKEN` doesn't start other workflows, so CI won't run on the merge commit and required checks can stay pending. Pushing another commit or closing and reopening the PR starts them. A personal access token passed to `actions/checkout` as `token` also avoids this, but every command in `regen.yml` can read it.
- **Merges that bring in workflow changes can be rejected.** `GITHUB_TOKEN` can't push changes to `.github/workflows`, so if the base changed those files the push can fail. You'll get `needs-human`.
