import type { Page } from "playwright";

const BLOCK_PATTERNS = [
  /captcha/i,
  /are you human/i,
  /bot detected/i,
  /access denied/i,
  /cloudflare/i,
  /ddos.?guard/i,
  /please verify/i,
  /challenge/i,
  /suspicious activity/i,
];

export async function isBlocked(page: Page): Promise<boolean> {
  const status = page.url();
  if (status.includes("captcha") || status.includes("challenge")) return true;

  const html = await page.content().catch(() => "");
  return BLOCK_PATTERNS.some((p) => p.test(html));
}

export class BlockedError extends Error {
  constructor(url: string) {
    super(`Blocked at ${url}`);
    this.name = "BlockedError";
  }
}
