import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, parseConfig } from "../src/config.ts";

const rules = parseConfig(`
generated:
  - files: [pnpm-lock.yaml]
    run: pnpm install --lockfile-only
  - files: [i18n.lock, locales/**/*.json]
    run: pnpm i18n:build
`);

test("parses rules", () => {
  assert.deepEqual(rules[0], {
    files: ["pnpm-lock.yaml"],
    run: "pnpm install --lockfile-only",
  });
});

test("rejects invalid configs", () => {
  for (const text of [
    "",
    "generated: []",
    "generated: [null]",
    "generated:\n  - files: []\n    run: x",
    "generated:\n  - files: [a]",
    "generated:\n  - files: a\n    run: x",
    "generated:\n  - files: [a]\n    run: '  '",
  ]) {
    assert.throws(() => parseConfig(text), /regen\.yml/, text);
  }
});

test("treats any unmatched path as source", () => {
  const result = classify(rules, ["pnpm-lock.yaml", "src/app.ts"]);
  assert.deepEqual(result.source, ["src/app.ts"]);
  assert.deepEqual(result.rules, [rules[0]]);
});

test("matches nested globs and returns each rule once", () => {
  const result = classify(rules, ["i18n.lock", "locales/pt/a/b.json"]);
  assert.deepEqual(result.source, []);
  assert.deepEqual(result.rules, [rules[1]]);
});

test("does not match a same-named file in another folder", () => {
  assert.deepEqual(classify(rules, ["pkg/pnpm-lock.yaml"]).source, ["pkg/pnpm-lock.yaml"]);
});
