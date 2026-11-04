# Shared by the demos: builds regen, then creates a throwaway project and cds into it.
repo=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
[ -f "$repo/dist/cli.js" ] && [ -z "$(find "$repo/src" -newer "$repo/dist/cli.js")" ] ||
  (cd "$repo" && npm run --silent build)

unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
export LC_ALL=C GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

dir=$(mktemp -d "${TMPDIR:-/tmp}/regen-demo.XXXXXX")
trap 'rm -rf "$dir"' EXIT
cd "$dir"

regen() { node "$repo/dist/cli.js" "$@"; }
step() { printf '\n=== %s\n' "$*"; }
fail() { echo "FAILED: $*" >&2; exit 1; }

run() {
  local want=$1 got=0
  shift
  echo "\$ $*"
  "$@" || got=$?
  [ "$got" = "$want" ] || fail "$* exited $got, expected $want"
}

check() {
  local label=$1
  shift
  "$@" >/dev/null || fail "$label"
  echo "ok: $label"
}

clean() { [ -z "$(git status --porcelain)" ]; }
lock_fresh() { node build-locales.js && git diff --quiet -- locales.lock; }

commit_locale() {
  printf '%s\n' "$2" >"locales/$1.json"
  node build-locales.js
  git add -A
  git commit -qm "$3"
}

git init -qb main
git config user.name Demo
git config user.email demo@example.com
mkdir locales

cat >regen.yml <<'YML'
generated:
  - files: [locales.lock]
    run: node build-locales.js
YML

cat >build-locales.js <<'JS'
const { createHash } = require("node:crypto");
const { readdirSync, readFileSync, writeFileSync } = require("node:fs");
const strings = {};
for (const file of readdirSync("locales").sort()) {
  Object.assign(strings, JSON.parse(readFileSync(`locales/${file}`, "utf8")));
}
const body = Object.keys(strings).sort().map((key) => `${key} = ${strings[key]}\n`).join("");
const hash = createHash("sha256").update(body).digest("hex").slice(0, 8);
writeFileSync("locales.lock", `hash ${hash}\n${body}`);
JS

printf '%s\n' '{ "search.go": "Search" }' >locales/search.json
commit_locale checkout '{ "checkout.pay": "Pay now" }' "base project"
