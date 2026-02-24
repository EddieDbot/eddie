import type { ChannelProvider, ChannelStatus, InboxItem } from "../types.ts";
import { getAccessToken, hasGoogleAuth } from "./auth.ts";
import { getSyncState, setSyncState, getUnreadCount } from "../inbox.ts";
import { config } from "../../config.ts";
import { logger } from "../../utils/logger.ts";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const CAL_SCOPES = "https://www.googleapis.com/auth/calendar";
const POLL_INTERVAL_MS = 5 * 60_000;

interface CalEvent {
  id: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email: string; displayName?: string }[];
  hangoutLink?: string;
  creator?: { email?: string };
  status?: string;
}

function eventToItem(event: CalEvent): InboxItem {
  const startTime = event.start?.dateTime ?? event.start?.date ?? "";
  const startFormatted = startTime
    ? new Date(startTime).toLocaleString("en-US", {
        timeZone: config.TIMEZONE,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : "TBD";
  const attendees = event.attendees
    ?.slice(0, 3)
    .map((a) => a.displayName ?? a.email)
    .join(", ");
  const preview = [
    startFormatted,
    attendees ? `with ${attendees}` : "",
    event.description?.slice(0, 80),
  ]
    .filter(Boolean)
    .join(" · ");
  const isUpcoming =
    startTime && new Date(startTime).getTime() - Date.now() < 15 * 60_000;

  return {
    channel: "google-calendar",
    externalId: event.id,
    from: event.creator?.email ?? "calendar",
    subject: event.summary ?? "Untitled Event",
    preview,
    receivedAt: new Date().toISOString(),
    status: "unread",
    priority: isUpcoming ? "high" : "normal",
    metadata: {
      start: startTime,
      end: event.end?.dateTime ?? event.end?.date,
      hangoutLink: event.hangoutLink,
      attendees: event.attendees,
    },
  };
}

async function fetchUpcomingEvents(account: string): Promise<InboxItem[]> {
  const token = await getAccessToken(CAL_SCOPES, account);
  const lastCursor = await getSyncState("google-calendar");
  const now = new Date().toISOString();
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const params = new URLSearchParams({
    timeMin: lastCursor ?? now,
    timeMax: tomorrow,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "20",
  });

  const res = await fetch(
    `${CALENDAR_API}/calendars/primary/events?${params}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) throw new Error(`Calendar list ${res.status}`);
  const data = (await res.json()) as { items?: CalEvent[] };

  await setSyncState("google-calendar", new Date().toISOString());
  return (data.items ?? [])
    .filter((e) => e.status !== "cancelled")
    .map(eventToItem);
}

export function createGoogleCalendarProvider(): ChannelProvider | null {
  if (!hasGoogleAuth()) return null;
  const accounts = (config.COMMS_EMAIL_ACCOUNTS ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  const primary =
    accounts.find((a) => !a.toLowerCase().includes("eddie")) ?? accounts[0];
  if (!primary) return null;

  let lastError: string | undefined;
  let lastPolledAt: string | undefined;

  logger.info("comms:calendar-provider", { account: primary });
  return {
    id: "google-calendar",
    pollIntervalMs: POLL_INTERVAL_MS,
    async poll() {
      const items = await fetchUpcomingEvents(primary);
      lastPolledAt = new Date().toISOString();
      lastError = undefined;
      return items;
    },
    async healthCheck() {
      try {
        const token = await getAccessToken(CAL_SCOPES, primary);
        const res = await fetch(`${CALENDAR_API}/calendars/primary`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10_000),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
    async getStatus(): Promise<ChannelStatus> {
      const counts = await getUnreadCount();
      return {
        channel: "google-calendar",
        enabled: true,
        healthy: !lastError,
        lastPolledAt,
        lastError,
        itemCount: counts["google-calendar"] ?? 0,
      };
    },
  };
}

// Returns formatted upcoming events for display (used by /calendar command)
export async function getUpcomingCalendarEvents(days = 1): Promise<string> {
  if (!hasGoogleAuth()) return "Google Calendar not configured.";
  const accounts = (config.COMMS_EMAIL_ACCOUNTS ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  const primary =
    accounts.find((a) => !a.toLowerCase().includes("eddie")) ?? accounts[0];
  if (!primary) return "No Google account configured.";

  try {
    const token = await getAccessToken(CAL_SCOPES, primary);
    const now = new Date().toISOString();
    const end = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    const params = new URLSearchParams({
      timeMin: now,
      timeMax: end,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "20",
    });
    const res = await fetch(
      `${CALENDAR_API}/calendars/primary/events?${params}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) return `Calendar error: ${res.status}`;
    const data = (await res.json()) as { items?: CalEvent[] };
    const events = (data.items ?? []).filter((e) => e.status !== "cancelled");
    if (events.length === 0) return "No upcoming events.";
    return events
      .map((e) => {
        const start = e.start?.dateTime ?? e.start?.date ?? "";
        const formatted = start
          ? new Date(start).toLocaleString("en-US", {
              timeZone: config.TIMEZONE,
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            })
          : "All day";
        return `• ${formatted}: ${e.summary ?? "Untitled"}`;
      })
      .join("\n");
  } catch (err) {
    return `Calendar error: ${err instanceof Error ? err.message : String(err)}`;
  }
}
