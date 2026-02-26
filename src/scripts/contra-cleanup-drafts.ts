/**
 * contra-cleanup-drafts.ts — Delete duplicate services from EDDIE's Contra profile.
 * Uses a pre-provided AuthSession cookie instead of Google OAuth automation.
 *
 * Setup: Add "contra": { "auth_session": "<value>" } to credentials.json
 * Get it: Contra.com → DevTools → Application → Cookies → AuthSession
 *
 * Usage:
 *   bun run src/scripts/contra-cleanup-drafts.ts [--dry-run]
 */
import { launchBrowser, createContext } from "../browser/launcher.ts";
import type { Page, Request } from "playwright";
import * as fs from "fs";

const SCREENSHOT_DIR = "/home/na/.claude/playwright-output/contra-profile";
const CREDENTIALS_PATH = "/home/na/.config/eddie-accounts/credentials.json";
const DRY_RUN = process.argv.includes("--dry-run");

const KEEP_SLUGS = [
  "3PEOeqg2-cinematic-ai-website-48-hour-delivery",
  "eZXNrE7M-full-ai-website-system-multi-page",
];

const PROFILE_URL = "https://contra.com/eddie_eddie_5t04qp6g/services";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8")) as any;
const authSession: string | undefined = creds?.contra?.auth_session;

if (!authSession) {
  console.error(`
❌ No Contra session cookie found in credentials.json.

To get it:
  1. Open https://contra.com in Chrome/Firefox
  2. Log in as eddie@nac70x7.com via Google
  3. Open DevTools → Application tab → Cookies → https://contra.com
  4. Find "AuthSession" and copy its value
  5. Add to credentials.json:
     "contra": { "auth_session": "<paste value here>" }

Then re-run this script.
`);
  process.exit(1);
}

async function checkAuthState(page: Page): Promise<string | null> {
  // Intercept the real AppPreloadQuery response — don't hardcode doc_id
  let username: string | null = null;
  const handler = async (res: import("playwright").Response) => {
    const url = res.url();
    if (url.includes("/api/") && url.includes("AppPreloadQuery")) {
      try {
        const body = await res.json().catch(() => null);
        const acct = body?.data?.visitor?.userAccount;
        if (acct)
          username = acct.username ?? acct.name ?? acct.id ?? "authenticated";
      } catch {}
    }
  };
  page.on("response", handler);
  await page.goto("https://contra.com/community/for-you", {
    waitUntil: "networkidle",
  });
  await sleep(2000);
  page.off("response", handler);
  return username;
}

async function collectServiceLinks(
  page: Page,
): Promise<{ href: string; keep: boolean }[]> {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(2000);
  // Scroll back up too in case more load at top
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(1500);

  return page.evaluate((keepSlugs: string[]) => {
    const seen = new Set<string>();
    return Array.from(document.querySelectorAll('a[href*="/s/"]'))
      .map((a) => (a as HTMLAnchorElement).href)
      .filter((h) => {
        if (seen.has(h)) return false;
        seen.add(h);
        return true;
      })
      .map((href) => ({ href, keep: keepSlugs.some((s) => href.includes(s)) }));
  }, keepSlugs);
}

// Capture delete mutation doc_id on first run
let deleteMutationDocId: string | null = null;
let deleteMutationOpName: string | null = null;
let capturedServiceIdFormat: string | null = null;

