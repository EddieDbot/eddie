/**
 * Dripify Campaign 3 — Home Services Sequence Builder
 * Builds 7-step sequence from blank canvas + configures webhook
 * Campaign ID: 1800087
 */

import { type Page } from "playwright";
import { withBrowserFallback, type BrowserMode } from "../browser/launcher";
import * as fs from "fs";

const LOGIN_EMAIL = "dan@crabillchamp.com";
const LOGIN_PASSWORD = "CrabillDrip2001!";
const CAMPAIGN_ID = "1800087";
const SEQUENCE_URL = `https://app.dripify.com/campaigns/${CAMPAIGN_ID}/sequence`;
const SETTINGS_URL = `https://app.dripify.com/campaigns/${CAMPAIGN_ID}/settings`;
const SCREENSHOT_DIR = "/home/na/.claude/playwright-output/dripify-campaign3";

const WEBHOOK_URL = "https://therapybot.nac70x7.com/webhook/dripify-reply-v2";
const WEBHOOK_KEY = "c63c5fc33962e0961bd9a1aa71a75453";

// Delays AFTER each step (days). Index matches step number (1-indexed).
const DELAYS_AFTER_STEP = [0, 0, 3, 4, 7, 7, 9, 0]; // index = step num

const STEPS: Array<{
  type: "invite" | "message";
  primary: string;
  fallback: string;
}> = [
  {
    type: "invite",
    primary:
      "Hey %%first_name%% -- noticed %%company%% in %%city%%. I work with home services businesses on their card processing and had a quick question. Not a pitch -- just a pattern I keep seeing in the fees.",
    fallback:
      "Hey %%first_name%% -- I work with home services businesses on their card processing and had a quick question. Not a pitch -- just a pattern I keep seeing in the fees that's costing real money.",
  },
  {
    type: "message",
    primary: `Thanks for connecting, %%first_name%%.

Here's what I wanted to ask: do you know your effective processing rate? Not the number on your contract -- the actual percentage after all the fees?

Most home services businesses I analyze are paying 2.9-3.2% when they could be at 2.2-2.4%. If %%company%% uses mobile or field readers -- most contractors do -- you're paying a 0.5-1% surcharge on top of that. On seasonal months that's $300-400 just... gone.

I built a free calculator that shows your estimated savings in about 30 seconds. No statement needed, no sign-up:

https://crabillchamp.com

Might be worth a quick look.`,
    fallback: `Thanks for connecting, %%first_name%%.

Here's what I wanted to ask: do you know your effective processing rate? Not the number on your contract -- the actual percentage after all the fees?

Most home services businesses I analyze are paying 2.9-3.2% when they could be at 2.2-2.4%. Mobile and field readers tack on an extra 0.5-1% surcharge most contractors don't even notice. On a typical month, that's $300+ just... gone.

I built a free calculator that shows your estimated savings in about 30 seconds. No statement needed, no sign-up:

https://crabillchamp.com

Might be worth a quick look.`,
  },
  {
    type: "message",
    primary: `Hey %%first_name%% -- wanted to make sure this didn't get buried in your inbox.

That calculator I mentioned takes about 30 seconds. It shows whether %%company%% is in the ~70% of home services businesses overpaying on processing -- especially those mobile reader surcharges that add up fast during busy season.

https://crabillchamp.com

If your rates are already solid, you'll know in half a minute. Either way, good connecting with you.`,
    fallback: `Hey %%first_name%% -- wanted to make sure this didn't get buried in your inbox.

That calculator I mentioned takes about 30 seconds. It shows whether you're in the ~70% of home services businesses overpaying on processing.

https://crabillchamp.com

If your rates are already solid, you'll know in half a minute. Either way, good connecting with you.`,
  },
  {
    type: "message",
    primary: `Hey %%first_name%% -- something most contractors don't know:

If you're using a mobile card reader (Square, Clover Go, etc.), you're paying a flat 2.6-2.9% on every transaction. But interchange-plus pricing through a dedicated processor drops that to 1.8-2.2% on most transactions.

The catch: mobile readers subsidize their "free hardware" with higher rates. On a busy month, that delta is $200-400 for a typical home services business.

Just passing it along in case %%company%% is on a flat-rate plan.`,
    fallback: `Hey %%first_name%% -- something most contractors don't know:

If you're using a mobile card reader (Square, Clover Go, etc.), you're paying a flat 2.6-2.9% on every transaction. But interchange-plus pricing through a dedicated processor drops that to 1.8-2.2% on most transactions.

The catch: mobile readers subsidize their "free hardware" with higher rates. On a busy month, that delta is $200-400 for a typical home services business.

Just passing it along in case you're on a flat-rate plan.`,
  },
  {
    type: "message",
    primary: `%%first_name%% -- quick win story.

A plumbing company doing $25K/month switched from Square to interchange-plus processing. They were paying 2.75% flat. New effective rate: 2.05%.

Monthly savings: $175. Annual: $2,100. And they got a free terminal for the office plus a mobile reader.

If %%company%% is still on a flat-rate processor, it's worth checking:
https://crabillchamp.com`,
    fallback: `%%first_name%% -- quick win story.

A plumbing company doing $25K/month switched from Square to interchange-plus processing. They were paying 2.75% flat. New effective rate: 2.05%.

Monthly savings: $175. Annual: $2,100. And they got a free terminal for the office plus a mobile reader.

If you're still on a flat-rate processor, it's worth checking:
https://crabillchamp.com`,
  },
  {
    type: "message",
    primary: `%%first_name%% -- different question this time.

When's the last time your processor proactively lowered your rate?

Interchange tables update twice a year. If your rates haven't changed in 12+ months, they've gone up relative to what's available.

Most processors won't volunteer to save you money. It's not a conspiracy -- it's just not their incentive.

If %%company%% wants to see what current rates look like compared to what you're paying: https://crabillchamp.com

Still free, still takes 30 seconds.`,
    fallback: `%%first_name%% -- different question this time.

When's the last time your processor proactively lowered your rate?

Interchange tables update twice a year. If your rates haven't changed in 12+ months, they've gone up relative to what's available.

Most processors won't volunteer to save you money. It's not a conspiracy -- it's just not their incentive.

If you want to see what current rates look like compared to what you're paying: https://crabillchamp.com

Still free, still takes 30 seconds.`,
  },
  {
    type: "message",
    primary: `%%first_name%% -- last message from me.

I've been reaching out because I genuinely think %%company%% might be overpaying on processing. But I also know that's a low-priority problem when you're busy running a business.

So here's the deal: I'm not going to message you again. But the calculator doesn't expire:

https://crabillchamp.com

Anytime you want to check -- next week, next quarter, next year -- it's there. 30 seconds. No login. No follow-up unless you ask for one.

Good luck with everything, %%first_name%%.`,
    fallback: `%%first_name%% -- last message from me.

I've been reaching out because I genuinely think you might be overpaying on processing. But I also know that's a low-priority problem when you're busy running a business.

So here's the deal: I'm not going to message you again. But the calculator doesn't expire:

https://crabillchamp.com

Anytime you want to check -- next week, next quarter, next year -- it's there. 30 seconds. No login. No follow-up unless you ask for one.

Good luck with everything, %%first_name%%.`,
  },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function shot(page: Page, name: string) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const path = `${SCREENSHOT_DIR}/${Date.now()}-${name}.png`;
  try {
    await page.screenshot({ path, fullPage: false });
    console.log(`  📸 ${path}`);
  } catch (err) {
    console.log(
      `  ⚠️ screenshot failed (${name}): ${(err as Error).message?.slice(0, 60)}`,
    );
  }
  return path;
}

