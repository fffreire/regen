import assert from "node:assert/strict";
import { test } from "node:test";
import { createRepo } from "./repo.ts";

const CONFIG = "generated:\n  - files: [gen.txt]\n    run: 'true'\n";

test("lists conflicts by class", () => {
  const repo = createRepo();
  repo.commit("base", { "regen.yml": CONFIG, "gen.txt": "base\n", "app.txt": "base\n" });
  repo.git("checkout", "-qb", "feature");
  repo.commit("feature", { "gen.txt": "feature\n", "app.txt": "feature\n" });
  repo.git("checkout", "-q", "main");
  repo.commit("main", { "gen.txt": "main\n", "app.txt": "main\n" });
  repo.git("merge", "feature");

  const result = repo.regen("status");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /source\s+app\.txt/);
  assert.match(result.stdout, /generated\s+gen\.txt/);
});

test("reports no conflicts", () => {
  const repo = createRepo();
  repo.commit("base", { "regen.yml": CONFIG });
  const result = repo.regen("status");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /No conflicts/);
});

test("requires a committed regen.yml", () => {
  const repo = createRepo();
  repo.commit("base", { "app.txt": "base\n" });
  repo.write({ "regen.yml": CONFIG });
  const result = repo.regen("status");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /no regen\.yml in HEAD/);
});

test("rejects unknown commands", () => {
  assert.equal(createRepo().regen("nope").status, 2);
});
