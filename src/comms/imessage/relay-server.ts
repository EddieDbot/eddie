#!/usr/bin/env bun
/**
 * iMessage Relay Server — deploy this on your Mac, NOT on the homelab.
 *
 * Reads ~/Library/Messages/chat.db and exposes messages over HTTP.
 * EDDIE polls this server from the homelab over Tailscale.
 *
 * Setup on Mac:
 *   1. Grant Terminal/Bun full disk access in System Preferences → Privacy
 *   2. bun run relay-server.ts
 *   3. Or install as LaunchAgent (see below)
 *
 * LaunchAgent plist (~/.config/launchd/imessage-relay.plist):
 *   Label: com.eddie.imessage-relay
 *   ProgramArguments: ["/usr/local/bin/bun", "run", "/path/to/relay-server.ts"]
 *   RunAtLoad: true
 *   KeepAlive: true
 *
 * Env vars:
 *   RELAY_PORT (default: 3456)
 *   RELAY_API_KEY (optional — set same in COMMS_IMESSAGE_RELAY_KEY on server)
 */

import { Database } from "bun:sqlite";
import { homedir } from "os";
import { join } from "path";

const PORT = parseInt(Bun.env.RELAY_PORT ?? "3456");
const API_KEY = Bun.env.RELAY_API_KEY ?? "";
const DB_PATH = join(homedir(), "Library/Messages/chat.db");

const db = new Database(DB_PATH, { readonly: true });

// Apple's epoch starts Jan 1 2001 (nanoseconds)
const APPLE_EPOCH_MS = 978307200000;

function appleToMs(appleNs: number): number {
  return APPLE_EPOCH_MS + Math.floor(appleNs / 1_000_000);
}

function msToApple(ms: number): number {
  return (ms - APPLE_EPOCH_MS) * 1_000_000;
}

const messageStmt = db.prepare(`
  SELECT
    m.guid,
    m.text,
    m.date,
    m.is_from_me,
    h.id as handle_id,
    c.chat_identifier as chat_id
  FROM message m
  LEFT JOIN handle h ON m.handle_id = h.rowid
  LEFT JOIN chat_message_join cmj ON m.rowid = cmj.message_id
  LEFT JOIN chat c ON cmj.chat_id = c.rowid
  WHERE m.date > ? AND m.text IS NOT NULL AND m.text != ''
  ORDER BY m.date DESC
  LIMIT ?
`);

function checkAuth(req: Request): boolean {
  if (!API_KEY) return true;
  const url = new URL(req.url);
  const key = req.headers.get("x-api-key") ?? url.searchParams.get("key");
  return key === API_KEY;
}

Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);

    if (!checkAuth(req)) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, dbPath: DB_PATH }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/messages") {
      const sinceMs = parseInt(url.searchParams.get("since") ?? "0") || Date.now() - 3_600_000;
      const limit = parseInt(url.searchParams.get("limit") ?? "50");
      const sinceApple = msToApple(sinceMs);

      try {
        const rows = messageStmt.all(sinceApple, limit) as Array<{
          guid: string;
          text: string | null;
          date: number;
          is_from_me: number;
          handle_id: string | null;
          chat_id: string | null;
        }>;

        const messages = rows.map((row) => ({
          id: row.guid,
          text: row.text ?? "",
          from: row.is_from_me ? "me" : (row.handle_id ?? "unknown"),
          chatId: row.chat_id ?? "unknown",
          receivedAt: new Date(appleToMs(row.date)).toISOString(),
          isFromMe: row.is_from_me === 1,
        }));

        return new Response(JSON.stringify({ messages, count: messages.length }), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  },
});

console.log(`iMessage relay running on port ${PORT} (db: ${DB_PATH})`);
