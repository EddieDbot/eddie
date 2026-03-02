import { z } from "zod";
import { homedir } from "node:os";

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string(),
  OWNER_TELEGRAM_ID: z.coerce.number(),
  CLAUDE_PATH: z.string().default("claude"),
  // Owner configuration
  EDDIE_OWNER_NAME: z.string().default("User"),
  EDDIE_OWNER_EMAIL: z.string().default(""),
  EDDIE_HOME: z.string().default(homedir()),
  BRAIN_VAULT_PATH: z.string().default(`${homedir()}/brain-vault`),
  PERSONAL_GIT_REPO: z.string().default(""),
  TAILSCALE_HOST: z.string().default(""),
  SERVER_HOST: z.string().default("localhost"),
  // When set, all claude subprocess invocations use this as HOME so they read
  // credentials from ~/.eddie-home/.claude/ instead of ~/.claude/.
  // Set this after subscribing and running:
  //   HOME=$EDDIE_CLAUDE_HOME claude auth
  EDDIE_CLAUDE_HOME: z.string().optional(),
  SESSION_DIR: z.string().default("./sessions"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  DASHBOARD_PORT: z.coerce.number().default(3000),
  DASHBOARD_ENABLED: z
    .preprocess((v) => String(v ?? "true") !== "false", z.boolean())
    .default(true),
  PROACTIVE_QUIET_START: z.coerce.number().default(22),
  PROACTIVE_QUIET_END: z.coerce.number().default(8),
  HEARTBEAT_ENABLED: z
    .preprocess((v) => String(v ?? "false") === "true", z.boolean())
    .default(false),
  // Active hours (10 AM–10 PM): slower cadence, sends reports to Nicholas
  // Idle hours (10 PM–10 AM): faster cadence, autonomous work only
  HEARTBEAT_ACTIVE_INTERVAL_MS: z.coerce.number().default(3_600_000), // 60 min
  HEARTBEAT_IDLE_INTERVAL_MS: z.coerce.number().default(1_800_000), // 30 min
  HEARTBEAT_ACTIVE_START: z.coerce.number().default(10), // 10 AM
  HEARTBEAT_ACTIVE_END: z.coerce.number().default(22), // 10 PM
  TIMEZONE: z.string().default("America/Chicago"),
  RELAY_MODEL: z.string().default("sonnet"),
  HEARTBEAT_MODEL: z.string().default("haiku"),
  SUPABASE_PAT: z.string().optional(),
  SUPABASE_PROJECT_REF: z.string().optional(),
  JOBS_DATA_DIR: z.string().default("./data"),
  BRAIN_VAULT_JOBS_DIR: z
    .string()
    .default("~/brain-vault/90 - Agent Memory/Jobs"),
  KIMI_PATH: z.string().default("/home/na/.local/bin/kimi"),
  GEMINI_PATH: z.string().default("gemini"),
  CODEX_PATH: z.string().default("codex"),
  TMUX_PATH: z.string().default("tmux"),
  JOB_POLL_INTERVAL_MS: z.coerce.number().default(30_000),
  CONSOLIDATE_INTERVAL_MS: z.coerce.number().default(3_600_000),
  // Embeddings — provider options: "google" (zero RAM, uses GOOGLE_API_KEY), "ollama" (local), "openai"
  EMBED_PROVIDER: z.enum(["openai", "ollama", "google"]).default("google"),
  OLLAMA_URL: z.string().default("http://localhost:11434"),
  EMBED_MODEL: z.string().default("nomic-embed-text"),
  GOOGLE_EMBED_MODEL: z.string().default("gemini-embedding-001"),
  GOOGLE_EMBED_DIMENSIONS: z.coerce.number().default(768),
  // Dashboard auth (W5)
  DASHBOARD_TOKEN: z.string().optional(),
  DASHBOARD_USER: z.string().default("eddie"),
  DASHBOARD_HOST: z.string().default("127.0.0.1"),
  // Job time limits (W6)
  JOBS_DEFAULT_TIMEOUT_MS: z.coerce.number().default(7_200_000),
  MAX_CONCURRENT_JOBS: z.coerce.number().default(4),
  // Cost tracking (W8)
  COST_TRACKING_ENABLED: z
    .preprocess((v) => String(v ?? "true") !== "false", z.boolean())
    .default(true),
  GOAL_TASK_ENABLED: z
    .preprocess((v) => String(v ?? "false") === "true", z.boolean())
    .default(false),
  INTENT_DETECTION_ENABLED: z
    .preprocess((v) => String(v ?? "true") !== "false", z.boolean())
    .default(true),
  DREAM_ENABLED: z
    .preprocess((v) => String(v ?? "false") === "true", z.boolean())
    .default(false),
  DREAM_TIME: z.string().default("02:00"),
  NIGHTLY_ORCHESTRATE_ENABLED: z
    .preprocess((v) => String(v ?? "false") === "true", z.boolean())
    .default(false),
  NIGHTLY_ORCHESTRATE_TIME: z.string().default("02:30"),
  MORNING_BRIEF_ENABLED: z
    .preprocess((v) => String(v ?? "false") === "true", z.boolean())
    .default(false),
  MORNING_BRIEF_TIME: z.string().default("08:00"),
  WHEEL_MAX_JOBS: z.coerce.number().default(3),
  // Unified Communications Layer
  COMMS_ENABLED: z
    .preprocess((v) => String(v ?? "false") === "true", z.boolean())
    .default(false),
  COMMS_NOTIFY_ENABLED: z
    .preprocess((v) => String(v ?? "true") !== "false", z.boolean())
    .default(true),
  COMMS_EMAIL_ACCOUNTS: z.string().optional(), // comma-separated email addresses (e.g. "nicholas@domain.com,eddie@domain.com")
  GOOGLE_SERVICE_ACCOUNT_PATH: z.string().optional(), // path to service account JSON key
  // OR: use existing OAuth user tokens (from google-hub)
  GOOGLE_OAUTH_TOKENS_PATH: z.string().optional(), // path to tokens.json (e.g. ~/.claude/google-hub/tokens.json)
  GOOGLE_OAUTH_CREDENTIALS_PATH: z.string().optional(), // path to credentials.json (client_id/secret)
  COMMS_IMESSAGE_RELAY_URL: z.string().optional(), // e.g. "http://mac-tailscale-ip:3456"
  COMMS_IMESSAGE_RELAY_KEY: z.string().optional(),
  COMMS_SLACK_BOT_TOKEN: z.string().optional(),
  COMMS_SLACK_WATCH_CHANNELS: z.string().optional(), // comma-separated channel IDs
  SLACK_OWNER_USER_ID: z.string().optional(), // Nicholas's Slack user ID for @mention detection
  SLACK_SIGNING_SECRET: z.string().optional(), // Slack app signing secret for request verification
  COMMS_WHATSAPP_BRIDGE_URL: z.string().optional(),
  COMMS_WHATSAPP_TOKEN: z.string().optional(),
  ICLOUD_EMAIL: z.string().optional(),
  ICLOUD_APP_PASSWORD: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  SELF_HEAL_ENABLED: z
    .preprocess((v) => String(v ?? "false") === "true", z.boolean())
    .default(false),
  DAILY_BRIEF_ENABLED: z
    .preprocess((v) => String(v ?? "false") === "true", z.boolean())
    .default(false),
  DAILY_BRIEF_INTERVAL_MS: z.coerce.number().default(10_800_000),
  CLAUDE_HEALTH_ENABLED: z
    .preprocess((v) => String(v ?? "false") === "true", z.boolean())
    .default(false),
  PROVENANCE_ENABLED: z
    .preprocess((v) => String(v ?? "false") === "true", z.boolean())
    .default(false),
  TOOL_TICKER_ENABLED: z
    .preprocess((v) => String(v ?? "false") === "true", z.boolean())
    .default(false),
  VISION_ENABLED: z
    .preprocess((v) => String(v ?? "false") === "true", z.boolean())
    .default(false),
  MIGRATIONS_AUTO_APPLY: z
    .preprocess((v) => String(v ?? "false") === "true", z.boolean())
    .default(false),
  CONTEXT_DRIFT_ENABLED: z.coerce.boolean().default(false),
  CONTEXT_DRIFT_THRESHOLD: z.coerce.number().default(0.1),
  CONTEXT_DRIFT_MIN_SAMPLE: z.coerce.number().int().default(10),
  JOB_QA_GATE_ENABLED: z.coerce.boolean().default(false),
  OUTPUT_SCAN_ENABLED: z.coerce.boolean().default(false),
  INTEGRITY_CHECK_ENABLED: z.coerce.boolean().default(false),
  SELF_IMPROVE_ENABLED: z.coerce.boolean().default(false),
  SELF_IMPROVE_WEEKLY_DAY: z.coerce.number().default(0),
  KANBAN_ENABLED: z.coerce.boolean().default(false),
  GATHER_BEFORE_BRIEF: z.coerce.boolean().default(false),
  // Wave 0B — Persistent Jobs Session
  PERSISTENT_JOBS_SESSION: z.coerce.boolean().default(false),
  // Wave 2 — Security Hardening
  TRUST_CLASSIFICATION_ENABLED: z.coerce.boolean().default(false),
  HOOKS_VALIDATION_ENABLED: z.coerce.boolean().default(false),
  MCP_AUDIT_LOG_ENABLED: z.coerce.boolean().default(false),
  ANOMALY_DETECT_ENABLED: z.coerce.boolean().default(false),
  // Wave 4 — Morning Brief + Commands
  MORNING_BRIEF_NEWS_ENABLED: z.coerce.boolean().default(false),
  COMMITMENT_TRACKING_ENABLED: z.coerce.boolean().default(false),
  URL_INGESTION_ENABLED: z.coerce.boolean().default(false),
  // Wave 6 — Dashboard + Job Execution
  WEB_CHAT_ENABLED: z.coerce.boolean().default(false),
  FRAMEWORK_PROMPTING_ENABLED: z.coerce.boolean().default(false),
  JOB_DISCOVERY_PHASE_ENABLED: z.coerce.boolean().default(false),
  PHASE_GIT_COMMITS_ENABLED: z.coerce.boolean().default(false),
  // Wave 7 — Autonomous Crons
  SECURITY_COUNCIL_ENABLED: z.coerce.boolean().default(false),
  SECURITY_COUNCIL_TIME: z.string().default("03:30"),
  DISCOVERABILITY_ENABLED: z.coerce.boolean().default(false),
  MONTHLY_REVIEW_ENABLED: z.coerce.boolean().default(false),
  OBSERVATION_LOG_ENABLED: z.coerce.boolean().default(false),
  // Wave 8 — Final Polish
  CROSS_PROVIDER_ROUTING_ENABLED: z.coerce.boolean().default(true),
  MONOLOGUE_BRIEF_ENABLED: z.coerce.boolean().default(false),
  ANTHROPIC_MONITOR_ENABLED: z.coerce.boolean().default(false),
  GEMINI_EXTRACT_MODEL: z.string().default("gemini-2.5-flash"),
  AGENT_DASHBOARD_ENABLED: z.coerce.boolean().default(false),
  AGENT_DASHBOARD_POLL_MS: z.coerce.number().default(5_000),
  // Memory monitor
  MEMORY_MONITOR_ENABLED: z.coerce.boolean().default(true),
  MEMORY_WARN_MB: z.coerce.number().default(500),
  MEMORY_WARN_COOLDOWN_MS: z.coerce.number().default(1_800_000), // 30 min
  OPTIMIZER_ENABLED: z.coerce.boolean().default(false),
  OPTIMIZER_TIME: z.string().default("03:00"),
  DOCKER_ENV: z.coerce.boolean().default(false),
  GITHUB_PAT: z.string().optional(),
  GITHUB_PERSONAL_PAT: z.string().optional(),
  // Heimdall — community piece management
  // Comma-separated GitHub handles of trusted contributors. Empty = open (no gate).
  HEIMDALL_TRUSTED_AUTHORS: z.string().optional(),
  // n8n workflow audit
  N8N_API_KEY: z.string().optional(),
  N8N_BASE_URL: z.string().optional(),
  // YouTube (optional)
  YOUTUBE_CHANNEL_ID: z.string().optional(),
  // iMessage contact sync
  CONTACT_SYNC_TIME: z.string().optional(),
  // Internet Archive (optional)
  IA_S3_ACCESS_KEY: z.string().optional(),
  IA_S3_SECRET_KEY: z.string().optional(),
});

export type Config = z.infer<typeof envSchema>;

export const config: Config = envSchema.parse(Bun.env);
