import { resolve } from "node:path";
import { homedir } from "node:os";
import { readdir } from "node:fs/promises";
import type { Bot } from "gramio";
import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { checkEmbeddingHealth } from "../memory/client.ts";
import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";
import { emitEvent } from "../dashboard/server.ts";
import { CAPABILITIES } from "../routing/capabilities.ts";
import { STATE_DIR, LEARNINGS_DIR, EDDIE_STATE_FILE } from "../memory/brain-vault-paths.ts";

type ProjectSnapshot = {
  slug: string;
  status: string;
  lastUpdated: string;
  staleDays: number;
  hasBlocker: boolean;
  blockerText?: string;
  healthSignal: "healthy" | "stale" | "blocked" | "unknown";
};

type ServiceHealth = {
  name: string;
  healthy: boolean;
  detail?: string;
};

type Blocker = {
  project: string;
  description: string;
  requiresHuman: boolean;
  detectedAt: string;
};

type ProactiveAction = {
  type: "task" | "message" | "maintenance";
  priority: "high" | "medium" | "low";
  description: string;
  suggestedAgent?: string;
  targetProject?: string;
};

type DailyWork = {
  built: string[];
  decided: string[];
  changed: string[];
  newBlockers: string[];
  consolidationSources: string[];
};

type WorldModel = {
  version: 1;
  generatedAt: string;
  generatedAtLocal: string;
  activeShelf: unknown[];
  drawer: unknown[];
  services: Record<string, boolean>;
  blockers: Blocker[];
  staleProjects: string[];
  proactiveActions: ProactiveAction[];
  deltas: {
    newBlockers: Blocker[];
    resolvedBlockers: string[];
    statusChanges: Array<{ project: string; from: string; to: string }>;
    newStaleProjects: string[];
  };
  summary: string;
  dailyWork?: DailyWork;
  modelPerformance?: Partial<Record<string, number>>;
};

const WORLD_MODEL_PATH = resolve(STATE_DIR, "world-model.json");
const WORLD_INDEX_PATH = resolve(STATE_DIR, "world-index.yaml");
const STALE_THRESHOLD_DAYS = 7;

const SKIP_FILES = new Set([
  "system-overview",
  "eddie-current",
  "claude-code-component-catalog",
  "eddie-tools-reference",
  "EDDIE-upgrades",
  "world-model",
  "agent-forge",
  "claude-mastery",
  "treasure-map",
]);

function parseTime(timeStr: string): { hour: number; minute: number } {
  const [h, m] = timeStr.split(":").map(Number);
  return { hour: h ?? 2, minute: m ?? 30 };
}

function msUntilTime(hour: number, minute: number, timezone: string): number {
  const now = new Date();
  const nowLocal = new Date(
    now.toLocaleString("en-US", { timeZone: timezone }),
  );
  const target = new Date(nowLocal);
  target.setHours(hour, minute, 0, 0);
  if (target <= nowLocal) target.setDate(target.getDate() + 1);
  return target.getTime() - nowLocal.getTime();
}

async function readDailyConsolidations(): Promise<string> {
  const tz = "America/Chicago";
  const localNow = new Date(
    new Date().toLocaleString("en-US", { timeZone: tz }),
  );
  const today = localNow.toISOString().slice(0, 10);
  const activityPath = resolve(
    LEARNINGS_DIR,
    `${today}-eddie-activity.md`,
  );
  try {
    return await Bun.file(activityPath).text();
  } catch {
    return "";
  }
}

async function parseTodayActivityLog(): Promise<string> {
  const tz = "America/Chicago";
  const localNow = new Date(
    new Date().toLocaleString("en-US", { timeZone: tz }),
  );
  const today = localNow.toISOString().slice(0, 10);
  try {
    const statePath = EDDIE_STATE_FILE;
    const content = await Bun.file(statePath).text();
    const lines = content.split("\n");
    const todayLines = lines.filter((l) => l.includes(today));
    return todayLines.join("\n");
  } catch {
    return "";
  }
}

