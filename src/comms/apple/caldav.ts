import type { ChannelProvider, ChannelStatus, InboxItem } from "../types.ts";
import { config } from "../../config.ts";
import { getUnreadCount } from "../inbox.ts";
import { logger } from "../../utils/logger.ts";

const ICLOUD_CALDAV = "https://caldav.icloud.com";
const POLL_INTERVAL_MS = 10 * 60_000;

function basicAuth(email: string, password: string): string {
  return "Basic " + btoa(`${email}:${password}`);
}

function parseICalDate(str: string): Date {
  const match = str.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?/);
  if (!match) return new Date();
  const [, y, mo, d, h, mi, s, z] = match;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${z ? "Z" : ""}`);
}

interface ICalEvent {
  uid: string;
  summary: string;
  dtstart: Date;
  dtend?: Date;
  description?: string;
  location?: string;
  organizer?: string;
}

function parseVCalendar(vcal: string): ICalEvent[] {
  const events: ICalEvent[] = [];
  const veventRegex = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
  let match: RegExpExecArray | null;
  while ((match = veventRegex.exec(vcal)) !== null) {
    const block = match[1] ?? "";
    const get = (key: string): string =>
      block.match(new RegExp(`${key}(?:;[^:]*)?:([^\r\n]+)`))?.[1]?.trim() ??
      "";
    const uid = get("UID");
    const dtstartRaw = get("DTSTART");
    if (!uid || !dtstartRaw) continue;
    const dtendRaw = get("DTEND");
    events.push({
      uid,
      summary: get("SUMMARY"),
      dtstart: parseICalDate(dtstartRaw),
      dtend: dtendRaw ? parseICalDate(dtendRaw) : undefined,
      description: get("DESCRIPTION") || undefined,
      location: get("LOCATION") || undefined,
      organizer: get("ORGANIZER") || undefined,
    });
  }
  return events;
}

async function fetchCalDAVEvents(
  email: string,
  password: string,
): Promise<ICalEvent[]> {
  const auth = basicAuth(email, password);

  // Discover principal URL
  const discoverRes = await fetch(ICLOUD_CALDAV, {
    method: "PROPFIND",
    headers: {
      Authorization: auth,
      Depth: "0",
      "Content-Type": "application/xml",
    },
    body: `<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>`,
    signal: AbortSignal.timeout(20_000),
  });
  if (!discoverRes.ok)
    throw new Error(`CalDAV discover failed: ${discoverRes.status}`);

  const discoverXml = await discoverRes.text();
  const principalMatch = discoverXml.match(
    /<current-user-principal>[\s\S]*?<href>(.*?)<\/href>/,
  );
  const principalPath = principalMatch?.[1]?.trim();
  if (!principalPath) throw new Error("No CalDAV principal URL");

  // Get calendar home set
  const calHomeRes = await fetch(`${ICLOUD_CALDAV}${principalPath}`, {
    method: "PROPFIND",
    headers: {
      Authorization: auth,
      Depth: "0",
      "Content-Type": "application/xml",
    },
    body: `<?xml version="1.0"?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><C:calendar-home-set/></D:prop></D:propfind>`,
    signal: AbortSignal.timeout(20_000),
  });
  const calHomeXml = await calHomeRes.text();
  const calHomeMatch = calHomeXml.match(
    /<calendar-home-set>[\s\S]*?<href>(.*?)<\/href>/,
  );
  const calHomePath = calHomeMatch?.[1]?.trim();
  if (!calHomePath) throw new Error("No CalDAV calendar home");

  // Fetch next 24h events
  const now = new Date();
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const fmt = (d: Date): string =>
    (d.toISOString().replace(/[-:]/g, "").split(".")[0] ?? "") + "Z";

  const reportRes = await fetch(`${ICLOUD_CALDAV}${calHomePath}`, {
    method: "REPORT",
    headers: {
      Authorization: auth,
      Depth: "1",
      "Content-Type": "application/xml",
    },
    body: `<?xml version="1.0"?><C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:getetag/><C:calendar-data/></D:prop><C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT"><C:time-range start="${fmt(now)}" end="${fmt(tomorrow)}"/></C:comp-filter></C:comp-filter></C:filter></C:calendar-query>`,
    signal: AbortSignal.timeout(30_000),
  });
  if (!reportRes.ok)
    throw new Error(`CalDAV report failed: ${reportRes.status}`);

  const reportXml = await reportRes.text();
  const calDataRegex = /<calendar-data[^>]*>([\s\S]*?)<\/calendar-data>/g;
  const events: ICalEvent[] = [];
  let m: RegExpExecArray | null;
  while ((m = calDataRegex.exec(reportXml)) !== null) {
    const vcal = (m[1] ?? "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
    events.push(...parseVCalendar(vcal));
  }
  return events;
}

export function createAppleCalDAVProvider(): ChannelProvider | null {
  const email = config.ICLOUD_EMAIL;
  const password = config.ICLOUD_APP_PASSWORD;
  if (!email || !password) return null;

  let lastError: string | undefined;
  let lastPolledAt: string | undefined;
  const seenUids = new Set<string>();

  logger.info("comms:caldav-provider", { email });
  return {
    id: "icloud-calendar",
    pollIntervalMs: POLL_INTERVAL_MS,
    async poll() {
      const events = await fetchCalDAVEvents(email, password);
      lastPolledAt = new Date().toISOString();
      lastError = undefined;

      const newItems: InboxItem[] = [];
      for (const event of events) {
        if (seenUids.has(event.uid)) continue;
        seenUids.add(event.uid);

        const startFormatted = event.dtstart.toLocaleString("en-US", {
          timeZone: config.TIMEZONE,
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });
        const isUpcoming = event.dtstart.getTime() - Date.now() < 15 * 60_000;

        newItems.push({
          channel: "icloud-calendar",
          externalId: event.uid,
          from: event.organizer ?? "iCloud Calendar",
          subject: event.summary,
          preview: [
            startFormatted,
            event.location,
            event.description?.slice(0, 100),
          ]
            .filter(Boolean)
            .join(" · "),
          receivedAt: new Date().toISOString(),
          status: "unread",
          priority: isUpcoming ? "high" : "normal",
          metadata: {
            dtstart: event.dtstart.toISOString(),
            dtend: event.dtend?.toISOString(),
            location: event.location,
          },
        });
      }
      return newItems;
    },
    async healthCheck() {
      try {
        await fetchCalDAVEvents(email, password);
        return true;
      } catch {
        return false;
      }
    },
    async getStatus(): Promise<ChannelStatus> {
      const counts = await getUnreadCount();
      return {
        channel: "icloud-calendar",
        enabled: true,
        healthy: !lastError,
        lastPolledAt,
        lastError,
        itemCount: counts["icloud-calendar"] ?? 0,
      };
    },
  };
}
