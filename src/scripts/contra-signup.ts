/**
 * Contra account creation script for EDDIE's agent commerce account.
 * Uses Playwright to navigate signup, then checks eddie@nac70x7.com for verification.
 *
 * Run: bun run src/scripts/contra-signup.ts
 */

import { chromium } from "playwright";
import { homedir } from "node:os";
import { getAccessToken } from "../comms/google/auth.ts";

const EMAIL = "eddie@nac70x7.com";
const NAME_FIRST = "EDDIE";
const NAME_LAST = "Agent";

async function waitForVerificationEmail(
  maxWaitMs = 120_000,
): Promise<string | null> {
  console.log("Waiting for verification email from Contra...");
  const token = await getAccessToken(
    "https://www.googleapis.com/auth/gmail.modify",
    EMAIL,
  );

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const res = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=from:contra.com&maxResults=10",
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = (await res.json()) as { messages?: Array<{ id: string }> };

    if (data.messages && data.messages.length > 0) {
      for (const msg of data.messages) {
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const msgData = (await msgRes.json()) as {
          payload?: {
            body?: { data?: string };
            parts?: Array<{ body?: { data?: string } }>;
          };
        };

        let body = "";
        if (msgData.payload?.body?.data) {
          body = Buffer.from(msgData.payload.body.data, "base64").toString(
            "utf-8",
          );
        } else if (msgData.payload?.parts) {
          for (const part of msgData.payload.parts) {
            if (part.body?.data) {
              body += Buffer.from(part.body.data, "base64").toString("utf-8");
            }
          }
        }

        const linkMatch = body.match(
          /https:\/\/contra\.com[^\s"<>]*(verify|confirm|activate)[^\s"<>]*/i,
        );
        if (linkMatch) {
          console.log("Found verification link:", linkMatch[0]);
          return linkMatch[0];
        }
      }
    }

    console.log("No verification email yet, waiting 5s...");
    await Bun.sleep(5000);
  }
  return null;
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
  });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
    timezoneId: "America/Chicago",
  });
  // Remove webdriver property to avoid bot detection
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await context.newPage();
  const outputDir = `${homedir()}/.claude/playwright-output`;

  try {
    console.log("Navigating to Contra home...");
    await page.goto("https://contra.com", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${outputDir}/contra-01-landing.png` });
    console.log("Loaded. URL:", page.url());

    // Click Sign Up in nav
    const signUpBtn = page.getByRole("button", { name: /sign up/i }).first();
    const signUpLink = page.getByRole("link", { name: /sign up/i }).first();
    if (await signUpBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log("Clicking Sign Up button...");
      await signUpBtn.click();
    } else if (
      await signUpLink.isVisible({ timeout: 3000 }).catch(() => false)
    ) {
      console.log("Clicking Sign Up link...");
      await signUpLink.click();
    }
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${outputDir}/contra-02-after-click.png` });
    console.log("After Sign Up click. URL:", page.url());

    // Wait for the modal with the signup form
    await page
      .waitForSelector('input[placeholder="First name"]', { timeout: 8000 })
      .catch(() => null);
    await page.screenshot({ path: `${outputDir}/contra-03-modal.png` });

    // Fill First Name
    const firstField = page.locator('input[placeholder="First name"]').first();
    if (await firstField.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log("Filling first name...");
      await firstField.fill(NAME_FIRST);
    }

    // Fill Last Name
    const lastField = page.locator('input[placeholder="Last name"]').first();
    if (await lastField.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log("Filling last name...");
      await lastField.fill(NAME_LAST);
    }

    // Fill Email
    const emailField = page
      .locator('input[type="email"], input[placeholder*="email" i]')
      .first();
    if (await emailField.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log("Filling email:", EMAIL);
      await emailField.fill(EMAIL);
    }

    await page.screenshot({ path: `${outputDir}/contra-04-form-filled.png` });
    console.log("Form filled.");

    // Try Cloudflare Turnstile CAPTCHA
    // Turnstile creates an iframe — try clicking the checkbox inside it
    const frames = page.frames();
    console.log("Frames on page:", frames.length);
    for (const frame of frames) {
      const url = frame.url();
      if (
        url.includes("cloudflare") ||
        url.includes("turnstile") ||
        url.includes("challenges")
      ) {
        console.log("Found CAPTCHA frame:", url);
        const checkbox = frame.locator('input[type="checkbox"]').first();
        if (await checkbox.isVisible({ timeout: 2000 }).catch(() => false)) {
          console.log("Clicking CAPTCHA checkbox...");
          await checkbox.click();
          await page.waitForTimeout(2000);
        }
        break;
      }
    }

    await page.screenshot({ path: `${outputDir}/contra-05-pre-submit.png` });

    // Click Continue — use force:true to bypass modal backdrop issues
    const continueBtn = page
      .getByRole("button", { name: /^Continue$/i })
      .first();
    if (await continueBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log("Clicking Continue...");
      await continueBtn.click({ force: true });
      await page.waitForTimeout(5000);
    } else {
      console.log("Continue button not found.");
    }

    await page.screenshot({ path: `${outputDir}/contra-06-after-submit.png` });
    console.log("Post-submit URL:", page.url());

    // Check for verification email
    const verifyLink = await waitForVerificationEmail(120_000);
    if (verifyLink) {
      console.log("Navigating to verification link...");
      await page.goto(verifyLink, { waitUntil: "networkidle" });
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${outputDir}/contra-07-verified.png` });
      console.log("Verified! Final URL:", page.url());
    } else {
      console.log("No verification email — may need manual verification.");
    }

    await page.screenshot({ path: `${outputDir}/contra-08-final.png` });
    console.log("Final URL:", page.url());
    console.log("Done. Screenshots in:", outputDir);
  } catch (err) {
    console.error("Signup error:", err);
    await page.screenshot({ path: `${outputDir}/contra-error.png` });
  } finally {
    await browser.close();
  }
}

main();
