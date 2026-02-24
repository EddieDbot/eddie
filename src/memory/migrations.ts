import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runSQL } from "../database/admin.ts";
import { logger } from "../utils/logger.ts";

const MIGRATIONS_DIR = resolve(import.meta.dir, "../../data/migrations");

async function ensureMigrationsTable(): Promise<void> {
  await runSQL(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id serial PRIMARY KEY,
      filename text NOT NULL UNIQUE,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function getApplied(): Promise<Set<string>> {
  const rows = (await runSQL(
    `SELECT filename FROM schema_migrations ORDER BY filename`,
  )) as Array<{ filename: string }>;
  return new Set(rows.map((r) => r.filename));
}

async function getMigrationFiles(): Promise<string[]> {
  try {
    const entries = await readdir(MIGRATIONS_DIR);
    return entries.filter((f) => f.endsWith(".sql")).sort();
  } catch {
    return [];
  }
}

export async function applyPendingMigrations(): Promise<{
  applied: string[];
  skipped: string[];
  failed: Array<{ filename: string; error: string }>;
}> {
  await ensureMigrationsTable();

  const [files, appliedSet] = await Promise.all([
    getMigrationFiles(),
    getApplied(),
  ]);

  const applied: string[] = [];
  const skipped: string[] = [];
  const failed: Array<{ filename: string; error: string }> = [];

  for (const filename of files) {
    if (appliedSet.has(filename)) {
      skipped.push(filename);
      continue;
    }

    const sql = await Bun.file(join(MIGRATIONS_DIR, filename)).text();

    try {
      await runSQL(sql);
      await runSQL(
        `INSERT INTO schema_migrations (filename) VALUES ('${filename.replace(/'/g, "''")}')`,
      );
      logger.info("db:migration:applied", { filename });
      applied.push(filename);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error("db:migration:failed", { filename, error });
      failed.push({ filename, error });
    }
  }

  return { applied, skipped, failed };
}
