// Google OAuth re-authorization flow
// Handles /oauth/google/start and /oauth/google/callback in the dashboard

import { config } from "../../config.ts";
import { logger } from "../../utils/logger.ts";
import { resetOAuthCache } from "./auth.ts";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/youtube",
].join(" ");

type CredType = "installed" | "web";

interface OAuthCreds {
  client_id: string;
  client_secret: string;
  credType: CredType;
}

// ── CSRF state ────────────────────────────────────────────────────────────────
// Maps state token → { chatId, createdAt }. Consumed on callback.

const pendingStates = new Map<string, { chatId: number; createdAt: number }>();
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function createOAuthState(chatId: number): string {
  const state = crypto.randomUUID();
  pendingStates.set(state, { chatId, createdAt: Date.now() });
  return state;
}

export function consumeOAuthState(state: string): number | null {
  const entry = pendingStates.get(state);
  pendingStates.delete(state);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > STATE_TTL_MS) return null;
  return entry.chatId;
}

// ── Credentials ───────────────────────────────────────────────────────────────

async function loadCreds(): Promise<OAuthCreds | null> {
  const path = config.GOOGLE_OAUTH_CREDENTIALS_PATH;
  if (!path) return null;
  const resolved = path.startsWith("~")
    ? path.replace("~", process.env.HOME ?? "")
    : path;
  try {
    const raw = JSON.parse(await Bun.file(resolved).text()) as Record<string, unknown>;
    if (raw.web) return { ...(raw.web as Omit<OAuthCreds, "credType">), credType: "web" };
    if (raw.installed) return { ...(raw.installed as Omit<OAuthCreds, "credType">), credType: "installed" };
    return { ...(raw as unknown as Omit<OAuthCreds, "credType">), credType: "installed" };
  } catch {
    return null;
  }
}

// ── Redirect URI ─────────────────────────────────────────────────────────────
// web creds → use public SERVER_HOST (e.g. slack.nac70x7.com via Cloudflare)
// installed creds → must use localhost (Google restriction)

function getSmartRedirectUri(creds: OAuthCreds, req?: Request): string {
  if (creds.credType === "web") {
    if (req) {
      const url = new URL(req.url);
      return `${url.protocol}//${url.host}/oauth/google/callback`;
    }
    const host = config.SERVER_HOST !== "localhost"
      ? config.SERVER_HOST
      : `localhost:${config.DASHBOARD_PORT}`;
    const proto = host.includes("localhost") ? "http" : "https";
    return `${proto}://${host}/oauth/google/callback`;
  }
  // installed — always localhost
  const port = req
    ? (new URL(req.url).port || String(config.DASHBOARD_PORT))
    : String(config.DASHBOARD_PORT);
  return `http://localhost:${port}/oauth/google/callback`;
}

// ── Telegram notification ─────────────────────────────────────────────────────

async function notifyTelegram(chatId: number, text: string): Promise<void> {
  if (!config.TELEGRAM_BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {}
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Generate an OAuth auth URL for use in the Telegram /connect command. */
export async function generateOAuthUrl(chatId: number): Promise<string | null> {
  const creds = await loadCreds();
  if (!creds) return null;

  const redirectUri = getSmartRedirectUri(creds);
  const state = createOAuthState(chatId);

  return (
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: creds.client_id,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES,
      access_type: "offline",
      prompt: "consent",
      state,
    }).toString()
  );
}

export async function handleOAuthStart(req: Request): Promise<Response> {
  const creds = await loadCreds();
  if (!creds) {
    return new Response("GOOGLE_OAUTH_CREDENTIALS_PATH not configured", { status: 500 });
  }

  const redirectUri = getSmartRedirectUri(creds, req);
  const state = createOAuthState(config.OWNER_TELEGRAM_ID);

  const authUrl =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: creds.client_id,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES,
      access_type: "offline",
      prompt: "consent",
      state,
    }).toString();

  logger.info("google:oauth:start", { redirectUri, credType: creds.credType });
  return Response.redirect(authUrl, 302);
}

export async function handleOAuthCallback(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");

  if (error) {
    logger.error("google:oauth:callback-error", { error });
    return new Response(`OAuth error: ${error}`, { status: 400 });
  }
  if (!code) {
    return new Response("Missing code parameter", { status: 400 });
  }

  const creds = await loadCreds();
  if (!creds) {
    return new Response("Credentials not configured", { status: 500 });
  }

  const redirectUri = getSmartRedirectUri(creds, req);

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    logger.error("google:oauth:token-exchange-failed", { status: tokenRes.status, body });
    return new Response(`Token exchange failed: ${body}`, { status: 500 });
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  };

  const tokensPath = config.GOOGLE_OAUTH_TOKENS_PATH;
  if (!tokensPath) {
    return new Response("GOOGLE_OAUTH_TOKENS_PATH not configured", { status: 500 });
  }
  const resolved = tokensPath.startsWith("~")
    ? tokensPath.replace("~", process.env.HOME ?? "")
    : tokensPath;

  let existingRefreshToken: string | undefined;
  try {
    const existing = JSON.parse(await Bun.file(resolved).text()) as { refresh_token?: string };
    existingRefreshToken = existing.refresh_token;
    await Bun.write(resolved + ".bak", JSON.stringify(existing, null, 2));
  } catch {}

  const toSave = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? existingRefreshToken,
    expiry_date: Date.now() + tokens.expires_in * 1000,
    scope: tokens.scope,
  };

  await Bun.write(resolved, JSON.stringify(toSave, null, 2));
  resetOAuthCache();

  const scopeNames = tokens.scope
    .split(" ")
    .map((s) => s.split("/").pop())
    .join(", ");
  logger.info("google:oauth:reauth-complete", { scopes: scopeNames });

  // Notify the Telegram chat that initiated the flow
  const chatId = state ? (consumeOAuthState(state) ?? config.OWNER_TELEGRAM_ID) : config.OWNER_TELEGRAM_ID;
  await notifyTelegram(chatId, `Google connected.\nScopes: ${scopeNames}`);

  return new Response(
    `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;max-width:500px;margin:auto">
    <h2>✅ Google connected</h2>
    <p><strong>Scopes:</strong> ${scopeNames}</p>
    <p>EDDIE has picked up the new tokens — no restart needed.</p>
    <p style="color:#666;font-size:.9em">Old tokens backed up to tokens.json.bak</p>
    </body></html>`,
    { headers: { "Content-Type": "text/html" } },
  );
}
