import { Bot } from "gramio";
import { config } from "../config.ts";
import { authMiddleware } from "./middleware/auth.ts";
import { loggingMiddleware } from "./middleware/logging.ts";
import {
  handleStart,
  handleStatus,
  handleNewSession,
  handleRemember,
  handleForget,
  handleGoals,
  handleVoiceReply,
  handleCall,
  handleBrainstorm,
  handleHeartbeat,
  handleCron,
  handleRun,
  handleJobs,
  handleKill,
  handleConsolidate,
  handleDeploy,
  handleMode,
  handleAgents,
  handleWheel,
  handleBrief,
  handleCollabLog,
  handleInbox,
  handleChannels,
  handleCalendar,
  handleDrive,
  handleSlack,
  handlePlaylist,
} from "./handlers/command.ts";
import { handleText } from "./handlers/text.ts";
import { handleVoice } from "./handlers/voice.ts";
import { handlePhoto, handleDocument } from "./handlers/media.ts";
import { logger } from "../utils/logger.ts";

export function createBot(): Bot {
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

  bot.use(authMiddleware);
  bot.use(loggingMiddleware);

  bot.command("start", (context) => handleStart(context));
  bot.command("status", (context) => handleStatus(context));
  bot.command("newsession", (context) => handleNewSession(context));
  bot.command("remember", (context) => handleRemember(context));
  bot.command("forget", (context) => handleForget(context));
  bot.command("goals", (context) => handleGoals(context));
  bot.command("voicereply", (context) => handleVoiceReply(context));
  bot.command("call", (context) => handleCall(context));
  bot.command("brainstorm", (context) => handleBrainstorm(context));
  bot.command("heartbeat", (context) => handleHeartbeat(context));
  bot.command("cron", (context) => handleCron(context));
  bot.command("run", (context) => handleRun(context));
  bot.command("jobs", (context) => handleJobs(context));
  bot.command("kill", (context) => handleKill(context));
  bot.command("consolidate", (context) => handleConsolidate(context));
  bot.command("deploy", (context) => handleDeploy(context));
  bot.command("mode", (context) => handleMode(context));
  bot.command("agents", (context) => handleAgents(context));
  bot.command("wheel", (context) => handleWheel(context));
  bot.command("brief", (context) => handleBrief(context));
  bot.command("collab_log", (context) => handleCollabLog(context));
  bot.command("inbox", (context) => handleInbox(context));
  bot.command("channels", (context) => handleChannels(context));
  bot.command("calendar", (context) => handleCalendar(context));
  bot.command("drive", (context) => handleDrive(context));
  bot.command("slack", (context) => handleSlack(context));
  bot.command("playlist", (context) => handlePlaylist(context));

  bot.on("message", (context) => {
    if (context.voice) return handleVoice(context);
    if (context.photo && context.photo.length > 0) return handlePhoto(context);
    if (context.document) return handleDocument(context);
    return handleText(context);
  });

  bot.onStart(({ info }) => {
    logger.info("bot:started", { username: info.username });
  });

  return bot;
}
