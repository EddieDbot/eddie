import { memoryEnabled, getSupabase } from "../memory/client.ts";
import { getRecentJobs } from "../jobs/manager.ts";
import { listReportsMeta, getReportContent } from "../proactive/playlist.ts";
import { parseRoadmapItems } from "../proactive/report-synthesis.ts";

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

    return {
      jobSuccessRate,
      totalJobs7d: totalJobs,
      selfHealRate,
      selfHealSuccessRate,
      avgJobDurationMs,
      escalationCount7d: escalations,
    };
  } catch {
    return {
      jobSuccessRate: 0,
      totalJobs7d: 0,
      selfHealRate: 0,
      selfHealSuccessRate: 0,
      avgJobDurationMs: 0,
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
