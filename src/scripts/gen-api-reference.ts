import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveSlugPath } from "../memory/brain-vault-paths.ts";

const DASHBOARD_DIR = resolve(import.meta.dir, "../dashboard");

type Route = { method: string; path: string; description: string };

function extractRoutes(source: string, filename: string): Route[] {
  const routes: Route[] = [];
  const lines = source.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Match switch-case patterns like: case "/api/health":
    const caseMatch = line.match(/case\s+"(\/api\/[^"]+)"/);
    if (caseMatch) {
      const comment = i > 0 ? lines[i - 1]?.trim() ?? "" : "";
      const desc =
        comment.startsWith("//") ? comment.slice(2).trim() : `from ${filename}`;
      routes.push({ method: "GET", path: caseMatch[1]!, description: desc });
      continue;
    }

    // Match url.pathname patterns like: url.pathname === "/api/feed"
    const pathMatch = line.match(
      /url\.pathname\s*===\s*"(\/[^"]+)"/,
    );
    if (pathMatch) {
      const path = pathMatch[1]!;
      const method = line.includes('req.method === "POST"') || line.includes("POST") ? "POST" : "GET";
      const comment = i > 0 ? lines[i - 1]?.trim() ?? "" : "";
      const desc =
        comment.startsWith("//") ? comment.slice(2).trim() : `from ${filename}`;
      routes.push({ method, path, description: desc });
      continue;
    }

    // Match url.pathname.startsWith patterns
    const startsWithMatch = line.match(
      /url\.pathname\.startsWith\("(\/[^"]+)"\)/,
    );
    if (startsWithMatch) {
      const path = `${startsWithMatch[1]!}*`;
      const comment = i > 0 ? lines[i - 1]?.trim() ?? "" : "";
      const desc =
        comment.startsWith("//") ? comment.slice(2).trim() : `from ${filename}`;
      routes.push({ method: "GET", path, description: desc });
      continue;
    }

    // Match regex route patterns like: path.match(/^\/api\/jobs\/([^/]+)\/output$/)
    const regexMatch = line.match(/path\.match\(\/\^(\\\/api\\\/[^$]+)\$\/\)/);
    if (regexMatch) {
      const rawPath = regexMatch[1]!.replace(/\\\//g, "/").replace(/\(\[^\/\]\+\)/g, ":id");
      const comment = i > 0 ? lines[i - 1]?.trim() ?? "" : "";
      const desc =
        comment.startsWith("//") ? comment.slice(2).trim() : `from ${filename}`;
      routes.push({ method: "GET", path: rawPath, description: desc });
    }
  }

  return routes;
}

function dedup(routes: Route[]): Route[] {
  const seen = new Set<string>();
  return routes.filter((r) => {
    const key = `${r.method}:${r.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function main() {
  const files = ["server.ts", "api.ts"];
  const allRoutes: Route[] = [];

  for (const f of files) {
    const filepath = resolve(DASHBOARD_DIR, f);
    const source = readFileSync(filepath, "utf-8");
    allRoutes.push(...extractRoutes(source, f));
  }

  const routes = dedup(allRoutes);
  const getRoutes = routes.filter((r) => r.method === "GET");
  const postRoutes = routes.filter((r) => r.method === "POST");

  const lines: string[] = [
    "# EDDIE API Reference",
    "",
    `> Auto-generated on ${new Date().toISOString().slice(0, 10)}`,
    "",
  ];

  if (getRoutes.length > 0) {
    lines.push("## GET Routes", "");
    lines.push("| Path | Description |");
    lines.push("|------|-------------|");
    for (const r of getRoutes) {
      lines.push(`| \`${r.path}\` | ${r.description} |`);
    }
    lines.push("");
  }

  if (postRoutes.length > 0) {
    lines.push("## POST Routes", "");
    lines.push("| Path | Description |");
    lines.push("|------|-------------|");
    for (const r of postRoutes) {
      lines.push(`| \`${r.path}\` | ${r.description} |`);
    }
    lines.push("");
  }

  const eddiePath = resolveSlugPath("eddie");
  if (!eddiePath) {
    console.error("Could not resolve 'eddie' slug path");
    process.exit(1);
  }

  const outFile = resolve(eddiePath, "api-reference.md");
  await Bun.write(outFile, lines.join("\n"));
  console.log(`API reference written to ${outFile} (${routes.length} routes)`);
}

main();
