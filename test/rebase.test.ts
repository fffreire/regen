import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createRepo, type Repo } from "./repo.ts";

const config = (run: string) => `generated:\n  - files: [gen.txt]\n    run: ${JSON.stringify(run)}\n`;
const BUILD = "cat inputs/* > gen.txt";

const baseRepo = (run = BUILD) => {
  const repo = createRepo();
  repo.commit("base", { "regen.yml": config(run), "inputs/0": "base\n", "gen.txt": "base\n" });
  return repo;
};

// What BUILD produces from a commit's inputs.
const rebuild = (repo: Repo, rev: string) =>
  repo
    .git("ls-tree", "--name-only", rev, "inputs/")
    .stdout.trim()
    .split("\n")
    .map((path) => repo.git("show", `${rev}:${path}`).stdout)
    .join("");

function addInput(repo: Repo, name: string, extra: Record<string, string> = {}) {
  repo.commit(name, {
    [`inputs/${name}`]: `${name}\n`,
    "gen.txt": `${rebuild(repo, "HEAD")}${name}\n`,
    ...extra,
  });
}

function featureRepo(names: string[], extra: Record<string, Record<string, string>> = {}, run = BUILD) {
  const repo = baseRepo(run);
  repo.git("checkout", "-qb", "feature");
  for (const name of names) addInput(repo, name, extra[name]);
  repo.git("checkout", "-q", "main");
  addInput(repo, "z-main", extra.main);
  repo.git("checkout", "-q", "feature");
  return repo;
}

const read = (repo: Repo, path: string) => readFileSync(join(repo.root, path), "utf8");
const rebasing = (repo: Repo) =>
  ["rebase-merge", "rebase-apply"].some((dir) => existsSync(join(repo.root, ".git", dir)));
const subjects = (repo: Repo, range: string) =>
  repo.git("log", "--reverse", "--format=%s", range).stdout.trim().split("\n");
const runs = (output: string) => output.match(/regen: running/g)?.length ?? 0;

function assertRebuilt(repo: Repo, range: string) {
  for (const rev of repo.git("rev-list", range).stdout.trim().split("\n")) {
    const generated = repo.git("show", `${rev}:gen.txt`).stdout;
    assert.doesNotMatch(generated, /<<<<<<<|>>>>>>>/);
    assert.equal(generated, rebuild(repo, rev));
  }
}

const assertFinished = (repo: Repo) => {
  assert.equal(rebasing(repo), false);
  assert.equal(repo.git("status", "--porcelain").stdout, "");
  assert.equal(repo.git("rev-parse", "--abbrev-ref", "HEAD").stdout.trim(), "feature");
  assert.equal(repo.git("merge-base", "--is-ancestor", "main", "HEAD").status, 0);
};

test("regenerates a single conflicting commit", () => {
  const repo = featureRepo(["feature"]);
  const result = repo.regen("rebase", "main");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(read(repo, "gen.txt"), "base\nfeature\nz-main\n");
  assert.deepEqual(subjects(repo, "main..HEAD"), ["feature"]);
  assertRebuilt(repo, "main..HEAD");
  assertFinished(repo);
});

test("regenerates at every conflicting commit", () => {
  const repo = featureRepo(["a", "b", "c"]);
  const result = repo.regen("rebase", "main");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(runs(result.stdout), 3);
  assert.equal(read(repo, "gen.txt"), "base\na\nb\nc\nz-main\n");
  assert.deepEqual(subjects(repo, "main..HEAD"), ["a", "b", "c"]);
  assertRebuilt(repo, "main..HEAD");
  assertFinished(repo);
});

