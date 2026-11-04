import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const ROOT = resolve(import.meta.dirname, "..");

function demo(script: string) {
  const TMPDIR = mkdtempSync(join(tmpdir(), "regen-demo-test-"));
  const result = spawnSync("bash", [join("demo", script)], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, TMPDIR },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(readdirSync(TMPDIR).filter((name) => name.startsWith("regen-demo.")), []);
  rmSync(TMPDIR, { recursive: true });
  return result.stdout + result.stderr;
}

test("run.sh shows git conflicting, regen resolving, and a source conflict continuing", () => {
  const output = demo("run.sh");
  assert.match(output, /CONFLICT \(content\): Merge conflict in locales\.lock/);
  assert.match(output, /\$ regen merge add-checkout-total\nregen: running node build-locales\.js\nregen: merge complete/);
  assert.match(output, /Source conflicts need you:\n {2}locales\/checkout\.json/);
  assert.match(output, /generated {2}locales\.lock\nsource {5}locales\/checkout\.json/);
  assert.match(output, /\$ regen merge --continue\nregen: running node build-locales\.js\nregen: merge complete/);
  assert.match(output, /Done: every step behaved/);
});

test("stack.sh rebases a stack in one command", { skip: !existsSync(join(ROOT, "src/rebase.ts")) }, () => {
  const output = demo("stack.sh");
  for (const branch of ["stack-1", "stack-2", "stack-3"]) {
    assert.match(output, new RegExp(`ok: ${branch} locales\\.lock matches a fresh build`));
  }
  assert.match(output, /Done: every step behaved/);
});
