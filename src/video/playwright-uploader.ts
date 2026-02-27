import type { BrowserContext } from "playwright";
import { withBrowserFallback } from "../browser/launcher.ts";
import { logger } from "../utils/logger.ts";
import type { UploadParams, UploadResult } from "./uploader.ts";

const COOKIE_FILE = `${process.env.HOME}/.claude/google-hub/youtube-studio-cookies.json`;
const STUDIO_URL = "https://studio.youtube.com";
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
import { resolve } from "node:path";
const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const ERROR_SCREENSHOT_DIR = resolve(PROJECT_ROOT, "data/renders");

export class NotAuthenticatedError extends Error {
  constructor() {
    super(
      "YouTube Studio: not authenticated — cookie session expired or missing",
    );
    this.name = "NotAuthenticatedError";
  }
}

async function loadCookies(context: BrowserContext): Promise<boolean> {
  try {
    const raw = await Bun.file(COOKIE_FILE).text();
    const cookies = JSON.parse(raw);
    await context.addCookies(cookies);
    return true;
  } catch {
    return false;
  }
}

async function saveCookies(context: BrowserContext): Promise<void> {
  const cookies = await context.cookies();
  await Bun.write(COOKIE_FILE, JSON.stringify(cookies, null, 2));
}

export async function uploadVideoPlaywright(
  params: UploadParams,
): Promise<UploadResult> {
  const { videoPath, title, description } = params;
  const truncatedTitle = title.length > 60 ? title.slice(0, 60) : title;

  return withBrowserFallback(async (context: BrowserContext) => {
    const page = await context.newPage();

    try {
      // Load saved session cookies
      await loadCookies(context);

      // Navigate to YouTube Studio
      await page.goto(STUDIO_URL, {
        waitUntil: "networkidle",
        timeout: 30_000,
      });

      // Detect auth redirect
      if (page.url().includes("accounts.google.com")) {
        throw new NotAuthenticatedError();
      }

      logger.info("playwright-uploader:studio-loaded", { url: page.url() });

      // Click the Create button to open upload menu
      await page.waitForSelector(
        '[aria-label="Create"], ytcp-button[id="create-icon"]',
        {
          timeout: 15_000,
        },
      );
      await page.click('[aria-label="Create"], ytcp-button[id="create-icon"]');

      // Click "Upload videos" in the dropdown
      await page.waitForSelector('tp-yt-paper-item:has-text("Upload videos")', {
        timeout: 10_000,
      });
      await page.click('tp-yt-paper-item:has-text("Upload videos")');

      // YouTube Studio keeps the file input aria-hidden — wait for it to be
      // attached (not visible), then setInputFiles works on hidden inputs
      await page.waitForSelector('input[type="file"]', {
        state: "attached",
        timeout: 15_000,
      });
      await page.setInputFiles('input[type="file"]', videoPath);

      logger.info("playwright-uploader:file-selected", { videoPath });

      // Wait for upload dialog title field to appear
      const titleSel =
        '#title-textarea #textbox, #title-textarea div[contenteditable="true"]';
      await page.waitForSelector(titleSel, { timeout: 30_000 });
      // Give the upload a moment to start — scrim fades in briefly after file select
      await page.waitForTimeout(3000);

      // Set title via JS (bypasses any scrim overlay)
      await page.evaluate(
        `(function(t){
          var tb = document.querySelector('#title-textarea #textbox') || document.querySelector('#title-textarea [contenteditable]');
          if(tb){tb.textContent='';tb.focus();document.execCommand('selectAll');document.execCommand('insertText',false,t);tb.dispatchEvent(new Event('input',{bubbles:true}));}
        })(${JSON.stringify(truncatedTitle)})`,
      );

      // Set description via JS (optional — non-fatal)
      await page
        .evaluate(
          `(function(d){
          var tb = document.querySelector('#description-textarea #textbox') || document.querySelector('#description-textarea [contenteditable]');
          if(tb){tb.focus();document.execCommand('selectAll');document.execCommand('insertText',false,d);tb.dispatchEvent(new Event('input',{bubbles:true}));}
        })(${JSON.stringify(description)})`,
        )
        .catch(() => {});

      logger.info("playwright-uploader:metadata-filled", {
        title: truncatedTitle,
      });

      // Answer required Audience question — JS string eval (browser context)
      await page.evaluate(
        `(function(){var r=document.querySelectorAll('tp-yt-paper-radio-button');for(var i=0;i<r.length;i++){if(r[i].textContent&&r[i].textContent.toLowerCase().indexOf('not made for kids')>=0){r[i].click();break;}}})()`,
      );
      await page.waitForTimeout(600);
      logger.info("playwright-uploader:audience-set");

      // Step through Next buttons to reach Visibility tab (JS force-click)
      for (let i = 0; i < 3; i++) {
        await page.evaluate(
          `(function(){var b=document.querySelector('#next-button');if(b)b.click();})()`,
        );
        await page.waitForTimeout(1000);
      }
      await page.waitForTimeout(500);

      // Select "Public" — try Playwright then JS fallback
      await page
        .locator('tp-yt-paper-radio-button[name="PUBLIC"]')
        .click({ force: true, timeout: 5_000 })
        .catch(() =>
          page
            .evaluate(
              `(function(){var r=document.querySelectorAll('tp-yt-paper-radio-button');for(var i=0;i<r.length;i++){var t=r[i].textContent||'';if(t.toLowerCase().indexOf('public')>=0&&t.toLowerCase().indexOf('everyone')>=0){r[i].click();break;}}})()`,
            )
            .catch(() => {}),
        );
      await page.waitForTimeout(800);

      // Screenshot before publish (debug)
      try {
        const dbgPath = `${ERROR_SCREENSHOT_DIR}/pw-pre-publish-${Date.now()}.png`;
        await page.screenshot({ path: dbgPath, fullPage: true });
        logger.info("playwright-uploader:pre-publish-screenshot", { dbgPath });
      } catch {
        /* ignore */
      }

      // Click Publish via JS
      await page.evaluate(
        `(function(){var b=document.querySelector('#done-button');if(b)b.click();})()`,
      );

      logger.info("playwright-uploader:publish-clicked");

      // Race: capture video ID from the publish success dialog BEFORE redirect.
      // The dialog shows "youtu.be/VIDEO_ID" briefly then navigates to /channel.
      // We must grab the link from the dialog — not from the channel page which
      // has unrelated video links that would return stale IDs.
      let videoId = "";

      await Promise.race([
        // Primary: dialog link appears first (youtu.be/ID)
        page
          .waitForSelector(
            'a[href*="youtu.be"], a[href*="youtube.com/watch"]',
            {
              timeout: UPLOAD_TIMEOUT_MS,
            },
          )
          .then(async (linkEl) => {
            const href = (await linkEl?.getAttribute("href")) ?? "";
            const id =
              href.match(/youtu\.be\/([A-Za-z0-9_-]{11})/)?.[1] ??
              href.match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1] ??
              "";
            if (id) {
              videoId = id;
              logger.info("playwright-uploader:videoid-from-dialog-link", {
                href,
                videoId,
              });
            }
          })
          .catch(() => {}),

        // Backup: direct redirect to /video/ID (sometimes happens)
        page
          .waitForURL(/studio\.youtube\.com\/video\/([A-Za-z0-9_-]+)/, {
            timeout: UPLOAD_TIMEOUT_MS,
          })
          .then(() => {
            const id = page.url().match(/\/video\/([A-Za-z0-9_-]+)/)?.[1] ?? "";
            if (id && !videoId) videoId = id;
          })
          .catch(() => {}),
      ]);

      // Wait for full redirect (channel or video page)
      await page
        .waitForURL(/studio\.youtube\.com\/(?:channel|video)\//, {
          timeout: UPLOAD_TIMEOUT_MS,
        })
        .catch(() => {});

      // Final fallback: /video/ID in URL
      if (!videoId) {
        const finalUrl = page.url();
        videoId =
          finalUrl.match(/\/video\/([A-Za-z0-9_-]{11,})/)?.[1] ??
          finalUrl.match(/v=([A-Za-z0-9_-]{11})/)?.[1] ??
          "";
      }

      if (!videoId) {
        throw new Error(
          `Could not extract videoId after publish. URL: ${page.url()}`,
        );
      }

      const url = `https://www.youtube.com/watch?v=${videoId}`;

      logger.info("playwright-uploader:upload-complete", { videoId, url });

      // Save updated cookies for next session
      await saveCookies(context);
      await page.close();

      return { videoId, url, title: truncatedTitle };
    } catch (err) {
      // Auth errors must not cycle through browser modes
      if (err instanceof NotAuthenticatedError) throw err;

      // Screenshot on failure
      try {
        const ts = Date.now();
        const screenshotPath = `${ERROR_SCREENSHOT_DIR}/playwright-upload-error-${ts}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: true });
        logger.warn("playwright-uploader:screenshot-saved", { screenshotPath });
      } catch (ssErr) {
        logger.warn("playwright-uploader:screenshot-failed", {
          error: String(ssErr),
        });
      }

      await page.close();
      throw err;
    }
  });
}