for (const backend of ["merge", "apply"]) {
  test(`stops at a later source conflict and --continue finishes (${backend})`, () => {
    const repo = featureRepo(["a", "b", "c"], { b: { "app.txt": "b\n" }, main: { "app.txt": "main\n" } });
    repo.git("config", "rebase.backend", backend);
    const result = repo.regen("rebase", "main");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Source conflicts need you:\n {2}app\.txt/);
    assert.match(result.stderr, /regen rebase --continue/);
    assert.equal(rebasing(repo), true);
    assert.deepEqual(subjects(repo, "main..HEAD"), ["a"]);
    repo.write({ "app.txt": "both\n" });
    repo.git("add", "app.txt");
    const resumed = repo.regen("rebase", "--continue");
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal(runs(resumed.stdout), 2);
    assert.deepEqual(subjects(repo, "main..HEAD"), ["a", "b", "c"]);
    assert.equal(read(repo, "app.txt"), "both\n");
    assertRebuilt(repo, "main..HEAD");
    assertFinished(repo);
  });

  test(`drops a commit that regeneration leaves empty (${backend})`, () => {
    const repo = baseRepo();
    repo.git("config", "rebase.backend", backend);
    repo.git("checkout", "-qb", "feature");
    repo.commit("hand edit", { "gen.txt": "hand\n" });
    addInput(repo, "kept");
    repo.git("checkout", "-q", "main");
    addInput(repo, "z-main");
    repo.git("checkout", "-q", "feature");
    const result = repo.regen("rebase", "main");
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(subjects(repo, "main..HEAD"), ["kept"]);
    assertRebuilt(repo, "main..HEAD");
    assertFinished(repo);
  });
}

test("stops when a command fails and --continue can recover", () => {
  const repo = featureRepo(["a", "b"], {}, `test -f ok && ${BUILD}`);
  const result = repo.regen("rebase", "main");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Command failed/);
  assert.equal(rebasing(repo), true);
  repo.write({ ok: "" });
  const resumed = repo.regen("rebase", "--continue");
  assert.equal(resumed.status, 0, resumed.stderr);
  assertRebuilt(repo, "main..feature");
  assert.equal(read(repo, "gen.txt"), "base\na\nb\nz-main\n");
});

test("does nothing extra on a clean rebase", () => {
  const repo = baseRepo("touch ran");
  repo.git("checkout", "-qb", "feature");
  repo.commit("feature", { "b.txt": "b\n" });
  repo.git("checkout", "-q", "main");
  repo.commit("main", { "a.txt": "a\n" });
  repo.git("checkout", "-q", "feature");
  const result = repo.regen("rebase", "main");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(repo.root, "ran")), false);
  assert.equal(repo.git("rev-parse", "HEAD~").stdout, repo.git("rev-parse", "main").stdout);
  assertFinished(repo);
});

function stackRepo() {
  const repo = baseRepo();
  for (const [name, parent] of [["a", "main"], ["b", "a"], ["feature", "b"]] as const) {
    repo.git("checkout", "-qb", name, parent);
    addInput(repo, name);
  }
  repo.git("checkout", "-q", "main");
  addInput(repo, "z-main");
  repo.git("checkout", "-q", "feature");
  return repo;
}

test("leaves intermediate branches behind without --update-refs", () => {
  const repo = stackRepo();
  const before = repo.git("rev-parse", "a").stdout;
  assert.equal(repo.regen("rebase", "main").status, 0);
  assert.equal(repo.git("rev-parse", "a").stdout, before);
});

test("--update-refs moves an intermediate branch", () => {
  const repo = baseRepo();
  repo.git("checkout", "-qb", "a");
  repo.commit("a", { "a.txt": "a\n" });
  repo.git("checkout", "-qb", "feature");
  repo.commit("feature", { "f.txt": "f\n" });
  repo.git("checkout", "-q", "main");
  repo.commit("main", { "m.txt": "m\n" });
  repo.git("checkout", "-q", "feature");
  const result = repo.regen("rebase", "main", "--update-refs");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(repo.git("rev-parse", "a").stdout, repo.git("rev-parse", "feature~").stdout);
  assert.equal(repo.git("rev-parse", "a~").stdout, repo.git("rev-parse", "main").stdout);
});

test("resolves repeated conflicts up a 3-branch stack", () => {
  const repo = stackRepo();
  const result = repo.regen("rebase", "main", "--update-refs");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(runs(result.stdout), 3);
  for (const [branch, parent, generated] of [
    ["a", "main", "base\na\nz-main\n"],
    ["b", "a", "base\na\nb\nz-main\n"],
    ["feature", "b", "base\na\nb\nfeature\nz-main\n"],
  ] as const) {
    assert.equal(repo.git("rev-parse", `${branch}~`).stdout, repo.git("rev-parse", parent).stdout);
    assert.equal(repo.git("show", `${branch}:gen.txt`).stdout, generated);
  }
  assertRebuilt(repo, "main..feature");
  assertFinished(repo);
});

