import { chromium } from "playwright";

const POSTIZ_URL = "https://m7k4x.nac70x7.com";
const POSTIZ_EMAIL = "eddie@nac70x7.com";
const POSTIZ_PASSWORD = "EddieDbot2026!#";
const X_EMAIL = "eddie@nac70x7.com";
const X_PASSWORD = "Urb4na!1992";
const X_USERNAME = "EddieDbot";

async function login(): Promise<string> {
  const resp = await fetch(`${POSTIZ_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: POSTIZ_EMAIL,
      password: POSTIZ_PASSWORD,
      provider: "LOCAL",
    }),
  });
  const cookie =
    resp.headers.get("auth") ||
    resp.headers.get("set-cookie")?.match(/auth=([^;]+)/)?.[1];
  if (!cookie)
    throw new Error(`Login failed: ${resp.status} ${await resp.text()}`);
  console.log("✓ Logged into Postiz");
  return cookie;
}

async function getXAuthUrl(
  token: string,
): Promise<{ url: string; oauthToken: string }> {
  const resp = await fetch(`${POSTIZ_URL}/api/integrations/social/x`, {
    headers: { Cookie: `auth=${token}` },
  });
  if (!resp.ok)
    throw new Error(`Connect init failed: ${resp.status} ${await resp.text()}`);
  const { url } = (await resp.json()) as { url: string };
  const oauthToken = new URL(url).searchParams.get("oauth_token")!;
  console.log(`✓ Got X auth URL, oauth_token: ${oauthToken}`);
  return { url, oauthToken };
}

async function connectX(
  token: string,
  state: string,
  code: string,
): Promise<unknown> {
  const resp = await fetch(`${POSTIZ_URL}/api/integrations/social-connect/x`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `auth=${token}` },
    body: JSON.stringify({ state, code, timezone: "-360" }),
  });
  const body = await resp.json();
  if (!resp.ok)
    throw new Error(
      `social-connect failed: ${resp.status} ${JSON.stringify(body)}`,
    );
  return body;
}

const SCREENSHOT_DIR = "/home/na/brain-vault/00 - Inbox";

async function shot(page: import("playwright").Page, label: string) {
  const path = `${SCREENSHOT_DIR}/x-step-${label}-${Date.now()}.png`;
  await page.screenshot({ path }).catch(() => {});
  console.log(`  📸 ${label}`);
}

async function typeInto(locator: import("playwright").Locator, text: string) {
  await locator.click({ force: true });
  await locator.selectText().catch(() => {});
  await locator.pressSequentially(text, { delay: 50 });
}

async function run() {
  let token = await login();
  let { url: authUrl, oauthToken } = await getXAuthUrl(token);

  for (const headless of [true, false]) {
    console.log(`\nLaunching browser (headless=${headless})...`);

    const browser = await chromium.launch({
      headless,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        ...(headless ? [] : [`--display=:99`]),
      ],
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      env: headless ? undefined : { ...process.env, DISPLAY: ":99" },
    });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    try {
      console.log("Navigating to X OAuth authorize page...");
      await page.goto(authUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      console.log("URL:", page.url());

      // Step A: Click "Sign In" — this navigates to x.com/i/flow/login
      const signInBtn = page
        .locator('input[value="Sign In"], button:has-text("Sign In")')
        .first();
      await signInBtn.waitFor({ state: "visible", timeout: 10000 });
      console.log("Clicking Sign In (triggers navigation to x.com/i/flow/login)...");
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {}),
        signInBtn.click(),
      ]);
      console.log("URL after Sign In:", page.url());
      await shot(page, "01-login-page");

      // Step B: Username/email input — name="text", autocomplete="username"
      console.log("Waiting for username field...");
      const uField = page.locator('input[autocomplete="username"], input[name="text"]').first();
      await uField.waitFor({ state: "visible", timeout: 20000 });
      console.log("Filling username...");
      await typeInto(uField, X_EMAIL);
      await shot(page, "02-username-filled");

      // Click Next
      const nextBtn = page
        .locator('button:has-text("Next"), div[role="button"]:has-text("Next")')
        .first();
      const nextVis = await nextBtn.isVisible().catch(() => false);
      if (nextVis) {
        await nextBtn.click();
      } else {
        await page.keyboard.press("Enter");
      }
      await page.waitForTimeout(3000);
      await shot(page, "03-after-next");

      // Step C': X may ask "Enter your phone number or username" to verify identity
      // This appears when X doesn't recognize the device
      const verifyField = page
        .locator('input[data-testid="ocfEnterTextTextInput"], input[placeholder*="username"]')
        .first();
      const verifyVisible = await verifyField.isVisible().catch(() => false);
      if (verifyVisible) {
        console.log("Identity verification step — entering @EddieDbot...");
        await typeInto(verifyField, X_USERNAME);
        const verifyNext = page
          .locator('button:has-text("Next"), div[role="button"]:has-text("Next")')
          .first();
        if (await verifyNext.isVisible().catch(() => false)) {
          await verifyNext.click();
        } else {
          await page.keyboard.press("Enter");
        }
        await page.waitForTimeout(2000);
        await shot(page, "04-after-verify");
      }

      // Step C: Password
      console.log("Waiting for password field...");
      const pField = page
        .locator('input[name="password"], input[type="password"]')
        .first();
      await pField.waitFor({ state: "visible", timeout: 15000 });
      console.log("Filling password...");
      await typeInto(pField, X_PASSWORD);
      await shot(page, "05-password-filled");

      const loginBtn = page
        .locator('button:has-text("Log in"), button[data-testid="LoginForm_Login_Button"]')
        .first();
      if (await loginBtn.isVisible().catch(() => false)) {
        await loginBtn.click();
      } else {
        await page.keyboard.press("Enter");
      }
      await page.waitForTimeout(4000);
      await shot(page, "06-after-login");

      // Step D: Authorize app button (back on api.x.com/oauth/authorize after login)
      const authBtn = page
        .locator('input[value="Authorize app"], button:has-text("Authorize app"), button:has-text("Authorize")')
        .first();
      const authVis = await authBtn.isVisible().catch(() => false);
      if (authVis) {
        console.log("Clicking Authorize app...");
        await authBtn.click();
        await page.waitForTimeout(2000);
        await shot(page, "07-after-authorize");
      }

      // Wait for redirect back to Postiz
      console.log("Waiting for redirect back to Postiz...");
      await page.waitForURL("**/integrations/social/x**", { timeout: 45000 });

      const callbackUrl = new URL(page.url());
      const cbOauthToken = callbackUrl.searchParams.get("oauth_token");
      const cbOauthVerifier = callbackUrl.searchParams.get("oauth_verifier");

      if (!cbOauthToken || !cbOauthVerifier) {
        throw new Error(`Missing callback params. URL: ${page.url()}`);
      }

      console.log(
        `✓ Callback: oauth_token=${cbOauthToken}, verifier=${cbOauthVerifier.substring(0, 10)}...`,
      );
      await browser.close();

      if (cbOauthToken !== oauthToken) {
        console.log("oauth_token changed, refreshing Postiz state...");
        token = await login();
        await getXAuthUrl(token);
        await new Promise((r) => setTimeout(r, 1000));
      }

      const result = await connectX(token, cbOauthToken, cbOauthVerifier);
      console.log("\n✅ X connected successfully!");
      console.log(JSON.stringify(result, null, 2));
      return;
    } catch (err) {
      const screenshotPath = `${SCREENSHOT_DIR}/postiz-x-debug-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath }).catch(() => {});
      console.error(`✗ Error (headless=${headless}):`, err);
      await browser.close();

      if (!headless) throw err;
      console.log("Retrying in headed mode...");
      token = await login();
      ({ url: authUrl, oauthToken } = await getXAuthUrl(token));
    }
  }
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
