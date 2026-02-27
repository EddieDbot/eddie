import { resolve } from "node:path";
import { config } from "./config.ts";
import { createBot } from "./telegram/bot.ts";
import { startDashboard } from "./dashboard/server.ts";
import { startWebhookServer } from "./voice/webhook.ts";
import { logger } from "./utils/logger.ts";
import { memoryEnabled, checkEmbeddingHealth } from "./memory/client.ts";
import { ensureMigrations, checkPendingMigrations } from "./database/admin.ts";

logger.info("EDDIE:init", { logLevel: config.LOG_LEVEL });

if (config.SUPABASE_PAT) {
  await ensureMigrations();
  if (config.MIGRATIONS_AUTO_APPLY) {
    const { applyPendingMigrations } = await import("./memory/migrations.ts");
    const result = await applyPendingMigrations();
    if (result.applied.length > 0) {
      logger.info("db:migration:auto-applied", {
        count: result.applied.length,
        files: result.applied,
      });
    }
    if (result.failed.length > 0) {
      logger.error("db:migration:auto-apply-failures", {
        count: result.failed.length,
        failures: result.failed,
      });
    }
  }
}

const bot = createBot();
await bot.start();

if (memoryEnabled) {
  const { loadUserSettings } = await import("./telegram/handlers/command.ts");
  await loadUserSettings();
  logger.info("EDDIE:user-settings-loaded");
}

if (memoryEnabled) {
  await checkEmbeddingHealth();
  await checkPendingMigrations();
}

if (config.DASHBOARD_ENABLED) {
  startDashboard();
}

if (config.AGENT_DASHBOARD_ENABLED) {
  const { startAgentWatcher } = await import("./dashboard/agent-watcher.ts");
  startAgentWatcher();
}

if (config.TWILIO_ACCOUNT_SID) {
  startWebhookServer(config.TWILIO_WEBHOOK_PORT);
}

if (config.HEARTBEAT_ENABLED) {
  const { startHeartbeat } = await import("./proactive/heartbeat.ts");
  startHeartbeat(bot);
}

if (config.DREAM_ENABLED) {
  const { startDreamCycle } = await import("./proactive/dream.ts");
  startDreamCycle(bot, config.DREAM_TIME);
}

if (config.NIGHTLY_ORCHESTRATE_ENABLED) {
  const { startNightlyOrchestrate } =
    await import("./proactive/nightly-orchestrate.ts");
  startNightlyOrchestrate(bot);
}

if (config.SECURITY_COUNCIL_ENABLED) {
  const { startSecurityCouncil } =
    await import("./security/security-council.ts");
  startSecurityCouncil(bot);
}

// Monthly MCP audit (fires on day 1 of month)
if (config.MCP_AUDIT_LOG_ENABLED) {
  const { runMcpAudit } = await import("./security/mcp-audit.ts");
  const scheduleMonthlyAudit = () => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1, 3, 0, 0, 0);
    setTimeout(async () => {
      if (new Date().getDate() === 1) await runMcpAudit(bot);
      scheduleMonthlyAudit();
    }, next.getTime() - now.getTime());
  };
  scheduleMonthlyAudit();
}

if (config.MORNING_BRIEF_ENABLED) {
  const { startMorningBrief } = await import("./proactive/morning-brief.ts");
  startMorningBrief(bot, config.MORNING_BRIEF_TIME);
}

const { startConsolidation } = await import("./proactive/consolidate.ts");
startConsolidation();

const { startJobPoller } = await import("./jobs/poll.ts");
startJobPoller(bot);

// Hourly capabilities parity check — runs even when HEARTBEAT_ENABLED=false
setInterval(
  async () => {
    try {
      const { spawnSync } = await import("bun");
      spawnSync(
        [
          "bun",
          "run",
          resolve(import.meta.dir, "scripts/capabilities-parity-check.ts"),
        ],
        {
          stdout: "inherit",
          stderr: "inherit",
        },
      );
    } catch (err) {
      // Non-fatal — log and continue
      console.error("capabilities-parity: interval error:", err);
    }
  },
  60 * 60 * 1000,
);

if (config.COMMS_ENABLED) {
  const { startComms } = await import("./comms/index.ts");
  startComms(bot);
}

if (config.YOUTUBE_API_KEY && config.PLAYLIST_ENABLED) {
  const { startPlaylistWatcher } = await import("./proactive/playlist.ts");
  startPlaylistWatcher(bot);
}

if (config.DAILY_BRIEF_ENABLED) {
  const { startDailyBriefUpdater } = await import("./proactive/daily-brief.ts");
  startDailyBriefUpdater();
}

if (config.MEET_INGEST_ENABLED) {
  const { startMeetIngestionCron } = await import("./proactive/meet-ingest.ts");
  startMeetIngestionCron();
}

if (config.BOOK_INGEST_ENABLED) {
  const { startBookWatcher } = await import("./proactive/book-ingest.ts");
  startBookWatcher(bot);
}

if (config.CONTACT_SYNC_ENABLED) {
  const { startContactSync } = await import("./comms/imessage/contact-sync.ts");
  startContactSync();
}

if (config.CLAUDE_HEALTH_ENABLED) {
  const { startClaudeHealth } = await import("./proactive/claude-health.ts");
  startClaudeHealth(bot);
}

if (config.ANTHROPIC_MONITOR_ENABLED) {
  const { startAnthropicMonitor } =
    await import("./proactive/anthropic-monitor.ts");
  startAnthropicMonitor(bot);
}

if (config.MEMORY_MONITOR_ENABLED) {
  const { startMemoryMonitor } = await import("./proactive/memory-monitor.ts");
  startMemoryMonitor(bot);
}

if (config.ANOMALY_DETECT_ENABLED) {
  const { runAnomalyCheck } = await import("./security/anomaly-detect.ts");
  // Run on startup then every 24h (03:30 slot shared with security council)
  runAnomalyCheck().catch(() => {});
  setInterval(
    () =>
      runAnomalyCheck().catch((err) =>
        logger.warn("anomaly-detect:error", { error: String(err) }),
      ),
    24 * 60 * 60 * 1000,
  );
}

if (config.WEEKLY_CONTENT_ENABLED) {
  const { startWeeklyContent } = await import("./proactive/weekly-content.ts");
  startWeeklyContent(bot);
}

if (config.TRANSCRIPT_WATCHER_ENABLED) {
  const { startTranscriptWatcher } =
    await import("./proactive/transcript-watcher.ts");
  startTranscriptWatcher(bot);
}

if (config.VIDEO_PIPELINE_ENABLED) {
  const { startVideoPipelineScheduler } = await import("./video/pipeline.ts");
  const { startAnalyticsPoller } = await import("./video/analytics-tracker.ts");
  startVideoPipelineScheduler();
  startAnalyticsPoller();
}

bot.api
  .sendMessage({
    chat_id: config.OWNER_TELEGRAM_ID,
    text: "back online.",
  })
  .catch(() => {});