async function extractDailyDeltas(text: string): Promise<DailyWork> {
  const empty: DailyWork = {
    built: [],
    decided: [],
    changed: [],
    newBlockers: [],
    consolidationSources: [],
  };
  if (!text.trim()) return empty;

  const built: string[] = [];
  const decided: string[] = [];
  const changed: string[] = [];
  const newBlockers: string[] = [];
  const consolidationSources: string[] = [];

  const lines = text.split("\n");
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (
      lower.includes("built") ||
      lower.includes("created") ||
      lower.includes("added")
    ) {
      const match = line.match(/[-*]\s*(.+)/);
      if (match?.[1]) built.push(match[1].slice(0, 100));
    } else if (lower.includes("decided") || lower.includes("decision")) {
      const match = line.match(/[-*]\s*(.+)/);
      if (match?.[1]) decided.push(match[1].slice(0, 100));
    } else if (lower.includes("blocked") || lower.includes("waiting on")) {
      const match = line.match(/[-*]\s*(.+)/);
      if (match?.[1]) newBlockers.push(match[1].slice(0, 100));
    } else if (lower.includes("session") || lower.includes("agentic")) {
      const match = line.match(/[-*|]\s*(.+)/);
      if (match?.[1]) consolidationSources.push(match[1].slice(0, 80));
    }
  }

  return {
    built: built.slice(0, 10),
    decided: decided.slice(0, 5),
    changed,
    newBlockers: newBlockers.slice(0, 5),
    consolidationSources: consolidationSources.slice(0, 5),
  };
}

export function generateWorldIndex(model: WorldModel): string {
  const services = Object.entries(model.services)
    .map(([k, v]) => `${k}=${v ? "up" : "DOWN"}`)
    .join(" ");

  const shelfLines = (model.activeShelf as any[])
    .map((p: any) => {
      const blocked = p.blockers?.length > 0 ? " ⚠ BLOCKED" : "";
      return `  ${p.slug}: "${p.oneLiner}"${blocked}`;
    })
    .join("\n");

  const drawerSlugs = (model.drawer as any[])
    .map((p: any) => p.slug)
    .join(", ");

  const lines = [
    `# EDDIE World Index — auto-generated, do not edit`,
    `# Updated: ${model.generatedAtLocal}`,
    ``,
    `health:`,
    `  services: ${services}`,
    `  blockers: ${model.blockers.length}`,
    `  stale_projects: ${(model.staleProjects ?? []).length}`,
    ``,
    `shelf:`,
    shelfLines,
    ``,
    `drawer: [${drawerSlugs}]`,
    `# To load drawer project details, read world-model.json for retrievalTags`,
    ``,
    `summary: "${model.summary.replace(/"/g, "'")}"`,
  ];

  if (
    model.modelPerformance &&
    Object.keys(model.modelPerformance).length > 0
  ) {
    const topModel = Object.entries(model.modelPerformance).sort(
      ([, a], [, b]) => (b ?? 0) - (a ?? 0),
    )[0];
    if (topModel) {
      lines.push(``, `model_performance:`);
      lines.push(`  top: ${topModel[0]} (${topModel[1]}%)`);
    }
  }

  if (model.dailyWork && model.dailyWork.built.length > 0) {
    lines.push(``, `today:`);
    if (model.dailyWork.built.length > 0)
      lines.push(`  built: [${model.dailyWork.built.slice(0, 3).join(", ")}]`);
    if (model.dailyWork.newBlockers.length > 0)
      lines.push(`  new_blockers: [${model.dailyWork.newBlockers.join(", ")}]`);
  }

  return lines.join("\n");
}

async function writeWorldIndex(model: WorldModel): Promise<void> {
  await Bun.write(WORLD_INDEX_PATH, generateWorldIndex(model));
}

