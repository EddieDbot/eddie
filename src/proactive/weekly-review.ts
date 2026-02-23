import type { Bot } from "gramio";
import { logger } from "../utils/logger.ts";
import { resolve } from "node:path";

const HOME = process.env.HOME ?? "/home/na";
const LEARNINGS_DIR = resolve(HOME, "brain-vault/90 - Agent Memory/Learnings");

type ReviewStep = "wins" | "losses" | "energy" | "commitments" | "done";

type ReviewSession = {
  step: ReviewStep;
  wins?: string;
  losses?: string;
  energy?: string;
  commitments?: string;
  startedAt: Date;
};

const activeSessions = new Map<number, ReviewSession>();

const STEP_PROMPTS: Record<ReviewStep, string> = {
  wins: "Weekly review time\n\nWhat were your top 3 wins this week?",
  losses: "Got it\n\nWhat didn't go well or where did you fall short?",
  energy: "Noted\n\nHow was your energy and focus this week? (1-10 + context)",
  commitments: "Good\n\nWhat are your top 3 commitments for next week?",
  done: "",
};

const STEP_ORDER: ReviewStep[] = ["wins", "losses", "energy", "commitments", "done"];

export function isInReview(chatId: number): boolean {
  return activeSessions.has(chatId);
}

export async function startWeeklyReview(chatId: number, bot: Bot): Promise<void> {
  if (activeSessions.has(chatId)) {
    await bot.api.sendMessage({
      chat_id: chatId,
      text: "Already in a review session. Continue answering or send /cancel to stop.",
    });
    return;
  }
  activeSessions.set(chatId, { step: "wins", startedAt: new Date() });
  await bot.api.sendMessage({ chat_id: chatId, text: STEP_PROMPTS.wins });
}

export async function advanceReview(
  chatId: number,
  answer: string,
  bot: Bot,
): Promise<void> {
  const session = activeSessions.get(chatId);
  if (!session) return;

  switch (session.step) {
    case "wins": session.wins = answer; break;
    case "losses": session.losses = answer; break;
    case "energy": session.energy = answer; break;
    case "commitments": session.commitments = answer; break;
  }

  const currentIdx = STEP_ORDER.indexOf(session.step);
  const nextStep = STEP_ORDER[currentIdx + 1] ?? "done";
  session.step = nextStep;

  if (nextStep === "done") {
    activeSessions.delete(chatId);
    await finalizeReview(session, chatId, bot);
    return;
  }

  await bot.api.sendMessage({ chat_id: chatId, text: STEP_PROMPTS[nextStep] });
}

async function finalizeReview(
  session: ReviewSession,
  chatId: number,
  bot: Bot,
): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const path = resolve(LEARNINGS_DIR, `${date}-weekly-review.md`);

  const content = [
    `# Weekly Review — ${date}`,
    "",
    "## Wins",
    session.wins ?? "(not captured)",
    "",
    "## What Didn't Go Well",
    session.losses ?? "(not captured)",
    "",
    "## Energy & Focus",
    session.energy ?? "(not captured)",
    "",
    "## Commitments for Next Week",
    session.commitments ?? "(not captured)",
  ].join("\n");

  try {
    await Bun.write(path, content);
    logger.info("weekly-review:saved", { path });
    await bot.api.sendMessage({
      chat_id: chatId,
      text: `Weekly review complete\nSaved to Brain Vault: ${date}-weekly-review.md\n\nKey commitments:\n${(session.commitments ?? "").split("\n").slice(0, 3).join("\n")}`,
    });
  } catch (err) {
    logger.error("weekly-review:save-error", {
      error: err instanceof Error ? err.message : String(err),
    });
    await bot.api.sendMessage({ chat_id: chatId, text: "Review captured but failed to save to Brain Vault." });
  }
}

export function cancelReview(chatId: number): boolean {
  return activeSessions.delete(chatId);
}
