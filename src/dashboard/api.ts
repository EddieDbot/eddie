import { memoryEnabled, getSupabase } from "../memory/client.ts";
import { getAgentSessions } from "./agent-watcher.ts";
import { getRecentJobs, getJob } from "../jobs/manager.ts";
import { readOutput, isSessionAlive } from "../jobs/tmux.ts";
import { listReportsMeta, getReportContent } from "../proactive/playlist.ts";
import { parseRoadmapItems } from "../proactive/report-synthesis.ts";
import { getChannelStats, getRecentVideos } from "../comms/youtube.ts";
import { listGoals } from "../proactive/goals.ts";
import { getRevenueSummary } from "../proactive/revenue.ts";
import { config } from "../config.ts";

const startTime = Date.now();

export function handleApi(path: string): Response {
  switch (path) {
    case "/api/health":
      return json({
        status: "ok",
        uptime: Date.now() - startTime,
        memoryEnabled,
        timestamp: new Date().toISOString(),
      });
    case "/api/conversations":
      return handleAsync(getConversations);
    case "/api/facts":
      return handleAsync(getFacts);
    case "/api/stats":
      return handleAsync(getStats);
    case "/api/communication-log":
      return handleAsync(getCommunicationLog);
    case "/api/heartbeat-log":
      return handleAsync(getHeartbeatLog);
    case "/api/cron-jobs":
      return handleAsync(getCronJobs);
    case "/api/jobs":
      return handleAsync(getJobs);
    case "/api/usage":
      return handleAsync(getUsageSummary7d);
    case "/api/system-metrics":
      return handleAsync(getSystemMetrics);
    case "/api/inbox":
      return handleAsync(getInbox);
    case "/api/inbox/summary":
      return handleAsync(getInboxSummary);
    case "/api/channels":
      return handleAsync(getChannels);
    case "/api/needs-attention":
      return handleAsync(getNeedsAttention);
    case "/api/health-indicators":
      return handleAsync(getHealthIndicators);
    case "/api/roadmap":
      return handleAsync(getRoadmap);
    case "/api/youtube":
      return handleAsync(getYoutubeStats);
    case "/api/goals":
      return handleAsync(getGoals);
    case "/api/revenue":
      return handleAsync(getRevenueSummary);
    case "/api/books":
      return handleAsync(getBooks);
    case "/api/job-performance":
      return handleAsync(getJobPerformance);
    case "/api/context-budget":
      return handleAsync(getContextBudget);
    case "/api/agents":
      return handleAsync(async () => getAgentSessions());
    default: {
      if (path === "/api/reports") {
        return handleAsync(listReportsMeta);
      }
      const reportPrefix = "/api/report/";
      if (path.startsWith(reportPrefix)) {
        const filename = decodeURIComponent(path.slice(reportPrefix.length));
        return handleAsync(async () => {
          const content = await getReportContent(filename);
          if (content === null) return { error: "not found" };
          return { filename, content };
        });
      }
      // Agent session detail: GET /api/agents/:uuid
      const agentMatch = path.match(/^\/api\/agents\/([^/]+)$/);
      if (agentMatch) {
        const uuid = agentMatch[1]!;
        return handleAsync(async () => {
          const all = getAgentSessions();
          const session = all.find((s) => s.uuid === uuid);
          if (!session) return { error: "not found" };
          return session;
        });
      }
      // Job output endpoint: GET /api/jobs/:id/output
      const jobOutputMatch = path.match(/^\/api\/jobs\/([^/]+)\/output$/);
      if (jobOutputMatch) {
        const jobId = jobOutputMatch[1]!;
        return handleAsync(async () => {
          const job = await getJob(jobId);
          if (!job) return { error: "job not found" };
          const output = await readOutput(jobId);
          const alive = await isSessionAlive(job.tmuxSession);
          return {
            output,
            status: alive ? "running" : job.status,
          };
        });
      }
      return json({ error: "not found" }, 404);
    }
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function handleAsync(fn: () => Promise<unknown>): Response {
  return new Response(
    new ReadableStream({
      async start(controller) {
        try {
          const data = await fn();
          controller.enqueue(new TextEncoder().encode(JSON.stringify(data)));
        } catch (e) {
          controller.enqueue(
            new TextEncoder().encode(JSON.stringify({ error: String(e) })),
          );
        }
        controller.close();
      },
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}

async function getConversations() {
  if (!memoryEnabled) return [];
  const { data } = await getSupabase()
    .from("conversations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  return data ?? [];
}

async function getFacts() {
  if (!memoryEnabled) return [];
  const { data } = await getSupabase()
    .from("facts")
    .select("*")
    .eq("active", true)
    .order("created_at", { ascending: false });
  return data ?? [];
}

async function getStats() {
  if (!memoryEnabled)
    return { totalConversations: 0, totalFacts: 0, totalCommunications: 0 };
  const [convos, facts, comms] = await Promise.all([
    getSupabase()
      .from("conversations")
      .select("*", { count: "exact", head: true }),
    getSupabase().from("facts").select("*", { count: "exact", head: true }),
    getSupabase()
      .from("communication_log")
      .select("*", { count: "exact", head: true }),
  ]);
  return {
    totalConversations: convos.count ?? 0,
    totalFacts: facts.count ?? 0,
    totalCommunications: comms.count ?? 0,
  };
}

async function getCommunicationLog() {
  if (!memoryEnabled) return [];
  const { data } = await getSupabase()
    .from("communication_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  return data ?? [];
}

async function getHeartbeatLog() {
  if (!memoryEnabled) return [];
  try {
    const { data } = await getSupabase()
      .from("heartbeat_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    return data ?? [];
  } catch {
    return [];
  }
}

async function getCronJobs() {
  if (!memoryEnabled) return [];
  try {
    const { data } = await getSupabase()
      .from("cron_jobs")
      .select("*")
      .order("created_at", { ascending: true });
    return data ?? [];
  } catch {
    return [];
  }
}

async function getJobs() {
  return getRecentJobs(50);
}

async function getUsageSummary7d() {
  try {
    const { getUsageSummary } = await import("../memory/usage.ts");
    return getUsageSummary(7);
  } catch {
    return {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      bySource: {},
    };
  }
}

async function getInbox() {
  try {
    const { getItems } = await import("../comms/inbox.ts");
    return getItems({ status: "unread", limit: 50 });
  } catch {
    return [];
  }
}

async function getInboxSummary() {
  try {
    const { getUnreadCount } = await import("../comms/inbox.ts");
    return getUnreadCount();
  } catch {
    return {};
  }
}

async function getChannels() {
  try {
    const { getPollerStatus } = await import("../comms/index.ts");
    const { getUnreadCount } = await import("../comms/inbox.ts");
    const [pollers, counts] = await Promise.all([
      Promise.resolve(getPollerStatus()),
      getUnreadCount(),
    ]);
    return pollers.map((p) => ({
      ...p,
      unread: counts[p.channel as import("../comms/types.ts").ChannelId] ?? 0,
    }));
  } catch {
    return [];
  }
}

async function getSystemMetrics() {
  try {
    const [memFile, loadFile] = await Promise.all([
      Bun.file("/proc/meminfo")
        .text()
        .catch(() => ""),
      Bun.file("/proc/loadavg")
        .text()
        .catch(() => ""),
    ]);

    const memTotal =
      parseInt(memFile.match(/MemTotal:\s+(\d+)/)?.[1] ?? "0") * 1024;
    const memAvail =
      parseInt(memFile.match(/MemAvailable:\s+(\d+)/)?.[1] ?? "0") * 1024;
    const memUsed = memTotal - memAvail;

    const loadAvg = parseFloat(loadFile.split(" ")[0] ?? "0");

    const dfProc = Bun.spawnSync(["df", "-k", "/"]);
    const dfOut = new TextDecoder().decode(dfProc.stdout);
    const dfLine = dfOut.split("\n")[1] ?? "";
    const dfParts = dfLine.trim().split(/\s+/);
    const diskUsePct = dfParts[4] ? parseInt(dfParts[4]) : 0;

    return {
      memory: {
        totalGb: parseFloat((memTotal / 1e9).toFixed(2)),
        usedGb: parseFloat((memUsed / 1e9).toFixed(2)),
        availGb: parseFloat((memAvail / 1e9).toFixed(2)),
        usePct: memTotal > 0 ? Math.round((memUsed / memTotal) * 100) : 0,
      },
      cpu: { loadAvg1m: loadAvg },
      disk: { usePct: diskUsePct },
    };
  } catch (err) {
    return { error: String(err) };
  }
}

async function getNeedsAttention() {
  if (!memoryEnabled)
    return { failedJobs: [], pendingJudgments: [], staleItems: 0, total: 0 };
  try {
    const sb = getSupabase();
    const since48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const staleThreshold = new Date(
      Date.now() - 2 * 60 * 60 * 1000,
    ).toISOString();

    const [failedRes, judgmentRes, staleRes] = await Promise.all([
      sb
        .from("jobs")
        .select("id, prompt, error, started_at")
        .eq("status", "failed")
        .gte("started_at", since48h)
        .order("started_at", { ascending: false })
        .limit(10),
      sb
        .from("human_judgment")
        .select("id, source, confidence, decision")
        .eq("status", "pending")
        .limit(10),
      sb
        .from("cron_jobs")
        .select("id", { count: "exact", head: true })
        .or(`last_run_at.is.null,next_run_at.lt.${staleThreshold}`),
    ]);

    const failedJobs = (failedRes.data ?? []).map((j) => ({
      id: j.id,
      prompt: j.prompt,
      error: j.error,
      startedAt: j.started_at,
    }));
    const pendingJudgments = judgmentRes.data ?? [];
    const staleItems = staleRes.count ?? 0;

    return {
      failedJobs,
      pendingJudgments,
      staleItems,
      total: failedJobs.length + pendingJudgments.length + staleItems,
    };
  } catch {
    return { failedJobs: [], pendingJudgments: [], staleItems: 0, total: 0 };
  }
}

async function getHealthIndicators() {
  if (!memoryEnabled)
    return {
      jobSuccessRate: 0,
      totalJobs7d: 0,
      selfHealRate: 0,
      selfHealSuccessRate: 0,
      avgJobDurationMs: 0,
      escalationCount7d: 0,
    };
  try {
    const sb = getSupabase();
    const since7d = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const [
      allJobsRes,
      completedJobsRes,
      healTriggeredRes,
      healResolvedRes,
      heartbeatRes,
    ] = await Promise.all([
      sb
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .gte("completed_at", since7d),
      sb
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .gte("completed_at", since7d)
        .eq("status", "completed"),
      sb
        .from("self_heal_log")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since7d),
      sb
        .from("self_heal_log")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since7d)
        .eq("outcome", "resolved"),
      sb
        .from("heartbeat_log")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since7d)
        .in("decision", ["message", "call"]),
    ]);

    const totalJobs = allJobsRes.count ?? 0;
    const completedJobs = completedJobsRes.count ?? 0;
    const healTriggered = healTriggeredRes.count ?? 0;
    const healResolved = healResolvedRes.count ?? 0;
    const escalations = heartbeatRes.count ?? 0;

    const jobSuccessRate =
      totalJobs > 0 ? Math.round((completedJobs / totalJobs) * 100) : 0;
    const selfHealRate =
      totalJobs > 0 ? Math.round((healTriggered / totalJobs) * 100) : 0;
    const selfHealSuccessRate =
      healTriggered > 0 ? Math.round((healResolved / healTriggered) * 100) : 0;

    // Avg duration from completed jobs
    const { data: durationData } = await sb
      .from("jobs")
      .select("duration_ms")
      .gte("completed_at", since7d)
      .eq("status", "completed")
      .not("duration_ms", "is", null)
      .limit(200);
    const durations = (durationData ?? [])
      .map((d) => d.duration_ms)
      .filter(Boolean);
    const avgJobDurationMs =
      durations.length > 0
        ? Math.round(
            durations.reduce((a: number, b: number) => a + b, 0) /
              durations.length,
          )
        : 0;
    const maxJobDurationMs = durations.length > 0 ? Math.max(...durations) : 0;

    return {
      jobSuccessRate,
      totalJobs7d: totalJobs,
      selfHealRate,
      selfHealSuccessRate,
      avgJobDurationMs,
      maxJobDurationMs,
      escalationCount7d: escalations,
    };
  } catch {
    return {
      jobSuccessRate: 0,
      totalJobs7d: 0,
      selfHealRate: 0,
      selfHealSuccessRate: 0,
      avgJobDurationMs: 0,
      maxJobDurationMs: 0,
      escalationCount7d: 0,
    };
  }
}

async function getRoadmap() {
  try {
    const items = await parseRoadmapItems();
    return items;
  } catch {
    return [];
  }
}

async function getYoutubeStats() {
  const channelId = config.YOUTUBE_CHANNEL_ID;
  if (!channelId) return { error: "YOUTUBE_CHANNEL_ID not configured" };
  const [stats, videos] = await Promise.all([
    getChannelStats(channelId),
    getRecentVideos(channelId, 5),
  ]);
  return { stats, videos };
}

async function getGoals() {
  try {
    const goals = await listGoals("active");
    return { goals };
  } catch (e) {
    return { error: String(e) };
  }
}

async function getJobPerformance() {
  if (!memoryEnabled)
    return {
      models: [],
      totals: {
        count7d: 0,
        count30d: 0,
        successRate7d: 0,
        successRate30d: 0,
        avgDurationMs7d: 0,
      },
    };
  try {
    const now = Date.now();
    const ago30d = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const ago7d = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const { data } = await getSupabase()
      .from("jobs")
      .select("model,status,duration_ms,started_at")
      .gte("started_at", ago30d.toISOString());

    const rows = data ?? [];

    const byModel: Record<string, typeof rows> = {};
    for (const row of rows) {
      const m = row.model ?? "unknown";
      (byModel[m] = byModel[m] ?? []).push(row);
    }

    const computeStats = (items: typeof rows, cutoff: Date) => {
      const window = items.filter((r) => new Date(r.started_at) >= cutoff);
      const count = window.length;
      const successful = window.filter((r) => r.status === "completed").length;
      const successRate = count > 0 ? successful / count : 0;
      const durations = window
        .map((r) => r.duration_ms)
        .filter((d): d is number => d != null);
      const avgDurationMs =
        durations.length > 0
          ? durations.reduce((a, b) => a + b, 0) / durations.length
          : 0;
      const maxDurationMs = durations.length > 0 ? Math.max(...durations) : 0;
      return { count, successRate, avgDurationMs, maxDurationMs };
    };

    const models = Object.entries(byModel)
      .map(([model, items]) => {
        const s7 = computeStats(items, ago7d);
        const s30 = computeStats(items, ago30d);
        return {
          model,
          count7d: s7.count,
          count30d: s30.count,
          successRate7d: s7.successRate,
          successRate30d: s30.successRate,
          avgDurationMs7d: s7.avgDurationMs,
          maxDurationMs7d: s7.maxDurationMs,
        };
      })
      .sort((a, b) => b.count30d - a.count30d);

    const allS7 = computeStats(rows, ago7d);
    const allS30 = computeStats(rows, ago30d);
    const totals = {
      count7d: allS7.count,
      count30d: allS30.count,
      successRate7d: allS7.successRate,
      successRate30d: allS30.successRate,
      avgDurationMs7d: allS7.avgDurationMs,
    };

    return { models, totals };
  } catch {
    return {
      models: [],
      totals: {
        count7d: 0,
        count30d: 0,
        successRate7d: 0,
        successRate30d: 0,
        avgDurationMs7d: 0,
      },
    };
  }
}

async function getContextBudget() {
  if (!memoryEnabled)
    return {
      topHeavyJobs: [],
      avgDurationByModel: {},
      generatedAt: new Date().toISOString(),
    };
  try {
    const sb = getSupabase();
    const since7d = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const [topRes, allRes] = await Promise.all([
      sb
        .from("jobs")
        .select("id, model, duration_ms, prompt")
        .gte("started_at", since7d)
        .not("duration_ms", "is", null)
        .order("duration_ms", { ascending: false })
        .limit(5),
      sb
        .from("jobs")
        .select("model, duration_ms")
        .gte("started_at", since7d)
        .not("duration_ms", "is", null)
        .limit(500),
    ]);

    const topHeavyJobs = (topRes.data ?? []).map((j) => ({
      id: j.id,
      model: j.model,
      duration_ms: j.duration_ms,
      prompt_preview: j.prompt ? j.prompt.slice(0, 120) : "",
    }));

    const byModel: Record<string, number[]> = {};
    for (const row of allRes.data ?? []) {
      const m = row.model ?? "unknown";
      (byModel[m] = byModel[m] ?? []).push(row.duration_ms as number);
    }
    const avgDurationByModel: Record<string, number> = {};
    for (const [model, durations] of Object.entries(byModel)) {
      avgDurationByModel[model] = Math.round(
        durations.reduce((a, b) => a + b, 0) / durations.length,
      );
    }

    return {
      topHeavyJobs,
      avgDurationByModel,
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return {
      topHeavyJobs: [],
      avgDurationByModel: {},
      generatedAt: new Date().toISOString(),
    };
  }
}

async function getBooks() {
  const { readdir } = await import("node:fs/promises");
  const { homedir } = await import("node:os");
  const HOME = homedir();
  const rawDir = `${HOME}/brain-vault/00 - Inbox/books/_raw`;
  const processedLog = `${HOME}/brain-vault/00 - Inbox/books/processed-books.txt`;

  let inbox: string[] = [];
  let processed: Array<{ hash: string; title: string; date: string }> = [];

  try {
    const files = await readdir(rawDir);
    inbox = files.filter((f) => /\.(pdf|epub|txt)$/i.test(f));
  } catch {
    // dir doesn't exist yet
  }

  try {
    const text = await Bun.file(processedLog).text();
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [hash, title, date] = trimmed.split("|");
      if (hash && title) processed.push({ hash, title, date: date ?? "" });
    }
  } catch {
    // file doesn't exist yet
  }

  return { inbox_count: inbox.length, inbox, processed };
}