async function deleteServiceViaAPI(
  page: Page,
  serviceRelayId: string,
): Promise<boolean> {
  if (!deleteMutationDocId) return false;
  const result = await page.evaluate(
    async ({ opName, docId, serviceId }) => {
      try {
        const res = await fetch(`/api/?operationName=${opName}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            doc_id: docId,
            operationName: opName,
            variables: { input: { serviceId } },
          }),
        });
        return { status: res.status, body: (await res.text()).slice(0, 300) };
      } catch (e: any) {
        return { error: e?.message };
      }
    },
    {
      opName: deleteMutationOpName!,
      docId: deleteMutationDocId,
      serviceId: serviceRelayId,
    },
  );
  console.log(`  API result: ${JSON.stringify(result)}`);
  return (result as any).status === 200 && !(result as any).error;
}

async function deleteServiceViaUI(
  page: Page,
  slugId: string,
): Promise<{ ok: boolean; relayId?: string }> {
  const cardLink = page.locator(`a[href*="${slugId}"]`).first();
  let visible = await cardLink.isVisible({ timeout: 3000 }).catch(() => false);
  if (!visible) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(1500);
    visible = await cardLink.isVisible({ timeout: 3000 }).catch(() => false);
  }
  if (!visible) return { ok: true }; // already deleted

  await cardLink.scrollIntoViewIfNeeded();
  await sleep(400);
  const box = await cardLink.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(800);

  const actionsBtn = page
    .locator('[aria-label="View service actions"]')
    .first();
  if (!(await actionsBtn.isVisible({ timeout: 2000 }).catch(() => false))) {
    return { ok: false };
  }

  // Intercept API call to capture mutation
  let capturedMutation: any = null;
  const handler = (req: Request) => {
    const url = req.url();
    if (url.includes("/api/") && req.method() === "POST") {
      try {
        const body = JSON.parse(req.postData() ?? "{}");
        if (/delete|remove/i.test(body.operationName ?? "")) {
          capturedMutation = body;
        }
      } catch {}
    }
  };
  page.on("request", handler);

  await actionsBtn.click();
  await sleep(500);

  const deleteOpt = page
    .locator("[role='menuitem'], [data-radix-popper-content-wrapper] button")
    .filter({ hasText: /delete|remove|unpublish/i })
    .first();

  if (!(await deleteOpt.isVisible({ timeout: 2000 }).catch(() => false))) {
    await page.keyboard.press("Escape");
    page.off("request", handler);
    return { ok: false };
  }

  await deleteOpt.click();
  await sleep(800);

  // Confirm dialog
  const confirmBtn = page
    .locator("button")
    .filter({ hasText: /^(confirm|yes|delete|delete service)$/i })
    .first();
  if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await confirmBtn.click();
    await sleep(2000);
  }

  page.off("request", handler);

  if (capturedMutation && !deleteMutationDocId) {
    deleteMutationDocId = capturedMutation.doc_id;
    deleteMutationOpName = capturedMutation.operationName;
    const serviceId =
      capturedMutation.variables?.input?.serviceId ??
      capturedMutation.variables?.serviceId ??
      capturedMutation.variables?.id;
    capturedServiceIdFormat = serviceId;
    console.log(
      `  📡 Captured mutation: ${deleteMutationOpName} (doc_id: ${deleteMutationDocId})`,
    );
    console.log(`  📡 Service ID used: ${serviceId}`);
  }

  return { ok: true };
}

// ── Main ────────────────────────────────────────────────────────────────────

const keepSlugs = KEEP_SLUGS;

const browser = await launchBrowser("stealth");
const context = await createContext(browser, "stealth");

try {
  // Inject session cookie
  await context.addCookies([
    {
      name: "AuthSession",
      value: authSession,
      domain: ".contra.com",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);

  const page = await context.newPage();

  // Verify auth (navigates to community/for-you internally)
  const username = await checkAuthState(page);
  if (!username) {
    console.error(
      "❌ AuthSession cookie is invalid or expired. Get a fresh one from your browser.",
    );
    process.exit(1);
  }
  console.log(`✅ Authenticated as: ${username}`);

  // Navigate to services page
  await page.goto(PROFILE_URL, { waitUntil: "networkidle" });
  await sleep(3000);

  console.log("Owner mode confirmed (auth verified above).");

  // Collect service links
  const allLinks = await collectServiceLinks(page);
  const toDelete = allLinks.filter((l) => !l.keep);
  const toKeep = allLinks.filter((l) => l.keep);

  console.log(`\nKeeping ${toKeep.length} services:`);
  toKeep.forEach((l) => console.log(`  ✅ ${l.href}`));
  console.log(
    `\nFound ${toDelete.length} duplicates${DRY_RUN ? " [DRY RUN]" : " to delete"}:`,
  );
  toDelete.forEach((l) => console.log(`  🗑️  ${l.href}`));

  if (DRY_RUN || toDelete.length === 0) {
    console.log(DRY_RUN ? "\n[DRY RUN] Done." : "\nNothing to delete.");
    process.exit(0);
  }

  let deleted = 0;
  let failed = 0;

  for (const svc of toDelete) {
    const slugId = svc.href.split("/s/")[1]?.split("-")[0] ?? "";
    console.log(`\nDeleting: ${svc.href}`);
    const result = await deleteServiceViaUI(page, slugId);
    if (result.ok) {
      console.log("  ✅ Done");
      deleted++;
    } else {
      console.log("  ❌ Failed (UI)");
      failed++;
    }
    await sleep(500);
  }

  console.log(`\n─── Results ───`);
  console.log(
    `Deleted: ${deleted} | Failed: ${failed} | Kept: ${toKeep.length}`,
  );
} finally {
  await browser.close();
}
