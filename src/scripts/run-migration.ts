import { join, resolve } from "node:path";
import { applyPendingMigrations } from "../memory/migrations.ts";
import { runSQL } from "../database/admin.ts";

const MIGRATIONS_DIR = resolve(import.meta.dir, "../../data/migrations");

const args = process.argv.slice(2);
const fileIdx = args.indexOf("--file");
const specificFile = fileIdx !== -1 ? args[fileIdx + 1] : null;

if (specificFile) {
  const sql = await Bun.file(join(MIGRATIONS_DIR, specificFile)).text();

  // Ensure tracking table exists
  await runSQL(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id serial PRIMARY KEY,
      filename text NOT NULL UNIQUE,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await runSQL(sql);
  await runSQL(
    `INSERT INTO schema_migrations (filename) VALUES ('${specificFile.replace(/'/g, "''")}') ON CONFLICT (filename) DO NOTHING`,
  );
  console.log(`✓ Applied ${specificFile}`);
} else {
  const { applied, skipped, failed } = await applyPendingMigrations();

  for (const f of skipped) {
    console.log(`  skipped (already applied): ${f}`);
  }
  for (const f of applied) {
    console.log(`✓ Applied ${f}`);
  }
  for (const { filename, error } of failed) {
    console.error(`✗ Failed ${filename}: ${error}`);
  }

  if (applied.length === 0 && failed.length === 0 && skipped.length === 0) {
    console.log("No migration files found.");
  } else if (applied.length === 0 && failed.length === 0) {
    console.log("All migrations already applied.");
  }

  if (failed.length > 0) process.exit(1);
}
