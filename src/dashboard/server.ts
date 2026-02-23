import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";
import { handleApi } from "./api.ts";
import {
  handleOAuthStart,
  handleOAuthCallback,
} from "../comms/google/oauth-flow.ts";

type SSEClient = { controller: ReadableStreamDefaultController; id: string };

const clients: SSEClient[] = [];

export function emitEvent(type: string, data: unknown): void {
  const payload = `data: ${JSON.stringify({ type, data, timestamp: new Date().toISOString() })}\n\n`;
  for (let i = clients.length - 1; i >= 0; i--) {
    try {
      clients[i]!.controller.enqueue(new TextEncoder().encode(payload));
    } catch {
      clients.splice(i, 1);
    }
  }
}

function handleSSE(): Response {
  const id = crypto.randomUUID();
  const stream = new ReadableStream({
    start(controller) {
      clients.push({ controller, id });
      controller.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({ type: "connected", data: { id } })}\n\n`,
        ),
      );
    },
    cancel() {
      const idx = clients.findIndex((c) => c.id === id);
      if (idx !== -1) clients.splice(idx, 1);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'";

async function serveStatic(path: string): Promise<Response> {
  const filePath = `${import.meta.dir}/public${path === "/" ? "/index.html" : path}`;
  const file = Bun.file(filePath);
  if (await file.exists()) {
    return new Response(file, { headers: { "Content-Security-Policy": CSP } });
  }
  return new Response("Not found", { status: 404 });
}

export function startDashboard(): void {
  const port = config.DASHBOARD_PORT;

  Bun.serve({
    port,
    hostname: "0.0.0.0",
    async fetch(req) {
      const url = new URL(req.url);

      // SSE feed — no auth needed (EventSource can't set headers)
      if (url.pathname === "/api/feed") return handleSSE();

      // OAuth flow — no auth needed (these are Google redirects)
      if (url.pathname === "/oauth/google/start") return handleOAuthStart(req);
      if (url.pathname === "/oauth/google/callback")
        return handleOAuthCallback(req);

      // Auth check for all other /api/* routes
      if (url.pathname.startsWith("/api/") && url.pathname !== "/api/health") {
        if (config.DASHBOARD_TOKEN) {
          const auth = req.headers.get("authorization");
          if (!auth || auth !== `Bearer ${config.DASHBOARD_TOKEN}`) {
            return new Response(JSON.stringify({ error: "unauthorized" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }
        }
      }

      if (url.pathname.startsWith("/api/")) return handleApi(url.pathname);
      return serveStatic(url.pathname);
    },
  });

  // Emit system metrics every 30s
  setInterval(async () => {
    try {
      const loadFile = await Bun.file("/proc/loadavg")
        .text()
        .catch(() => "0");
      const loadAvg = parseFloat(loadFile.split(" ")[0] ?? "0");
      const memFile = await Bun.file("/proc/meminfo")
        .text()
        .catch(() => "");
      const memTotal =
        parseInt(memFile.match(/MemTotal:\s+(\d+)/)?.[1] ?? "0") * 1024;
      const memAvail =
        parseInt(memFile.match(/MemAvailable:\s+(\d+)/)?.[1] ?? "0") * 1024;
      const usePct =
        memTotal > 0 ? Math.round(((memTotal - memAvail) / memTotal) * 100) : 0;
      emitEvent("system:metrics", { loadAvg1m: loadAvg, memUsePct: usePct });
    } catch {}
  }, 30_000);

  logger.info("EDDIE:dashboard", { port, url: `http://127.0.0.1:${port}` });
}
