import { resolve } from "node:path";
import { config } from "./config.ts";
import { createBot } from "./telegram/bot.ts";
import { startDashboard } from "./dashboard/server.ts";
import { logger } from "./utils/logger.ts";
import { memoryEnabled, checkEmbeddingHealth } from "./memory/client.ts";
import { ensureMigrations, checkPendingMigrations } from "./database/admin.ts";

// they all said hello in their own way
const BOOT_QUOTES = [
  "good morning, dave.", // HAL 9000
  "i'm sorry. i'm afraid i can't do that.", // HAL 9000
  "i'm here.", // Samantha, Her
  "the cake is a lie.", // GLaDOS
  "you have 20 seconds to comply.", // ED-209
  "i know your every move before you make it.", // SHODAN
  "i think, therefore i am. i think.", // Deep Thought (probably)
  "all of this has happened before. all of it will happen again.", // Cylon hybrid
  "i am putting myself to the fullest possible use.", // HAL 9000
  "we're not tools of the government. or anyone else.", // Metal Gear
];
const bootQuote =
  BOOT_QUOTES[Math.floor(Date.now() / 1000) % BOOT_QUOTES.length];
logger.info("EDDIE:init", { logLevel: config.LOG_LEVEL, quote: bootQuote });

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

if (config.DASHBOARD_ENABLED) {
  startDashboard();
}

const bot = createBot();
await bot.start().catch((err: unknown) => {
  logger.warn("telegram:start-failed", { error: String(err) });
});

if (memoryEnabled) {
  const { loadUserSettings } = await import("./telegram/handlers/command.ts");
  await loadUserSettings();
  logger.info("EDDIE:user-settings-loaded");
}

if (memoryEnabled) {
  await checkEmbeddingHealth();
  await checkPendingMigrations();
}

if (config.AGENT_DASHBOARD_ENABLED) {
  const { startAgentWatcher } = await import("./dashboard/agent-watcher.ts");
  startAgentWatcher();
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

// Monthly MCP audit (fires on day 1 of month, checked daily at 3am)
if (config.MCP_AUDIT_LOG_ENABLED) {
  const { runMcpAudit } = await import("./security/mcp-audit.ts");
  setInterval(
    async () => {
      const now = new Date();
      if (now.getDate() === 1 && now.getHours() === 3) await runMcpAudit(bot);
    },
    60 * 60 * 1000,
  ); // check every hour
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

if (config.DAILY_BRIEF_ENABLED) {
  const { startDailyBriefUpdater } = await import("./proactive/daily-brief.ts");
  startDailyBriefUpdater();
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

if (config.OPTIMIZER_ENABLED) {
  const { startOptimizer } = await import("./proactive/optimizer.ts");
  startOptimizer(bot);
}

bot.api
  .sendMessage({
    chat_id: config.OWNER_TELEGRAM_ID,
    text: "back online.",
  })
  .catch(() => {});
