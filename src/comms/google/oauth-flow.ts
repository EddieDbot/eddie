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

function getRedirectUri(req: Request): string {
  const url = new URL(req.url);
  // Desktop app OAuth credentials only allow http://localhost as redirect URI.
  // If the request came from a non-localhost host, still use localhost so Google
  // accepts it — the callback will be received on the server's dashboard port.
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return `http://localhost:${port}/oauth/google/callback`;
}

export async function handleOAuthStart(req: Request): Promise<Response> {
  const creds = await loadCreds();
  if (!creds) {
    return new Response("GOOGLE_OAUTH_CREDENTIALS_PATH not configured", {
      status: 500,
    });
  }

  const redirectUri = getRedirectUri(req);
  const authUrl =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: creds.client_id,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES,
      access_type: "offline",
      prompt: "consent",
    }).toString();

  logger.info("google:oauth:start", { redirectUri });
  return Response.redirect(authUrl, 302);
}

export async function handleOAuthCallback(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

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

  const redirectUri = getRedirectUri(req);

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
    logger.error("google:oauth:token-exchange-failed", {
      status: tokenRes.status,
      body,
    });
    return new Response(`Token exchange failed: ${body}`, { status: 500 });
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  };

  // Load existing tokens to preserve refresh_token if Google didn't return a new one
  const tokensPath = config.GOOGLE_OAUTH_TOKENS_PATH;
  if (!tokensPath)
    return new Response("GOOGLE_OAUTH_TOKENS_PATH not configured", {
      status: 500,
    });
  const resolved = tokensPath.startsWith("~")
    ? tokensPath.replace("~", process.env.HOME ?? "")
    : tokensPath;

  let existingRefreshToken: string | undefined;
  try {
    const existing = JSON.parse(await Bun.file(resolved).text()) as {
      refresh_token?: string;
    };
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

  return new Response(
    `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;max-width:500px;margin:auto">
    <h2>✅ Google re-authorized</h2>
    <p><strong>Scopes:</strong> ${scopeNames}</p>
    <p>EDDIE has picked up the new tokens — no restart needed.</p>
    <p style="color:#666;font-size:.9em">Old tokens backed up to tokens.json.bak</p>
    </body></html>`,
    { headers: { "Content-Type": "text/html" } },
  );
}
