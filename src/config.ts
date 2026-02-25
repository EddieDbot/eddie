import { z } from "zod";

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string(),
  OWNER_TELEGRAM_ID: z.coerce.number(),
  CLAUDE_PATH: z.string().default("claude"),
  SESSION_DIR: z.string().default("./sessions"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().default("21m00Tcm4TlvDq8ikWAM"),
  DASHBOARD_PORT: z.coerce.number().default(3000),
  DASHBOARD_ENABLED: z
    .preprocess((v) => String(v ?? "true") !== "false", z.boolean())
    .default(true),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  TWILIO_WEBHOOK_PORT: z.coerce.number().default(8443),
  OWNER_PHONE: z.string().optional(),
  TWILIO_WEBHOOK_URL: z.string().optional(),
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
  KIMI_PATH: z.string().default("kimi"),
  GEMINI_PATH: z
    .string()
    .default("/home/na/.nvm/versions/node/v22.22.0/bin/gemini"),
  CODEX_PATH: z
    .string()
    .default("/home/na/.nvm/versions/node/v22.22.0/bin/codex"),
  TMUX_PATH: z.string().default("tmux"),
  JOB_POLL_INTERVAL_MS: z.coerce.number().default(30_000),
  CONSOLIDATE_INTERVAL_MS: z.coerce.number().default(3_600_000),
  // Embeddings (W4: Ollama)
  EMBED_PROVIDER: z.enum(["openai", "ollama"]).default("ollama"),
  OLLAMA_URL: z.string().default("http://localhost:11434"),
  EMBED_MODEL: z.string().default("nomic-embed-text"),
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
  YOUTUBE_API_KEY: z.string().optional(),
  YOUTUBE_CHANNEL_ID: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  PLAYLIST_ENABLED: z
    .preprocess((v) => String(v ?? "true") !== "false", z.boolean())
    .default(true),
  SELF_HEAL_ENABLED: z
    .preprocess((v) => String(v ?? "false") === "true", z.boolean())
    .default(false),
  DAILY_BRIEF_ENABLED: z
    .preprocess((v) => String(v ?? "false") === "true", z.boolean())
    .default(false),
  DAILY_BRIEF_INTERVAL_MS: z.coerce.number().default(10_800_000),
  MEET_INGEST_ENABLED: z
    .preprocess((v) => String(v ?? "false") === "true", z.boolean())
    .default(false),
  MEET_INGEST_TIME: z.string().default("21:00"),
  BOOK_INGEST_ENABLED: z
    .preprocess((v) => String(v ?? "false") === "true", z.boolean())
    .default(false),
  BOOK_INBOX_POLL_INTERVAL_MS: z.coerce.number().default(300_000),
  IA_S3_ACCESS_KEY: z.string().optional(),
  IA_S3_SECRET_KEY: z.string().optional(),
  CONTACT_SYNC_ENABLED: z
    .preprocess((v) => String(v ?? "false") === "true", z.boolean())
    .default(false),
  CONTACT_SYNC_TIME: z.string().default("03:00"),
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
  WEEKLY_CONTENT_ENABLED: z.coerce.boolean().default(false),
  TRANSCRIPT_WATCHER_ENABLED: z.coerce.boolean().default(false),
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
  BOOK_EXERCISE_EXTRACTION: z.coerce.boolean().default(false),
  // Wave 5 — Tracking + Ingestion
  EXPENSE_TRACKING_ENABLED: z.coerce.boolean().default(false),
  COMMITMENT_TRACKING_ENABLED: z.coerce.boolean().default(false),
  SOCIAL_SNAPSHOT_ENABLED: z.coerce.boolean().default(false),
  YOUTUBE_COMPETITOR_ENABLED: z.coerce.boolean().default(false),
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
  ACCOUNTING_PIPELINE_ENABLED: z.coerce.boolean().default(false),
  OBSERVATION_LOG_ENABLED: z.coerce.boolean().default(false),
  // Wave 8 — Final Polish
  CROSS_PROVIDER_ROUTING_ENABLED: z.coerce.boolean().default(false),
  MONOLOGUE_BRIEF_ENABLED: z.coerce.boolean().default(false),
  ANTHROPIC_MONITOR_ENABLED: z.coerce.boolean().default(false),
  // Video Pipeline
  VIDEO_PIPELINE_ENABLED: z.coerce.boolean().default(false),
  VIDEO_PIPELINE_TIME: z.string().default("13:00"), // 13:00 UTC = 7am CST
});

export type Config = z.infer<typeof envSchema>;

export const config: Config = envSchema.parse(Bun.env);
