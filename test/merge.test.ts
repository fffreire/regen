import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createRepo, type Repo } from "./repo.ts";

const config = (run: string, files = "[gen.txt]") =>
  `generated:\n  - files: ${files}\n    run: ${JSON.stringify(run)}\n`;
const BUILD = "cat inputs/* > gen.txt";

function conflictingRepo(run = BUILD, extra: { feature?: object; main?: object } = {}) {
  const repo = createRepo();
  repo.commit("base", {
    "regen.yml": config(run),
    "inputs/base": "base\n",
    "gen.txt": "base\n",
  });
  repo.git("checkout", "-qb", "feature");
  repo.commit("feature", { "inputs/feature": "feature\n", "gen.txt": "base\nfeature\n", ...extra.feature });
  repo.git("checkout", "-q", "main");
  repo.commit("main", { "inputs/main": "main\n", "gen.txt": "base\nmain\n", ...extra.main });
  return repo;
}

const read = (repo: Repo, path: string) => readFileSync(join(repo.root, path), "utf8");
const merging = (repo: Repo) => repo.git("rev-parse", "-q", "--verify", "MERGE_HEAD").status === 0;

test("regenerates a conflicted file from both sides and commits", () => {
  const repo = conflictingRepo();
  const result = repo.regen("merge", "feature");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(read(repo, "gen.txt"), "base\nfeature\nmain\n");
  assert.equal(repo.git("rev-list", "--parents", "-n1", "HEAD").stdout.trim().split(" ").length, 3);
  assert.equal(repo.git("status", "--porcelain").stdout, "");
});

test("does nothing extra on a clean merge", () => {
  const repo = createRepo();
  repo.commit("base", { "regen.yml": config("exit 1"), "a.txt": "a\n" });
  repo.git("checkout", "-qb", "feature");
  repo.commit("feature", { "b.txt": "b\n" });
  repo.git("checkout", "-q", "main");
  assert.equal(repo.regen("merge", "feature").status, 0);
});

test("stops on a source conflict without running commands", () => {
  const repo = conflictingRepo("touch ran", {
    feature: { "app.txt": "feature\n" },
    main: { "app.txt": "main\n" },
  });
  const result = repo.regen("merge", "feature");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Source conflicts need you:\n {2}app\.txt/);
  assert.equal(existsSync(join(repo.root, "ran")), false);
  assert.match(read(repo, "app.txt"), /<<<<<<</);
  assert.match(read(repo, "gen.txt"), /<<<<<<</);
  assert.equal(merging(repo), true);
});

test("--continue finishes after a source conflict is fixed", () => {
  const repo = conflictingRepo(BUILD, {
    feature: { "app.txt": "feature\n" },
    main: { "app.txt": "main\n" },
  });
  repo.regen("merge", "feature");
  repo.write({ "app.txt": "both\n" });
  repo.git("add", "app.txt");
  const result = repo.regen("merge", "--continue");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(read(repo, "gen.txt"), "base\nfeature\nmain\n");
  assert.equal(merging(repo), false);
});

test("--continue rebuilds a generated file you staged with markers", () => {
  const repo = conflictingRepo();
  repo.git("merge", "feature");
  repo.git("add", "-A");
  assert.equal(repo.regen("merge", "--continue").status, 0);
  assert.equal(read(repo, "gen.txt"), "base\nfeature\nmain\n");
  assert.equal(repo.git("show", "HEAD:gen.txt").stdout, "base\nfeature\nmain\n");
});

test("--continue rebuilds a generated file that merged cleanly but went stale", () => {
  const repo = createRepo();
  repo.commit("base", {
    "regen.yml": config("wc -c < app.txt | tr -d ' ' > size.txt", "[size.txt]"),
    "app.txt": "base\n",
    "size.txt": "5\n",
  });
  repo.git("checkout", "-qb", "feature");
  repo.commit("feature", { "app.txt": "feature\n" });
  repo.git("checkout", "-q", "main");
  repo.commit("main", { "app.txt": "main\n" });
  assert.equal(repo.regen("merge", "feature").status, 1);
  repo.write({ "app.txt": "feature and main\n" });
  repo.git("add", "app.txt");
  assert.equal(repo.regen("merge", "--continue").status, 0);
  assert.equal(repo.git("show", "HEAD:size.txt").stdout, "17\n");
});

test("refuses to commit markers a command left behind", () => {
  const repo = conflictingRepo("true");
  repo.git("merge", "feature");
  repo.git("add", "-A");
  const result = repo.regen("merge", "--continue");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /still have conflict markers:\ngen\.txt/);
  assert.equal(merging(repo), true);
});

test("keeps conflict notes out of the merge commit message", () => {
  const repo = conflictingRepo();
  assert.equal(repo.regen("merge", "feature").status, 0);
  assert.doesNotMatch(repo.git("log", "-1", "--format=%B").stdout, /Conflicts/);
});

test("--continue requires a merge in progress", () => {
  const repo = createRepo();
  repo.commit("base", { "regen.yml": config("true") });
  const result = repo.regen("merge", "--continue");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /no merge in progress/);
});

test("stops when a command fails and --continue can recover", () => {
  const repo = conflictingRepo("test -f ok && cat inputs/* > gen.txt");
  const result = repo.regen("merge", "feature");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Command failed/);
  assert.equal(merging(repo), true);
  repo.write({ ok: "" });
  assert.equal(repo.regen("merge", "--continue").status, 0);
  assert.equal(read(repo, "gen.txt"), "base\nfeature\nmain\n");
});

