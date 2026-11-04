import { parseConfig } from "./config.ts";
import { conflictedPaths, git, modifiedPaths, readConfig } from "./git.ts";
import { regenerate } from "./resolve.ts";

function finish(root: string, rules: ReturnType<typeof parseConfig>, everything = false) {
  const stopped = regenerate(root, rules, "regen merge --continue", everything);
  if (stopped) {
    console.error(stopped);
    return 1;
  }
  const commit = git(["commit", "--no-edit", "--cleanup=strip"], root);
  if (!commit.ok) {
    console.error(commit.stderr || commit.stdout);
    return 1;
  }
  console.log("regen: merge complete");
  return 0;
}

export function merge(root: string, ref: string) {
  const rules = parseConfig(readConfig(root));
  if (conflictedPaths(root).length > 0) {
    console.error("regen: finish the conflicts already in progress first");
    return 2;
  }
  if (modifiedPaths(root).length > 0) {
    console.error("regen: commit or stash your changes first");
    return 2;
  }
  const result = git(["merge", "--no-edit", ref], root);
  if (result.ok) {
    console.log(result.stdout.trim());
    return 0;
  }
  if (conflictedPaths(root).length === 0) {
    console.error(result.stderr || result.stdout);
    return 2;
  }
  return finish(root, rules);
}

export function mergeContinue(root: string) {
  if (!git(["rev-parse", "-q", "--verify", "MERGE_HEAD"], root).ok) {
    console.error("regen: no merge in progress");
    return 2;
  }
  return finish(root, parseConfig(readConfig(root)), true);
}
