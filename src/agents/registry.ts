import { resolve } from "node:path";
import { homedir } from "node:os";
import { logger } from "../utils/logger.ts";

export type AgentInfo = {
  slug: string;
  name: string;
  description: string;
  model: string;
  tools: string[];
};

const AGENTS_DIR = resolve(homedir(), ".claude/agents");
const CACHE_TTL_MS = 60 * 60 * 1000;

let cache: AgentInfo[] | null = null;
let cacheTime = 0;

function parseFrontmatter(content: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key) result[key] = value;
  }
  return result;
}

export async function loadAgents(): Promise<AgentInfo[]> {
  if (cache && Date.now() - cacheTime < CACHE_TTL_MS) return cache;

  const agents: AgentInfo[] = [];

  try {
    const dir = Bun.file(AGENTS_DIR);
    if (!(await dir.exists())) {
      cache = [];
      cacheTime = Date.now();
      return [];
    }

    const files = await import("node:fs/promises").then((fs) =>
      fs.readdir(AGENTS_DIR)
    );

    for (const file of files) {
      if (!file.endsWith(".md") || file.startsWith("_")) continue;
      const slug = file.replace(/\.md$/, "");
      try {
        const content = await Bun.file(resolve(AGENTS_DIR, file)).text();
        const frontmatter = parseFrontmatter(content);

        const name = frontmatter["name"] ?? slug;
        const description = frontmatter["description"] ?? "";
        const model = frontmatter["model"] ?? "sonnet";
        const toolsRaw = frontmatter["tools"] ?? "";
        const tools = toolsRaw
          ? toolsRaw.split(",").map((t) => t.trim()).filter(Boolean)
          : [];

        agents.push({ slug, name, description, model, tools });
      } catch {
        // Skip unreadable files
      }
    }
  } catch (err) {
    logger.warn("agents:registry-load-failed", { error: err instanceof Error ? err.message : String(err) });
  }

  cache = agents;
  cacheTime = Date.now();
  logger.info("agents:loaded", { count: agents.length });
  return agents;
}

export async function listAgents(): Promise<AgentInfo[]> {
  return loadAgents();
}

export async function findAgentsForTask(desc: string): Promise<AgentInfo[]> {
  const all = await loadAgents();
  const words = desc.toLowerCase().split(/\s+/);

  return all
    .map((agent) => {
      const haystack = `${agent.slug} ${agent.name} ${agent.description}`.toLowerCase();
      const score = words.filter((w) => haystack.includes(w)).length;
      return { agent, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ agent }) => agent);
}

export function clearCache(): void {
  cache = null;
  cacheTime = 0;
}
