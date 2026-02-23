#!/bin/bash
# Safe git pull for EDDIE — runs before service start
# Exits 0 always so a pull failure never blocks startup

cd /home/na/eddie || exit 0

# Only pull if we can reach GitHub
if ! git fetch --dry-run 2>/dev/null; then
  echo "[eddie:git-pull] fetch failed — skipping pull, starting with current code"
  exit 0
fi

BEFORE=$(git rev-parse HEAD)
git pull --ff-only 2>&1 || {
  echo "[eddie:git-pull] pull failed (merge conflict?) — starting with current code"
  exit 0
}
AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" != "$AFTER" ]; then
  echo "[eddie:git-pull] updated $(git log --oneline "$BEFORE..$AFTER" | wc -l) commit(s)"
  # Reinstall deps if package.json changed
  if git diff --name-only "$BEFORE" "$AFTER" | grep -q "package.json"; then
    echo "[eddie:git-pull] package.json changed — running bun install"
    /home/na/.bun/bin/bun install
  fi
else
  echo "[eddie:git-pull] already up to date"
fi

exit 0
