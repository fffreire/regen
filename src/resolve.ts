import { spawnSync } from "node:child_process";
import { classify, matches, type Rule } from "./config.ts";
import { conflictedPaths, git, modifiedPaths, stagedPaths, untrackedPaths } from "./git.ts";

const list = (paths: string[]) => paths.map((path) => `  ${path}`).join("\n");

// Returns why it stopped, or undefined when every conflict is resolved and staged.
// `everything` reruns all rules: after a hand fix, any generated file may be stale.
export function regenerate(root: string, rules: Rule[], resume: string, everything = false) {
  const conflicts = conflictedPaths(root);
  const { source, rules: matched } = classify(rules, conflicts);
  if (source.length > 0) {
    return `Source conflicts need you:\n${list(source)}\n\nFix and \`git add\` them, then run \`${resume}\`.`;
  }

  // Generators may choke on conflict markers, so start from a clean copy of either side.
  for (const path of conflicts) {
    git(["checkout", "--ours", "--", path], root).ok ||
      git(["checkout", "--theirs", "--", path], root);
  }

  const before = new Set(untrackedPaths(root));
  for (const { run } of everything ? rules : matched) {
    console.log(`regen: running ${run}`);
    if (spawnSync(run, { cwd: root, shell: true, stdio: "inherit" }).status !== 0) {
      return `Command failed: ${run}\n\nFix it, then run \`${resume}\`.`;
    }
  }

  const isGenerated = (path: string) => rules.some((rule) => matches(rule, path));
  const changed = [...new Set([...modifiedPaths(root), ...untrackedPaths(root)])];
  const outside = changed.filter((path) => !before.has(path) && !isGenerated(path));
  if (outside.length > 0) {
    return `Files changed outside your generated rules:\n${list(outside)}\n\nStage them or fix the command, then run \`${resume}\`.`;
  }

  const paths = [...new Set([...conflicts, ...changed.filter(isGenerated)])];
  if (paths.length > 0) {
    const added = git(["add", "--", ...paths], root);
    if (!added.ok) return added.stderr;
  }

  const generated = stagedPaths(root).filter(isGenerated);
  const markers = generated.length > 0 && git(["grep", "--cached", "-lE", "^<{7,} ", "--", ...generated], root);
  if (markers && markers.ok) {
    return `Generated files still have conflict markers:\n${markers.stdout}\nFix the command, then run \`${resume}\`.`;
  }
}