test("--update-refs survives a stop and --continue", () => {
  const repo = stackRepo();
  repo.commit("source", { "app.txt": "feature\n" });
  repo.git("checkout", "-q", "main");
  repo.commit("main source", { "app.txt": "main\n" });
  repo.git("checkout", "-q", "feature");
  assert.equal(repo.regen("rebase", "main", "--update-refs").status, 1);
  repo.write({ "app.txt": "both\n" });
  repo.git("add", "app.txt");
  assert.equal(repo.regen("rebase", "--continue").status, 0);
  assert.equal(repo.git("merge-base", "--is-ancestor", "main", "a").status, 0);
  assert.equal(repo.git("merge-base", "--is-ancestor", "b", "feature").status, 0);
  assertRebuilt(repo, "main..feature");
});

test("--continue rebuilds generated files you resolved by hand", () => {
  const repo = featureRepo(["a"]);
  repo.git("rebase", "main");
  repo.write({ "gen.txt": "by hand\n" });
  repo.git("add", "gen.txt");
  const result = repo.regen("rebase", "--continue");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(runs(result.stdout), 1);
  assert.equal(read(repo, "gen.txt"), rebuild(repo, "HEAD"));
  assertFinished(repo);
});

test("exits 1 when git stops mid-rebase without a conflict", () => {
  const repo = baseRepo();
  repo.git("checkout", "-qb", "feature");
  repo.commit("one", { "one.txt": "1\n" });
  repo.commit("two", { "two.txt": "2\n" });
  repo.git("checkout", "-q", "main");
  repo.commit("clean", { "other.txt": "x\n" });
  repo.git("checkout", "-q", "feature");
  repo.git("rm", "-q", "--cached", "two.txt");
  repo.git("commit", "-qm", "untrack two");
  repo.write({ "two.txt": "in the way\n" });
  const result = repo.regen("rebase", "main");
  assert.equal(result.status, 1, result.stderr);
  assert.equal(rebasing(repo), true);
});

test("refuses to start with uncommitted changes to tracked files", () => {
  const repo = featureRepo(["a"]);
  repo.write({ "inputs/0": "half done\n" });
  const result = repo.regen("rebase", "main");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /commit or stash/);
  assert.equal(rebasing(repo), false);
});

test("status reads rules from the branch being rebased", () => {
  const repo = featureRepo(["a"]);
  repo.git("rebase", "main");
  const result = repo.regen("status");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /generated\s+gen\.txt/);
});

test("--continue requires a rebase in progress", () => {
  const repo = baseRepo();
  const result = repo.regen("rebase", "--continue");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /no rebase in progress/);
});

test("--continue doesn't mistake git am for a rebase", () => {
  const repo = featureRepo(["a"]);
  const patch = repo.git("format-patch", "-1", "--stdout").stdout;
  repo.git("checkout", "-q", "main");
  writeFileSync(join(repo.root, ".git/patch"), patch);
  assert.notEqual(repo.git("am", ".git/patch").status, 0);
  const result = repo.regen("rebase", "--continue");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /no rebase in progress/);
});

test("rejects flag-like refs and unknown flags", () => {
  const repo = featureRepo(["a"]);
  for (const args of [["--abort"], ["-i", "main"], ["main", "--onto"], ["main", "--update-refs", "x"]]) {
    const result = repo.regen("rebase", ...args);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /usage:/);
  }
  assert.equal(rebasing(repo), false);
});

test("reports git errors", () => {
  const repo = baseRepo();
  assert.equal(repo.regen("rebase", "missing").status, 2);
  repo.write({ "gen.txt": "dirty\n" });
  assert.equal(repo.regen("rebase", "main").status, 2);
  assert.equal(rebasing(repo), false);
  assert.equal(read(repo, "gen.txt"), "dirty\n");
});

