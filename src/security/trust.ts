import { config } from "../config.ts";

export enum TrustLevel {
  Owner = "owner",      // Nicholas — full trust
  Known = "known",      // Whitelisted services (Google, Supabase, etc.)
  External = "external", // Third-party APIs, public web
  Untrusted = "untrusted", // User-generated content, unknown sources
}

type SourceClassification = {
  level: TrustLevel;
  reason: string;
};

const KNOWN_SOURCES = [
  "gmail", "gmail-eddie", "google-calendar", "google-drive",
  "supabase", "slack", "youtube",
];

const TRUSTED_DOMAINS = [
  "googleapis.com", "google.com", "supabase.co",
  "slack.com", "youtube.com", "anthropic.com",
];

export function classifySource(source: string): SourceClassification {
  if (!config.TRUST_CLASSIFICATION_ENABLED) {
    return { level: TrustLevel.External, reason: "classification disabled" };
  }

  // Owner channel check
  if (source === "owner" || source === "telegram") {
    return { level: TrustLevel.Owner, reason: "owner channel" };
  }

  // Known EDDIE integrations
  if (KNOWN_SOURCES.includes(source)) {
    return { level: TrustLevel.Known, reason: `known source: ${source}` };
  }

  // Domain check for URLs
  try {
    const url = new URL(source);
    if (TRUSTED_DOMAINS.some(d => url.hostname.endsWith(d))) {
      return { level: TrustLevel.Known, reason: `trusted domain: ${url.hostname}` };
    }
  } catch {
    // Not a URL
  }

  // Web content / user input
  if (source.startsWith("http://") || source.startsWith("https://")) {
    return { level: TrustLevel.External, reason: "external URL" };
  }

  return { level: TrustLevel.Untrusted, reason: "unknown source" };
}

export function isTrusted(source: string, minimum = TrustLevel.Known): boolean {
  const levels = [TrustLevel.Owner, TrustLevel.Known, TrustLevel.External, TrustLevel.Untrusted];
  const { level } = classifySource(source);
  return levels.indexOf(level) <= levels.indexOf(minimum);
}
