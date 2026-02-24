import { config } from "../../config.ts";
import { logger } from "../../utils/logger.ts";

export interface ServiceAccount {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
}

interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  expiry_date?: number;
}

interface OAuthCredentials {
  client_id: string;
  client_secret: string;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, TokenCache>();

// ─── Service Account (JWT) Auth ───────────────────────────────────────────────

function pemToDer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(base64);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
  return buffer.buffer;
}

function base64url(data: ArrayBuffer | string): string {
  let b64: string;
  if (typeof data === "string") {
    b64 = btoa(data);
  } else {
    const bytes = new Uint8Array(data);
    let bin = "";
    for (const byte of bytes) bin += String.fromCharCode(byte);
    b64 = btoa(bin);
  }
  return b64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function signJWT(
  sa: ServiceAccount,
  scope: string,
  subject?: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: sa.private_key_id };
  const payload: Record<string, unknown> = {
    iss: sa.client_email,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  if (subject) payload.sub = subject;

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const message = `${headerB64}.${payloadB64}`;

  const keyDer = pemToDer(sa.private_key);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(message),
  );
  return `${message}.${base64url(signature)}`;
}

async function fetchServiceAccountToken(
  sa: ServiceAccount,
  scope: string,
  subject?: string,
): Promise<string> {
  const jwt = await signJWT(sa, scope, subject);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok)
    throw new Error(`SA token fetch failed ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

let serviceAccount: ServiceAccount | null = null;
let saLoadAttempted = false;

async function loadServiceAccount(): Promise<ServiceAccount | null> {
  if (serviceAccount) return serviceAccount;
  if (saLoadAttempted) return null;
  saLoadAttempted = true;
  const path = config.GOOGLE_SERVICE_ACCOUNT_PATH;
  if (!path) return null;
  try {
    const resolved = path.startsWith("~")
      ? path.replace("~", process.env.HOME ?? "")
      : path;
    serviceAccount = JSON.parse(
      await Bun.file(resolved).text(),
    ) as ServiceAccount;
    logger.info("google:auth:sa-loaded", {
      client_email: serviceAccount.client_email,
    });
    return serviceAccount;
  } catch (err) {
    logger.error("google:auth:load-sa", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ─── OAuth User Token (Refresh Token) Auth ────────────────────────────────────

let oauthTokens: OAuthTokens | null = null;
let oauthCreds: OAuthCredentials | null = null;
// Promise-based init to avoid race condition when multiple pollers start simultaneously
let oauthLoadPromise: Promise<{
  tokens: OAuthTokens;
  creds: OAuthCredentials;
} | null> | null = null;

function resolvePath(p: string): string {
  return p.startsWith("~") ? p.replace("~", process.env.HOME ?? "") : p;
}

async function doLoadOAuthTokens(): Promise<{
  tokens: OAuthTokens;
  creds: OAuthCredentials;
} | null> {
  const tokensPath = config.GOOGLE_OAUTH_TOKENS_PATH;
  const credsPath = config.GOOGLE_OAUTH_CREDENTIALS_PATH;
  if (!tokensPath || !credsPath) return null;
  try {
    const [tokensRaw, credsRaw] = await Promise.all([
      Bun.file(resolvePath(tokensPath)).text(),
      Bun.file(resolvePath(credsPath)).text(),
    ]);
    oauthTokens = JSON.parse(tokensRaw) as OAuthTokens;
    const credsData = JSON.parse(credsRaw) as Record<string, unknown>;
    oauthCreds = (credsData.installed ??
      credsData.web ??
      credsData) as OAuthCredentials;
    logger.info("google:auth:oauth-loaded", { tokensPath, credsPath });
    return { tokens: oauthTokens, creds: oauthCreds };
  } catch (err) {
    logger.error("google:auth:load-oauth", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function loadOAuthTokens(): Promise<{
  tokens: OAuthTokens;
  creds: OAuthCredentials;
} | null> {
  if (oauthTokens && oauthCreds)
    return { tokens: oauthTokens, creds: oauthCreds };
  if (!oauthLoadPromise) oauthLoadPromise = doLoadOAuthTokens();
  return oauthLoadPromise;
}

async function refreshOAuthToken(
  tokens: OAuthTokens,
  creds: OAuthCredentials,
): Promise<string> {
  // Check if current access_token is still valid
  if (tokens.expiry_date && tokens.expiry_date > Date.now() + 60_000) {
    return tokens.access_token;
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
    client_id: creds.client_id,
    client_secret: creds.client_secret,
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok)
    throw new Error(`OAuth refresh failed ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  // Update cached tokens with new access_token + expiry
  oauthTokens = {
    ...tokens,
    access_token: data.access_token,
    expiry_date: Date.now() + data.expires_in * 1000,
  };

  // Persist refreshed token back to disk
  const tokensPath = config.GOOGLE_OAUTH_TOKENS_PATH;
  if (tokensPath) {
    try {
      await Bun.write(
        resolvePath(tokensPath),
        JSON.stringify(oauthTokens, null, 2),
      );
    } catch {
      // non-fatal
    }
  }

  return data.access_token;
}

// ─── Cache Reset (called after re-auth) ───────────────────────────────────────

export function resetOAuthCache(): void {
  oauthTokens = null;
  oauthCreds = null;
  oauthLoadPromise = null;
  tokenCache.clear();
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getAccessToken(
  scope: string,
  subject?: string,
): Promise<string> {
  const cacheKey = `${scope}:${subject ?? ""}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  // Prefer service account when configured (no expiry, no re-auth)
  const sa = await loadServiceAccount();
  if (sa) {
    try {
      const token = await fetchServiceAccountToken(sa, scope, subject);
      tokenCache.set(cacheKey, { token, expiresAt: Date.now() + 3_500_000 });
      return token;
    } catch (err) {
      logger.warn("google:auth:sa-fallback", {
        error: err instanceof Error ? err.message : String(err),
        subject,
      });
      // fall through to OAuth
    }
  }

  // Fall back to OAuth user tokens
  const oauth = await loadOAuthTokens();
  if (oauth) {
    const token = await refreshOAuthToken(oauth.tokens, oauth.creds);
    tokenCache.set(cacheKey, { token, expiresAt: Date.now() + 3_500_000 });
    return token;
  }

  throw new Error(
    "No Google auth configured. Set GOOGLE_SERVICE_ACCOUNT_PATH or GOOGLE_OAUTH_TOKENS_PATH + GOOGLE_OAUTH_CREDENTIALS_PATH.",
  );
}

export function hasGoogleAuth(): boolean {
  return !!(
    config.GOOGLE_OAUTH_TOKENS_PATH || config.GOOGLE_SERVICE_ACCOUNT_PATH
  );
}
