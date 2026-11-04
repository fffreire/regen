import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { createRepo, type Repo } from "./repo.ts";

type Step = { run: string; env: Record<string, string> };
const ROOT = resolve(import.meta.dirname, "..");
const action: { runs: { steps: Step[] } } = parse(readFileSync(join(ROOT, "action.yml"), "utf8"));
const step = action.runs.steps[0]!;

const actionPath = mkdtempSync(join(tmpdir(), "regen-action-"));
const npmLog = join(actionPath, "npm.log");
const output = join(actionPath, "output");
cpSync(join(ROOT, "action"), join(actionPath, "action"), { recursive: true });
mkdirSync(join(actionPath, "dist"));
mkdirSync(join(actionPath, "bin"));
writeFileSync(join(actionPath, "dist/cli.js"), `import(${JSON.stringify(join(ROOT, "src/cli.ts"))});\n`);
writeFileSync(join(actionPath, "bin/npm"), `#!/bin/sh\necho "$PWD $*" >> "${npmLog}"\n`, { mode: 0o755 });

const config = (run: string) => `generated:\n  - files: [gen.txt]\n    run: ${JSON.stringify(run)}\n`;

function prRepo(extra: { feature?: object; main?: object } = {}, branch = "feature") {
  const repo = createRepo();
  const origin = mkdtempSync(join(tmpdir(), "regen-origin-"));
  spawnSync("git", ["init", "-q", "--bare", origin]);
  repo.commit("base", {
    "regen.yml": config("cat inputs/* > gen.txt"),
    "inputs/base": "base\n",
    "gen.txt": "base\n",
  });
  repo.git("checkout", "-qb", branch);
  repo.commit("feature", { "inputs/feature": "feature\n", "gen.txt": "base\nfeature\n", ...extra.feature });
  repo.git("checkout", "-q", "main");
  repo.commit("main", { "inputs/main": "main\n", "gen.txt": "base\nmain\n", ...extra.main });
  repo.git("remote", "add", "origin", origin);
  repo.git("push", "-q", "origin", "main", branch);
  repo.git("checkout", "-q", branch);
  return repo;
}

function run(repo: Repo, env: Record<string, string> = {}) {
  rmSync(npmLog, { force: true });
  writeFileSync(output, "");
  const result = spawnSync("bash", ["-c", step.run], {
    cwd: repo.root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${join(actionPath, "bin")}:${process.env.PATH}`,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GITHUB_ACTION_PATH: actionPath,
      GITHUB_EVENT_NAME: "push",
      GITHUB_OUTPUT: output,
      BRANCH: "feature",
      BASE: "main",
      ...env,
    },
  });
  return { ...result, output: readFileSync(output, "utf8") };
}

const head = (repo: Repo) => repo.git("rev-parse", "HEAD").stdout.trim();
const remote = (repo: Repo, branch = "feature") =>
  repo.git("ls-remote", "origin", `refs/heads/${branch}`).stdout.split("\t")[0];
const merging = (repo: Repo) => repo.git("rev-parse", "-q", "--verify", "MERGE_HEAD").status === 0;
const sourceConflict = { feature: { "app.txt": "feature\n" }, main: { "app.txt": "main\n" } };

test("action.yml passes expressions through env only", () => {
  assert.deepEqual(step.env, {
    BRANCH: "${{ inputs.branch }}",
    BASE: "${{ inputs.base }}",
  });
  assert.doesNotMatch(step.run, /\$\{\{/);
});

test("resolves a generated conflict and pushes the merge", () => {
  const repo = prRepo();
  const result = run(repo);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, "result=resolved\n");
  assert.equal(remote(repo), head(repo));
  assert.equal(repo.git("show", "origin/feature:gen.txt").stdout, "base\nfeature\nmain\n");
  assert.equal(repo.git("rev-list", "--parents", "-n1", "HEAD").stdout.trim().split(" ").length, 3);
  assert.equal(repo.git("log", "-1", "--format=%an").stdout.trim(), "Test");
  assert.equal(readFileSync(npmLog, "utf8"), `${actionPath} ci\n${actionPath} run build\n`);
});

test("is up to date once the base is merged", () => {
  const repo = prRepo();
  run(repo);
  const pushed = remote(repo);
  const result = run(repo);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, "result=up-to-date\n");
  assert.equal(remote(repo), pushed);
});

test("sets a bot identity only when none is configured", () => {
  const repo = prRepo();
  repo.git("config", "--unset", "user.name");
  repo.git("config", "--unset", "user.email");
  assert.equal(run(repo).status, 0);
  assert.equal(repo.git("log", "-1", "--format=%an").stdout.trim(), "github-actions[bot]");
});

test("needs a human on a source conflict, aborts the merge and pushes nothing", () => {
  const repo = prRepo(sourceConflict);
  const pushed = remote(repo);
  const result = run(repo);
  assert.equal(result.status, 1);
  assert.equal(result.output, "result=needs-human\n");
  assert.match(result.stdout, /^::error::regen stopped/m);
  assert.equal(merging(repo), false);
  assert.equal(repo.git("status", "--porcelain").stdout, "");
  assert.equal(remote(repo), pushed);
});

test("needs a human when a command fails", () => {
  const repo = prRepo();
  repo.commit("break", { "regen.yml": config("exit 3") });
  const result = run(repo);
  assert.equal(result.status, 1);
  assert.equal(result.output, "result=needs-human\n");
  assert.equal(merging(repo), false);
});

test("needs a human on a Git error", () => {
  const repo = prRepo();
  const result = run(repo, { BASE: "missing" });
  assert.equal(result.status, 1);
  assert.equal(result.output, "result=needs-human\n");
  assert.match(result.stdout, /^::error::regen could not merge origin\/missing/m);
});

test("runs on workflow_dispatch", () => {
  const result = run(prRepo(), { GITHUB_EVENT_NAME: "workflow_dispatch" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, "result=resolved\n");
});

for (const event of ["pull_request", "pull_request_target"]) {
  test(`refuses ${event}`, () => {
    const repo = prRepo();
    const before = head(repo);
    const result = run(repo, { GITHUB_EVENT_NAME: event });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /^::error::regen must run on push or workflow_dispatch/m);
    assert.equal(existsSync(npmLog), false);
    assert.equal(head(repo), before);
  });
}

test("refuses a detached or shallow checkout", () => {
  const detached = prRepo();
  detached.git("checkout", "-q", "--detach");
  assert.match(run(detached).stdout, /^::error::regen needs the branch/m);
  const shallow = prRepo();
  shallow.write({ ".git/shallow": `${head(shallow)}\n` });
  assert.match(run(shallow).stdout, /^::error::regen needs the branch/m);
});

test("never forces over a branch that moved", () => {
  const repo = prRepo();
  repo.git("checkout", "-qb", "other");
  repo.commit("someone else", { "other.txt": "other\n" });
  const moved = head(repo);
  repo.git("push", "-q", "origin", "other:feature");
  repo.git("checkout", "-q", "feature");
  const result = run(repo);
  assert.equal(result.status, 1);
  assert.equal(result.output, "result=needs-human\n");
  assert.match(result.stdout, /^::error::regen merged origin\/main but the push was rejected/m);
  assert.equal(remote(repo), moved);
});

test("treats a hostile branch name as data", () => {
  const branch = "x$(touch${IFS}pwned)";
  const repo = prRepo({}, branch);
  const result = run(repo, { BRANCH: branch });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(repo.root, "pwned")), false);
  assert.equal(remote(repo, branch), head(repo));
});
