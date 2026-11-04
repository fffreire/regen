import { spawnSync } from "node:child_process";

export function git(args: string[], cwd: string) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: Infinity,
    env: { ...process.env, GIT_LITERAL_PATHSPECS: "1" },
  });
  if (result.error) throw result.error;
  return { ok: result.status === 0, stdout: result.stdout, stderr: result.stderr };
}

export function repoRoot(cwd: string) {
  const result = git(["rev-parse", "--show-toplevel"], cwd);
  if (!result.ok) throw new Error("not inside a git repository");
  return result.stdout.replace(/\n$/, "");
}

const split = (output: string) => output.split("\0").filter(Boolean);

export const conflictedPaths = (root: string) =>
  split(git(["diff", "--name-only", "--diff-filter=U", "-z"], root).stdout);

export const stagedPaths = (root: string) =>
  split(git(["diff", "--cached", "--name-only", "-z"], root).stdout);

export const modifiedPaths = (root: string) =>
  split(git(["diff", "--name-only", "-z", "--ignore-submodules=all"], root).stdout);

export const untrackedPaths = (root: string) =>
  split(git(["ls-files", "-z", "--others", "--exclude-standard"], root).stdout);

// Read from HEAD, not the working tree, so a branch being merged in can't
// choose the commands that run on your machine.
export function readConfig(root: string) {
  const result = git(["show", "HEAD:regen.yml"], root);
  if (!result.ok) throw new Error("no regen.yml in HEAD. Add it and commit it first");
  return result.stdout;
}
