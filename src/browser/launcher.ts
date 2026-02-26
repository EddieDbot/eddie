import {
  chromium as playwrightChromium,
  type Browser,
  type BrowserContext,
} from "playwright";
import { chromium as stealthChromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { execSync, spawn } from "child_process";

stealthChromium.use(StealthPlugin());

export type BrowserMode = "headless" | "headed" | "stealth";

const XVFB_DISPLAY = ":99";

const BASE_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-blink-features=AutomationControlled",
];

const STEALTH_ARGS = [
  ...BASE_ARGS,
  "--disable-web-security",
  "--disable-features=IsolateOrigins,site-per-process",
  "--disable-infobars",
  "--window-size=1920,1080",
];

function isXvfbRunning(): boolean {
  try {
    execSync(`DISPLAY=${XVFB_DISPLAY} xdpyinfo > /dev/null 2>&1`);
    return true;
  } catch {
    return false;
  }
}

async function ensureXvfb(): Promise<void> {
  if (isXvfbRunning()) return;
  spawn("Xvfb", [XVFB_DISPLAY, "-screen", "0", "1920x1080x24"], {
    detached: true,
    stdio: "ignore",
  }).unref();
  await new Promise((r) => setTimeout(r, 800));
}

export async function launchBrowser(
  mode: BrowserMode = "headless",
): Promise<Browser> {
  const headed = mode !== "headless";

  if (headed) await ensureXvfb();

  const env = headed ? { ...process.env, DISPLAY: XVFB_DISPLAY } : process.env;

  const launcher = mode === "stealth" ? stealthChromium : playwrightChromium;

  return launcher.launch({
    headless: !headed,
    args: mode === "stealth" ? STEALTH_ARGS : BASE_ARGS,
    env: env as Record<string, string>,
  });
}

export async function createContext(
  browser: Browser,
  mode: BrowserMode,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    // @ts-ignore
    delete navigator.__proto__.webdriver;
  });

  return context;
}

const FALLBACK_ORDER: BrowserMode[] = ["headless", "headed", "stealth"];

export async function withBrowserFallback<T>(
  fn: (context: BrowserContext, mode: BrowserMode) => Promise<T>,
): Promise<T> {
  let lastError: Error = new Error("No modes attempted");

  for (const mode of FALLBACK_ORDER) {
    const browser = await launchBrowser(mode);
    try {
      const context = await createContext(browser, mode);
      const result = await fn(context, mode);
      await browser.close();
      return result;
    } catch (err) {
      await browser.close();
      lastError = err as Error;
      const isBlocked =
        err instanceof Error &&
        (err.name === "BlockedError" || err.message.includes("Blocked at"));
      if (!isBlocked) throw err; // non-block errors bubble up immediately
      console.log(
        `[browser] ${mode} blocked — retrying with ${FALLBACK_ORDER[FALLBACK_ORDER.indexOf(mode) + 1] ?? "nothing"}`,
      );
    }
  }

  throw lastError;
}
