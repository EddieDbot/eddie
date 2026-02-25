import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";

const TOKEN_FILE = `${process.env.HOME ?? "/home/na"}/.claude/google-hub/youtube-tokens.json`;

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
].join(" ");

interface YouTubeTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

interface OAuthCreds {
  client_id: string;
  client_secret: string;
}

async function loadCreds(): Promise<OAuthCreds | null> {
  const path = config.GOOGLE_OAUTH_CREDENTIALS_PATH;
  if (!path) return null;
  const resolved = path.startsWith("~")
    ? path.replace("~", process.env.HOME ?? "")
    : path;
  try {
    const raw = JSON.parse(await Bun.file(resolved).text()) as Record<
      string,
      unknown
    >;
    return (raw.installed ?? raw.web ?? raw) as OAuthCreds;
  } catch {
    return null;
  }
}

async function loadTokens(): Promise<YouTubeTokens | null> {
  try {
    const raw = await Bun.file(TOKEN_FILE).text();
    return JSON.parse(raw) as YouTubeTokens;
  } catch {
    return null;
  }
}

export async function storeYouTubeTokens(tokens: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}): Promise<void> {
  const toSave: YouTubeTokens = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in,
  };
  await Bun.write(TOKEN_FILE, JSON.stringify(toSave, null, 2));
  logger.info("youtube:auth:tokens-stored", { expires_at: toSave.expires_at });
}

export async function isYouTubeAuthorized(): Promise<boolean> {
  const tokens = await loadTokens();
  return tokens !== null && !!tokens.refresh_token;
}

export async function getYouTubeAccessToken(): Promise<string> {
  const tokens = await loadTokens();
  if (!tokens) {
    throw new Error(
      "YouTube not authorized. Visit /oauth/youtube/start to authorize.",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  if (tokens.expires_at > now + 60) {
    return tokens.access_token;
  }

  const creds = await loadCreds();
  if (!creds) {
    throw new Error(
      "GOOGLE_OAUTH_CREDENTIALS_PATH not configured — cannot refresh YouTube token.",
    );
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: creds.client_id,
      client_secret: creds.client_secret,
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `YouTube token refresh failed ${res.status}: ${body}`,
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  const updated: YouTubeTokens = {
    access_token: data.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
  };

  await Bun.write(TOKEN_FILE, JSON.stringify(updated, null, 2));
  logger.info("youtube:auth:token-refreshed", {
    expires_at: updated.expires_at,
  });

  return updated.access_token;
}

export { SCOPES as YOUTUBE_SCOPES, loadCreds as loadYouTubeCreds };
