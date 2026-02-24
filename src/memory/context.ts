import { searchMemory } from "./search.ts";
import { memoryEnabled } from "./client.ts";
import { logger } from "../utils/logger.ts";
import { EDDIE_STATE_FILE } from "./brain-vault-paths.ts";

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export async function buildMemoryContext(prompt: string): Promise<string> {
  if (!memoryEnabled) return "";
  try {
    const [results, stateContent] = await Promise.all([
      searchMemory(prompt, 10, 0.7).catch(() => []),
      Bun.file(EDDIE_STATE_FILE).text().catch(() => ""),
    ]);

    const parts: string[] = [];

    if (results.length > 0) {
      const lines = results.map((r) => {
        const time = relativeTime(r.created_at);
        const label = r.category ?? r.source;
        return `- (${time}, ${label}) "${r.content}"`;
      });
      parts.push(`<memory>\n${lines.join("\n")}\n</memory>`);
    }

    if (stateContent) {
      parts.push(`<session_state>\n${stateContent}\n</session_state>`);
    }

    return parts.join("\n\n");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("memory:context", { error: message });
    return "";
  }
}
