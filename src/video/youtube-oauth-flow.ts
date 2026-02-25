// YouTube OAuth flow
// Handles /oauth/youtube/start and /oauth/youtube/callback in the dashboard

import { logger } from "../utils/logger.ts";
import {
  storeYouTubeTokens,
  YOUTUBE_SCOPES,
  loadYouTubeCreds,
} from "./youtube-auth.ts";

function getRedirectUri(req: Request): string {
  const url = new URL(req.url);
  // Use the actual host from the request so Tailscale IP works correctly
  return `${url.protocol}//${url.host}/oauth/youtube/callback`;
}

export async function handleYouTubeOAuthStart(req: Request): Promise<Response> {
  const creds = await loadYouTubeCreds();
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
      scope: YOUTUBE_SCOPES,
      access_type: "offline",
      prompt: "consent",
    }).toString();

  logger.info("youtube:oauth:start", { redirectUri });
  return Response.redirect(authUrl, 302);
}

export async function handleYouTubeOAuthCallback(
  req: Request,
): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    logger.error("youtube:oauth:callback-error", { error });
    return new Response(`OAuth error: ${error}`, { status: 400 });
  }
  if (!code) {
    return new Response("Missing code parameter", { status: 400 });
  }

  const creds = await loadYouTubeCreds();
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
    logger.error("youtube:oauth:token-exchange-failed", {
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

  if (!tokens.refresh_token) {
    logger.error("youtube:oauth:no-refresh-token", {
      hint: "Re-authorize with prompt=consent to get a refresh token",
    });
    return new Response(
      "No refresh_token returned. Revoke app access at https://myaccount.google.com/permissions and try again.",
      { status: 400 },
    );
  }

  await storeYouTubeTokens({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: tokens.expires_in,
  });

  logger.info("youtube:oauth:complete", { scope: tokens.scope });

  return Response.redirect("/?youtube=connected", 302);
}
