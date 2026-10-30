#!/usr/bin/env bash
# Run from a machine with GitHub network access and an authenticated gh CLI.
set -euo pipefail

release_version=0.7.0
release_tag="v${release_version}"
release_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
client_repo="$(cd -- "$release_dir/../.." && pwd)"
server_repo="$(cd -- "$client_repo/../annoy-server" && pwd)"

for executable in git gh node; do
  command -v "$executable" >/dev/null || { echo "Missing command: $executable" >&2; exit 1; }
done
gh auth status --hostname github.com
cmp "$client_repo/packages/protocol/src/index.ts" "$server_repo/packages/protocol/src/index.ts"

# Validate both repositories before publishing either one. Never force-push or replace tags.
for release_repo in "$server_repo" "$client_repo"; do
  if [[ -n "$(git -C "$release_repo" status --porcelain)" ]]; then
    echo "Commit or resolve pending changes first: $release_repo" >&2; exit 1
  fi
  current_version="$(node -p 'require(process.argv[1]).version' "$release_repo/package.json")"
  [[ "$current_version" == "$release_version" ]] || { echo "Unexpected version: $release_repo" >&2; exit 1; }
  git -C "$release_repo" fetch origin --prune --tags
  git -C "$release_repo" merge-base --is-ancestor origin/main HEAD || {
    echo "origin/main has new changes. Integrate and validate them before publishing: $release_repo" >&2; exit 1
  }
  if git -C "$release_repo" rev-parse --verify --quiet "refs/tags/$release_tag" >/dev/null; then
    echo "Tag already exists: $release_tag in $release_repo" >&2; exit 1
  fi
  git -C "$release_repo" symbolic-ref --short HEAD >/dev/null
  test -f "$release_repo/docs/releases/$release_version.md"
done

server_head="$(git -C "$server_repo" rev-parse HEAD)"
client_head="$(git -C "$client_repo" rev-parse HEAD)"
for release_repo in "$server_repo" "$client_repo"; do
  release_branch="$(git -C "$release_repo" symbolic-ref --short HEAD)"
  git -C "$release_repo" push --atomic origin "HEAD:refs/heads/$release_branch" HEAD:refs/heads/main
done

gh release create "$release_tag" --repo GeGLab/annoy-server --target "$server_head" \
  --title "Annoy server $release_version" --notes-file "$server_repo/docs/releases/$release_version.md"
gh release create "$release_tag" --repo GeGLab/annoy-client --target "$client_head" \
  --title "Annoy $release_version" --notes-file "$client_repo/docs/releases/$release_version.md"

echo 'Releases published. The docker and release workflows build and attach the distribution artifacts.'
gh run list --repo GeGLab/annoy-server --workflow docker.yml --limit 1
gh run list --repo GeGLab/annoy-client --workflow release.yml --limit 1
