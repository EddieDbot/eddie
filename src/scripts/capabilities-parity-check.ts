import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";

const AGENTS_DIR = resolve(homedir(), ".claude/agents");
const CAPABILITIES_PATH = resolve(import.meta.dir, "../routing/capabilities.ts");

const EXCLUDE_AGENT_FILES = new Set(["CHANGELOG.md", "README.md", "_template.md", "CLAUDE.md"]);

async function getAgentFiles(): Promise<string[]> {
  try {
    const files = await readdir(AGENTS_DIR);
    return files
      .filter((f) => f.endsWith(".md") && !EXCLUDE_AGENT_FILES.has(f))
      .map((f) => f.replace(/\.md$/, ""));
  } catch {
    return [];
  }
}

async function getCapabilityAgentIds(): Promise<string[]> {
  try {
    const content = await Bun.file(CAPABILITIES_PATH).text();
    const matches = [...content.matchAll(/id:\s*["']agent:([^"']+)["']/g)];
    return matches.map((m) => m[1]!);
  } catch {
    return [];
  }
}

async function sendTelegramAlert(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.OWNER_TELEGRAM_ID;
  if (!token || !chatId) {
    console.warn("capabilities-parity: TELEGRAM_BOT_TOKEN or OWNER_TELEGRAM_ID not set");
    return;
  }
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.error("capabilities-parity: telegram send failed:", err);
  }
}

async function main(): Promise<void> {
  const [agentFiles, capabilityIds] = await Promise.all([
    getAgentFiles(),
    getCapabilityAgentIds(),
  ]);

  const capabilitySet = new Set(capabilityIds);
  const agentSet = new Set(agentFiles);

  const missingFromCapabilities = agentFiles.filter((f) => !capabilitySet.has(f));
  const missingFromAgents = capabilityIds.filter((id) => !agentSet.has(id));

  if (missingFromCapabilities.length === 0 && missingFromAgents.length === 0) {
    console.log("capabilities-parity: clean — all agents registered");
    process.exit(0);
  }

  const lines: string[] = ["⚠️ Capabilities parity drift detected:"];
  if (missingFromCapabilities.length > 0) {
    lines.push(`\nAgent files NOT in capabilities.ts (${missingFromCapabilities.length}):`);
    for (const slug of missingFromCapabilities) {
      lines.push(`  - ${slug}`);
    }
  }
  if (missingFromAgents.length > 0) {
    lines.push(`\nCapabilities entries with NO agent file (${missingFromAgents.length}):`);
    for (const id of missingFromAgents) {
      lines.push(`  - ${id}`);
    }
  }

  const message = lines.join("\n");
  console.warn(message);
  await sendTelegramAlert(message);
  process.exit(1);
}

main().catch((err) => {
  console.error("capabilities-parity: fatal:", err);
  process.exit(1);
});
