#!/usr/bin/env node
import { classify, parseConfig } from "./config.ts";
import { conflictedPaths, readConfig, repoRoot } from "./git.ts";

const USAGE = "usage: regen status";

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

function main(args: string[]) {
  if (args[0] !== "status" || args.length !== 1) {
    console.error(USAGE);
    return 2;
  }
  try {
    return status(repoRoot(process.cwd()));
  } catch (error) {
    console.error(`regen: ${error instanceof Error ? error.message : error}`);
    return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
