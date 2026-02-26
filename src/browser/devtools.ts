/**
 * Browser DevTools Utilities
 *
 * Programmatic equivalents of F12 DevTools — cookie extraction, storage dumps,
 * network capture, and console execution. Works with both headless and headed
 * modes since Playwright has direct browser access (no DevTools UI needed).
 *
 * Key: Playwright returns HttpOnly cookies too — it has the same privileges as
 * DevTools because it communicates directly over the Chrome DevTools Protocol.
 */

import type { BrowserContext, Page, Response } from "playwright";

export type Cookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None" | "";
};

export type CapturedRequest = {
  url: string;
  method: string;
  requestBody: string | null;
  status: number;
  responseBody: string;
  headers: Record<string, string>;
};

export type StorageDump = {
  local: Record<string, string>;
  session: Record<string, string>;
};

/**
 * Get a specific cookie by name.
 * Works for HttpOnly cookies — Playwright has direct browser access.
 * Equivalent to F12 → Application → Cookies → find by name.
 */
export async function getAuthCookie(
  context: BrowserContext,
  name: string,
  domain?: string,
): Promise<Cookie | null> {
  const cookies = await context.cookies();
  return (
    (cookies as Cookie[]).find(
      (c) => c.name === name && (!domain || c.domain.includes(domain)),
    ) ?? null
  );
}

/**
 * Poll until a cookie appears or timeout (default 30s).
 * Use after OAuth flows where cookies appear asynchronously.
 */
export async function waitForCookie(
  context: BrowserContext,
  name: string,
  opts?: { domain?: string; timeout?: number },
): Promise<Cookie> {
  const timeout = opts?.timeout ?? 30000;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const cookie = await getAuthCookie(context, name, opts?.domain);
    if (cookie) return cookie;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `Cookie "${name}" not found after ${timeout}ms — auth may have failed`,
  );
}

/**
 * Dump all cookies for a domain.
 * Equivalent to F12 → Application → Cookies → select domain.
 */
export async function dumpCookies(
  context: BrowserContext,
  domain?: string,
): Promise<Cookie[]> {
  const cookies = await context.cookies();
  if (!domain) return cookies as Cookie[];
  return (cookies as Cookie[]).filter((c) => c.domain.includes(domain));
}

/**
 * Dump localStorage and sessionStorage as plain objects.
 * Equivalent to F12 → Application → Storage → Local/Session Storage.
 */
export async function dumpStorage(page: Page): Promise<StorageDump> {
  return page.evaluate(() => ({
    local: Object.fromEntries(
      Object.keys(localStorage).map((k) => [k, localStorage.getItem(k) ?? ""]),
    ),
    session: Object.fromEntries(
      Object.keys(sessionStorage).map((k) => [
        k,
        sessionStorage.getItem(k) ?? "",
      ]),
    ),
  }));
}

/**
 * Intercept the NEXT request matching a URL pattern and return its full data.
 * Call this BEFORE triggering the action, then await.
 * Equivalent to F12 → Network → filter by URL → inspect request/response.
 *
 * Example:
 *   const capture = captureRequest(page, /api.*createService/);
 *   await page.click("#submit");
 *   const { requestBody, responseBody } = await capture;
 */
export function captureRequest(
  page: Page,
  urlPattern: string | RegExp,
  opts?: { timeout?: number },
): Promise<CapturedRequest> {
  const timeout = opts?.timeout ?? 30000;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(`captureRequest: no match for ${urlPattern} after ${timeout}ms`),
        ),
      timeout,
    );

    const handler = async (response: Response) => {
      const url = response.url();
      const matches =
        typeof urlPattern === "string"
          ? url.includes(urlPattern)
          : urlPattern.test(url);
      if (!matches) return;

      page.off("response", handler);
      clearTimeout(timer);

      try {
        const req = response.request();
        resolve({
          url,
          method: req.method(),
          requestBody: req.postData(),
          status: response.status(),
          responseBody: await response.text().catch(() => ""),
          headers: response.headers(),
        });
      } catch (err) {
        reject(err);
      }
    };

    page.on("response", handler);
  });
}

/**
 * Capture ALL requests matching a pattern during an async operation.
 * Equivalent to F12 → Network → filter → run action → collect all matches.
 *
 * Example:
 *   const calls = await captureAllRequests(page, /graphql/, async () => {
 *     await page.click("#load-more");
 *     await page.waitForLoadState("networkidle");
 *   });
 */
export async function captureAllRequests(
  page: Page,
  urlPattern: string | RegExp,
  action: () => Promise<void>,
): Promise<CapturedRequest[]> {
  const results: CapturedRequest[] = [];

  const handler = async (response: Response) => {
    const url = response.url();
    const matches =
      typeof urlPattern === "string"
        ? url.includes(urlPattern)
        : urlPattern.test(url);
    if (!matches) return;

    try {
      const req = response.request();
      results.push({
        url,
        method: req.method(),
        requestBody: req.postData(),
        status: response.status(),
        responseBody: await response.text().catch(() => ""),
        headers: response.headers(),
      });
    } catch {
      // ignore individual capture failures
    }
  };

  page.on("response", handler);
  try {
    await action();
  } finally {
    page.off("response", handler);
  }

  return results;
}

/**
 * Execute JS in the page context with a typed return value.
 * Equivalent to F12 → Console → type expression → Enter.
 */
export function runInPage<T>(page: Page, fn: () => T): Promise<T> {
  return page.evaluate(fn);
}
