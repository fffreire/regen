import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const CLI = resolve(import.meta.dirname, "../src/cli.ts");

export type Repo = ReturnType<typeof createRepo>;

export function createRepo() {
  const root = mkdtempSync(join(tmpdir(), "regen-test-"));

  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.error) throw result.error;
    return result;
  };
  const write = (files: Record<string, string>) => {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
  };
  const commit = (message: string, files: Record<string, string>) => {
    write(files);
    git("add", "-A");
    git("commit", "-qm", message);
  };
  const regen = (...args: string[]) =>
    spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: "utf8" });

  git("init", "-qb", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  git("config", "commit.gpgsign", "false");

  return { root, git, write, commit, regen };
}
