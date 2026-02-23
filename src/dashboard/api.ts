import { memoryEnabled, getSupabase } from "../memory/client.ts";
import { getRecentJobs } from "../jobs/manager.ts";

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
    default:
      return json({ error: "not found" }, 404);
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
