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

if (config.TWILIO_ACCOUNT_SID) {
  startWebhookServer(config.TWILIO_WEBHOOK_PORT);
}

if (config.HEARTBEAT_ENABLED) {
  const { startHeartbeat } = await import("./proactive/heartbeat.ts");
  startHeartbeat(bot);
}

if (config.DREAM_ENABLED) {
  const { startDreamCycle } = await import("./proactive/dream.ts");
  startDreamCycle(config.DREAM_TIME);
}

if (config.MORNING_BRIEF_ENABLED) {
  const { startMorningBrief } = await import("./proactive/morning-brief.ts");
  startMorningBrief(bot, config.MORNING_BRIEF_TIME);
}

const { startConsolidation } = await import("./proactive/consolidate.ts");
startConsolidation();

const { startJobPoller } = await import("./jobs/poll.ts");
startJobPoller(bot);

if (config.COMMS_ENABLED) {
  const { startComms } = await import("./comms/index.ts");
  startComms(bot);
}

if (config.YOUTUBE_API_KEY && config.PLAYLIST_ENABLED) {
  const { startPlaylistWatcher } = await import("./proactive/playlist.ts");
  startPlaylistWatcher(bot);
}
