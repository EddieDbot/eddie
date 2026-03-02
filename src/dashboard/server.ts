import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";
import { handleApi } from "./api.ts";
import {
  handleOAuthStart,
  handleOAuthCallback,
} from "../comms/google/oauth-flow.ts";
import { createJob } from "../jobs/manager.ts";
import { spawnJob } from "../jobs/tmux.ts";

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

      // Public paths — no auth required (preview sites, shareable links, health check)
      const isPublic =
        url.pathname === "/api/health" ||
        url.pathname === "/slack/command" ||
        url.pathname.startsWith("/preview/") ||
        url.pathname === "/oauth/google/callback";

      if (!isPublic && config.DASHBOARD_TOKEN) {
        // Basic Auth gate on everything else
        const auth = req.headers.get("authorization") ?? "";
        const encoded = Buffer.from(
          `${config.DASHBOARD_USER}:${config.DASHBOARD_TOKEN}`,
        ).toString("base64");
        if (auth !== `Basic ${encoded}`) {
          return new Response("Unauthorized", {
            status: 401,
            headers: { "WWW-Authenticate": 'Basic realm="EDDIE"' },
          });
        }
      }

      // OAuth flow (Google redirects — after auth gate so DASHBOARD_TOKEN protects start)
      if (url.pathname === "/oauth/google/start") return handleOAuthStart(req);
      if (url.pathname === "/oauth/google/callback")
        return handleOAuthCallback(req);
      // SSE feed
      if (url.pathname === "/api/feed") return handleSSE();

      // Slack slash commands
      if (url.pathname === "/slack/command" && req.method === "POST") {
        const rawBody = await req.text();
        const signature = req.headers.get("x-slack-signature") ?? "";
        const timestamp = req.headers.get("x-slack-request-timestamp") ?? "";
        const signingSecret = config.SLACK_SIGNING_SECRET ?? "";

        if (signingSecret) {
          const { verifySlackSignature } =
            await import("../comms/slack/commands.ts");
          if (
            !verifySlackSignature(signingSecret, signature, timestamp, rawBody)
          ) {
            return Response.json(
              { error: "Invalid signature" },
              { status: 401 },
            );
          }
        }

        const body = Object.fromEntries(new URLSearchParams(rawBody));
        const command = body.command ?? "";
        const text = body.text ?? "";
        const userId = body.user_id ?? "";

        const { handleSlackCommand } =
          await import("../comms/slack/commands.ts");
        const result = await handleSlackCommand(command, text, userId);
        return Response.json(result);
      }

      // Web chat routes (gated by WEB_CHAT_ENABLED)
      if (config.WEB_CHAT_ENABLED) {
        if (url.pathname === "/chat") {
          return serveStatic("/chat.html");
        }
        if (url.pathname === "/chat.js") {
          return serveStatic("/chat.js");
        }
        if (url.pathname === "/chat/send" && req.method === "POST") {
          try {
            const body = (await req.json()) as { message?: string };
            const message = body.message?.trim();
            if (!message) {
              return Response.json(
                { error: "message is required" },
                { status: 400 },
              );
            }
            const job = await createJob("claude", message);
            await spawnJob(job);
            return Response.json({ jobId: job.id });
          } catch (err) {
            return Response.json(
              { error: err instanceof Error ? err.message : String(err) },
              { status: 500 },
            );
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
