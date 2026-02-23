const RELAY_SAFE_VARS = [
  "HOME",
  "PATH",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "TZ",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
];

const SENSITIVE_VARS = [
  "TELEGRAM_BOT_TOKEN",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_PHONE_NUMBER",
  "TWILIO_WEBHOOK_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_PAT",
  "OPENAI_API_KEY",
  "ELEVENLABS_API_KEY",
  "DASHBOARD_TOKEN",
  "GOOGLE_SERVICE_ACCOUNT_PATH",
  "COMMS_SLACK_BOT_TOKEN",
  "COMMS_WHATSAPP_TOKEN",
  "COMMS_IMESSAGE_RELAY_KEY",
  "ICLOUD_APP_PASSWORD",
];

export function getRelayEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of RELAY_SAFE_VARS) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
  }
  return env;
}

const SESSION_VARS = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS",
  "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE",
];

export function getJobEnvUnsetArgs(): string {
  return [...SENSITIVE_VARS, ...SESSION_VARS]
    .map((v) => `--unset=${v}`)
    .join(" ");
}
