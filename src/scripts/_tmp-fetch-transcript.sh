#!/bin/bash
# Run this to fetch transcript for yEa6dgh7wuc and save to Brain Vault
cd /home/na/eddie
bun run src/scripts/fetch-yt-transcript.ts yEa6dgh7wuc \
  "/home/na/brain-vault/00 - Inbox/yEa6dgh7wuc-claude-code-animations-transcript.md"
echo "Done. File saved to brain-vault/00 - Inbox/"
