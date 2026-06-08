#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-/tmp/forgejo-vscode-nested-manual}"
LAUNCH_CURSOR="${LAUNCH_CURSOR:-0}"

if [[ "${2:-}" == "--launch-cursor" || "${1:-}" == "--launch-cursor" ]]; then
  LAUNCH_CURSOR="1"
  if [[ "${1:-}" == "--launch-cursor" ]]; then
    ROOT="/tmp/forgejo-vscode-nested-manual"
  fi
fi

run_git() {
  local cwd="$1"
  shift
  git -C "$cwd" "$@" >/dev/null
}

make_repo() {
  local relative_dir="$1"
  local remote_url="$2"
  local repo_dir="$ROOT/$relative_dir"

  mkdir -p "$repo_dir"
  printf '# %s\n' "$relative_dir" > "$repo_dir/README.md"
  run_git "$repo_dir" init
  run_git "$repo_dir" config user.name 'Forgejo Manual Test'
  run_git "$repo_dir" config user.email 'forgejo-manual-test@example.test'
  run_git "$repo_dir" config commit.gpgsign false
  run_git "$repo_dir" remote add origin "$remote_url"
  run_git "$repo_dir" add README.md
  run_git "$repo_dir" commit -m 'Initial commit'
}

rm -rf "$ROOT"
mkdir -p "$ROOT/.vscode"
cat > "$ROOT/.vscode/settings.json" <<'JSON'
{
  "git.autoRepositoryDetection": "subFolders",
  "git.repositoryScanMaxDepth": 4,
  "forgejo.instances": [
    {
      "id": "codeberg",
      "name": "Codeberg",
      "instanceUrl": "https://codeberg.org",
      "token": "",
      "isDefault": true
    }
  ]
}
JSON

cat > "$ROOT/MANUAL-TEST.md" <<'MD'
# Forgejo nested repository manual test

Open each nested README, then run `Forgejo: Show Diagnostics`.

Expected active configuration:

- `repo-a/README.md` → owner `maxking`, repo `forgejo-vscode`
- `repo-b/README.md` → owner `forgejo`, repo `forgejo`
- `packages/repo-c/README.md` → owner `forgejo-contrib`, repo `forgejo-cli`

The parent folder is intentionally not a Git repository.
MD

make_repo 'repo-a' 'https://codeberg.org/maxking/forgejo-vscode.git'
make_repo 'repo-b' 'https://codeberg.org/forgejo/forgejo.git'
make_repo 'packages/repo-c' 'https://codeberg.org/forgejo-contrib/forgejo-cli.git'

printf 'Created nested repository workspace: %s\n' "$ROOT"
printf 'Repos:\n'
printf '  %s\n' "$ROOT/repo-a" "$ROOT/repo-b" "$ROOT/packages/repo-c"
printf '\nManual verification:\n'
printf '  1. Open the Forgejo sidebar and confirm Pull Requests, Issues, Actions, and Releases are grouped by repository name.\n'
printf '  2. Open each README.md.\n'
printf '  3. Run command palette: Forgejo: Show Diagnostics.\n'
printf '  4. Confirm owner/repo follows the active nested repository.\n'

if [[ "$LAUNCH_CURSOR" == "1" ]]; then
  if command -v cursor >/dev/null 2>&1; then
    cursor "$ROOT" >/dev/null 2>&1 &
    printf '\nLaunched Cursor with workspace: %s\n' "$ROOT"
  else
    printf '\nCursor CLI not found. Open manually: %s\n' "$ROOT" >&2
    exit 1
  fi
fi