async function loadWorldModel(): Promise<WorldModel | null> {
  try {
    const raw = await Bun.file(WORLD_MODEL_PATH).text();
    return JSON.parse(raw) as WorldModel;
  } catch {
    return null;
  }
}

async function scanStateFiles(): Promise<ProjectSnapshot[]> {
  const snapshots: ProjectSnapshot[] = [];
  try {
    const files = await readdir(STATE_DIR);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const slug = file.replace(".md", "");
      if (SKIP_FILES.has(slug)) continue;
      if (slug.startsWith("daily-brief-")) continue;

      try {
        const content = await Bun.file(resolve(STATE_DIR, file)).text();
        const lines = content.split("\n").slice(0, 30).join("\n");

        const statusMatch = lines.match(/\*\*Status:\*\*\s*(.+)/i);
        const updatedMatch = lines.match(/\*\*Last [Uu]pdated?:\*\*\s*(.+)/i);
        const status = statusMatch?.[1]?.trim() ?? "unknown";
        const lastUpdatedStr = updatedMatch?.[1]?.trim() ?? "";

        let staleDays = 0;
        if (lastUpdatedStr) {
          const parsed = new Date(lastUpdatedStr);
          if (!isNaN(parsed.getTime())) {
            staleDays = Math.floor(
              (Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24),
            );
          }
        }

        const lowerContent = content.toLowerCase();
        const blockerKeywords = [
          "blocked",
          "waiting on",
          "needs ",
          "401",
          "expired",
          "broken",
          "stalled",
        ];
        const hasBlocker = blockerKeywords.some((kw) =>
          lowerContent.includes(kw),
        );
        const blockerMatch = content.match(/\*\*[Bb]lock[^:]*:\*\*\s*(.+)/);
        const blockerText = blockerMatch?.[1]?.trim();

        let healthSignal: ProjectSnapshot["healthSignal"] = "healthy";
        if (hasBlocker) healthSignal = "blocked";
        else if (
          staleDays > STALE_THRESHOLD_DAYS &&
          !status.toLowerCase().includes("complete")
        ) {
          healthSignal = "stale";
        }

        snapshots.push({
          slug,
          status,
          lastUpdated: lastUpdatedStr || "unknown",
          staleDays,
          hasBlocker,
          blockerText,
          healthSignal,
        });
      } catch {
        snapshots.push({
          slug,
          status: "unknown",
          lastUpdated: "unknown",
          staleDays: 0,
          hasBlocker: false,
          healthSignal: "unknown",
        });
      }
    }
  } catch (err) {
    logger.error("nightly-orchestrate:scan-state-files", {
      error: String(err),
    });
  }
  return snapshots;
}

async function getUnroutedAgents(): Promise<string[]> {
  const agentsDir = resolve(homedir(), ".claude/agents");
  try {
    const files = await readdir(agentsDir);
    const routedIds = new Set(
      CAPABILITIES.filter((c) => c.type === "agent").map((c) =>
        c.id.replace("agent:", ""),
      ),
    );
    const unrouted: string[] = [];
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const slug = file.replace(".md", "");
      if (slug.startsWith("_") || slug === "CLAUDE" || slug === "README")
        continue;
      if (!routedIds.has(slug)) unrouted.push(slug);
    }
    return unrouted;
  } catch {
    return [];
  }
}

async function checkServiceHealth(): Promise<ServiceHealth[]> {
  const services: ServiceHealth[] = [{ name: "eddie", healthy: true }];

  try {
    await getSupabase().from("goals").select("id").limit(1);
    services.push({ name: "supabase", healthy: true });
  } catch (err) {
    services.push({ name: "supabase", healthy: false, detail: String(err) });
  }

  try {
    const healthy = await checkEmbeddingHealth();
    services.push({ name: "ollama", healthy });
  } catch {
    services.push({ name: "ollama", healthy: false });
  }

  try {
    const tokensPath = resolve(homedir(), ".claude/google-hub/tokens.json");
    const raw = await Bun.file(tokensPath).text();
    const tokens = JSON.parse(raw);
    const expiry = tokens.expiry_date ?? tokens.tokens?.expiry_date;
    const expired = expiry ? expiry < Date.now() : true;
    services.push({
      name: "googleOAuth",
      healthy: !expired,
      detail: expired ? "Token expired — re-auth needed" : undefined,
    });
  } catch {
    services.push({
      name: "googleOAuth",
      healthy: false,
      detail: "Token file not found",
    });
  }

  return services;
}

