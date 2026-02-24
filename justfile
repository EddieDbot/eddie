# EDDIE Development Commands

# Launch claude with project settings
cli:
    claude --settings /home/na/eddie/.claude/settings.json

# Run type checks
check:
    cd /home/na/eddie && /home/na/.bun/bin/bun run tsc --noEmit

# Run tests
test:
    cd /home/na/eddie && /home/na/.bun/bin/bun test

# Deploy (restart service)
deploy:
    systemctl --user restart eddie

# View live logs
logs:
    journalctl --user -u eddie -f

# Install dependencies
setup:
    cd /home/na/eddie && /home/na/.bun/bin/bun install

# Build check + deploy
release: check deploy
    @echo "Deployed successfully"

# Create a Custom GPT via Playwright
# Usage: just gpt "Name" "Instructions" ["Description"] [file=/path/to/file]
gpt name instructions description="":
    cd /home/na/eddie && /home/na/.bun/bin/bun run src/scripts/create-gpt.ts --name "{{name}}" --instructions "{{instructions}}" --description "{{description}}"
