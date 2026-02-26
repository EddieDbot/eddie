/**
 * Playwright-based Google OAuth re-auth for Drive write access.
 * Signs in as eddie@nac70x7.com and saves drive-tokens.json.
 * Run once: bun src/scripts/reauth-google-drive.ts
 */

import { withBrowserFallback } from "../browser/launcher.ts";
import type { BrowserContext, Page } from "playwright";

const CALLBACK_PORT = 3099;
const DRIVE_TOKENS_PATH = `${process.env.HOME}/.claude/google-hub/drive-tokens.json`;
const CREDS_PATH = `${process.env.HOME}/.claude/google-hub/credentials.json`;
const ACCOUNTS_PATH = `${process.env.HOME}/.config/eddie-accounts/credentials.json`;

const credsRaw = JSON.parse(await Bun.file(CREDS_PATH).text()) as Record<string, unknown>;
const oauthCreds = (credsRaw.installed ?? credsRaw.web ?? credsRaw) as {
  client_id: string;
  client_secret: string;
};

const accounts = JSON.parse(await Bun.file(ACCOUNTS_PATH).text()) as {
  google_workspace: { email: string; password: string };
};
const { email, password } = accounts.google_workspace;

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const redirectUri = `http://localhost:${CALLBACK_PORT}/oauth/callback`;

// Start local callback server
let resolveCode: (code: string) => void;
let rejectCode: (err: Error) => void;
const codePromise = new Promise<string>((res, rej) => {
  resolveCode = res;
  rejectCode = rej;
});

const server = Bun.serve({
  port: CALLBACK_PORT,
  fetch(req) {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    if (error) {
      rejectCode(new Error(`OAuth error: ${error}`));
      return new Response(`OAuth error: ${error}`, { status: 400 });
    }
    if (code) {
      resolveCode(code);
      return new Response(
        `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem">
        <h2>✅ Authorization complete</h2><p>Drive tokens saved. You can close this.</p>
        </body></html>`,
        { headers: { "Content-Type": "text/html" } },
      );
    }
    return new Response("Waiting...");
  },
});

setTimeout(() => {
  rejectCode(new Error("OAuth callback timeout (2 min)"));
  server.stop();
}, 120_000);

console.log(`Callback server on :${CALLBACK_PORT}`);

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: oauthCreds.client_id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
  }).toString();

async function completeOAuth(page: Page): Promise<string> {
  console.log("Navigating to Google auth...");
  await page.goto(authUrl, { waitUntil: "domcontentloaded" });

  // Email step
  await page.waitForSelector('input[type="email"]', { timeout: 20_000 });
  await page.fill('input[type="email"]', email);
  await page.click('[data-action="next"], #identifierNext, [jsname="LgbsSe"]', {
    timeout: 5_000,
  }).catch(() => page.keyboard.press("Enter"));
  console.log("Email submitted");

  // Password step
  await page.waitForSelector('input[type="password"]', {
    state: "visible",
    timeout: 15_000,
  });
  await page.fill('input[type="password"]', password);
  await page.click('[data-action="next"], #passwordNext, [jsname="LgbsSe"]', {
    timeout: 5_000,
  }).catch(() => page.keyboard.press("Enter"));
  console.log("Password submitted");

  // Wait for consent screen or account chooser
  await page.waitForURL(
    (url) =>
      url.href.includes("consent") ||
      url.href.includes("localhost:" + CALLBACK_PORT) ||
      url.href.includes("oauthchooseaccount"),
    { timeout: 30_000 },
  );

  // Handle account chooser if shown
  if (page.url().includes("oauthchooseaccount")) {
    const accountBtn = page.locator(`text="${email}"`).first();
    await accountBtn.click({ timeout: 10_000 }).catch(() => {});
    await page.waitForURL((url) => url.href.includes("consent") || url.href.includes("localhost:" + CALLBACK_PORT), {
      timeout: 15_000,
    });
  }

  // Handle consent screen
  if (!page.url().includes("localhost:" + CALLBACK_PORT)) {
    console.log("Consent screen — clicking Allow...");
    // Try various consent button selectors
    await page
      .click(
        '[data-action="id-forward-button"], #submit_approve_access, [jsname="b3VHJd"]',
        { timeout: 10_000 },
      )
      .catch(async () => {
        // Fallback: find button with "Allow", "Continue", or "Confirm" text
        const btn = page.locator('button:has-text("Allow"), button:has-text("Continue"), button:has-text("Confirm")').first();
        await btn.click({ timeout: 10_000 });
      });
  }

  // Wait for callback
  console.log("Waiting for callback...");
  const code = await codePromise;
  return code;
}

try {
  const code = await withBrowserFallback(async (context: BrowserContext) => {
    const page = await context.newPage();
    return completeOAuth(page);
  });

  server.stop();
  console.log("Got authorization code, exchanging for tokens...");

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: oauthCreds.client_id,
      client_secret: oauthCreds.client_secret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });

  if (!tokenRes.ok) {
    throw new Error(`Token exchange failed ${tokenRes.status}: ${await tokenRes.text()}`);
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  };

  const toSave = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: Date.now() + tokens.expires_in * 1000,
    scope: tokens.scope,
    email,
  };

  await Bun.write(DRIVE_TOKENS_PATH, JSON.stringify(toSave, null, 2));
  console.log(`✅ Drive tokens saved to ${DRIVE_TOKENS_PATH}`);
  console.log(`   Scopes: ${tokens.scope}`);
  process.exit(0);
} catch (err) {
  server.stop();
  console.error("❌ Re-auth failed:", err);
  process.exit(1);
}
