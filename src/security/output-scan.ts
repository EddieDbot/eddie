import { config } from "../config.ts";

type OutputScanResult = {
  clean: boolean;
  redacted: string;
  count: number;
};

type SecretPattern = { name: string; regex: RegExp };

let patterns: SecretPattern[] | null = null;

function buildPatterns(): SecretPattern[] {
  const vars: Array<[string, string | undefined]> = [
    ["TELEGRAM_BOT_TOKEN", config.TELEGRAM_BOT_TOKEN],
    ["SUPABASE_URL", config.SUPABASE_URL],
    ["SUPABASE_ANON_KEY", config.SUPABASE_ANON_KEY],
    ["OPENAI_API_KEY", config.OPENAI_API_KEY],
    ["COMMS_SLACK_BOT_TOKEN", config.COMMS_SLACK_BOT_TOKEN],
    ["COMMS_WHATSAPP_TOKEN", config.COMMS_WHATSAPP_TOKEN],
    ["COMMS_IMESSAGE_RELAY_KEY", config.COMMS_IMESSAGE_RELAY_KEY],
    ["ICLOUD_APP_PASSWORD", config.ICLOUD_APP_PASSWORD],
    ["DASHBOARD_TOKEN", config.DASHBOARD_TOKEN],
    ["IA_S3_ACCESS_KEY", config.IA_S3_ACCESS_KEY],
    ["IA_S3_SECRET_KEY", config.IA_S3_SECRET_KEY],
    ["SLACK_SIGNING_SECRET", config.SLACK_SIGNING_SECRET],
    ["GITHUB_PAT", process.env.GITHUB_PAT],
    ["CHATGPT_PASSWORD", process.env.CHATGPT_PASSWORD],
  ];
  return vars
    .filter(([, v]) => v && v.length > 6)
    .map(([name, value]) => ({
      name,
      regex: new RegExp(escapeRegex(value!), "g"),
    }));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function scanOutput(text: string): OutputScanResult {
  if (!patterns) patterns = buildPatterns();
  let redacted = text;
  let count = 0;
  for (const { name, regex } of patterns) {
    const matches = redacted.match(regex);
    if (matches) {
      count += matches.length;
      redacted = redacted.replace(regex, `[REDACTED:${name}]`);
    }
  }
  return { clean: count === 0, redacted, count };
}

export function redactSecrets(text: string): string {
  return scanOutput(text).redacted;
}
