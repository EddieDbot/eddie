import { getYouTubeAccessToken } from "../video/youtube-auth.ts";
import { withBrowserFallback } from "../browser/launcher.ts";

const COOKIE_FILE = `${process.env.HOME ?? "/home/na"}/.claude/google-hub/youtube-studio-cookies.json`;
const STUDIO_URL = "https://studio.youtube.com";
const POLL_INTERVAL_MS = 2_000;
const TIMEOUT_MS = 120_000;

async function getTokenInfo(
  accessToken: string,
): Promise<{ email?: string; error?: string }> {
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${accessToken}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    return (await res.json()) as { email?: string; error?: string };
  } catch {
    return {};
  }
}

async function pollForStudioUrl(
  page: import("playwright").Page,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = page.url();
    if (url.includes("studio.youtube.com") && !url.includes("accounts.google.com")) {
      return true;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

async function main() {
  console.log("Fetching YouTube OAuth access token...");
  const accessToken = await getYouTubeAccessToken();

  const tokenInfo = await getTokenInfo(accessToken);
  if (tokenInfo.email) {
    console.log(`Token owner: ${tokenInfo.email}`);
  } else if (tokenInfo.error) {
    console.warn(`Token info warning: ${tokenInfo.error}`);
  }

  await withBrowserFallback(async (context) => {
    const page = await context.newPage();

    console.log("Navigating to YouTube Studio...");
    await page.goto(STUDIO_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    const currentUrl = page.url();

    if (
      currentUrl.includes("studio.youtube.com") &&
      !currentUrl.includes("accounts.google.com")
    ) {
      console.log("Already logged in to YouTube Studio.");
    } else {
      console.log(
        "\n⚠️  Browser opened on display :99. Connect via VNC or run:",
      );
      console.log("  DISPLAY=:99 xdg-open https://studio.youtube.com");
      console.log(
        "\nLog in to Google when the browser window appears. Waiting 120s...\n",
      );

      const loggedIn = await pollForStudioUrl(page, TIMEOUT_MS);
      if (!loggedIn) {
        throw new Error(
          "Timed out waiting for YouTube Studio login. Run the script again after logging in via VNC.",
        );
      }

      console.log("Login detected.");
    }

    const cookies = await context.cookies();
    await Bun.write(COOKIE_FILE, JSON.stringify(cookies, null, 2));
    console.log(`Cookies saved to ${COOKIE_FILE} (${cookies.length} cookies)`);
  });
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
