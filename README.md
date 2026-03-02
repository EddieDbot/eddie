```
 ███████╗██████╗ ██████╗ ██╗███████╗
 ██╔════╝██╔══██╗██╔══██╗██║██╔════╝
 █████╗  ██║  ██║██║  ██║██║█████╗
 ██╔══╝  ██║  ██║██║  ██║██║██╔══╝
 ███████╗██████╔╝██████╔╝██║███████╗
 ╚══════╝╚═════╝ ╚═════╝ ╚═╝╚══════╝
```

# EDDIE — Every Day Digital Intelligence Engine

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Your always-on AI chief of staff — running 24/7 on your own server, powered by your own Claude subscription.

## What it does

- **Telegram relay** — Send any task to EDDIE via Telegram. Background jobs run autonomously and report back.
- **Semantic memory** — EDDIE remembers what you tell it. Hybrid vector + keyword search over a personal knowledge base.
- **Google integration** — Read email, calendar, and Drive via Google Workspace APIs.
- **Morning briefs** — Daily digest of email, calendar, memory highlights, and weather. Delivered to Telegram at your chosen time.

## Quick Start

**Prerequisites:** Bun, Claude Code subscription, Telegram bot, Supabase project (free tier)

```bash
# Clone and install
git clone https://github.com/EddieDbot/eddie.git
cd eddie
bun install

# Run the onboarding wizard
bun run src/onboarding/wizard.ts
```

The wizard walks you through credentials, Brain Vault setup, and Claude auth. Takes about 5 minutes.

## Architecture

EDDIE is organized in 4 blocks:

| Block | What it does |
|-------|-------------|
| **Core** | Telegram bot, job runner, tmux-based background execution |
| **Memory** | pgvector semantic search, Brain Vault (Obsidian KB), hybrid retrieval |
| **Google** | Gmail, Calendar, Drive via service account or OAuth |
| **Comms** | Slack monitoring, iMessage relay, unified inbox |

## Configuration

Copy `.env.example` to `.env` and fill in your credentials, or use the wizard.

Key vars:

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `OWNER_TELEGRAM_ID` | Your Telegram user ID (from @userinfobot) |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Semantic memory (free tier at supabase.com) |
| `GOOGLE_API_KEY` | Embeddings via gemini-embedding-001 (free tier) |
| `MAX_CONCURRENT_JOBS` | 2 (Pro) / 4 (Max 5x) / 8 (Max 20x) |

See `.env.example` for the full list.

## Community

Join the Skool community for updates, community pieces (agents, workflows, scripts), and support:

👉 **[skool.com/eddie](https://skool.com/eddie)**

## License

MIT — see [LICENSE](./LICENSE)
