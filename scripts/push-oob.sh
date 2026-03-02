#!/bin/bash
# Push current main to EddieDbot/eddie (OOB public repo)
# Automatically rewrites author email to EddieDbot no-reply for GitHub compliance

set -e

NOREPLY="263855383+EddieDbot@users.noreply.github.com"
PERSONAL="eddie@nac70x7.com"
COMMITS="${1:-1}"  # number of commits to rewrite, default 1

echo "Pushing $COMMITS commit(s) from v1 to EddieDbot/eddie..."

git config user.email "$NOREPLY"
git rebase "HEAD~${COMMITS}" --exec 'git commit --amend --reset-author --no-edit' -q
git push eddiedbot v1:main --force-with-lease
git push eddiedbot v1:next --force-with-lease
git config user.email "$PERSONAL"

# Sync personal repo with rebased commits
git push origin v1 --force-with-lease

echo "Done. Both remotes updated."
