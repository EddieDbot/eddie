import { createInterface, type Interface } from "node:readline";
import { cpus, homedir } from "node:os";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BANNER = `
 ███████╗██████╗ ██████╗ ██╗███████╗
 ██╔════╝██╔══██╗██╔══██╗██║██╔════╝
 █████╗  ██║  ██║██║  ██║██║█████╗
 ██╔══╝  ██║  ██║██║  ██║██║██╔══╝
 ███████╗██████╔╝██████╔╝██║███████╗
 ╚══════╝╚═════╝ ╚═════╝ ╚═╝╚══════╝
 Every Day Digital Intelligence Engine
`;

const USAGE = `
EDDIE Onboarding Wizard — First-Run Setup

Usage: bun run src/onboarding/wizard.ts [options]

Options:
  --dry-run    Walk through all prompts without writing files or starting services
  --help, -h   Show this help message

The wizard will:
  1. Detect your system environment (OS, RAM, CPU, disk)
  2. Ask about your Claude subscription tier
  3. Walk through module selection
  4. Collect Telegram credentials
  5. Configure Supabase (semantic memory)
  6. Configure Google API key (embeddings)
  7. Configure Slack (optional)
  8. Set owner info and Brain Vault path
  9. Initialize Brain Vault directory structure
  10. Generate a .env configuration file
  11. Run a smoke test to verify EDDIE starts correctly
`.trim();

type ModuleSelection = {
  vectorMemory: boolean;
  heimdallSync: boolean;
};

type CollectedConfig = {
  ownerName: string;
  brainVaultPath: string;
  personalGitRepo: string;
  telegramBotToken: string;
  telegramUserId: string;
  maxConcurrentJobs: number;
  modules: ModuleSelection;
  supabaseUrl: string;
  supabaseAnonKey: string;
  googleApiKey: string;
  slackBotToken: string;
  slackChannelId: string;
};

const DRY_RUN = process.argv.includes("--dry-run");

