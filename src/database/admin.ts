import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";
import { getSupabase, memoryEnabled } from "../memory/client.ts";

const BASE = "https://api.supabase.com/v1/projects";

function getRef(): string {
  if (config.SUPABASE_PROJECT_REF) return config.SUPABASE_PROJECT_REF;
  if (config.SUPABASE_URL) {
    const match = config.SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/);
    if (match) return match[1]!;
  }
  throw new Error("No SUPABASE_PROJECT_REF or SUPABASE_URL configured");
}

export async function runSQL(query: string): Promise<unknown[]> {
  if (!config.SUPABASE_PAT) throw new Error("SUPABASE_PAT not configured");
  const ref = getRef();
  const res = await fetch(`${BASE}/${ref}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.SUPABASE_PAT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const body = await res.text();
    logger.error("db:admin:error", { status: res.status, body });
    throw new Error(`Supabase Management API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<unknown[]>;
}

export async function tableExists(table: string): Promise<boolean> {
  const rows = await runSQL(
    `SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='${table}'`,
  );
  return rows.length > 0;
}

export async function ensureMigrations(): Promise<void> {
  logger.info("db:migrate:check");
  await runSQL(`
    create table if not exists heartbeat_log (
      id uuid primary key default gen_random_uuid(),
      decision text not null check (decision in ('ok', 'message', 'call')),
      summary text,
      message_sent text,
      duration_ms int,
      created_at timestamptz default now()
    );
    create index if not exists idx_heartbeat_log_created on heartbeat_log (created_at);
    create table if not exists cron_jobs (
      id uuid primary key default gen_random_uuid(),
      name text unique not null,
      schedule_type text not null check (schedule_type in ('interval', 'daily', 'weekdays', 'weekly')),
      schedule_value text not null,
      prompt text not null,
      enabled boolean default true,
      last_run_at timestamptz,
      next_run_at timestamptz not null,
      created_at timestamptz default now()
    );
    create index if not exists idx_cron_jobs_next on cron_jobs (enabled, next_run_at);
  `);
  // Usage tracking table
  await runSQL(`
    create table if not exists usage_log (
      id uuid primary key default gen_random_uuid(),
      model text not null,
      input_tokens int not null default 0,
      output_tokens int not null default 0,
      est_cost_usd decimal(10,8) not null default 0,
      source text not null,
      created_at timestamptz default now()
    );
    create index if not exists idx_usage_log_created on usage_log (created_at);
    create index if not exists idx_usage_log_source on usage_log (source);
  `);

  // Migrate embedding dimensions from OpenAI (1536) to Ollama nomic-embed-text (768)
  try {
    await runSQL(`
      DO $$
      BEGIN
        -- Drop old embedding indexes (names may vary)
        EXECUTE 'DROP INDEX IF EXISTS facts_embedding_idx';
        EXECUTE 'DROP INDEX IF EXISTS idx_facts_embedding';
        EXECUTE 'DROP INDEX IF EXISTS conversations_embedding_idx';
        EXECUTE 'DROP INDEX IF EXISTS idx_conversations_embedding';
        -- Resize facts embedding (clear broken OpenAI embeddings, resize column)
        BEGIN
          UPDATE facts SET embedding = NULL;
          ALTER TABLE facts ALTER COLUMN embedding TYPE vector(768) USING NULL::vector(768);
        EXCEPTION WHEN others THEN NULL;
        END;
        -- Resize conversations embedding
        BEGIN
          UPDATE conversations SET embedding = NULL;
          ALTER TABLE conversations ALTER COLUMN embedding TYPE vector(768) USING NULL::vector(768);
        EXCEPTION WHEN others THEN NULL;
        END;
        -- Recreate indexes for 768-dim vectors
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_facts_embedding ON facts USING ivfflat (embedding vector_cosine_ops) WHERE embedding IS NOT NULL';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_convos_embedding ON conversations USING ivfflat (embedding vector_cosine_ops) WHERE embedding IS NOT NULL';
      END;
      $$;
    `);
    logger.info("db:migrate:embeddings-resized", { dims: 768 });
  } catch (err) {
    logger.warn("db:migrate:embeddings-resize-failed", {
      error: err instanceof Error ? err.message : String(err),
      note: "Will retry next startup",
    });
  }

  // Add usage_snapshot column to heartbeat_log
  try {
    await runSQL(`
      ALTER TABLE heartbeat_log ADD COLUMN IF NOT EXISTS usage_snapshot jsonb;
    `);
    logger.info("db:migrate:heartbeat-usage-snapshot");
  } catch (err) {
    logger.warn("db:migrate:heartbeat-usage-snapshot-skip", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Add 'task' to heartbeat_log decision constraint
  try {
    await runSQL(`
      DO $$
      BEGIN
        ALTER TABLE heartbeat_log DROP CONSTRAINT IF EXISTS heartbeat_log_decision_check;
        ALTER TABLE heartbeat_log ADD CONSTRAINT heartbeat_log_decision_check
          CHECK (decision IN ('ok', 'message', 'call', 'task'));
      EXCEPTION WHEN others THEN NULL;
      END;
      $$;
    `);
    logger.info("db:migrate:heartbeat-task-decision");
  } catch (err) {
    logger.warn("db:migrate:heartbeat-constraint-skip", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Jobs table (replaces data/jobs.json flat file)
  try {
    await runSQL(`
      CREATE TABLE IF NOT EXISTS jobs (
        id text PRIMARY KEY,
        model text NOT NULL,
        prompt text NOT NULL,
        status text NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'killed')),
        tmux_session text NOT NULL,
        output_path text,
        started_at timestamptz NOT NULL,
        completed_at timestamptz,
        duration_ms int,
        error text,
        timeout_ms int,
        outcome text CHECK (outcome IN ('success', 'partial', 'failed', 'unknown')),
        outcome_summary text,
        created_at timestamptz DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);
      CREATE INDEX IF NOT EXISTS idx_jobs_started_at ON jobs (started_at DESC);
    `);
    logger.info("db:migrate:jobs-table");
  } catch (err) {
    logger.warn("db:migrate:jobs-table-skip", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // User settings table (persists voiceReply + mode across restarts)
  try {
    await runSQL(`
      CREATE TABLE IF NOT EXISTS user_settings (
        chat_id bigint NOT NULL,
        key text NOT NULL,
        value text NOT NULL,
        updated_at timestamptz DEFAULT now(),
        PRIMARY KEY (chat_id, key)
      );
      ALTER TABLE user_settings DISABLE ROW LEVEL SECURITY;
      ALTER TABLE jobs DISABLE ROW LEVEL SECURITY;
    `);
    logger.info("db:migrate:user-settings-table");
  } catch (err) {
    logger.warn("db:migrate:user-settings-table-skip", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Unified Communications Layer tables
  try {
    await runSQL(`
      CREATE TABLE IF NOT EXISTS inbox (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        channel text NOT NULL,
        external_id text NOT NULL,
        from_addr text NOT NULL,
        subject text,
        preview text NOT NULL,
        body text,
        received_at timestamptz NOT NULL,
        status text NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'archived')),
        priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('high', 'normal', 'low')),
        metadata jsonb,
        created_at timestamptz DEFAULT now(),
        UNIQUE (channel, external_id)
      );
      CREATE INDEX IF NOT EXISTS idx_inbox_status ON inbox (status, received_at DESC);
      CREATE INDEX IF NOT EXISTS idx_inbox_channel ON inbox (channel, status);
      ALTER TABLE inbox DISABLE ROW LEVEL SECURITY;

      CREATE TABLE IF NOT EXISTS comms_sync_state (
        channel text PRIMARY KEY,
        cursor text NOT NULL,
        last_polled_at timestamptz DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS comms_notifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        channels text[] NOT NULL,
        item_count int NOT NULL,
        sent_at timestamptz DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_comms_notify_sent ON comms_notifications (sent_at DESC);
    `);
    logger.info("db:migrate:comms-tables");
  } catch (err) {
    logger.warn("db:migrate:comms-tables-skip", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info("db:migrate:done");
}

/**
 * Check for missing tables that require manual migration (when SUPABASE_PAT not set).
 * Logs a single actionable warning with the SQL file path if tables are missing.
 */
export async function checkPendingMigrations(): Promise<void> {
  if (!memoryEnabled) return;
  const db = getSupabase();
  const tablesToCheck: Array<{ table: string; col: string }> = [
    { table: "jobs", col: "id" },
    { table: "user_settings", col: "chat_id" },
    { table: "inbox", col: "id" },
    { table: "comms_sync_state", col: "channel" },
  ];
  const missing: string[] = [];

  for (const { table, col } of tablesToCheck) {
    const { error } = await db.from(table).select(col).limit(1);
    if (
      error &&
      (error.message.includes("schema cache") ||
        error.message.includes("relation"))
    ) {
      missing.push(table);
    }
  }

  if (missing.length > 0) {
    logger.warn("db:migrate:pending", {
      tables: missing,
      action:
        "Run SQL from src/database/migrations/003-jobs-user-settings.sql in Supabase dashboard",
      url: `https://supabase.com/dashboard/project/${getRef()}/sql`,
      note: "Jobs will fall back to data/jobs.json until migration runs",
    });
  } else {
    logger.info("db:migrate:all-tables-ok", { checked: tablesToCheck });
  }
}
