import { config } from "../config.ts";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

type SessionMap = Record<string, string>;

const sessionsPath = () => join(config.SESSION_DIR, "sessions.json");

async function readSessions(): Promise<SessionMap> {
  try {
    const file = Bun.file(sessionsPath());
    return await file.json() as SessionMap;
  } catch {
    return {};
  }
}

async function writeSessions(sessions: SessionMap): Promise<void> {
  mkdirSync(config.SESSION_DIR, { recursive: true });
  await Bun.write(sessionsPath(), JSON.stringify(sessions, null, 2));
}

export async function getOrCreateSession(chatId: number): Promise<string> {
  const sessions = await readSessions();
  const key = String(chatId);

  if (sessions[key]) {
    return sessions[key];
  }

  const sessionId = crypto.randomUUID();
  sessions[key] = sessionId;
  await writeSessions(sessions);
  return sessionId;
}

export async function resetSession(chatId: number): Promise<string> {
  const sessions = await readSessions();
  const key = String(chatId);
  const sessionId = crypto.randomUUID();
  sessions[key] = sessionId;
  await writeSessions(sessions);
  return sessionId;
}

export async function forceNewSession(chatId: number): Promise<string> {
  const sessions = await readSessions();
  const key = String(chatId);
  const sessionId = crypto.randomUUID();
  sessions[key] = sessionId;
  await writeSessions(sessions);
  return sessionId;
}
