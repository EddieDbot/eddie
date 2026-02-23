import { resolve } from "node:path";
import { homedir } from "node:os";
import { config } from "../config.ts";

const HOME = homedir();
const STATE_DIR = resolve(HOME, "brain-vault/90 - Agent Memory/State");
const PROJECTS_DIR = resolve(HOME, "brain-vault/10 - Projects");

export type ActivityMode = "AGENTIC" | "COLLAB";

function formatTimestamp(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: config.TIMEZONE,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/**
 * Log project activity to two locations:
 * 1. ~/brain-vault/90 - Agent Memory/State/{slug}.md — Eddie's tracking
 * 2. ~/brain-vault/10 - Projects/{slug}/EDDIE_LOG.md — project-level record
 *
 * Mode:
 *   AGENTIC = Eddie ran this autonomously (heartbeat, wheel, cron)
 *   COLLAB  = Nicholas was in the session (terminal or Telegram)
 */
export async function logProjectActivity(
  slug: string,
  summary: string,
  mode: ActivityMode = "AGENTIC",
): Promise<void> {
  const ts = formatTimestamp();
  const entry = `- ${ts} | ${mode} | ${summary}`;

  await Promise.allSettled([
    appendToStateFile(slug, entry),
    appendToProjectLog(slug, entry),
  ]);
}

async function appendToStateFile(slug: string, entry: string): Promise<void> {
  const path = resolve(STATE_DIR, `${slug}.md`);
  const file = Bun.file(path);
  if (!(await file.exists())) return;

  let content = await file.text();
  const SECTION = "## Activity Log";

  if (content.includes(SECTION)) {
    const idx = content.indexOf(SECTION);
    const afterHeader = idx + SECTION.length;
    // Insert after section header (skip immediate newline)
    const insertAt =
      content[afterHeader] === "\n" ? afterHeader + 1 : afterHeader;
    content =
      content.slice(0, insertAt) + entry + "\n" + content.slice(insertAt);
  } else {
    if (!content.endsWith("\n")) content += "\n";
    content += `\n${SECTION}\n\n${entry}\n`;
  }

  await Bun.write(path, content);
}

async function appendToProjectLog(slug: string, entry: string): Promise<void> {
  const logPath = resolve(PROJECTS_DIR, slug, "EDDIE_LOG.md");
  const file = Bun.file(logPath);

  if (await file.exists()) {
    const content = await file.text();
    const SECTION = "## Log";
    if (content.includes(SECTION)) {
      const idx = content.indexOf(SECTION);
      const afterHeader = idx + SECTION.length;
      const insertAt =
        content[afterHeader] === "\n" ? afterHeader + 1 : afterHeader;
      const newContent =
        content.slice(0, insertAt) + "\n" + entry + "\n" + content.slice(insertAt);
      await Bun.write(logPath, newContent);
    } else {
      await Bun.write(logPath, content + `\n\n## Log\n\n${entry}\n`);
    }
  } else {
    await Bun.write(
      logPath,
      `# EDDIE Activity Log — ${slug}\n\nThis file tracks what EDDIE (autonomous) and Nicholas (collaborative) have done in this project.\nModes: AGENTIC = Eddie ran solo | COLLAB = session with Nicholas\n\n## Log\n\n${entry}\n`,
    );
  }
}