function ask(rl: Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function confirm(rl: Interface, question: string): Promise<boolean> {
  const answer = await ask(rl, `${question} (y/n): `);
  return answer.toLowerCase().startsWith("y");
}

async function askWithDefault(
  rl: Interface,
  question: string,
  defaultValue: string,
): Promise<string> {
  const answer = await ask(rl, `${question} [${defaultValue}]: `);
  return answer || defaultValue;
}

async function detectEnvironment(): Promise<{
  os: string;
  ramGB: number;
  cpuCores: number;
  diskFreeGB: number;
}> {
  const platform = process.platform;
  const osName =
    platform === "linux" ? "Linux" : platform === "darwin" ? "macOS" : platform;

  let ramGB = 0;
  if (platform === "linux") {
    try {
      const proc = Bun.spawn(["cat", "/proc/meminfo"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const text = await new Response(proc.stdout).text();
      const match = text.match(/MemTotal:\s+(\d+)\s+kB/);
      if (match?.[1]) ramGB = Math.round(parseInt(match[1]) / 1024 / 1024);
    } catch {
      /* fallback below */
    }
  } else if (platform === "darwin") {
    try {
      const proc = Bun.spawn(["sysctl", "-n", "hw.memsize"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const text = await new Response(proc.stdout).text();
      ramGB = Math.round(parseInt(text.trim()) / 1024 / 1024 / 1024);
    } catch {
      /* fallback */
    }
  }

  const cpuCores = cpus().length;

  let diskFreeGB = 0;
  try {
    const proc = Bun.spawn(["df", "-BG", homedir()], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const text = await new Response(proc.stdout).text();
    const lines = text.trim().split("\n");
    const secondLine = lines[1];
    if (secondLine) {
      const parts = secondLine.split(/\s+/);
      const avail = parts[3];
      if (avail) {
        diskFreeGB = parseInt(avail.replace("G", ""));
      }
    }
  } catch {
    /* fallback */
  }

  return { os: osName, ramGB, cpuCores, diskFreeGB };
}

async function stepBanner(): Promise<void> {
  console.log(BANNER);
  console.log("  First-Run Setup Wizard");
  if (DRY_RUN) console.log("  [DRY RUN] No files will be written\n");
  console.log("");
}

async function stepTosAcknowledgment(rl: Interface): Promise<void> {
  console.log("── Terms of Service ──\n");
  console.log("  EDDIE requires your own Claude Code subscription to operate.");
  console.log("  By continuing, you confirm:\n");
  console.log(
    "    ✓  You have an active Claude Code subscription (Pro, Max 5x, or Max 20x)",
  );
  console.log("    ✓  EDDIE will run on YOUR subscription — no shared access");
  console.log("    ✓  You agree to Anthropic's Consumer Terms of Service");
  console.log("       https://www.anthropic.com/legal/consumer-terms\n");

  if (DRY_RUN) {
    console.log("  [DRY RUN] Would prompt for ToS acknowledgment\n");
    return;
  }

  const agreed = await confirm(rl, "  Do you confirm and agree to continue?");
  if (!agreed) {
    console.log(
      "\n  Setup cancelled. Subscribe at https://claude.ai/upgrade to get started.\n",
    );
    process.exit(0);
  }
  console.log("");
}

async function stepDetectEnvironment(): Promise<void> {
  console.log("── Step 1: Environment Detection ──\n");
  const env = await detectEnvironment();
  console.log(
    `  Detected: ${env.os}, ${env.ramGB}GB RAM, ${env.cpuCores} cores, ${env.diskFreeGB}GB free\n`,
  );
}

async function stepSubscriptionTier(rl: Interface): Promise<number> {
  console.log("── Step 2: Claude Subscription ──\n");
  console.log("  What Claude subscription do you have?");
  console.log("  [1] Pro ($20/mo)");
  console.log("  [2] Max 5x ($100/mo)");
  console.log("  [3] Max 20x ($200/mo)\n");

  let choice = "";
  while (!["1", "2", "3"].includes(choice)) {
    choice = await ask(rl, "  Choice (1-3): ");
  }

  const tierMap: Record<string, { name: string; jobs: number }> = {
    "1": { name: "Pro", jobs: 2 },
    "2": { name: "Max 5x", jobs: 4 },
    "3": { name: "Max 20x", jobs: 8 },
  };

  const tier = tierMap[choice]!;
  console.log(
    `\n  ${tier.name} selected — MAX_CONCURRENT_JOBS=${tier.jobs}${choice === "1" ? ", Opus routing disabled" : ", full model routing"}\n`,
  );
  return tier.jobs;
}

async function stepModuleSelection(rl: Interface): Promise<ModuleSelection> {
  console.log("── Step 3: Module Selection ──\n");

  console.log(
    "  Heimdall sync — Check for community piece updates automatically",
  );
  const heimdallSync = await confirm(rl, "  Enable Heimdall sync?");
  console.log("");

  return { vectorMemory: true, heimdallSync };
}

async function stepRequiredCredentials(rl: Interface): Promise<{
  telegramBotToken: string;
  telegramUserId: string;
}> {
  console.log("── Step 4: Required Credentials ──\n");

  let telegramBotToken = "";
  let attempts = 0;
  while (!telegramBotToken) {
    if (attempts >= 2) {
      console.log(
        '  Token format: digits followed by colon, e.g. "123456789:ABCdefGHIjklMNO..."',
      );
      console.log(
        "  Create a bot: Open Telegram, message @BotFather, send /newbot\n",
      );
    }
    const token = await ask(rl, "  Telegram bot token (from @BotFather): ");
    if (/^\d+:.+$/.test(token)) {
      telegramBotToken = token;
    } else if (token) {
      console.log(
        '  Invalid format. Must start with digits followed by ":" (e.g. 123456789:ABC...)\n',
      );
      attempts++;
      if (attempts >= 3) {
        console.log(
          "  Skipping — you can set TELEGRAM_BOT_TOKEN in .env later.\n",
        );
        break;
      }
    }
  }

  let telegramUserId = "";
  attempts = 0;
  while (!telegramUserId) {
    if (attempts >= 2) {
      console.log("  To get your ID: message @userinfobot on Telegram\n");
    }
    const id = await ask(
      rl,
      "  Your Telegram user ID (message @userinfobot to get it): ",
    );
    if (/^\d+$/.test(id)) {
      telegramUserId = id;
    } else if (id) {
      console.log("  Invalid format. Must be numeric.\n");
      attempts++;
      if (attempts >= 3) {
        console.log(
          "  Skipping — you can set OWNER_TELEGRAM_ID in .env later.\n",
        );
        break;
      }
    }
  }

  console.log("");
  return { telegramBotToken, telegramUserId };
}

async function stepSupabaseCredentials(rl: Interface): Promise<{
  supabaseUrl: string;
  supabaseAnonKey: string;
}> {
  console.log("── Step 5: Supabase (Semantic Memory) ──\n");
  console.log(
    "  Supabase powers EDDIE's semantic memory — required for EDDIE to remember and learn.",
  );
  console.log("  Free tier available at supabase.com\n");

  const supabaseUrl = await ask(
    rl,
    "  Supabase project URL (https://xxx.supabase.co): ",
  );
  const supabaseAnonKey = await ask(rl, "  Supabase anon key: ");
  console.log("");
  return { supabaseUrl, supabaseAnonKey };
}

async function stepGoogleCredentials(rl: Interface): Promise<string> {
  console.log("── Step 6: Google API Key (Embeddings) ──\n");
  console.log(
    "  Google API key enables semantic search via gemini-embedding-001 (free tier).",
  );
  console.log(
    "  Get one at console.cloud.google.com — enable the Generative Language API.\n",
  );

  const googleApiKey = await ask(
    rl,
    "  Google API key (or press Enter to skip): ",
  );
  console.log("");
  return googleApiKey;
}

async function stepSlackCredentials(rl: Interface): Promise<{
  slackBotToken: string;
  slackChannelId: string;
}> {
  console.log("── Step 7: Slack (optional) ──\n");
  console.log(
    "  EDDIE can monitor Slack channels and notify you of important messages.",
  );

  const enableSlack = await confirm(rl, "  Enable Slack integration?");
  console.log("");

  if (!enableSlack) return { slackBotToken: "", slackChannelId: "" };

  const slackBotToken = await ask(rl, "  Slack bot token (xoxb-...): ");
  const slackChannelId = await ask(
    rl,
    "  Channel IDs to monitor (comma-separated): ",
  );
  console.log("");
  return { slackBotToken, slackChannelId };
}

async function stepOwnerInfo(rl: Interface): Promise<{
  ownerName: string;
  brainVaultPath: string;
}> {
  console.log("── Step 8: Owner Info ──\n");

  const ownerName = await ask(rl, "  Your name (for briefs and greetings): ");
  const defaultBV = resolve(homedir(), "brain-vault");
  const brainVaultPath = await askWithDefault(
    rl,
    "  Brain Vault path",
    defaultBV,
  );

  console.log("");
  return { ownerName, brainVaultPath };
}

async function stepBrainVaultInit(brainVaultPath: string): Promise<void> {
  console.log("── Step 9: Brain Vault Initialization ──\n");

  const dirs = [
    "00 - Inbox",
    "10 - Projects",
    "20 - Areas/EDDIE",
    "90 - Agent Memory/Decisions",
    "90 - Agent Memory/Learnings",
    "90 - Agent Memory/State",
  ];

  for (const dir of dirs) {
    const fullPath = resolve(brainVaultPath, dir);
    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would create: ${fullPath}`);
    } else {
      mkdirSync(fullPath, { recursive: true });
      console.log(`  Created: ${fullPath}`);
    }
  }

  const statePath = resolve(
    brainVaultPath,
    "90 - Agent Memory/State/eddie-current.md",
  );
  if (!existsSync(statePath) || DRY_RUN) {
    const template = `# EDDIE Current State

## Status
Initialized — first run pending.

## Last Updated
${new Date().toISOString().split("T")[0]}

## Active Modules
(will be populated after first successful run)
`;
    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would write: ${statePath}`);
    } else {
      await Bun.write(statePath, template);
      console.log(`  Written: ${statePath}`);
    }
  }

  console.log(`\n  Brain Vault initialized at ${brainVaultPath}\n`);
}

async function stepClaudeAuth(rl: Interface): Promise<void> {
  console.log("── Step 10: Claude CLI Authentication ──\n");
  console.log("  Run this command in a new terminal to authenticate Claude:\n");
  console.log("    claude auth\n");
  await ask(rl, "  Press Enter when done...");
  console.log("");
}

async function stepPersonalRepo(rl: Interface): Promise<string> {
  console.log("── Step 11: Personal Git Repo (optional) ──\n");
  console.log(
    "  A private GitHub repo stores your personal EDDIE config (recommended).",
  );
  const repo = await ask(rl, "  Repo URL (or press Enter to skip): ");
  console.log("");
  return repo;
}

async function stepGenerateEnv(config: CollectedConfig): Promise<void> {
  console.log("── Step 12: Generate .env ──\n");

  const envPath = resolve(import.meta.dir, "../../.env");
  const examplePath = resolve(import.meta.dir, "../../.env.example");

  let template = "";
  try {
    template = await Bun.file(examplePath).text();
  } catch {
    // If no .env.example, build from scratch
  }

  const envLines: string[] = [
    "# Generated by EDDIE Onboarding Wizard",
    `# ${new Date().toISOString()}`,
    "",
    "# Owner configuration",
    `EDDIE_OWNER_NAME=${config.ownerName}`,
    `BRAIN_VAULT_PATH=${config.brainVaultPath}`,
    `PERSONAL_GIT_REPO=${config.personalGitRepo}`,
    "",
    "# Telegram",
    `TELEGRAM_BOT_TOKEN=${config.telegramBotToken}`,
    `OWNER_TELEGRAM_ID=${config.telegramUserId}`,
    "",
    "# Job system",
    `MAX_CONCURRENT_JOBS=${config.maxConcurrentJobs}`,
    "",
    "# Dashboard",
    "DASHBOARD_ENABLED=true",
    "DASHBOARD_PORT=3000",
    "",
  ];

  // Supabase — always
  envLines.push("# Supabase (semantic memory)");
  if (config.supabaseUrl) envLines.push(`SUPABASE_URL=${config.supabaseUrl}`);
  if (config.supabaseAnonKey)
    envLines.push(`SUPABASE_ANON_KEY=${config.supabaseAnonKey}`);
  envLines.push("");

  // Google embeddings — always if provided
  if (config.googleApiKey) {
    envLines.push("# Google (embeddings)");
    envLines.push("EMBED_PROVIDER=google");
    envLines.push(`GOOGLE_API_KEY=${config.googleApiKey}`);
    envLines.push("");
  }

  // Slack — optional
  if (config.slackBotToken) {
    envLines.push("# Slack");
    envLines.push("COMMS_ENABLED=true");
    envLines.push(`COMMS_SLACK_BOT_TOKEN=${config.slackBotToken}`);
    if (config.slackChannelId)
      envLines.push(`COMMS_SLACK_WATCH_CHANNELS=${config.slackChannelId}`);
    envLines.push("");
  }

  // Feature flags — sensible defaults for new installs
  envLines.push("# Feature flags (defaults for new installs)");
  envLines.push("MEMORY_MONITOR_ENABLED=true");
  envLines.push("COST_TRACKING_ENABLED=true");
  envLines.push("INTENT_DETECTION_ENABLED=true");
  envLines.push("");

  const content = envLines.join("\n") + "\n";
  const valueCount = envLines.filter(
    (l) => l.includes("=") && !l.startsWith("#"),
  ).length;

  if (DRY_RUN) {
    console.log(
      `  [DRY RUN] Would write ${envPath} with ${valueCount} configuration values`,
    );
    console.log("\n  Preview:\n");
    for (const line of envLines) {
      if (
        line.includes("TOKEN=") ||
        line.includes("API_KEY=") ||
        line.includes("SECRET=")
      ) {
        const [key] = line.split("=");
        console.log(`  ${key}=****`);
      } else {
        console.log(`  ${line}`);
      }
    }
  } else {
    if (existsSync(envPath)) {
      const backupPath = `${envPath}.backup.${Date.now()}`;
      const existing = await Bun.file(envPath).text();
      await Bun.write(backupPath, existing);
      console.log(`  Backed up existing .env to ${backupPath}`);
    }
    await Bun.write(envPath, content);
    console.log(`  .env written with ${valueCount} configuration values`);
  }

  console.log("");
}

async function stepSmokeTest(): Promise<void> {
  console.log("── Step 13: Smoke Test ──\n");

  if (DRY_RUN) {
    console.log("  [DRY RUN] Would start EDDIE service and verify status\n");
    return;
  }

  try {
    console.log("  Starting EDDIE...");
    const start = Bun.spawn(["systemctl", "--user", "start", "eddie"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await start.exited;

    // Wait for service to initialize
    await new Promise((r) => setTimeout(r, 3000));

    const check = Bun.spawn(["systemctl", "--user", "is-active", "eddie"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const status = (await new Response(check.stdout).text()).trim();

    if (status === "active") {
      console.log("  EDDIE is running\n");
    } else {
      console.log(`  Warning: Service status is "${status}"`);
      console.log("  Check logs: journalctl --user -u eddie -f\n");
    }
  } catch (err) {
    console.log(
      "  Could not start systemd service (may not be configured yet)",
    );
    console.log("  To start manually: bun run ~/eddie/src/index.ts");
    console.log("  To set up systemd: see docs/systemd-setup.md\n");
  }
}

function stepDone(config: CollectedConfig): void {
  console.log("── Setup Complete ──\n");
  console.log("  Configuration Summary:");
  console.log(`    Owner: ${config.ownerName}`);
  console.log(`    Brain Vault: ${config.brainVaultPath}`);
  console.log(`    Max concurrent jobs: ${config.maxConcurrentJobs}`);
  console.log(
    `    Telegram: ${config.telegramBotToken ? "configured" : "skipped"}`,
  );
  console.log(`    Supabase: ${config.supabaseUrl ? "configured" : "skipped"}`);
  console.log(
    `    Google API: ${config.googleApiKey ? "configured" : "skipped"}`,
  );
  console.log(`    Slack: ${config.slackBotToken ? "configured" : "skipped"}`);
  if (config.modules.heimdallSync) console.log("    Heimdall: enabled");
  if (config.personalGitRepo) {
    console.log(`    Personal repo: ${config.personalGitRepo}`);
  }

  console.log("\n  EDDIE is ready. Send it a message on Telegram.");
  console.log("  Join the community: https://skool.com/eddie\n");
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(USAGE);
    process.exit(0);
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Handle Ctrl+C
  rl.on("close", () => {
    console.log("\n\n  Setup cancelled.\n");
    process.exit(0);
  });

  try {
    await stepBanner();
    await stepTosAcknowledgment(rl);
    await stepDetectEnvironment();

    const maxConcurrentJobs = await stepSubscriptionTier(rl);
    const modules = await stepModuleSelection(rl);

    const { telegramBotToken, telegramUserId } =
      await stepRequiredCredentials(rl);
    const { supabaseUrl, supabaseAnonKey } = await stepSupabaseCredentials(rl);
    const googleApiKey = await stepGoogleCredentials(rl);
    const { slackBotToken, slackChannelId } = await stepSlackCredentials(rl);

    const { ownerName, brainVaultPath } = await stepOwnerInfo(rl);

    await stepBrainVaultInit(brainVaultPath);
    await stepClaudeAuth(rl);

    const personalGitRepo = await stepPersonalRepo(rl);

    const config: CollectedConfig = {
      ownerName,
      brainVaultPath,
      personalGitRepo,
      telegramBotToken,
      telegramUserId,
      maxConcurrentJobs,
      modules,
      supabaseUrl,
      supabaseAnonKey,
      googleApiKey,
      slackBotToken,
      slackChannelId,
    };

    await stepGenerateEnv(config);
    await stepSmokeTest();
    stepDone(config);
  } finally {
    rl.close();
  }
}

main();
