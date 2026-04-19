#!/usr/bin/env bash
# Builds a deterministic small repo for tests.
# Usage: make-small-repo.sh <target_dir>
set -euo pipefail
target="${1:?target dir required}"
rm -rf "$target"
mkdir -p "$target"
cd "$target"

git init -q -b main
git config user.email "test@composto.dev"
git config user.name  "Composto Test"
export GIT_AUTHOR_DATE="2026-01-01T10:00:00Z"
export GIT_COMMITTER_DATE="$GIT_AUTHOR_DATE"

commit() {
  local msg="$1"; shift
  local datestr="$1"; shift
  export GIT_AUTHOR_DATE="$datestr"
  export GIT_COMMITTER_DATE="$datestr"
  git add -A
  git commit -q -m "$msg"
}

# 20 commits: 16 features, 3 fixes, 1 revert
echo "export function login() {}" > auth.ts
commit "feat: add login stub" "2026-01-01T10:00:00Z"

echo "export function login(u: string) {}" > auth.ts
commit "feat: login takes username" "2026-01-02T10:00:00Z"

echo "export function login(u: string, p: string) {}" > auth.ts
commit "fix: login missing password param" "2026-01-03T10:00:00Z"

echo "export function logout() {}" > session.ts
commit "feat: add logout" "2026-01-04T10:00:00Z"

echo "export function validate() {}" > token.ts
commit "feat: token validator" "2026-01-05T10:00:00Z"

echo "export function validate(t: string) {}" > token.ts
commit "fix: validate takes token" "2026-01-06T10:00:00Z"

for i in $(seq 7 15); do
  echo "// noop $i" >> notes.md
  commit "docs: note $i" "2026-01-${i}T10:00:00Z"
done

# One commit that touches multiple files
echo "// config update" >> config.json
echo "// deps update" >> package.json
commit "feat: update config and deps" "2026-01-16T10:00:00Z"

# One more feature
echo "export function refresh() {}" > session.ts
commit "feat: add session refresh" "2026-01-16T11:00:00Z"

# Introduce a bug, then revert it
echo "export function validate(t: string) { throw new Error('oops') }" > token.ts
commit "feat: extra validation" "2026-01-17T10:00:00Z"
BUG_SHA=$(git rev-parse HEAD)

export GIT_AUTHOR_DATE="2026-01-18T10:00:00Z"
export GIT_COMMITTER_DATE="$GIT_AUTHOR_DATE"
git revert --no-edit "$BUG_SHA" > /dev/null 2>&1

# One more fix after the revert
echo "export function validate(t: string) { return !!t }" > token.ts
commit "fix: token validator returns boolean" "2026-01-19T10:00:00Z"

echo "Built small repo at $target with $(git rev-list --count HEAD) commits"