function identifyProactiveActions(
  snapshots: ProjectSnapshot[],
  services: ServiceHealth[],
  _previousModel: WorldModel | null,
): ProactiveAction[] {
  const actions: ProactiveAction[] = [];

  for (const snap of snapshots) {
    if (
      snap.staleDays > STALE_THRESHOLD_DAYS &&
      snap.healthSignal === "stale"
    ) {
      actions.push({
        type: "maintenance",
        priority: "low",
        description: `Update state file for ${snap.slug} (${snap.staleDays} days since last update)`,
        suggestedAgent: "project-orchestrator",
        targetProject: snap.slug,
      });
    }
  }

  const oauthDown = services.find(
    (s) => s.name === "googleOAuth" && !s.healthy,
  );
  if (oauthDown) {
    actions.push({
      type: "message",
      priority: "medium",
      description:
        "Google OAuth expired — Gmail/Calendar 401. Re-auth via SSH tunnel: ssh -L 3000:localhost:3000 na@100.73.11.127 then http://localhost:3000/oauth/google/start",
    });
  }

  const supabaseDown = services.find(
    (s) => s.name === "supabase" && !s.healthy,
  );
  if (supabaseDown) {
    actions.push({
      type: "maintenance",
      priority: "high",
      description: "Supabase connection failed — check service status",
      suggestedAgent: "self-healer",
    });
  }

  return actions;
}

function computeDeltas(
  snapshots: ProjectSnapshot[],
  previous: WorldModel | null,
): WorldModel["deltas"] {
  if (!previous) {
    return {
      newBlockers: [],
      resolvedBlockers: [],
      statusChanges: [],
      newStaleProjects: [],
    };
  }

  const prevSlugs = new Map(
    previous.blockers?.map((b) => [b.project, b]) ?? [],
  );
  const newBlockers: Blocker[] = [];
  const resolvedBlockers: string[] = [];
  const statusChanges: Array<{ project: string; from: string; to: string }> =
    [];
  const newStaleProjects: string[] = [];

  for (const snap of snapshots) {
    if (snap.hasBlocker && !prevSlugs.has(snap.slug)) {
      newBlockers.push({
        project: snap.slug,
        description: snap.blockerText ?? "Blocker detected",
        requiresHuman: true,
        detectedAt: new Date().toISOString(),
      });
    }
  }

  for (const prevBlocker of previous.blockers ?? []) {
    const current = snapshots.find((s) => s.slug === prevBlocker.project);
    if (!current?.hasBlocker) {
      resolvedBlockers.push(prevBlocker.description);
    }
  }

  return { newBlockers, resolvedBlockers, statusChanges, newStaleProjects };
}

function generateSummary(
  deltas: WorldModel["deltas"],
  services: ServiceHealth[],
  proactiveActions: ProactiveAction[],
  dailyWork?: DailyWork,
): string {
  const unhealthy = services.filter((s) => !s.healthy);

  if (
    deltas.newBlockers.length === 0 &&
    deltas.resolvedBlockers.length === 0 &&
    deltas.statusChanges.length === 0 &&
    proactiveActions.length === 0 &&
    unhealthy.length === 0
  ) {
    const base = "No changes detected overnight. All active projects stable.";
    if (dailyWork?.built.length) return `${base} Today: ${dailyWork.built[0]}`;
    return base;
  }

  const parts: string[] = [];
  if (deltas.newBlockers.length > 0) {
    parts.push(
      `${deltas.newBlockers.length} new blocker(s): ${deltas.newBlockers.map((b) => b.project).join(", ")}`,
    );
  }
  if (deltas.resolvedBlockers.length > 0) {
    parts.push(`${deltas.resolvedBlockers.length} blocker(s) resolved`);
  }
  if (unhealthy.length > 0) {
    parts.push(`Services down: ${unhealthy.map((s) => s.name).join(", ")}`);
  }
  if (proactiveActions.length > 0) {
    parts.push(`${proactiveActions.length} proactive action(s) identified`);
  }
  if (dailyWork?.built.length) {
    parts.push(`Today: ${dailyWork.built[0]}`);
  }

  return parts.join(". ") + ".";
}

