import { resolve } from "node:path";
import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";
import type { PieceMetadata } from "./types.ts";

const HOME = homedir();
const COMMUNITY_REPO =
  process.env.HEIMDALL_COMMUNITY_REPO ?? "EddieDbot/eddie-community";
const CACHE_DIR = resolve(
  import.meta.dir,
  "../../data/heimdall-cache",
);

interface SyncEntry {
  id: string;
  name: string;
  currentVersion?: string;
  availableVersion: string;
  status: "new" | "update" | "conflict" | "up-to-date";
  diffSummary?: string;
}

async function fetchPieceIndex(): Promise<PieceMetadata[]> {
  // Fetch the community repo's piece index via GitHub API
  const token = process.env.HEIMDALL_GITHUB_PAT;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
  };
  if (token) headers.Authorization = `token ${token}`;

  try {
    const url = `https://api.github.com/repos/${COMMUNITY_REPO}/contents/pieces`;
    const resp = await fetch(url, { headers });

    if (!resp.ok) {
      if (resp.status === 404) return [];
      throw new Error(`GitHub API: ${resp.status} ${resp.statusText}`);
    }

    const entries = (await resp.json()) as Array<{
      name: string;
      type: string;
      download_url?: string;
    }>;

    const pieces: PieceMetadata[] = [];
    for (const entry of entries) {
      if (entry.type !== "dir") continue;

      // Fetch metadata.json from each piece directory
      const metaUrl = `https://api.github.com/repos/${COMMUNITY_REPO}/contents/pieces/${entry.name}/metadata.json`;
      try {
        const metaResp = await fetch(metaUrl, { headers });
        if (!metaResp.ok) continue;

        const metaData = (await metaResp.json()) as {
          content?: string;
          encoding?: string;
        };
        if (metaData.content && metaData.encoding === "base64") {
          const decoded = atob(metaData.content.replace(/\n/g, ""));
          pieces.push(JSON.parse(decoded) as PieceMetadata);
        }
      } catch {
        // Skip pieces with invalid metadata
      }
    }

    return pieces;
  } catch (e) {
    console.error(`Failed to fetch community index: ${e}`);
    return [];
  }
}

async function getInstalledVersion(
  pieceId: string,
): Promise<string | undefined> {
  // Check local registry for installed version
  const registryPath = resolve(
    import.meta.dir,
    "../../data/heimdall-registry.json",
  );
  try {
    const content = await Bun.file(registryPath).text();
    const registry = JSON.parse(content) as Record<
      string,
      { version: string }
    >;
    return registry[pieceId]?.version;
  } catch {
    return undefined;
  }
}

export async function checkForUpdates(): Promise<SyncEntry[]> {
  const remotePieces = await fetchPieceIndex();
  const entries: SyncEntry[] = [];

  for (const piece of remotePieces) {
    const installed = await getInstalledVersion(piece.id);

    if (!installed) {
      entries.push({
        id: piece.id,
        name: piece.name,
        availableVersion: piece.version,
        status: "new",
      });
    } else if (installed !== piece.version) {
      entries.push({
        id: piece.id,
        name: piece.name,
        currentVersion: installed,
        availableVersion: piece.version,
        status: "update",
      });
    } else {
      entries.push({
        id: piece.id,
        name: piece.name,
        currentVersion: installed,
        availableVersion: piece.version,
        status: "up-to-date",
      });
    }
  }

  return entries;
}

function formatSyncStatus(entries: SyncEntry[]): string {
  if (entries.length === 0) {
    return "No pieces found in the community repository.";
  }

  const newPieces = entries.filter((e) => e.status === "new");
  const updates = entries.filter((e) => e.status === "update");
  const upToDate = entries.filter((e) => e.status === "up-to-date");
  const conflicts = entries.filter((e) => e.status === "conflict");

  const lines: string[] = ["Sync Status:\n"];

  if (newPieces.length > 0) {
    lines.push("  New pieces available:");
    for (const p of newPieces) {
      lines.push(`    + ${p.name} (${p.id}) v${p.availableVersion}`);
    }
    lines.push("");
  }

  if (updates.length > 0) {
    lines.push("  Updates available:");
    for (const p of updates) {
      lines.push(
        `    ~ ${p.name} (${p.id}) ${p.currentVersion} -> ${p.availableVersion}`,
      );
    }
    lines.push("");
  }

  if (conflicts.length > 0) {
    lines.push("  Conflicts (local modifications):");
    for (const p of conflicts) {
      lines.push(`    ! ${p.name} (${p.id}) — review manually`);
    }
    lines.push("");
  }

  if (upToDate.length > 0) {
    lines.push(`  ${upToDate.length} piece(s) up to date.`);
  }

  const actionable = newPieces.length + updates.length + conflicts.length;
  if (actionable > 0) {
    lines.push(
      `\n${actionable} piece(s) need attention. Use 'heimdall review <piece>' for details.`,
    );
  }

  return lines.join("\n");
}

// CLI entry point
if (import.meta.main) {
  await mkdir(CACHE_DIR, { recursive: true });

  console.log("Checking community repository for updates...\n");
  const entries = await checkForUpdates();
  console.log(formatSyncStatus(entries));
}
