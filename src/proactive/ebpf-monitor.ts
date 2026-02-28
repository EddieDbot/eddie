import net from "node:net";
import { stat } from "node:fs/promises";
import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";

type EbpfProcessExec = { type: "process_exec"; pid: number; ppid: number; comm: string; ts: number };
type EbpfProcessExit = { type: "process_exit"; pid: number; comm: string; ts: number };
type EbpfOomKill = { type: "oom_kill"; pid: number; comm: string; ts: number };
type EbpfOomAdj = { type: "oom_adj"; pid: number; comm: string; score: number; ts: number };
type EbpfTcpConnect = { type: "tcp_connect"; pid: number; comm: string; dport: number; ts: number };
type EbpfMemTick = { type: "mem_tick"; ts: number };

export type EbpfEvent = EbpfProcessExec | EbpfProcessExit | EbpfOomKill | EbpfOomAdj | EbpfTcpConnect | EbpfMemTick;

const handlers: Array<(event: EbpfEvent) => void> = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function onEbpfEvent(handler: (event: EbpfEvent) => void): void {
  handlers.push(handler);
}

function dispatch(event: EbpfEvent): void {
  for (const h of handlers) {
    try { h(event); } catch { /* ignore handler errors */ }
  }
}

function parseEvent(line: string): EbpfEvent | null {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>;
    if (typeof obj.type !== "string") return null;
    return obj as unknown as EbpfEvent;
  } catch {
    return null;
  }
}

async function socketExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isSocket();
  } catch {
    return false;
  }
}

function connect(): void {
  const socketPath = config.EBPF_SOCKET_PATH;
  const client = net.createConnection({ path: socketPath });
  let buf = "";

  client.on("connect", () => {
    logger.info("[ebpf-monitor] connected to eBPF socket");
  });

  client.on("data", (chunk: Buffer) => {
    buf += chunk.toString("utf8");
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const event = parseEvent(trimmed);
      if (event) dispatch(event);
    }
  });

  client.on("error", () => {
    client.destroy();
    scheduleReconnect();
  });

  client.on("close", () => {
    scheduleReconnect();
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    const exists = await socketExists(config.EBPF_SOCKET_PATH);
    if (exists) {
      connect();
    } else {
      scheduleReconnect();
    }
  }, 10_000);
}

// Default handler: alert on OOM kills
onEbpfEvent((event) => {
  if (event.type === "oom_kill") {
    logger.error(`[ebpf-monitor] OOM kill: pid=${event.pid} comm=${event.comm}`);
  }
});

export async function startEbpfMonitor(): Promise<void> {
  if (!config.EBPF_ENABLED) return;
  const exists = await socketExists(config.EBPF_SOCKET_PATH);
  if (exists) {
    connect();
  } else {
    logger.info("[ebpf-monitor] socket not found, will retry in 10s");
    scheduleReconnect();
  }
}
