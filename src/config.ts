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
  TMUX_PATH: z.string().default("tmux"),
  JOB_POLL_INTERVAL_MS: z.coerce.number().default(30_000),
  CONSOLIDATE_INTERVAL_MS: z.coerce.number().default(3_600_000),
  // Embeddings (W4: Ollama)
  EMBED_PROVIDER: z.enum(["openai", "ollama"]).default("ollama"),
  OLLAMA_URL: z.string().default("http://localhost:11434"),
  EMBED_MODEL: z.string().default("nomic-embed-text"),
  // Dashboard auth (W5)
  DASHBOARD_TOKEN: z.string().optional(),
  DASHBOARD_HOST: z.string().default("127.0.0.1"),
  // Job time limits (W6)
  JOBS_DEFAULT_TIMEOUT_MS: z.coerce.number().default(7_200_000),
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
  COMMS_WHATSAPP_BRIDGE_URL: z.string().optional(),
  COMMS_WHATSAPP_TOKEN: z.string().optional(),
  ICLOUD_EMAIL: z.string().optional(),
  ICLOUD_APP_PASSWORD: z.string().optional(),
  YOUTUBE_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  PLAYLIST_ENABLED: z
    .preprocess((v) => String(v ?? "true") !== "false", z.boolean())
    .default(true),
  SELF_HEAL_ENABLED: z
    .preprocess((v) => String(v ?? "false") === "true", z.boolean())
    .default(false),
});

export type Config = z.infer<typeof envSchema>;

export const config: Config = envSchema.parse(Bun.env);
