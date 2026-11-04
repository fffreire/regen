import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseConfig } from "./config.ts";
import { conflictedPaths, git, modifiedPaths, readConfig } from "./git.ts";
import { regenerate } from "./resolve.ts";

// The branch tip the rebase started from. Absent when no rebase is running,
// including during `git am`, which also uses rebase-apply.
export function originalHead(root: string) {
  for (const dir of ["rebase-merge", "rebase-apply"]) {
    const path = git(["rev-parse", "--git-path", `${dir}/orig-head`], root).stdout.trim();
    if (existsSync(resolve(root, path))) return readFileSync(resolve(root, path), "utf8").trim();
  }
}

function finish(root: string, rules: ReturnType<typeof parseConfig>, everything = false) {
  while (true) {
    const stopped = regenerate(root, rules, "regen rebase --continue", everything);
    everything = false;
    if (stopped) {
      console.error(stopped);
      return 1;
    }
    // --skip hard-resets, so it's only for a commit with nothing left, staged or not.
    const empty = git(["diff", "--quiet", "HEAD"], root).ok;
    const step = git(["rebase", empty ? "--skip" : "--continue"], root, { GIT_EDITOR: "true" });
    if (step.ok && !originalHead(root)) {
      console.log("regen: rebase complete");
      return 0;
    }
    if (conflictedPaths(root).length === 0) {
      console.error(step.stderr || step.stdout);
      return 1;
    }
  }
}

export function rebase(root: string, ref: string, flags: string[]) {
  const rules = parseConfig(readConfig(root));
  if (conflictedPaths(root).length > 0) {
    console.error("regen: finish the conflicts already in progress first");
    return 2;
  }
  if (modifiedPaths(root).length > 0) {
    console.error("regen: commit or stash your changes first");
    return 2;
  }
  const result = git(["rebase", ...flags, ref], root);
  if (result.ok) {
    console.log("regen: rebase complete");
    return 0;
  }
  if (conflictedPaths(root).length === 0) {
    console.error(result.stderr || result.stdout);
    return originalHead(root) ? 1 : 2;
  }
  return finish(root, rules);
}

export function rebaseContinue(root: string) {
  const head = originalHead(root);
  if (!head) {
    console.error("regen: no rebase in progress");
    return 2;
  }
  // HEAD is now the target plus replayed commits, so read the commit the rules came from.
  return finish(root, parseConfig(readConfig(root, head)), true);
}