export async function runNightlyOrchestrate(): Promise<void> {
  const start = Date.now();
  logger.info("nightly-orchestrate:start");

  const [
    previousModel,
    snapshots,
    services,
    unroutedAgents,
    activityFile,
    todayLog,
  ] = await Promise.all([
    loadWorldModel(),
    scanStateFiles(),
    checkServiceHealth(),
    getUnroutedAgents(),
    readDailyConsolidations(),
    parseTodayActivityLog(),
  ]);

  const combinedText = [activityFile, todayLog].filter(Boolean).join("\n\n");
  const dailyWork = await extractDailyDeltas(combinedText);

  const blockers: Blocker[] = snapshots
    .filter((s) => s.hasBlocker)
    .map((s) => ({
      project: s.slug,
      description: s.blockerText ?? "Blocker detected",
      requiresHuman: true,
      detectedAt: new Date().toISOString(),
    }));

  const staleProjects = snapshots
    .filter(
      (s) => s.staleDays > STALE_THRESHOLD_DAYS && s.healthSignal === "stale",
    )
    .map((s) => s.slug);

  const proactiveActions = identifyProactiveActions(
    snapshots,
    services,
    previousModel,
  );

  if (unroutedAgents.length > 0) {
    proactiveActions.push({
      type: "maintenance",
      priority: "low",
      description: `${unroutedAgents.length} agent(s) missing routing entries in capabilities.ts: ${unroutedAgents.join(", ")}`,
      suggestedAgent: "agent-forge",
    });
  }

  const deltas = computeDeltas(snapshots, previousModel);
  const summary = generateSummary(
    deltas,
    services,
    proactiveActions,
    dailyWork,
  );

  const activeShelf = previousModel?.activeShelf ?? [];
  const drawer = previousModel?.drawer ?? [];

  const serviceMap: Record<string, boolean> = {};
  for (const svc of services) serviceMap[svc.name] = svc.healthy;

  const worldModel: WorldModel = {
    version: 1,
    generatedAt: new Date().toISOString(),
    generatedAtLocal: new Date().toLocaleString("en-US", {
      timeZone: config.TIMEZONE,
    }),
    activeShelf,
    drawer,
    services: serviceMap,
    blockers,
    staleProjects,
    proactiveActions,
    deltas,
    summary,
    dailyWork,
  };

  await Bun.write(WORLD_MODEL_PATH, JSON.stringify(worldModel, null, 2));
  await writeWorldIndex(worldModel);

  // Phase 3 stitch: feed daily signals → vision preference updates
  if (config.VISION_ENABLED) {
    const today = new Date().toISOString().slice(0, 10);
    const signals: { date: string; signal: string; context: string }[] = [];

    if (dailyWork) {
      for (const item of dailyWork.built.slice(0, 3)) {
        signals.push({
          date: today,
          signal: `built: ${item}`,
          context: "daily-work",
        });
      }
      for (const blocker of dailyWork.newBlockers.slice(0, 2)) {
        signals.push({
          date: today,
          signal: `blocker: ${blocker}`,
          context: "daily-work",
        });
      }
    }

    if (config.PROVENANCE_ENABLED) {
      const { getProvenanceSummary } = await import("../memory/provenance.ts");
      const prov = await getProvenanceSummary(1);
      for (const r of prov.recent.slice(0, 2)) {
        signals.push({
          date: today,
          signal: `shipped: ${r.feature_name}`,
          context: `from ${r.source_type}`,
        });
      }
    }

    if (config.TOOL_TICKER_ENABLED) {
      const { getToolUsageSummary } = await import("../memory/tool-ticker.ts");
      const { topTools } = await getToolUsageSummary(1);
      if (topTools[0]) {
        signals.push({
          date: today,
          signal: `top-tool: ${topTools[0].tool_name}`,
          context: `${topTools[0].count}x today`,
        });
      }
    }

    if (signals.length > 0) {
      const { updateVisionPreferences } = await import("./vision.ts");
      await updateVisionPreferences(signals).catch(() => {});
    }
  }

  if (config.SELF_IMPROVE_ENABLED) {
    const { getWinRates } = await import("../routing/comparisons.ts");
    const winRates = await getWinRates(30).catch(() => ({}));
    worldModel.modelPerformance = winRates;
    await Bun.write(WORLD_MODEL_PATH, JSON.stringify(worldModel, null, 2));
  }

  if (config.KANBAN_ENABLED && proactiveActions.length > 0) {
    const { addTask, getQueuedTasks } = await import("./task-queue.ts");
    const existing = await getQueuedTasks({ state: "planned" });
    const existingTitles = new Set(existing.map((t) => t.title));

    for (const action of proactiveActions) {
      if (existingTitles.has(action.description)) continue;
      const priority =
        action.priority === "high" ? 2 : action.priority === "medium" ? 5 : 8;
      let visionScore: number | undefined;
      if (config.VISION_ENABLED) {
        const { evaluateTaskAlignment } = await import("./vision.ts");
        const alignment = await evaluateTaskAlignment(action.description).catch(
          () => ({ aligned: true, score: 5, reason: "" }),
        );
        visionScore = alignment.score;
      }
      const task = await addTask(action.description, action.suggestedAgent, {
        priority,
        source: "nightly-orchestrate",
        projectSlug: action.targetProject,
        visionScore,
      });
      if (task && visionScore !== undefined && visionScore >= 5) {
        const { updateTaskState } = await import("./task-queue.ts");
        await updateTaskState(task.id, "ready");
      }
    }
  }

  emitEvent("nightly-orchestrate", {
    projectCount: snapshots.length,
    blockerCount: blockers.length,
    staleCount: staleProjects.length,
    actionCount: proactiveActions.length,
    durationMs: Date.now() - start,
  });

  logger.info("nightly-orchestrate:done", {
    projects: snapshots.length,
    blockers: blockers.length,
    staleProjects: staleProjects.length,
    proactiveActions: proactiveActions.length,
    durationMs: Date.now() - start,
  });
}

export function startNightlyOrchestrate(
  bot: import("gramio").Bot,
  time = config.NIGHTLY_ORCHESTRATE_TIME,
): void {
  if (!config.NIGHTLY_ORCHESTRATE_ENABLED) return;

  const { hour, minute } = parseTime(time);
  const delay = msUntilTime(hour, minute, config.TIMEZONE);

  const handleOrchestrateError = (err: unknown): void => {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("nightly-orchestrate:error", { error: errorMsg });
    import("../jobs/self-heal.ts")
      .then(({ triggerSelfHeal }) =>
        triggerSelfHeal(
          {
            source: "nightly-orchestrate" as const,
            name: "run",
            error: errorMsg,
            timestamp: Date.now(),
          },
          bot,
        ),
      )
      .catch(() => {});
  };

  setTimeout(() => {
    runNightlyOrchestrate().catch(handleOrchestrateError);
    setInterval(
      () => {
        runNightlyOrchestrate().catch(handleOrchestrateError);
      },
      24 * 60 * 60 * 1000,
    );
  }, delay);

  logger.info("nightly-orchestrate:scheduled", {
    time: `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")} ${config.TIMEZONE}`,
    delayMs: delay,
  });
}