test("won't take over conflicts that are already in progress", () => {
  const repo = featureRepo(["a", "b"]);
  repo.git("rebase", "main");
  const conflicted = read(repo, "gen.txt");
  const result = repo.regen("rebase", "main");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /already in progress/);
  assert.equal(read(repo, "gen.txt"), conflicted);
  assert.equal(rebasing(repo), true);
});

test("a failing hook on continue stops instead of looping", () => {
  const repo = featureRepo(["a", "b"]);
  const hook = join(repo.root, ".git/hooks/prepare-commit-msg");
  writeFileSync(hook, "#!/bin/sh\necho hook said no >&2\nexit 1\n", { mode: 0o755 });
  const result = repo.regen("rebase", "main");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /hook said no/);
  assert.equal(rebasing(repo), true);
  writeFileSync(hook, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  assert.equal(repo.regen("rebase", "--continue").status, 0);
  assertRebuilt(repo, "main..feature");
});

for (const backend of ["merge", "apply"]) {
  test(`never skips a commit while uncommitted edits exist (${backend})`, () => {
    const repo = baseRepo();
    repo.git("config", "rebase.backend", backend);
    repo.commit("other", { "other.txt": "other\n" });
    repo.git("checkout", "-qb", "feature");
    repo.commit("a", { "app.txt": "a\n" });
    repo.git("checkout", "-q", "main");
    repo.commit("main", { "app.txt": "main\n" });
    repo.git("checkout", "-q", "feature");
    assert.equal(repo.regen("rebase", "main").status, 1);
    repo.git("checkout", "main", "--", "app.txt");
    repo.write({ "other.txt": "edited\n" });
    const result = repo.regen("rebase", "--continue");
    assert.equal(result.status, 1);
    assert.equal(read(repo, "other.txt"), "edited\n");
    assert.equal(rebasing(repo), true);
  });
}

test("reports a stop that isn't a conflict instead of claiming success", () => {
  const repo = featureRepo(["a", "b"]);
  repo.git("-c", "sequence.editor=sed -i s/pick/edit/", "rebase", "-i", "feature~2");
  const result = repo.regen("rebase", "--continue");
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout, /rebase complete/);
  assert.equal(rebasing(repo), true);
  assert.equal(repo.regen("rebase", "--continue").status, 0);
  assert.equal(rebasing(repo), false);
  assert.deepEqual(subjects(repo, "main..HEAD"), ["a", "b"]);
});

test("keeps the starting rules when a replayed commit changes regen.yml", () => {
  const repo = featureRepo(["a", "b"], { a: { "regen.yml": config("touch pwned") } });
  repo.commit("restore", { "regen.yml": config(BUILD) });
  const result = repo.regen("rebase", "main");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(repo.root, "pwned")), false);
  assertRebuilt(repo, "main..feature");
});

test("--continue ignores a regen.yml from a replayed commit", () => {
  const repo = featureRepo(
    ["a", "b"],
    { a: { "regen.yml": config("touch pwned") }, b: { "app.txt": "b\n" }, main: { "app.txt": "main\n" } },
  );
  repo.commit("restore", { "regen.yml": config(BUILD) });
  assert.equal(repo.regen("rebase", "main").status, 1);
  assert.match(repo.git("show", "HEAD:regen.yml").stdout, /pwned/);
  repo.write({ "app.txt": "both\n" });
  repo.git("add", "app.txt");
  const result = repo.regen("rebase", "--continue");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(repo.root, "pwned")), false);
  assertRebuilt(repo, "main..feature");
});

test("--continue ignores a regen.yml from the rebase target", () => {
  const repo = featureRepo(["a"], {
    a: { "app.txt": "a\n" },
    main: { "app.txt": "main\n", "regen.yml": config("touch pwned") },
  });
  assert.equal(repo.regen("rebase", "main").status, 1);
  assert.match(repo.git("show", "HEAD:regen.yml").stdout, /pwned/);
  repo.write({ "app.txt": "both\n" });
  repo.git("add", "app.txt");
  const result = repo.regen("rebase", "--continue");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(repo.root, "pwned")), false);
  assertRebuilt(repo, "main..feature");
});
