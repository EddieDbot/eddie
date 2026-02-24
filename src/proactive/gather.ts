import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";

export type GatherResult = {
  gmailCount: number;
  calendarCount: number;
  errors: string[];
};

export async function gatherFreshData(): Promise<GatherResult> {
  if (!config.COMMS_ENABLED)
    return { gmailCount: 0, calendarCount: 0, errors: [] };

  const result: GatherResult = { gmailCount: 0, calendarCount: 0, errors: [] };

  try {
    const { createGmailProviders } = await import("../comms/google/gmail.ts");
    const { saveItems } = await import("../comms/inbox.ts");
    const providers = createGmailProviders();
    for (const provider of providers) {
      const items = await provider.poll().catch(() => []);
      if (items.length > 0) {
        await saveItems(items).catch(() => {});
        result.gmailCount += items.length;
      }
    }
  } catch (err) {
    result.errors.push(
      `gmail: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    const { createGoogleCalendarProvider } = await import(
      "../comms/google/calendar.ts"
    );
    const { saveItems } = await import("../comms/inbox.ts");
    const provider = createGoogleCalendarProvider();
    if (provider) {
      const items = await provider.poll().catch(() => []);
      if (items.length > 0) {
        await saveItems(items).catch(() => {});
        result.calendarCount += items.length;
      }
    }
  } catch (err) {
    result.errors.push(
      `calendar: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (result.gmailCount > 0 || result.calendarCount > 0) {
    logger.info("gather:fresh-data", {
      gmail: result.gmailCount,
      calendar: result.calendarCount,
    });
  }

  return result;
}
