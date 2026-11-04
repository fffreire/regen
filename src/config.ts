import picomatch from "picomatch";
import { parse } from "yaml";

export type Rule = { files: string[]; run: string };

export function parseConfig(text: string): Rule[] {
  const generated: unknown = parse(text)?.generated;
  if (!Array.isArray(generated) || generated.length === 0) {
    throw new Error("regen.yml needs a non-empty `generated` list");
  }
  return generated.map((rule: Partial<Rule> | null, index) => {
    const { files, run } = rule ?? {};
    const validFiles =
      Array.isArray(files) &&
      files.length > 0 &&
      files.every((file) => typeof file === "string" && file !== "");
    if (!validFiles || typeof run !== "string" || run.trim() === "") {
      throw new Error(`regen.yml: generated[${index}] needs \`files\` and \`run\``);
    }
    return { files, run };
  });
}

export const matches = (rule: Rule, path: string) =>
  picomatch.isMatch(path, rule.files, { dot: true });

export function classify(rules: Rule[], paths: string[]) {
  return {
    source: paths.filter((path) => !rules.some((rule) => matches(rule, path))),
    rules: rules.filter((rule) => paths.some((path) => matches(rule, path))),
  };
}
