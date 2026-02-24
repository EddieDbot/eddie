#!/usr/bin/env bun
/**
 * iMessage Relay Server — deploy this on your Mac, NOT on the homelab.
 *
 * Reads ~/Library/Messages/chat.db and exposes messages over HTTP.
 * Also reads AddressBook DB to resolve phone numbers → contact names.
 * EDDIE polls this server from the homelab over Tailscale.
 *
 * Setup on Mac:
 *   1. Grant Terminal/Bun full disk access in System Preferences → Privacy
 *   2. bun run relay-server.ts
 *   3. Or install as LaunchAgent (see ~/Library/LaunchAgents/com.eddie.imessage-relay.plist)
 *
 * Env vars:
 *   RELAY_PORT (default: 3456)
 *   RELAY_API_KEY (optional — set same in COMMS_IMESSAGE_RELAY_KEY on server)
 */

import { Database } from "bun:sqlite";
import { homedir } from "os";
import { join } from "path";
import { readdirSync, existsSync } from "fs";

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

// --- AddressBook contact resolution ---

function findAddressBookDB(): string | null {
  const sourcesDir = join(homedir(), "Library/Application Support/AddressBook/Sources");
  if (!existsSync(sourcesDir)) return null;
  try {
    for (const uuid of readdirSync(sourcesDir)) {
      const dbPath = join(sourcesDir, uuid, "AddressBook-v22.abcddb");
      if (existsSync(dbPath)) return dbPath;
    }
  } catch {}
  return null;
}

const AB_PATH = findAddressBookDB();
const abDb = AB_PATH ? new Database(AB_PATH, { readonly: true }) : null;

if (abDb) {
  console.log(`AddressBook DB: ${AB_PATH}`);
} else {
  console.warn("AddressBook DB not found — contact names will not be resolved");
}

const allContactsStmt = abDb?.prepare(`
  SELECT
    r.Z_PK as pk,
    r.ZFIRSTNAME as first_name,
    r.ZLASTNAME as last_name,
    r.ZORGANIZATION as organization,
    GROUP_CONCAT(DISTINCT p.ZFULLNUMBER) as phones,
    GROUP_CONCAT(DISTINCT e.ZADDRESS) as emails
  FROM ZABCDRECORD r
  LEFT JOIN ZABCDPHONENUMBER p ON r.Z_PK = p.ZOWNER
  LEFT JOIN ZABCDEMAILADDRESS e ON r.Z_PK = e.ZOWNER
  WHERE (p.ZFULLNUMBER IS NOT NULL OR r.ZFIRSTNAME IS NOT NULL OR r.ZLASTNAME IS NOT NULL)
  GROUP BY r.Z_PK
`);

interface ContactRow {
  pk: number;
  first_name: string | null;
  last_name: string | null;
  organization: string | null;
  phones: string | null;
  emails: string | null;
}

interface Contact {
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  organization: string | null;
  phones: string[];
  emails: string[];
}

// Phone → name cache, refreshed every 5 minutes
let phoneToName = new Map<string, string>();
let cacheTs = 0;

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

function refreshCache(): void {
  if (!allContactsStmt || Date.now() - cacheTs < 300_000) return;
  try {
    const rows = allContactsStmt.all() as ContactRow[];
    phoneToName = new Map();
    for (const row of rows) {
      const name =
        [row.first_name, row.last_name].filter(Boolean).join(" ") ||
        row.organization ||
        "";
      if (!name || !row.phones) continue;
      for (const phone of row.phones.split(",")) {
        const digits = normalizePhone(phone);
        if (digits) phoneToName.set(digits, name);
      }
    }
    cacheTs = Date.now();
  } catch (err) {
    console.error("contact cache refresh error:", err);
  }
}

function resolvePhone(raw: string): string {
  if (!raw || raw === "me" || raw === "unknown") return raw;
  refreshCache();
  const digits = normalizePhone(raw);
  return (
    phoneToName.get(digits) ??
    phoneToName.get(digits.slice(-10)) ??
    raw
  );
}

function getAllContacts(): Contact[] {
  if (!allContactsStmt) return [];
  refreshCache();
  try {
    const rows = allContactsStmt.all() as ContactRow[];
    return rows.map((row) => ({
      firstName: row.first_name,
      lastName: row.last_name,
      fullName:
        [row.first_name, row.last_name].filter(Boolean).join(" ") ||
        row.organization ||
        "",
      organization: row.organization,
      phones: row.phones ? row.phones.split(",").filter(Boolean) : [],
      emails: row.emails ? row.emails.split(",").filter(Boolean) : [],
    }));
  } catch (err) {
    console.error("getAllContacts error:", err);
    return [];
  }
}

// --- iMessage queries ---

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
      return new Response(
        JSON.stringify({ ok: true, dbPath: DB_PATH, addressBookLoaded: !!abDb }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    if (url.pathname === "/messages") {
      const sinceMs =
        parseInt(url.searchParams.get("since") ?? "0") || Date.now() - 3_600_000;
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
          from: row.is_from_me ? "me" : resolvePhone(row.handle_id ?? "unknown"),
          rawFrom: row.is_from_me ? "me" : (row.handle_id ?? "unknown"),
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

    if (url.pathname === "/contacts") {
      try {
        const contacts = getAllContacts();
        return new Response(JSON.stringify({ contacts, count: contacts.length }), {
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