test("stops when a command changes files outside the rules", () => {
  const repo = conflictingRepo(`${BUILD} && echo x > surprise.txt`);
  const result = repo.regen("merge", "feature");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /outside your generated rules:\n {2}surprise\.txt/);
  assert.equal(merging(repo), true);
});

test("stages other generated files a command rewrites", () => {
  const repo = conflictingRepo(`${BUILD} && cp gen.txt copy.txt`);
  repo.commit("rule", { "regen.yml": config(`${BUILD} && cp gen.txt copy.txt`, "[gen.txt, copy.txt]") });
  assert.equal(repo.regen("merge", "feature").status, 0);
  assert.equal(repo.git("show", "HEAD:copy.txt").stdout, "base\nfeature\nmain\n");
});

test("handles a generated file deleted on one side", () => {
  const repo = createRepo();
  repo.commit("base", { "regen.yml": config("echo new > gen.txt"), "gen.txt": "base\n" });
  repo.git("checkout", "-qb", "feature");
  repo.git("rm", "-q", "gen.txt");
  repo.git("commit", "-qm", "delete");
  repo.git("checkout", "-q", "main");
  repo.commit("main", { "gen.txt": "main\n" });
  const result = repo.regen("merge", "feature");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(read(repo, "gen.txt"), "new\n");
});

test("handles a generated file the command removes", () => {
  const repo = conflictingRepo("rm gen.txt");
  const result = repo.regen("merge", "feature");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(repo.root, "gen.txt")), false);
  assert.equal(repo.git("status", "--porcelain").stdout, "");
});

test("never runs commands from the branch being merged", () => {
  const repo = conflictingRepo("true && " + BUILD, {
    feature: { "regen.yml": config("touch pwned") },
  });
  assert.equal(repo.regen("merge", "feature").status, 0);
  assert.equal(existsSync(join(repo.root, "pwned")), false);
});

test("refuses to start with uncommitted changes to tracked files", () => {
  const repo = conflictingRepo();
  repo.write({ "inputs/base": "half done\n" });
  const result = repo.regen("merge", "feature");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /commit or stash/);
  assert.equal(merging(repo), false);
  assert.equal(read(repo, "inputs/base"), "half done\n");
});

test("--continue keeps stopping on a command that changes tracked source", () => {
  const repo = conflictingRepo(`${BUILD}; echo formatted > inputs/base`);
  assert.equal(repo.regen("merge", "feature").status, 1);
  const result = repo.regen("merge", "--continue");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /outside your generated rules:\n {2}inputs\/base/);
  assert.equal(merging(repo), true);
});

test("--continue stages what an earlier failed run wrote", () => {
  const repo = createRepo();
  const run = `${BUILD}; cp gen.txt copy.txt; test -f ok`;
  repo.commit("base", {
    "regen.yml": config(run, "[gen.txt, copy.txt]"),
    "inputs/base": "base\n",
    "gen.txt": "base\n",
    "copy.txt": "base\n",
  });
  repo.git("checkout", "-qb", "feature");
  repo.commit("feature", { "inputs/feature": "feature\n", "gen.txt": "feature\n" });
  repo.git("checkout", "-q", "main");
  repo.commit("main", { "inputs/main": "main\n", "gen.txt": "main\n" });
  assert.equal(repo.regen("merge", "feature").status, 1);
  repo.write({ ok: "" });
  assert.equal(repo.regen("merge", "--continue").status, 0);
  assert.equal(repo.git("show", "HEAD:copy.txt").stdout, "base\nfeature\nmain\n");
});

test("treats filenames with brackets literally", () => {
  const repo = createRepo();
  const path = "app/[id]/gen.ts";
  repo.commit("base", {
    "regen.yml": config(`cat inputs/* > '${path}'`, "['app/\\[id\\]/gen.ts']"),
    "inputs/base": "base\n",
    [path]: "base\n",
    "app/i/gen.ts": "keep\n",
  });
  repo.git("checkout", "-qb", "feature");
  repo.commit("feature", { "inputs/feature": "feature\n", [path]: "feature\n" });
  repo.git("checkout", "-q", "main");
  repo.commit("main", { "inputs/main": "main\n", [path]: "main\n" });
  const result = repo.regen("merge", "feature");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(repo.git("show", `HEAD:${path}`).stdout, "base\nfeature\nmain\n");
});

test("catches markers of a custom size", () => {
  const repo = conflictingRepo("true");
  repo.commit("attrs", { ".gitattributes": "gen.txt conflict-marker-size=32\n" });
  repo.git("merge", "feature");
  repo.git("add", "-A");
  assert.equal(repo.regen("merge", "--continue").status, 1);
});

test("reports git errors", () => {
  const repo = createRepo();
  repo.commit("base", { "regen.yml": config("true") });
  assert.equal(repo.regen("merge", "missing").status, 2);
});

test("won't take over conflicts that are already in progress", () => {
  const repo = conflictingRepo();
  repo.git("branch", "other", "main");
  repo.git("merge", "feature");
  const conflicted = read(repo, "gen.txt");
  const result = repo.regen("merge", "other");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /already in progress/);
  assert.equal(read(repo, "gen.txt"), conflicted);
  assert.equal(merging(repo), true);
});

test("rejects flag-like refs", () => {
  const repo = createRepo();
  repo.commit("base", { "regen.yml": config("true") });
  assert.equal(repo.regen("merge", "--abort").status, 2);
});

test("leaves unrelated uncommitted files alone", () => {
  const repo = conflictingRepo();
  repo.write({ "notes.txt": "mine\n" });
  assert.equal(repo.regen("merge", "feature").status, 0);
  assert.equal(repo.git("status", "--porcelain").stdout, "?? notes.txt\n");
});
