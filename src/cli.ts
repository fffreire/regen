#!/usr/bin/env node
import { classify, parseConfig } from "./config.ts";
import { conflictedPaths, readConfig, repoRoot } from "./git.ts";
import { merge, mergeContinue } from "./merge.ts";

const USAGE = `usage:
  regen status
  regen merge <ref>
  regen merge --continue`;

function status(root: string) {
  const rules = parseConfig(readConfig(root));
  const paths = conflictedPaths(root);
  if (paths.length === 0) {
    console.log("No conflicts.");
    return 0;
  }
  const { source } = classify(rules, paths);
  for (const path of paths) {
    console.log(`${source.includes(path) ? "source   " : "generated"}  ${path}`);
  }
  return 0;
}

function run(root: string, [command, arg, ...rest]: string[]) {
  if (command === "status" && arg === undefined) return status(root);
  if (command === "merge" && arg === "--continue" && rest.length === 0) return mergeContinue(root);
  if (command === "merge" && arg && !arg.startsWith("-") && rest.length === 0) return merge(root, arg);
  console.error(USAGE);
  return 2;
}

try {
  process.exitCode = run(repoRoot(process.cwd()), process.argv.slice(2));
} catch (error) {
  console.error(`regen: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 2;
}