async function dismissCookies(page: Page) {
  try {
    const btn = page.getByRole("button", { name: /allow all/i });
    if (await btn.isVisible({ timeout: 600 })) {
      await btn.click();
      await sleep(300);
    }
  } catch {}
}

async function fillTextareaVue(
  page: Page,
  locator: ReturnType<Page["locator"]>,
  text: string,
) {
  await locator.click();
  await sleep(200);
  await locator.evaluate((el: HTMLTextAreaElement, val: string) => {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    nativeSetter.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, text);
  await sleep(300);
}

async function login(page: Page) {
  console.log("[dripify] Logging in...");
  await page.goto("https://app.dripify.com/", {
    waitUntil: "networkidle",
    timeout: 30000,
  });
  await dismissCookies(page);
  await page.locator('input[type="email"]').fill(LOGIN_EMAIL);
  await page.locator('input[type="password"]').fill(LOGIN_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/campaigns|dashboard/, { timeout: 20000 });
  console.log("[dripify] Logged in:", page.url());
}

async function clickBottommostAddButton(page: Page) {
  // The invite step creates a fork with "Yes" (accepted) and "No" (rejected) branches.
  // We always want to add to the "Yes/accepted" branch — messages go there.
  //
  // Dripify aria-label pattern: "'Send an invite' action - Yes branch"
  // Find all Add Action buttons and pick the one inside the Yes branch container.

  const allAddBtns = await page
    .locator('button[aria-label="Add Action"]')
    .all();

  if (allAddBtns.length === 0)
    throw new Error("No Add buttons found on canvas");

  if (allAddBtns.length === 1) {
    // Single button — blank canvas or single-path step
    const box = await allAddBtns[0].boundingBox();
    console.log(
      `    [add-btn] single Add button at (${Math.round(box?.x ?? 0)},${Math.round(box?.y ?? 0)})`,
    );
    await allAddBtns[0].click();
    await sleep(800);
    await dismissCookies(page);
    return;
  }

  // Multiple Add buttons — we're after the "Yes branch" one.
  // Use JS to find which button lives inside the Yes branch container.
  const yesBranchBtnIdx = await page.evaluate(() => {
    const addBtns = [
      ...document.querySelectorAll('button[aria-label="Add Action"]'),
    ];
    for (let i = 0; i < addBtns.length; i++) {
      let parent = addBtns[i].parentElement;
      for (let d = 0; d < 15 && parent; d++) {
        const lbl = parent.getAttribute("aria-label");
        if (lbl && lbl.toLowerCase().includes("yes")) return i;
        parent = parent.parentElement;
      }
    }
    return -1; // not found
  });

  if (yesBranchBtnIdx >= 0) {
    const yesBranchBtn = allAddBtns[yesBranchBtnIdx];
    const box = await yesBranchBtn.boundingBox();
    console.log(
      `    [add-btn] Yes-branch Add at (${Math.round(box?.x ?? 0)},${Math.round(box?.y ?? 0)}) [idx ${yesBranchBtnIdx}]`,
    );
    await yesBranchBtn.click({ force: true });
    await sleep(800);
    await dismissCookies(page);
    return;
  }

  // Fallback: bottommost button (deepest in sequence = last step)
  const withBoxes = [];
  for (const btn of allAddBtns) {
    const box = await btn.boundingBox();
    if (box) withBoxes.push({ y: box.y, x: box.x, btn });
  }
  withBoxes.sort((a, b) => b.y - a.y);
  console.log(
    `    [add-btn] fallback bottommost at (${Math.round(withBoxes[0].x)},${Math.round(withBoxes[0].y)})`,
  );
  await withBoxes[0].btn.click();
  await sleep(800);
  await dismissCookies(page);
}

async function clearCanvas(page: Page) {
  // Dismiss any open editor panel first (ESC closes modals/panels)
  await page.keyboard.press("Escape");
  await sleep(500);

  const existingBlocks = await page.locator(".action-face__wrap").count();
  if (existingBlocks === 0) {
    console.log("[dripify] Canvas is blank — no clearing needed");
    return;
  }

  console.log(
    `[dripify] Canvas has ${existingBlocks} existing block(s) — clearing via .action-face__remove...`,
  );

  // Each block has a .action-face__remove button (visible on hover, at right edge of block)
  for (let attempt = 0; attempt < existingBlocks + 3; attempt++) {
    const blocks = await page.locator(".action-face__wrap").count();
    if (blocks === 0) break;

    // Hover to reveal the remove button on the last block
    const lastBlock = page.locator(".action-face__wrap").last();
    const bb = await lastBlock.boundingBox();
    if (!bb) continue;

    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await sleep(400);

    // Click the remove button (right edge of the block row)
    const removeBtn = page.locator(".action-face__remove").last();
    if (await removeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await removeBtn.click({ force: true });
      await sleep(800);
      // Confirm dialog if present
      const confirmBtn = page
        .getByRole("button", { name: /confirm|yes|delete|ok/i })
        .first();
      if (await confirmBtn.isVisible({ timeout: 800 }).catch(() => false)) {
        await confirmBtn.click();
        await sleep(600);
      }
      console.log(`  Removed block (attempt ${attempt + 1})`);
    } else {
      console.log(`  No remove button found on attempt ${attempt + 1}`);
      break;
    }

    await page.keyboard.press("Escape");
    await sleep(300);
  }

  const remaining = await page.locator(".action-face__wrap").count();
  if (remaining > 0) {
    console.log(
      `[dripify] ⚠️ ${remaining} block(s) remain after clear — proceeding anyway`,
    );
  } else {
    console.log("[dripify] Canvas cleared");
  }
  await shot(page, "canvas-after-clear");
}

async function openStepEditor(page: Page, stepNum: number): Promise<boolean> {
  // Strategy: find the correct block and open its editor.
  // 1. Gather all .action-face__wrap elements with aria-labels and positions
  const blockInfo = await page.evaluate(() =>
    [...document.querySelectorAll(".action-face__wrap")].map((el, i) => ({
      idx: i,
      ariaLabel: el.getAttribute("aria-label") ?? "",
      x: Math.round((el as HTMLElement).getBoundingClientRect().x),
      y: Math.round((el as HTMLElement).getBoundingClientRect().y),
      w: Math.round((el as HTMLElement).getBoundingClientRect().width),
      h: Math.round((el as HTMLElement).getBoundingClientRect().height),
    })),
  );
  console.log(`    [step ${stepNum}] all blocks:`, JSON.stringify(blockInfo));

  // Find blocks that are likely editable: have positive dimensions, not "End" nodes
  const editable = blockInfo.filter(
    (b) =>
      b.w > 50 &&
      b.h > 20 &&
      !b.ariaLabel.toLowerCase().includes("end") &&
      b.y > 0 &&
      b.x > 0,
  );

  // For step > 1: the NEW block is the one NOT among step (stepNum-1) blocks.
  // Heuristic: highest y-coord among editable blocks (deepest in sequence)
  editable.sort((a, b) => b.y - a.y);
  const target = editable[0];
  if (!target) {
    console.log(`    [step ${stepNum}] ⚠️ No editable block found`);
    return false;
  }
  console.log(
    `    [step ${stepNum}] target block: idx=${target.idx} at (${target.x},${target.y}) label="${target.ariaLabel}"`,
  );

  // Try multiple methods to open the editor
  const cx = target.x + target.w / 2;
  const cy = target.y + target.h / 2;

  // Method 1: locator dblclick (scrolls into view)
  const blockLocator = page.locator(".action-face__wrap").nth(target.idx);
  await blockLocator.scrollIntoViewIfNeeded().catch(() => {});
  await sleep(300);
  await blockLocator.dblclick({ timeout: 5000 }).catch(() => {});
  await sleep(800);
  await dismissCookies(page);
  if (
    await page
      .locator('textarea[placeholder="Message"]')
      .isVisible({ timeout: 1000 })
      .catch(() => false)
  ) {
    console.log(`    [step ${stepNum}] ✓ editor opened via locator.dblclick()`);
    return true;
  }

  // Method 2: mouse.dblclick at viewport coords
  await page.mouse.dblclick(cx, cy);
  await sleep(800);
  await dismissCookies(page);
  if (
    await page
      .locator('textarea[placeholder="Message"]')
      .isVisible({ timeout: 1000 })
      .catch(() => false)
  ) {
    console.log(`    [step ${stepNum}] ✓ editor opened via mouse.dblclick`);
    return true;
  }

  // Method 3: single click to select, then Enter
  await page.mouse.click(cx, cy);
  await sleep(400);
  await page.keyboard.press("Enter");
  await sleep(800);
  await dismissCookies(page);
  if (
    await page
      .locator('textarea[placeholder="Message"]')
      .isVisible({ timeout: 1000 })
      .catch(() => false)
  ) {
    console.log(`    [step ${stepNum}] ✓ editor opened via click+Enter`);
    return true;
  }

  // Method 4: try other blocks in case the target was wrong (try second candidate)
  if (editable.length > 1) {
    const alt = editable[1];
    const ax = alt.x + alt.w / 2;
    const ay = alt.y + alt.h / 2;
    const altLocator = page.locator(".action-face__wrap").nth(alt.idx);
    console.log(
      `    [step ${stepNum}] trying alt block idx=${alt.idx} at (${alt.x},${alt.y})`,
    );
    await altLocator.scrollIntoViewIfNeeded().catch(() => {});
    await sleep(300);
    await altLocator.dblclick({ timeout: 5000 }).catch(() => {});
    await sleep(800);
    await dismissCookies(page);
    if (
      await page
        .locator('textarea[placeholder="Message"]')
        .isVisible({ timeout: 1000 })
        .catch(() => false)
    ) {
      console.log(`    [step ${stepNum}] ✓ editor opened via alt block`);
      return true;
    }
    // Method 4b: mouse on alt
    await page.mouse.dblclick(ax, ay);
    await sleep(800);
    if (
      await page
        .locator('textarea[placeholder="Message"]')
        .isVisible({ timeout: 1000 })
        .catch(() => false)
    ) {
      console.log(
        `    [step ${stepNum}] ✓ editor opened via alt block mouse.dblclick`,
      );
      return true;
    }
  }

  return false;
}

async function addStepAndFill(
  page: Page,
  stepNum: number,
  step: (typeof STEPS)[0],
) {
  console.log(`\n[step ${stepNum}] Adding ${step.type}...`);

  await clickBottommostAddButton(page);

  // Select step type from panel
  const typeLabel = step.type === "invite" ? "Send an invite" : "Message";
  await page.getByText(typeLabel, { exact: true }).first().click({ force: true });
  await sleep(2000); // extra wait for canvas to settle after adding block
  await dismissCookies(page);

  await shot(page, `step${stepNum}-after-add`);

  // Open the step editor (dblclick with multiple fallback strategies)
  const opened = await openStepEditor(page, stepNum);
  if (!opened) {
    await shot(page, `step${stepNum}-editor-fail`);
    throw new Error(
      `Step ${stepNum}: failed to open editor after all fallback methods`,
    );
  }
  await sleep(500);

  // Fill Primary message
  const primaryTextarea = page
    .locator('textarea[placeholder="Message"]')
    .first();
  await primaryTextarea.waitFor({ state: "visible", timeout: 8000 });
  await fillTextareaVue(page, primaryTextarea, step.primary);
  await shot(page, `step${stepNum}-primary-filled`);

  // Switch to Alternative message tab and fill fallback
  const altTab = page
    .getByText("Alternative message", { exact: false })
    .first();
  if (await altTab.isVisible({ timeout: 1000 }).catch(() => false)) {
    await altTab.click();
    await sleep(700);
    const fallbackTextarea = page
      .locator('textarea[placeholder="Message"]')
      .first();
    if (
      await fallbackTextarea.isVisible({ timeout: 2000 }).catch(() => false)
    ) {
      await fillTextareaVue(page, fallbackTextarea, step.fallback);
    }
  }

  // Save via the .sequence-msg dialog Save button.
  // This properly closes the dialog AND auto-dismisses the action-face config disabler.
  const msgDialog = page.locator(".sequence-msg");
  if (await msgDialog.isVisible({ timeout: 2000 }).catch(() => false)) {
    await msgDialog.locator('button:has-text("Save")').first().click({ force: true });
  } else {
    // Fallback: first Save button on page
    await page.locator('button:has-text("Save")').first().click({ force: true });
  }
  await sleep(1500);
  await dismissCookies(page);
  console.log(`  ✓ Step ${stepNum} saved`);
  console.log(`  ✓ Step ${stepNum} saved`);
  await shot(page, `step${stepNum}-saved`);
}

async function setDelay(page: Page, stepNum: number, days: number) {
  if (days === 0) return;
  console.log(`  Setting delay after step ${stepNum}: ${days} days`);

  // Find the bottommost delay button (after the last step we added)
  const delayBtns = await page.locator(".action-delay__btn").all();
  let bottommostDelay: ReturnType<Page["locator"]> | null = null;
  let maxY = 0;
  for (const d of delayBtns) {
    const box = await d.boundingBox();
    if (box && box.y > maxY) {
      maxY = box.y;
      bottommostDelay = d as ReturnType<Page["locator"]>;
    }
  }

  if (!bottommostDelay) {
    console.log("  ⚠️ No delay button found");
    return;
  }

  await bottommostDelay!.click();
  await sleep(800);
  await dismissCookies(page);

  // Fill delay input using Vue reactive setter
  const delayInput = page.locator('input[name="delay-input"]');
  if (await delayInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await delayInput.evaluate((el: HTMLInputElement, val: number) => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      nativeSetter.call(el, String(val));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, days);
    await sleep(300);
  }

  // Click Apply
  const applyBtn = page.getByRole("button", { name: /apply/i }).first();
  if (await applyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await applyBtn.click();
    await sleep(800);
    console.log(`  ✓ Delay set to ${days} days`);
  }
  await dismissCookies(page);
}

async function buildSequence(page: Page) {
  console.log("\n[dripify] Loading sequence editor...");
  await page.goto(SEQUENCE_URL, { waitUntil: "networkidle", timeout: 30000 });
  await sleep(2000);
  await dismissCookies(page);

  // Dismiss "Save before leave" modal if present (from prior interrupted run)
  const saveLeaveOnLoad = page.locator('[aria-label*="Save before leave" i]');
  if (await saveLeaveOnLoad.isVisible({ timeout: 1500 }).catch(() => false)) {
    console.log("[dripify] Dismissing 'Save before leave' modal...");
    const stayBtn = page
      .getByRole("button", { name: /stay|don.t save|cancel|no/i })
      .first();
    if (await stayBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await stayBtn.click();
    } else {
      await page.keyboard.press("Escape");
    }
    await sleep(800);
    await dismissCookies(page);
  }

  // Click "Custom campaign" if template gallery is showing
  const customBtn = page.locator('button:has-text("Custom campaign")');
  if (await customBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await customBtn.click();
    await sleep(1500);
    await dismissCookies(page);
  }

  await shot(page, "00-canvas-initial");

  // Clear any existing steps from prior partial runs
  await clearCanvas(page);

  // Wait for at least one Add button to be present before starting
  await page
    .locator(".add-action__btn")
    .first()
    .waitFor({ state: "visible", timeout: 8000 });

  await shot(page, "01-ready-to-build");

  // Add all 7 steps
  for (let i = 0; i < STEPS.length; i++) {
    const stepNum = i + 1;
    const step = STEPS[i];
    await addStepAndFill(page, stepNum, step);

    // Set delay after this step (before next step)
    const delay = DELAYS_AFTER_STEP[stepNum];
    if (delay > 0) {
      await setDelay(page, stepNum, delay);
    }

    await sleep(500);
  }

  // Persist full sequence to backend via canvas Save
  console.log("\n[dripify] Saving sequence to backend...");
  const canvasSave = page.locator("button.async-btn:has-text('Save')");
  try {
    await canvasSave.waitFor({ state: "visible", timeout: 8000 });
    await canvasSave.click({ force: true });
    await sleep(3000);
    console.log("[dripify] ✅ Canvas Save clicked");
  } catch (err) {
    console.log(
      "[dripify] ⚠️ Canvas Save not found:",
      (err as Error).message?.slice(0, 80),
    );
  }

  await shot(page, "sequence-complete");
  console.log("\n[dripify] ✅ Sequence built (7 steps)");
}

async function configureWebhook(page: Page) {
  console.log("\n[dripify] Configuring webhook on settings page...");
  await page.goto(SETTINGS_URL, { waitUntil: "networkidle", timeout: 30000 });
  await sleep(2000);
  await dismissCookies(page);

  await shot(page, "settings-loaded");

  // Set campaign name
  const nameInput = page.locator('input[name="Name"]').first();
  if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await nameInput.fill("Crabill - Home Services - v2");
    console.log("[dripify] ✓ Campaign name set");
  }

  // Open the webhook trigger dropdown
  const webhookDropdown = page.locator('#Webhook');
  if (!(await webhookDropdown.isVisible({ timeout: 5000 }).catch(() => false))) {
    console.log("[dripify] ⚠️ Webhook dropdown not found — check screenshot");
    await shot(page, "settings-webhook-notfound");
    return;
  }

  await webhookDropdown.click();
  await sleep(800);
  await dismissCookies(page);
  await shot(page, "settings-dropdown-open");

  // Select "After a lead replies"
  const replyOption = page.getByText("After a lead replies", { exact: true }).first();
  if (await replyOption.isVisible({ timeout: 3000 }).catch(() => false)) {
    await replyOption.click();
    await sleep(1200);
    console.log("[dripify] ✓ Trigger: After a lead replies");
  } else {
    console.log("[dripify] ⚠️ 'After a lead replies' not found — trying any enabled option");
    const firstEnabled = page.locator('.select-dropdown__item:not([disabled])').nth(1);
    if (await firstEnabled.isVisible({ timeout: 2000 }).catch(() => false)) {
      const text = await firstEnabled.textContent();
      await firstEnabled.click();
      await sleep(1200);
      console.log("[dripify] Used trigger:", text?.trim());
    }
  }

  await dismissCookies(page);
  await shot(page, "settings-trigger-selected");

  // Fill webhook URL (appears after trigger selection)
  const urlInput = page.locator('input[type="url"][name="Webhook"]').first();
  if (await urlInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    await urlInput.fill(WEBHOOK_URL);
    console.log("[dripify] ✓ Webhook URL filled:", WEBHOOK_URL);
  } else {
    console.log("[dripify] ⚠️ URL input not found after trigger selection");
    await shot(page, "settings-url-notfound");
  }

  await shot(page, "webhook-configured");

  // Trigger Vue reactivity on name field so Save button enables
  const nameInputEl = page.locator('input[name="Name"]').first();
  if (await nameInputEl.isVisible({ timeout: 1000 }).catch(() => false)) {
    await nameInputEl.evaluate((el: HTMLInputElement) => {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await sleep(400);
  }

  // Click "Save Changes" (use force:true in case button is still disabled)
  const saveBtn = page.locator('#saveCampaignBtn, button.async-btn:has-text("Save")').first();
  if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await saveBtn.click({ force: true });
    await sleep(2500);
    await shot(page, "webhook-saved");
    console.log("[dripify] ✅ Webhook saved");
  } else {
    console.log("[dripify] ⚠️ Save Changes button not found");
  }
}

async function run() {
  console.log("=== Dripify Campaign 3 — Home Services Sequence Builder ===\n");

  await withBrowserFallback(async (context, mode: BrowserMode) => {
    console.log(`[browser] mode: ${mode}`);
    const page = await context.newPage();
    await page.route("**://app.clay.com/**", (route) => route.abort());

    await login(page);
    await buildSequence(page);
    await configureWebhook(page);

    console.log("\n=== DONE ===");
    console.log("Screenshots:", SCREENSHOT_DIR);
    console.log(
      "Manual step: Set campaign name to 'Crabill - Home Services - v2'",
    );
  });
}

run().catch((err) => {
  console.error("[FATAL]", err.message);
  process.exit(1);
});
